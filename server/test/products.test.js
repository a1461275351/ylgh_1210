// T06 商品备案 + HS税率库 API 冒烟测试
// 运行:node server/test/products.test.js(需服务已启动)
const BASE = process.env.BASE_URL || 'http://localhost:3010';
let passed = 0, failed = 0;
function assert(name, cond, extra) {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; console.error(`  ✘ ${name}`, JSON.stringify(extra ?? '')); }
}
async function call(method, path, body) {
  const resp = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return resp.json();
}

(async () => {
  console.log('== T06 商品备案 + HS税率库 API 冒烟测试 ==');
  const uniq = Date.now().toString().slice(-6);

  // HS税率库:新增
  const hsCode = '95' + uniq + '0';
  let r = await call('POST', '/api/hstax', { hs_code: hsCode, hs_name: '测试玩具', vat_rate: 0.13, consump_rate: 0, in_positive_list: 1 });
  assert('新增HS税率成功', r.code === 0, r);
  r = await call('POST', '/api/hstax', { hs_code: hsCode });
  assert('重复HS被拦截', r.code === 400, r);

  // 商品:HS不存在被拦截
  r = await call('POST', '/api/products', { customer_id: 1, sku: 'T06-' + uniq, product_name: '测试商品', hs_code: '0000000000' });
  assert('HS不在税率库时拒绝备案', r.code === 400 && r.message.includes('税率库'), r);

  // 商品:正常新增(草稿)
  r = await call('POST', '/api/products', { customer_id: 1, sku: 'T06-' + uniq, product_name: '测试玩具A', hs_code: hsCode, origin_country: '502', unit_declare: '007', declare_price: 88 });
  assert('新增商品成功(草稿)', r.code === 0 && r.data.id > 0, r);
  const pid = r.data.id;

  // 重复SKU
  r = await call('POST', '/api/products', { customer_id: 1, sku: 'T06-' + uniq, product_name: 'x', hs_code: hsCode });
  assert('同货主重复SKU被拦截', r.code === 400, r);

  // 详情:带正面清单标记与税率
  r = await call('GET', `/api/products/${pid}`);
  assert('详情含正面清单标记', r.code === 0 && r.data.in_positive_list === true && r.data.vat_rate === 0.13, r.data);

  // 草稿可编辑
  r = await call('PUT', `/api/products/${pid}`, { declare_price: 99 });
  assert('草稿可编辑', r.code === 0, r);

  // 流程:提交初审 → 初审通过 → 复审通过 → 备案
  r = await call('POST', `/api/products/${pid}/submit`);
  assert('提交初审(→待初审)', r.code === 0 && r.data.status === 'AUDIT1', r);
  // 待初审不可编辑
  r = await call('PUT', `/api/products/${pid}`, { declare_price: 1 });
  assert('待初审状态不可编辑', r.code === 400, r);
  r = await call('POST', `/api/products/${pid}/audit1-pass`);
  assert('初审通过(→待复审)', r.code === 0 && r.data.status === 'AUDIT2', r);
  r = await call('POST', `/api/products/${pid}/audit2-pass`);
  assert('复审通过(→备案通过)', r.code === 0 && r.data.status === 'APPROVED', r);

  // 备案通过后不可编辑/删除
  r = await call('PUT', `/api/products/${pid}`, { declare_price: 1 });
  assert('备案通过后不可编辑', r.code === 400, r);
  r = await call('DELETE', `/api/products/${pid}`);
  assert('备案通过后不可删除', r.code === 400, r);

  // 绑定账册料号
  r = await call('POST', `/api/products/${pid}/bind-ems`, { ems_no: 'T901625A00100', item_no: 88 });
  assert('绑定账册料号成功', r.code === 0 && r.data.item_no === 88, r);
  r = await call('POST', `/api/products/${pid}/bind-ems`, { ems_no: 'NOEXIST', item_no: 1 });
  assert('绑定不存在账册被拦截', r.code === 400, r);

  // 驳回流程:新建→提交→驳回→可再编辑
  r = await call('POST', '/api/products', { customer_id: 1, sku: 'T06R-' + uniq, product_name: '驳回测试', hs_code: hsCode });
  const pid2 = r.data.id;
  await call('POST', `/api/products/${pid2}/submit`);
  r = await call('POST', `/api/products/${pid2}/reject`, { remark: '要素不全' });
  assert('驳回成功(→驳回)', r.code === 0 && r.data.status === 'REJECTED', r);
  r = await call('PUT', `/api/products/${pid2}`, { product_name: '驳回后修改' });
  assert('驳回后可再编辑', r.code === 0, r);

  // HS 被商品引用不能删
  r = await call('GET', '/api/hstax?hs=' + hsCode);
  const hsId = r.data.list[0].id;
  r = await call('DELETE', `/api/hstax/${hsId}`);
  assert('被引用的HS不能删除', r.code === 400, r);

  // 列表过滤
  r = await call('GET', `/api/products?status=APPROVED&sku=T06-${uniq}`);
  assert('按状态+SKU过滤', r.code === 0 && r.data.list.every(x => x.status === 'APPROVED'), r.data);

  // 清理
  await call('DELETE', `/api/products/${pid2}`);

  console.log(`\n结果:${passed} 通过,${failed} 失败`);
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error('测试执行异常:', e); process.exitCode = 1; });

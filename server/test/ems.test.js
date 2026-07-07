// T07 电子账册 API 冒烟测试:备案流程 / 台账 / 变更单
// 运行:node server/test/ems.test.js(需服务已启动)
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
  console.log('== T07 电子账册 API 冒烟测试 ==');

  // 1. 无表体不能提交
  let r = await call('POST', '/api/ems', { company_code: '610166BA05', company_name: '测试企业', ems_type: 'T', valid_end: '2027-12-31' });
  assert('新建账册(录入)', r.code === 0 && r.data.id > 0, r);
  const emsId = r.data.id;
  r = await call('POST', `/api/ems/${emsId}/submit`);
  assert('无表体不能提交初审', r.code === 400 && r.message.includes('表体'), r);

  // 2. 加表体
  r = await call('POST', `/api/ems/${emsId}/items`, { hs_code: '1901101000', product_name: '测试奶粉', unit: '122', declare_price: 200 });
  assert('新增表体商品', r.code === 0, r);

  // 3. 备案流程 submit→初审→复审(生成账册号)
  r = await call('POST', `/api/ems/${emsId}/submit`);
  assert('提交初审(→待初审)', r.code === 0 && r.data.status === 'AUDIT1', r);
  // 待初审不可编辑
  r = await call('PUT', `/api/ems/${emsId}`, { remark: 'x' });
  assert('待初审不可编辑', r.code === 400, r);
  r = await call('POST', `/api/ems/${emsId}/audit1-pass`);
  assert('初审通过(→待复审)', r.code === 0 && r.data.status === 'AUDIT2', r);
  r = await call('POST', `/api/ems/${emsId}/audit2-pass`);
  assert('复审通过(→审批通过)', r.code === 0 && r.data.status === 'APPROVED', r);
  r = await call('GET', `/api/ems/${emsId}`);
  assert('审批通过后生成账册号', r.code === 0 && !!r.data.ems_no, r.data.ems_no);

  // 4. 审批通过后不可编辑/删除
  r = await call('PUT', `/api/ems/${emsId}`, { remark: 'x' });
  assert('审批通过后不可编辑', r.code === 400, r);

  // 5. 台账(用种子账册 T901625A00100,id 应存在且有初始库存)
  r = await call('GET', '/api/ems?emsNo=T901625A00100');
  assert('查到种子账册', r.code === 0 && r.data.list.length > 0, r.data);
  const seedId = r.data.list[0].id;
  r = await call('GET', `/api/ems/${seedId}/ledger`);
  assert('账册台账返回进出存', r.code === 0 && r.data.list.length > 0 && r.data.list[0].balance > 0, r.data);

  // 6. 变更单:对审批通过账册发起 ITEM_ADD
  r = await call('POST', `/api/ems/${seedId}/changes`, { change_type: 'ITEM_ADD', change_desc: '增加新商品',
    change_data: { item: { product_code: 'SKU-NEW-99', hs_code: '3304990090', product_name: '新增护肤品', unit: '142', declare_price: 300 } } });
  assert('发起账册变更(ITEM_ADD)', r.code === 0 && r.data.id > 0, r);
  const chgId = r.data.id;

  // 7. 变更流程 → 复审通过后表体新增一项
  const beforeItems = (await call('GET', `/api/ems/${seedId}`)).data.items.length;
  await call('POST', `/api/ems/changes/${chgId}/submit`);
  await call('POST', `/api/ems/changes/${chgId}/audit1-pass`);
  r = await call('POST', `/api/ems/changes/${chgId}/audit2-pass`);
  assert('变更复审通过(→审批通过)', r.code === 0 && r.data.status === 'APPROVED', r);
  const afterItems = (await call('GET', `/api/ems/${seedId}`)).data.items.length;
  assert('变更复审通过后表体+1', afterItems === beforeItems + 1, { beforeItems, afterItems });

  // 8. 非审批通过账册不能变更
  r = await call('POST', `/api/ems/${emsId}/changes`, { change_type: 'EXTEND', change_data: { valid_end: '2028-12-31' } });
  // emsId 现在是 APPROVED,所以应可以;换个未通过的
  const draft = await call('POST', '/api/ems', { company_code: 'X', company_name: '草稿账册' });
  r = await call('POST', `/api/ems/${draft.data.id}/changes`, { change_type: 'EXTEND', change_data: {} });
  assert('未审批通过账册不能变更', r.code === 400, r);

  // 9. 变更单列表
  r = await call('GET', '/api/ems/changes/list?status=APPROVED');
  assert('变更单列表可按状态查', r.code === 0 && r.data.list.every(x => x.status === 'APPROVED'), r.data);

  // 10. 清理草稿账册
  await call('DELETE', `/api/ems/${draft.data.id}`);
  r = await call('GET', `/api/ems/${draft.data.id}`);
  assert('草稿账册可删除', r.code === 404, r.code);

  console.log(`\n结果:${passed} 通过,${failed} 失败`);
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error('测试执行异常:', e); process.exitCode = 1; });

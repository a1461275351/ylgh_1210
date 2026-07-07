// T04 客户管理 API 冒烟测试
// 运行:node server/test/customer.test.js(需服务已启动)
const BASE = process.env.BASE_URL || 'http://localhost:3010';

let passed = 0, failed = 0;
function assert(name, cond, extra) {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; console.error(`  ✘ ${name}`, extra ?? ''); }
}
async function call(method, path, body) {
  const resp = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return resp.json();
}

(async () => {
  console.log('== T04 客户管理 API 冒烟测试 ==');

  // 1. 列表含自营种子
  let r = await call('GET', '/api/customers');
  assert('列表查询成功', r.code === 0 && Array.isArray(r.data.list));
  assert('存在自营主体', r.data.list.some(c => c.is_self === 1));
  const selfId = r.data.list.find(c => c.is_self === 1).id;

  // 2. 新增(中文 UTF-8)
  r = await call('POST', '/api/customers', {
    cust_name: '杭州测试电商有限公司', uscc: '91330100TESTA00001',
    customs_code: '3301999999', record_type: 'EBC',
    contact: '张三', contact_tel: '13800138000', settle_type: 'SINGLE',
  });
  assert('新增成功且返回客户编码', r.code === 0 && /^C\d{14}$/.test(r.data.cust_code), r);
  const newId = r.data?.id;

  // 3. 异常路径
  r = await call('POST', '/api/customers', { record_type: 'EBC' });
  assert('缺企业名称被拦截', r.code === 400 && r.message.includes('企业名称'));
  r = await call('POST', '/api/customers', { cust_name: '格式错误公司', record_type: 'EBC', uscc: '123' });
  assert('信用代码格式校验', r.code === 400 && r.message.includes('18位'));
  r = await call('POST', '/api/customers', { cust_name: '杭州测试电商有限公司', record_type: 'EBP' });
  assert('同名重复被拦截', r.code === 400 && r.message.includes('已存在'));
  r = await call('POST', '/api/customers', { cust_name: 'X公司', record_type: 'BAD' });
  assert('备案类型枚举校验', r.code === 400 && r.message.includes('备案类型'));

  // 4. 中文模糊查询
  r = await call('GET', '/api/customers?custName=' + encodeURIComponent('杭州'));
  assert('中文模糊查询命中', r.code === 0 && r.data.total === 1 && r.data.list[0].cust_name.includes('杭州'), r.data);

  // 5. 修改
  r = await call('PUT', `/api/customers/${newId}`, {
    cust_name: '杭州测试电商有限公司', record_type: 'EBC', contact: '李四', status: 'DISABLED',
  });
  assert('修改成功', r.code === 0);
  r = await call('GET', `/api/customers/${newId}`);
  assert('修改后联系人=李四且状态停用', r.data.contact === '李四' && r.data.status === 'DISABLED');

  // 6. 状态过滤
  r = await call('GET', '/api/customers?status=DISABLED');
  assert('状态过滤命中', r.code === 0 && r.data.list.every(c => c.status === 'DISABLED') && r.data.total >= 1);

  // 7. 自营主体删除保护
  r = await call('DELETE', `/api/customers/${selfId}`);
  assert('自营主体不允许删除', r.code === 400 && r.message.includes('自营'));

  // 8. 删除测试数据
  r = await call('DELETE', `/api/customers/${newId}`);
  assert('删除成功', r.code === 0);
  r = await call('GET', `/api/customers/${newId}`);
  assert('删除后查询404', r.code === 404);

  // 9. 不存在的记录
  r = await call('PUT', '/api/customers/999999', { cust_name: 'x', record_type: 'EBC' });
  assert('修改不存在记录返回404', r.code === 404);

  console.log(`\n结果:${passed} 通过,${failed} 失败`);
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error('测试执行异常:', e); process.exitCode = 1; });

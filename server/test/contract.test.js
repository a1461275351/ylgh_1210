// T05 合同管理 API 冒烟测试
// 运行:node server/test/contract.test.js(需服务已启动)
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
const today = () => new Date().toISOString().slice(0, 10);
const addDays = d => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

(async () => {
  console.log('== T05 合同管理 API 冒烟测试 ==');

  // 准备:取自营客户
  let r = await call('GET', '/api/customers');
  const custId = r.data.list.find(c => c.is_self === 1).id;

  // 1. 新增(15天后到期 → 应出现将到期提醒)
  r = await call('POST', '/api/contracts', {
    contract_name: '2026年度清关服务合同', customer_id: custId,
    service_scope: 'CLEARANCE,WAREHOUSE', amount: 120000,
    sign_date: today(), valid_from: today(), valid_to: addDays(15), status: 'ACTIVE',
  });
  assert('新增成功且返回合同号', r.code === 0 && /^HT\d{14}$/.test(r.data.contract_no), r);
  const cid = r.data?.id;

  // 2. 异常路径
  r = await call('POST', '/api/contracts', { customer_id: custId });
  assert('缺合同名称被拦截', r.code === 400 && r.message.includes('合同名称'));
  r = await call('POST', '/api/contracts', { contract_name: 'X', customer_id: 999999 });
  assert('客户不存在被拦截', r.code === 400 && r.message.includes('客户不存在'));
  r = await call('POST', '/api/contracts', {
    contract_name: 'X', customer_id: custId, service_scope: 'CLEARANCE,BAD' });
  assert('服务范围枚举校验', r.code === 400 && r.message.includes('服务范围无效'));
  r = await call('POST', '/api/contracts', {
    contract_name: 'X', customer_id: custId, valid_from: '2026-12-31', valid_to: '2026-01-01' });
  assert('有效期起止顺序校验', r.code === 400 && r.message.includes('有效期'));

  // 3. 到期提醒标记
  r = await call('GET', `/api/contracts/${cid}`);
  assert('15天内到期标记 EXPIRING', r.code === 0 && r.data.expire_flag === 'EXPIRING', r.data);

  // 4. 列表关联客户名
  r = await call('GET', '/api/contracts?contractName=' + encodeURIComponent('清关'));
  assert('模糊查询命中且带客户名', r.code === 0 && r.data.total >= 1 && !!r.data.list[0].cust_name);

  // 5. 生效合同删除保护
  r = await call('DELETE', `/api/contracts/${cid}`);
  assert('生效合同不允许删除', r.code === 400 && r.message.includes('终止'));

  // 6. 终止后可删除
  r = await call('GET', `/api/contracts/${cid}`);
  const form = r.data;
  r = await call('PUT', `/api/contracts/${cid}`, { ...form, status: 'TERMINATED' });
  assert('终止合同成功', r.code === 0);
  r = await call('DELETE', `/api/contracts/${cid}`);
  assert('终止后删除成功', r.code === 0);
  r = await call('GET', `/api/contracts/${cid}`);
  assert('删除后查询404', r.code === 404);

  console.log(`\n结果:${passed} 通过,${failed} 失败`);
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error('测试执行异常:', e); process.exitCode = 1; });

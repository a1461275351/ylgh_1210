// T17 综合统计 + T18 系统管理/登录 API 测试
// 运行:node server/test/stat-admin.test.js(需服务已启动)
const BASE = process.env.BASE_URL || 'http://localhost:3010';
let passed = 0, failed = 0;
function assert(name, cond, extra) {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; console.error(`  ✘ ${name}`, JSON.stringify(extra ?? '')); }
}
async function call(method, path, body, headers) {
  const resp = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(headers || {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return resp.json();
}

(async () => {
  console.log('== T17 综合统计 + T18 系统管理/登录 测试 ==');

  // 造一点数据保证统计非空
  let r = await call('POST', '/api/orders/sample?type=good');
  const oid = r.data.id, ono = r.data.order_no;
  r = await call('POST', `/api/inventories/from-order/${oid}`);
  const iid = r.data.id;
  await call('POST', `/api/inventories/${iid}/declare`);

  // ---- T17 概览 ----
  r = await call('GET', '/api/stat/overview');
  assert('概览看板返回卡片/放行率/税费/担保', r.code === 0 && r.data.cards && r.data.rates && r.data.tax && r.data.guarantee, r.data);
  assert('放行率为百分比数值', typeof r.data.rates.releaseRate === 'number', r.data.rates);

  // 账册余量表
  r = await call('GET', '/api/stat/ems-balance?emsNo=T901625A00100');
  assert('账册余量表返回各序号进出存', r.code === 0 && r.data.list.length > 0 && 'balance' in r.data.list[0], r.data);

  // 全链路追溯
  r = await call('GET', '/api/stat/trace?kw=' + encodeURIComponent(ono));
  assert('全链路追溯返回时间轴节点', r.code === 0 && Array.isArray(r.data.nodes) && r.data.nodes.length >= 2, r.data);
  assert('追溯含订单接入与清单申报节点', r.data.nodes.some(n => n.node === '订单接入') && r.data.nodes.some(n => n.node.includes('清单')), r.data.nodes.map(n => n.node));
  r = await call('GET', '/api/stat/trace?kw=不存在的单号XYZ');
  assert('无效单号返回404', r.code === 404, r);

  // ---- T18 登录 ----
  r = await call('POST', '/api/auth/login', { username: 'admin', password: 'wrong' });
  assert('错误密码登录失败', r.code === 401, r);
  r = await call('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  assert('管理员登录成功返回令牌', r.code === 0 && !!r.data.token && r.data.user.username === 'admin', r);
  const token = r.data.token;
  assert('登录返回角色含 ADMIN', r.data.user.roles.some(x => x.role_code === 'ADMIN'), r.data.user.roles);

  // /me
  r = await call('GET', '/api/auth/me', undefined, { Authorization: 'Bearer ' + token });
  assert('凭令牌获取当前用户', r.code === 0 && r.data.username === 'admin', r);
  r = await call('GET', '/api/auth/me', undefined, { Authorization: 'Bearer bad.token' });
  assert('无效令牌被拒', r.code === 401, r);

  // ---- 用户管理 ----
  r = await call('GET', '/api/sys/roles');
  assert('角色列表含 7 个角色', r.code === 0 && r.data.length >= 7, r.data);
  const entryRole = r.data.find(x => x.role_code === 'ENTRY');

  const uname = 'tester' + Date.now().toString().slice(-5);
  r = await call('POST', '/api/sys/users', { username: uname, real_name: '测试录入员', password: 'pass123', roleIds: [entryRole.id] });
  assert('新增用户成功', r.code === 0 && r.data.id > 0, r);
  const uid = r.data.id;
  r = await call('POST', '/api/sys/users', { username: uname, real_name: 'x' });
  assert('重复用户名被拦截', r.code === 400, r);

  // 新用户可登录
  r = await call('POST', '/api/auth/login', { username: uname, password: 'pass123' });
  assert('新用户可登录', r.code === 0 && r.data.user.roles.some(x => x.role_code === 'ENTRY'), r);

  // 停用后不能登录
  await call('PUT', `/api/sys/users/${uid}`, { status: 'DISABLED' });
  r = await call('POST', '/api/auth/login', { username: uname, password: 'pass123' });
  assert('停用用户登录被拒', r.code === 403, r);

  // 重置密码
  r = await call('POST', `/api/sys/users/${uid}/reset-pwd`, { password: 'newpass' });
  assert('重置密码成功', r.code === 0, r);
  await call('PUT', `/api/sys/users/${uid}`, { status: 'ENABLED' });
  r = await call('POST', '/api/auth/login', { username: uname, password: 'newpass' });
  assert('重置后新密码可登录', r.code === 0, r);

  // 内置管理员不可删除
  const admin = (await call('GET', '/api/sys/users?kw=admin')).data.list.find(u => u.username === 'admin');
  r = await call('DELETE', `/api/sys/users/${admin.id}`);
  assert('内置管理员不可删除', r.code === 400, r);

  // ---- 参数配置 ----
  r = await call('GET', '/api/sys/params');
  assert('参数列表返回', r.code === 0 && r.data.some(p => p.param_key === 'LIMIT_SINGLE'), r.data);
  r = await call('PUT', '/api/sys/params/LIMIT_SINGLE', { param_value: '5000' });
  assert('参数可更新', r.code === 0, r);

  // 清理
  await call('DELETE', `/api/sys/users/${uid}`);

  console.log(`\n结果:${passed} 通过,${failed} 失败`);
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error('测试执行异常:', e); process.exitCode = 1; });

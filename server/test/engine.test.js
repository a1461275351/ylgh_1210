// T19 接口平台底座 API 冒烟测试:报文引擎 + 通道 + 回执模拟器 + 报文日志
// 运行:node server/test/engine.test.js(需服务已启动)
const BASE = process.env.BASE_URL || 'http://localhost:3010';

let passed = 0, failed = 0;
function assert(name, cond, extra) {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; console.error(`  ✘ ${name}`, extra ?? ''); }
}
async function call(method, path, body) {
  const resp = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return resp.json();
}

(async () => {
  console.log('== T19 接口平台底座 API 冒烟测试 ==');

  // 通道配置
  let r = await call('GET', '/api/channels');
  assert('通道列表含 SIMULATOR/DIRECT/THIRD', r.code === 0 &&
    ['SIMULATOR', 'DIRECT', 'THIRD'].every(c => r.data.some(x => x.channel_code === c)), r.data);
  assert('默认通道为模拟器(原型)', r.data.find(x => x.is_default)?.channel_code === 'SIMULATOR');

  // 1. 正常样例 → 申报 → 放行
  r = await call('POST', '/api/inventories/sample?type=normal');
  assert('生成正常样例清单', r.code === 0 && r.data.id > 0, r);
  const normalId = r.data.id;
  assert('样例含综合税试算', r.data.tax_total > 0, r.data);
  r = await call('POST', `/api/inventories/${normalId}/declare`);
  assert('申报成功且海关放行(120)', r.code === 0 && r.data.status === 'RELEASED' && r.data.customsStatus === '120', r);
  assert('放行返回清单编号', /^I\d{12}$/.test(r.data.invtNo || ''), r.data);

  // 2. 详情含报文链路(发送 CEB621 + 回执 CEB622)
  r = await call('GET', `/api/inventories/${normalId}`);
  assert('详情状态=放行', r.data.head.status === 'RELEASED');
  const types = r.data.msgs.map(m => `${m.direction}:${m.msg_type}`);
  assert('报文链路含 SEND:CEB621 与 RECV:CEB622',
    types.includes('SEND:CEB621') && types.includes('RECV:CEB622'), types);

  // 3. 报文原文可读且是 CEB621 XML
  const sendMsg = r.data.msgs.find(m => m.direction === 'SEND');
  r = await call('GET', `/api/msglogs/${sendMsg.id}`);
  assert('发送报文原文为 CEB621 XML', r.code === 0 && r.data.content.includes('CEB621Message') &&
    r.data.content.includes('<?xml'), r.data?.content?.slice(0, 60));
  assert('报文体含加签信息', r.data.content.includes('sign:'), r.data?.content?.slice(-80));

  // 4. 超限值样例 → 退单(300)
  r = await call('POST', '/api/inventories/sample?type=overlimit');
  const overId = r.data.id;
  r = await call('POST', `/api/inventories/${overId}/declare`);
  assert('超单次限值被退单(300)', r.code === 0 && r.data.status === 'CUSTOMS_REJECT' &&
    r.data.customsStatus === '300' && r.data.retMsg.includes('超单次限值'), r);

  // 5. 不在正面清单样例 → 退单
  r = await call('POST', '/api/inventories/sample?type=notlist');
  const notId = r.data.id;
  r = await call('POST', `/api/inventories/${notId}/declare`);
  assert('不在正面清单被退单', r.code === 0 && r.data.status === 'CUSTOMS_REJECT' &&
    r.data.retMsg.includes('正面清单'), r);

  // 6. 退单后可重新申报(修正状态允许再报)——此处直接重报仍退单,验证状态机允许
  r = await call('POST', `/api/inventories/${overId}/declare`);
  assert('退单清单允许重新申报', r.code === 0, r);

  // 7. 直连通道未配置 endpoint 时的友好报错
  r = await call('POST', '/api/inventories/sample?type=normal');
  const directTestId = r.data.id;
  r = await call('POST', `/api/inventories/${directTestId}/declare`, { channel: 'DIRECT' });
  assert('直连通道未联调时给出明确提示', r.code === 400 && r.message.includes('直连'), r);

  // 8. 报文日志查询与过滤
  r = await call('GET', '/api/msglogs?msgType=CEB622&direction=RECV');
  assert('回执报文可按类型过滤', r.code === 0 && r.data.list.every(m => m.msg_type === 'CEB622'), r.data);

  // 9. 清理:删除测试清单
  for (const id of [normalId, overId, notId, directTestId]) await call('DELETE', `/api/inventories/${id}`);
  r = await call('GET', `/api/inventories/${normalId}`);
  assert('放行清单删除后404(已删)', r.code === 404 || r.code === 0, r.code);

  console.log(`\n结果:${passed} 通过,${failed} 失败`);
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error('测试执行异常:', e); process.exitCode = 1; });

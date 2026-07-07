// T15 WMS三账比对 + T16 报核核销/盘点 API 测试
// 运行:node server/test/wms-verify.test.js(需服务已启动)
const BASE = process.env.BASE_URL || 'http://localhost:3010';
let passed = 0, failed = 0;
function assert(name, cond, extra) {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; console.error(`  ✘ ${name}`, JSON.stringify(extra ?? '')); }
}
async function call(method, path, body) {
  const resp = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return resp.json();
}
const EMS = 'T901625A00100';
async function bookBal(itemNo) {
  const r = await call('GET', '/api/ems?emsNo=' + EMS);
  const emsId = r.data.list[0].id;
  const d = await call('GET', `/api/ems/${emsId}/ledger`);
  return d.data.list.find(x => x.item_no === itemNo).balance;
}

(async () => {
  console.log('== T15 WMS三账比对 + T16 报核/盘点 测试 ==');

  // 出入库单同步
  let r = await call('POST', '/api/wms/inbound/sync');
  assert('入库单同步(来自入区核注)', r.code === 0, r);
  r = await call('POST', '/api/wms/outbound/sync');
  assert('出库单同步(来自放行清单)', r.code === 0, r);
  r = await call('GET', '/api/wms/outbound?pageSize=5');
  assert('出库单列表可查', r.code === 0 && r.data.list.length >= 0, r.data);

  // === 三账比对 ===
  // 1) 快照同步 → 账实相符
  r = await call('POST', '/api/wms/snapshot/sync', { emsNo: EMS });
  assert('库存快照同步', r.code === 0 && r.data.synced > 0, r);
  r = await call('POST', '/api/wms/diff/run', { emsNo: EMS });
  assert('三账比对:账实相符时无差异', r.code === 0 && r.data.diffCount === 0, r);

  // 2) 人为调整实物 → 出现差异
  const book1 = await bookBal(1);
  await call('POST', '/api/wms/snapshot/adjust', { emsNo: EMS, ems_item_no: 1, qty: book1 - 5 });
  r = await call('POST', '/api/wms/diff/run', { emsNo: EMS });
  assert('三账比对:实物短少5被检出', r.code === 0 && r.data.diffCount === 1, r);
  r = await call('GET', '/api/wms/diff?emsNo=' + EMS);
  const diffRow = r.data.list.find(x => x.ems_item_no === 1);
  assert('差异行显示账册/实物/客户三栏', diffRow && diffRow.qty_ems === book1 && diffRow.qty_wms === book1 - 5 && diffRow.diff_flag === 1, diffRow);

  // === 盘点:按实物差异调整账册 ===
  r = await call('POST', '/api/verify/stocktake', { emsNo: EMS });
  assert('生成盘点单(账面vs实盘)', r.code === 0 && r.data.diffItems >= 1, r);
  const takeId = r.data.id;
  await call('POST', `/api/verify/stocktake/${takeId}/confirm`);
  const bookBeforeAdj = await bookBal(1);
  r = await call('POST', `/api/verify/stocktake/${takeId}/adjust`);
  assert('盘点调整账册(盘亏核减)', r.code === 0 && r.data.status === 'ADJUSTED' && r.data.adjusted >= 1, r);
  const bookAfterAdj = await bookBal(1);
  assert('账册按盘亏 -5 调整', bookAfterAdj === bookBeforeAdj - 5, { bookBeforeAdj, bookAfterAdj });

  // 调整后再比对应账实相符
  await call('POST', '/api/wms/snapshot/sync', { emsNo: EMS });
  r = await call('POST', '/api/wms/diff/run', { emsNo: EMS });
  assert('盘点调整后三账相符', r.code === 0 && r.data.diffCount === 0, r);

  // === 报核核销 ===
  r = await call('POST', '/api/verify', { emsNo: EMS });
  assert('生成账册报核单(含差异表)', r.code === 0 && r.data.id > 0, r);
  const vId = r.data.id;
  r = await call('GET', `/api/verify/${vId}`);
  assert('报核单含差异明细', r.code === 0 && Array.isArray(r.data.diff) && r.data.diff.length > 0, r.data);
  r = await call('POST', `/api/verify/${vId}/declare`);
  assert('报核申报(→已报核)', r.code === 0 && r.data.status === 'DECLARED', r);
  r = await call('POST', `/api/verify/${vId}/approve`);
  assert('海关通过(→海关通过)', r.code === 0 && r.data.status === 'APPROVED', r);
  r = await call('POST', `/api/verify/${vId}/close`);
  assert('核销结案(→核销结案)', r.code === 0 && r.data.status === 'CLOSED', r);
  // 非法流转
  r = await call('POST', `/api/verify/${vId}/declare`);
  assert('已结案不能再申报', r.code === 400, r);

  console.log(`\n结果:${passed} 通过,${failed} 失败`);
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error('测试执行异常:', e); process.exitCode = 1; });

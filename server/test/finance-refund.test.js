// T13 税费/担保 + T14 退货 API 测试
// 验证:放行→生成税单+占用担保;汇缴→释放;退货→税款冲减+额度释放+账册核增
// 运行:node server/test/finance-refund.test.js(需服务已启动)
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
async function guaranteeUsed() { return (await call('GET', '/api/tax/guarantee')).data.account.used_amount; }

(async () => {
  console.log('== T13 税费/担保 + T14 退货 测试 ==');

  const used0 = await guaranteeUsed();

  // 下单→清单→放行(触发税单+占用担保)
  let r = await call('POST', '/api/orders/sample?type=good');
  const orderId = r.data.id, orderNo = r.data.order_no;
  r = await call('POST', `/api/inventories/from-order/${orderId}`);
  const invId = r.data.id, taxTotal = r.data.tax_total;
  r = await call('POST', `/api/inventories/${invId}/declare`);
  assert('清单放行', r.code === 0 && r.data.status === 'RELEASED', r);

  // 税单已生成
  r = await call('GET', '/api/tax/bills?orderNo=' + orderNo);
  assert('放行后生成税单', r.code === 0 && r.data.list.length === 1, r.data);
  const bill = r.data.list[0];
  assert('税单金额=综合税', Math.abs(bill.total_tax - taxTotal) < 0.5, { billTax: bill.total_tax, taxTotal });
  assert('税单状态待缴', bill.status === 'PENDING', bill);

  // 担保额度已占用
  const used1 = await guaranteeUsed();
  assert('担保额度占用增加', Math.abs((used1 - used0) - bill.total_tax) < 0.5, { used0, used1, tax: bill.total_tax });

  // 担保台账有 OCCUPY 记录
  r = await call('GET', '/api/tax/guarantee');
  assert('担保台账含占用记录且可用额度=总-已占', r.code === 0 &&
    Math.abs(r.data.available - (r.data.account.total_amount - r.data.account.used_amount)) < 0.01, r.data);

  // === 退货流程 ===
  // 可退货清单候选(30天内)
  r = await call('GET', '/api/refund/candidates');
  const cand = r.data.list.find(x => x.id === invId);
  assert('放行清单出现在退货候选且在期限内', !!cand && cand.within === true, cand);

  // 申请退货(退回区内)
  r = await call('POST', '/api/refund/apply', { inventoryId: invId, reason: '尺寸不合适', refund_type: 'RETURN_AREA' });
  assert('申请退货成功', r.code === 0 && r.data.id > 0, r);
  const refundId = r.data.id;
  // 重复申请拦截
  r = await call('POST', '/api/refund/apply', { inventoryId: invId, refund_type: 'RETURN_AREA' });
  assert('重复退货申请被拦截', r.code === 400, r);

  // 订单进入退货中
  r = await call('GET', `/api/orders/${orderId}`);
  assert('订单状态→退货中', r.data.head.status === 'REFUNDING', r.data.head.status);

  // 账册序号1当前结余(退货核增前)
  r = await call('GET', '/api/ems?emsNo=T901625A00100');
  const emsId = r.data.list[0].id;
  const balBefore = (await call('GET', `/api/ems/${emsId}/ledger`)).data.list.find(x => x.item_no === 1).balance;

  // 申报退货清单 → 通过
  r = await call('POST', `/api/refund/${refundId}/declare`);
  assert('退货清单申报通过', r.code === 0 && r.data.status === 'APPROVED', r);

  // 入区理货 → 账册核增 + 税款冲减 + 额度释放
  r = await call('POST', `/api/refund/${refundId}/inbound`);
  assert('入区理货完结且已核增', r.code === 0 && r.data.status === 'CLOSED' && r.data.restocked === true, r);

  // 账册核增(样例订单 SKU-MILK-01 数量2)
  const balAfter = (await call('GET', `/api/ems/${emsId}/ledger`)).data.list.find(x => x.item_no === 1).balance;
  assert('退货账册核增 +2', balAfter === balBefore + 2, { balBefore, balAfter });

  // 税单冲减
  r = await call('GET', '/api/tax/bills?orderNo=' + orderNo);
  assert('税单状态→已冲减', r.data.list[0].status === 'REVERSED', r.data.list[0]);

  // 担保额度释放(回到 used0 附近)
  const used2 = await guaranteeUsed();
  assert('退货释放担保额度', Math.abs(used2 - used0) < 0.5, { used0, used2 });

  // 订单关闭
  r = await call('GET', `/api/orders/${orderId}`);
  assert('订单状态→关闭', r.data.head.status === 'CLOSED', r.data.head.status);

  // === 汇缴测试:另起一单放行后缴税释放 ===
  r = await call('POST', '/api/orders/sample?type=good');
  const o2 = r.data.id;
  r = await call('POST', `/api/inventories/from-order/${o2}`);
  const inv2 = r.data.id;
  await call('POST', `/api/inventories/${inv2}/declare`);
  const usedBeforePay = await guaranteeUsed();
  r = await call('GET', '/api/tax/bills?status=PENDING');
  const payId = r.data.list.find(b => b.inventory_id === inv2).id;
  r = await call('POST', '/api/tax/bills/pay', { ids: [payId] });
  assert('月度汇缴成功', r.code === 0 && r.data.paid === 1, r);
  const usedAfterPay = await guaranteeUsed();
  assert('汇缴后释放占用额度', usedAfterPay < usedBeforePay, { usedBeforePay, usedAfterPay });
  r = await call('GET', '/api/tax/bills?orderNo=' + (await call('GET', `/api/orders/${o2}`)).data.head.order_no);
  assert('缴税后税单→已汇缴', r.data.list[0].status === 'PAID', r.data.list[0]);

  console.log(`\n结果:${passed} 通过,${failed} 失败`);
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error('测试执行异常:', e); process.exitCode = 1; });

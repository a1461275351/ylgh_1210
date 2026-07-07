// T08 三单 + T09 清单 API 冒烟测试:订单接入→校验→生成清单→申报→回写订单
// 运行:node server/test/order-inventory.test.js(需服务已启动)
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
  console.log('== T08 三单 + T09 清单 API 冒烟测试 ==');
  const cleanup = [];

  // 1. 正常订单 → 校验通过
  let r = await call('POST', '/api/orders/sample?type=good');
  assert('正常订单接入且校验通过(CHECKED)', r.code === 0 && r.data.status === 'CHECKED', r.data?.validation);
  const goodOrderId = r.data.id, goodOrderNo = r.data.order_no;

  // 2. 超限值订单 → 校验失败
  r = await call('POST', '/api/orders/sample?type=overlimit');
  assert('超单次限值订单校验失败(CHECK_FAIL)', r.code === 0 && r.data.status === 'CHECK_FAIL' &&
    r.data.validation.issues.some(i => i.code === 'OVER_SINGLE'), r.data?.validation);
  const overOrderId = r.data.id;

  // 3. 未备案商品 → 校验失败
  r = await call('POST', '/api/orders/sample?type=notlist');
  assert('未备案/非清单商品校验失败', r.code === 0 && r.data.status === 'CHECK_FAIL' &&
    r.data.validation.issues.some(i => i.code === 'NOT_RECORDED' || i.code === 'NOT_IN_LIST'), r.data?.validation);

  // 4. 账册余量不足 → 校验失败
  r = await call('POST', '/api/orders/sample?type=short');
  assert('账册余量不足校验失败(STOCK_SHORT)', r.code === 0 && r.data.status === 'CHECK_FAIL' &&
    r.data.validation.issues.some(i => i.code === 'STOCK_SHORT'), r.data?.validation);

  // 5. 价格异常 → 预警但通过
  r = await call('POST', '/api/orders/sample?type=pricediff');
  assert('价格偏离仅预警不拦截(WARN 且 CHECKED)', r.code === 0 && r.data.status === 'CHECKED' &&
    r.data.validation.level === 'WARN' && r.data.validation.issues.some(i => i.code === 'PRICE_DIFF'), r.data?.validation);
  const priceOrderId = r.data.id;

  // 6. 校验失败订单不能生成清单
  r = await call('POST', `/api/inventories/from-order/${overOrderId}`);
  assert('校验失败订单拒绝生成清单', r.code === 400 && r.message.includes('校验'), r);

  // 7. 正常订单 → 生成清单
  r = await call('POST', `/api/inventories/from-order/${goodOrderId}`);
  assert('正常订单生成清单成功', r.code === 0 && r.data.id > 0 && r.data.tax_total > 0, r);
  const invId = r.data.id;

  // 8. 订单状态变为 已生成清单
  r = await call('GET', `/api/orders/${goodOrderId}`);
  assert('订单状态=已生成清单(INVT_CREATED)', r.data.head.status === 'INVT_CREATED', r.data?.head?.status);

  // 9. 重复生成被拦截
  r = await call('POST', `/api/inventories/from-order/${goodOrderId}`);
  assert('重复生成清单被拦截', r.code === 400 && r.message.includes('已生成'), r);

  // 10. 清单申报 → 放行
  r = await call('POST', `/api/inventories/${invId}/declare`);
  assert('清单申报海关放行', r.code === 0 && r.data.status === 'RELEASED' && r.data.customsStatus === '120', r);

  // 11. 放行后订单状态=放行
  r = await call('GET', `/api/orders/${goodOrderId}`);
  assert('放行回写订单状态=RELEASED', r.data.head.status === 'RELEASED', r.data?.head?.status);

  // 12. 登记支付单 + 运单
  r = await call('POST', `/api/orders/${goodOrderId}/payment`);
  assert('登记支付单成功', r.code === 0);
  r = await call('POST', `/api/orders/${goodOrderId}/logistics`);
  assert('登记运单成功', r.code === 0);

  // 13. 三单对碰:该单四单齐全
  r = await call('GET', '/api/orders/match/monitor?pageSize=100');
  const mon = r.data.list.find(x => x.order_no === goodOrderNo);
  assert('三单对碰显示四单齐全', mon && mon.match_status === '齐全' &&
    mon.has.payment && mon.has.logistics && mon.has.inventory, mon);

  // 14. 生成清单后价格预警单也能走通(生成→申报)
  r = await call('POST', `/api/inventories/from-order/${priceOrderId}`);
  assert('预警订单可生成清单', r.code === 0, r);
  const priceInvId = r.data.id;
  r = await call('POST', '/api/inventories/batch-declare', { ids: [priceInvId] });
  assert('批量申报接口可用', r.code === 0 && r.data.total === 1 && r.data.released === 1, r.data);

  // 15. 撤销一张已放行清单应被拒绝(放行不可撤销)
  r = await call('POST', `/api/inventories/${invId}/cancel`);
  assert('已放行清单不允许撤销', r.code === 400, r);

  console.log(`\n结果:${passed} 通过,${failed} 失败`);
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error('测试执行异常:', e); process.exitCode = 1; });

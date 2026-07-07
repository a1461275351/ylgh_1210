// T08 三单数据中心:订单接入 / 申报前校验 / 支付单 / 运单 / 三单对碰
const router = require('express').Router();
const db = require('../db');
const { ok, fail, page, genNo, opLog } = require('../util');
const { validateOrder } = require('../ceb/validate');

const STATUS_LABEL = {
  RECEIVED: '已接收', CHECK_FAIL: '校验失败', CHECKED: '已校验', INVT_CREATED: '已生成清单',
  DECLARING: '申报中', RELEASED: '放行', OUTBOUND: '已出库', SIGNED: '签收',
  REFUNDING: '退货中', CLOSED: '关闭',
};

// 接收单条订单并做前置校验;返回 order id + 校验结果
function intake(body, source) {
  if (!body.buyer_name || !body.buyer_id_no) throw new Error('订购人姓名/证件号必填');
  if (!Array.isArray(body.items) || !body.items.length) throw new Error('订单明细不能为空');
  const cust = db.prepare(`SELECT id FROM cust_customer WHERE id = ?`).get(body.ebc_customer_id);
  if (!cust) throw new Error('电商企业(客户)不存在');

  const orderNo = body.order_no || genNo('DD');
  const dup = db.prepare(`SELECT id FROM ceb_order WHERE order_no = ?`).get(orderNo);
  if (dup) throw new Error(`订单号 ${orderNo} 已存在`);

  const items = body.items.map((it, i) => {
    const total = it.total_price != null ? Number(it.total_price) : +(Number(it.qty) * Number(it.unit_price)).toFixed(4);
    return { ...it, seq_no: i + 1, total_price: total };
  });
  const goods = items.reduce((s, it) => s + it.total_price, 0);
  const freight = Number(body.freight) || 0;
  const order = {
    order_no: orderNo, ebc_customer_id: body.ebc_customer_id,
    buyer_name: body.buyer_name, buyer_id_no: body.buyer_id_no,
    goods_amount: +goods.toFixed(4), freight,
  };

  const vr = validateOrder(order, items);
  const status = vr.pass ? 'CHECKED' : 'CHECK_FAIL';

  const r = db.prepare(`INSERT INTO ceb_order
      (order_no, platform_code, platform_name, ebc_customer_id, shop_code, buyer_name, buyer_id_no, buyer_tel,
       consignee, consignee_addr, goods_amount, freight, discount, tax_amount, actual_paid, currency, source, status, check_msg, order_time)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now','localtime'))`)
    .run(orderNo, body.platform_code || null, body.platform_name || null, body.ebc_customer_id,
         body.shop_code || null, body.buyer_name, body.buyer_id_no, body.buyer_tel || null,
         body.consignee || body.buyer_name, body.consignee_addr || null,
         +goods.toFixed(4), freight, Number(body.discount) || 0, Number(body.tax_amount) || 0,
         Number(body.actual_paid) || +(goods + freight).toFixed(4), body.currency || '142',
         source, status, JSON.stringify(vr.issues));
  const orderId = Number(r.lastInsertRowid);
  const insItem = db.prepare(`INSERT INTO ceb_order_item (order_id, seq_no, sku, product_id, product_name, qty, unit_price, total_price) VALUES (?,?,?,?,?,?,?,?)`);
  for (const it of items) {
    const prod = db.prepare(`SELECT id FROM goods_product WHERE customer_id = ? AND sku = ?`).get(body.ebc_customer_id, it.sku);
    insItem.run(orderId, it.seq_no, it.sku, prod ? prod.id : null, it.product_name || it.sku, it.qty, it.unit_price, it.total_price);
  }
  return { id: orderId, order_no: orderNo, status, validation: vr };
}

// 列表
router.get('/', (req, res) => {
  const { offset, pageSize, page: p } = page(req);
  const where = [], args = [];
  if (req.query.orderNo)  { where.push(`order_no LIKE ?`); args.push(`%${req.query.orderNo}%`); }
  if (req.query.status)   { where.push(`status = ?`);      args.push(req.query.status); }
  if (req.query.buyer)    { where.push(`buyer_name LIKE ?`); args.push(`%${req.query.buyer}%`); }
  const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { c: total } = db.prepare(`SELECT COUNT(*) AS c FROM ceb_order ${cond}`).get(...args);
  const list = db.prepare(`SELECT * FROM ceb_order ${cond} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...args, pageSize, offset)
    .map(r => ({ ...r, status_label: STATUS_LABEL[r.status] || r.status,
                 issues: r.check_msg ? JSON.parse(r.check_msg) : [] }));
  ok(res, { list, total, page: p, pageSize });
});

// 详情:订单 + 明细 + 支付 + 运单 + 清单
router.get('/:id', (req, res) => {
  const head = db.prepare(`SELECT * FROM ceb_order WHERE id = ?`).get(req.params.id);
  if (!head) return fail(res, '订单不存在', 404);
  head.status_label = STATUS_LABEL[head.status] || head.status;
  head.issues = head.check_msg ? JSON.parse(head.check_msg) : [];
  const items = db.prepare(`SELECT * FROM ceb_order_item WHERE order_id = ? ORDER BY seq_no`).all(req.params.id);
  const payment = db.prepare(`SELECT * FROM ceb_payment WHERE order_no = ? ORDER BY id DESC LIMIT 1`).get(head.order_no);
  const logistics = db.prepare(`SELECT * FROM ceb_logistics WHERE order_no = ? ORDER BY id DESC LIMIT 1`).get(head.order_no);
  const inventory = db.prepare(`SELECT id, invt_no, status, ret_msg FROM ceb_inventory WHERE order_no = ?`).get(head.order_no);
  ok(res, { head, items, payment, logistics, inventory });
});

// 新增订单(单条 API)
router.post('/', (req, res) => {
  try { ok(res, intake(req.body, 'API')); }
  catch (e) { fail(res, e.message); }
});

// 批量导入
router.post('/import', (req, res) => {
  const arr = Array.isArray(req.body) ? req.body : req.body.orders;
  if (!Array.isArray(arr)) return fail(res, '请提供订单数组');
  const results = [];
  for (const o of arr) {
    try { results.push({ ok: true, ...intake(o, 'IMPORT') }); }
    catch (e) { results.push({ ok: false, order_no: o.order_no, error: e.message }); }
  }
  opLog(req, 'IMPORT', 'ORDER', '', { count: arr.length });
  ok(res, { total: arr.length, success: results.filter(r => r.ok).length, results });
});

// 生成样例订单(演示):good 正常 / overlimit 超限值 / short 余量不足 / notlist 非清单
router.post('/sample', (req, res) => {
  const type = req.query.type || 'good';
  const self = db.prepare(`SELECT id FROM cust_customer WHERE is_self = 1`).get();
  const cid = self ? self.id : 1;
  const tpls = {
    good: { buyer_name: '张伟', buyer_id_no: '610103199001011234',
      items: [{ sku: 'SKU-MILK-01', product_name: '婴幼儿配方奶粉 900g', qty: 2, unit_price: 220 },
              { sku: 'SKU-VC-02', product_name: '维生素C泡腾片', qty: 1, unit_price: 150 }] },
    overlimit: { buyer_name: '李娜', buyer_id_no: '610103199203032345',
      items: [{ sku: 'SKU-BAG-01', product_name: '真皮手袋', qty: 1, unit_price: 6800 }] },
    short: { buyer_name: '赵敏', buyer_id_no: '610103199406065678',
      items: [{ sku: 'SKU-BAG-01', product_name: '真皮手袋', qty: 9999999, unit_price: 0.0001 }] },
    notlist: { buyer_name: '王芳', buyer_id_no: '610103199305054567',
      items: [{ sku: 'SKU-NOLIST', product_name: '非清单内商品', qty: 1, unit_price: 300 }] },
    pricediff: { buyer_name: '孙浩', buyer_id_no: '610103199507078910',
      items: [{ sku: 'SKU-SKIN-03', product_name: '精华护肤液 50ml', qty: 1, unit_price: 80 }] },
  };
  const tpl = tpls[type];
  if (!tpl) return fail(res, '未知样例类型');
  try {
    const r = intake({ ebc_customer_id: cid, platform_code: '3301960A99', platform_name: '示例跨境平台',
      freight: 0, ...tpl }, 'MANUAL');
    opLog(req, 'CREATE', 'ORDER', r.id, { order_no: r.order_no, type });
    ok(res, r);
  } catch (e) { fail(res, e.message); }
});

// 重新校验(修正备案/账册后)
router.post('/:id/recheck', (req, res) => {
  const head = db.prepare(`SELECT * FROM ceb_order WHERE id = ?`).get(req.params.id);
  if (!head) return fail(res, '订单不存在', 404);
  const items = db.prepare(`SELECT * FROM ceb_order_item WHERE order_id = ?`).all(req.params.id);
  const vr = validateOrder(head, items);
  const status = vr.pass ? 'CHECKED' : 'CHECK_FAIL';
  db.prepare(`UPDATE ceb_order SET status=?, check_msg=?, updated_at=datetime('now','localtime') WHERE id=?`)
    .run(status, JSON.stringify(vr.issues), req.params.id);
  ok(res, { id: Number(req.params.id), status, validation: vr });
});

// 登记支付单
router.post('/:id/payment', (req, res) => {
  const head = db.prepare(`SELECT * FROM ceb_order WHERE id = ?`).get(req.params.id);
  if (!head) return fail(res, '订单不存在', 404);
  db.prepare(`INSERT INTO ceb_payment (order_id, order_no, pay_no, pay_company, payer_name, payer_id_no, pay_amount, pay_time, push_status)
      VALUES (?,?,?,?,?,?,?, datetime('now','localtime'), 'PUSHED')`)
    .run(head.id, head.order_no, req.body.pay_no || genNo('ZF'), req.body.pay_company || '示例支付公司',
         req.body.payer_name || head.buyer_name, req.body.payer_id_no || head.buyer_id_no,
         req.body.pay_amount != null ? req.body.pay_amount : head.actual_paid);
  opLog(req, 'CREATE', 'PAYMENT', head.id, { order_no: head.order_no });
  ok(res, { order_no: head.order_no });
});

// 登记运单
router.post('/:id/logistics', (req, res) => {
  const head = db.prepare(`SELECT * FROM ceb_order WHERE id = ?`).get(req.params.id);
  if (!head) return fail(res, '订单不存在', 404);
  db.prepare(`INSERT INTO ceb_logistics (order_id, order_no, logistics_no, logistics_name, weight, push_status, track_status)
      VALUES (?,?,?,?,?, 'PUSHED', 'PICKED')`)
    .run(head.id, head.order_no, req.body.logistics_no || genNo('YD'),
         req.body.logistics_name || '示例物流', req.body.weight != null ? req.body.weight : 1.2);
  opLog(req, 'CREATE', 'LOGISTICS', head.id, { order_no: head.order_no });
  ok(res, { order_no: head.order_no });
});

// 三单对碰监控:每单 订单/支付/运单/清单 四单状态矩阵
router.get('/match/monitor', (req, res) => {
  const { offset, pageSize, page: p } = page(req);
  const { c: total } = db.prepare(`SELECT COUNT(*) AS c FROM ceb_order`).get();
  const orders = db.prepare(`SELECT id, order_no, buyer_name, goods_amount, status FROM ceb_order ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(pageSize, offset);
  const list = orders.map(o => {
    const pay = db.prepare(`SELECT push_status FROM ceb_payment WHERE order_no = ? ORDER BY id DESC LIMIT 1`).get(o.order_no);
    const log = db.prepare(`SELECT push_status FROM ceb_logistics WHERE order_no = ? ORDER BY id DESC LIMIT 1`).get(o.order_no);
    const inv = db.prepare(`SELECT status FROM ceb_inventory WHERE order_no = ?`).get(o.order_no);
    const has = { order: true, payment: !!pay, logistics: !!log, inventory: !!inv };
    const missing = [];
    if (!has.payment) missing.push('支付单');
    if (!has.logistics) missing.push('运单');
    if (!has.inventory) missing.push('清单');
    return { ...o, has, inv_status: inv ? inv.status : null,
      match_status: missing.length ? '缺单' : '齐全', missing: missing.join('、') || '-' };
  });
  ok(res, { list, total, page: p, pageSize });
});

module.exports = router;

// T19 演示用清单:生成样例清单 + 申报(推送单一窗口/模拟器)+ 查看回执
// 说明:完整"订单→清单"生成在 T09 实现;此处提供样例清单以验证报文引擎与通道链路。
const router = require('express').Router();
const db = require('../db');
const { ok, fail, page, genNo, opLog, param } = require('../util');
const { calcItemTax } = require('../ceb/tax');
const engine = require('../ceb/engine');
const finance = require('../ceb/finance');

const STATUS_LABEL = {
  DRAFT: '暂存', AUDIT2: '待复审', DECLARED: '已申报',
  CUSTOMS_REJECT: '海关退单', RELEASED: '放行', CANCELLED: '已撤销',
};

// 样例模板:normal 放行 / overlimit 超限值退单 / notlist 不在正面清单退单
const SAMPLES = {
  normal: {
    buyer_name: '张伟', buyer_id_no: '610103199001011234',
    items: [
      { sku: 'SKU-MILK-01', product_name: '婴幼儿配方奶粉 900g', hs_code: '1901101000',
        origin_country: '609', unit: '122', qty: 2, unit_price: 220, vat_rate: 0.09, consump_rate: 0 },
      { sku: 'SKU-VC-02', product_name: '维生素C泡腾片', hs_code: '2106909090',
        origin_country: '304', unit: '142', qty: 1, unit_price: 150, vat_rate: 0.13, consump_rate: 0 },
    ],
  },
  overlimit: {
    buyer_name: '李娜', buyer_id_no: '610103199203032345',
    items: [
      { sku: 'SKU-BAG-01', product_name: '真皮手袋', hs_code: '4202210090',
        origin_country: '303', unit: '007', qty: 1, unit_price: 6800, vat_rate: 0.13, consump_rate: 0 },
    ],
  },
  notlist: {
    buyer_name: '王芳', buyer_id_no: '610103199305054567',
    items: [
      { sku: 'SKU-X-01', product_name: '非清单内商品', hs_code: '9990001000',
        origin_country: '502', unit: '007', qty: 1, unit_price: 300, vat_rate: 0.13, consump_rate: 0 },
    ],
  },
};

// 列表
router.get('/', (req, res) => {
  const { offset, pageSize, page: p } = page(req);
  const where = [];
  const args = [];
  if (req.query.orderNo) { where.push(`order_no LIKE ?`); args.push(`%${req.query.orderNo}%`); }
  if (req.query.status)  { where.push(`status = ?`);      args.push(req.query.status); }
  const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { c: total } = db.prepare(`SELECT COUNT(*) AS c FROM ceb_inventory ${cond}`).get(...args);
  const list = db.prepare(`SELECT * FROM ceb_inventory ${cond} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...args, pageSize, offset)
    .map(r => ({ ...r, status_label: STATUS_LABEL[r.status] || r.status }));
  ok(res, { list, total, page: p, pageSize });
});

// 详情:表头 + 表体 + 关联报文
router.get('/:id', (req, res) => {
  const head = db.prepare(`SELECT * FROM ceb_inventory WHERE id = ?`).get(req.params.id);
  if (!head) return fail(res, '清单不存在', 404);
  const items = db.prepare(`SELECT * FROM ceb_inventory_item WHERE inventory_id = ? ORDER BY seq_no`).all(req.params.id);
  const msgs = db.prepare(
    `SELECT id, direction, channel, msg_type, status, created_at FROM msg_log WHERE biz_no = ? ORDER BY id`)
    .all(head.order_no);
  ok(res, { head: { ...head, status_label: STATUS_LABEL[head.status] || head.status }, items, msgs });
});

// 生成样例清单:POST /api/inventories/sample?type=normal|overlimit|notlist
router.post('/sample', (req, res) => {
  const type = req.query.type || 'normal';
  const tpl = SAMPLES[type];
  if (!tpl) return fail(res, '未知样例类型');
  const discount = Number(param('TAX_DISCOUNT', '0.7'));
  const orderNo = genNo('DD');
  const preNo = genNo('YL');
  let goods = 0, taxTotal = 0, netWeight = 0;
  const items = tpl.items.map((it, i) => {
    const total = +(it.qty * it.unit_price).toFixed(4);
    const tax = calcItemTax(total, it.vat_rate, it.consump_rate, discount);
    goods += total; taxTotal += tax; netWeight += it.qty * 0.5;
    return { ...it, seq_no: i + 1, total_price: total, tax_amount: tax };
  });
  const freight = 0;
  const r = db.prepare(`INSERT INTO ceb_inventory
      (order_no, pre_no, ebc_code, ebp_code, agent_code, ems_no, logistics_no,
       buyer_name, buyer_id_no, gross_weight, net_weight, goods_amount, freight, tax_total, status, channel)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'DRAFT', 'SIMULATOR')`)
    .run(orderNo, preNo, '610166BA05', '3301960A99', '610166BA05', 'T901625A00100',
         genNo('YD'), tpl.buyer_name, tpl.buyer_id_no,
         +(netWeight + 0.2).toFixed(3), +netWeight.toFixed(3),
         +goods.toFixed(4), freight, +taxTotal.toFixed(4));
  const invId = Number(r.lastInsertRowid);
  const insItem = db.prepare(`INSERT INTO ceb_inventory_item
      (inventory_id, seq_no, sku, hs_code, product_name, origin_country, unit, qty, unit_price, total_price, vat_rate, consump_rate, tax_amount)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const it of items) {
    insItem.run(invId, it.seq_no, it.sku, it.hs_code, it.product_name, it.origin_country,
                it.unit, it.qty, it.unit_price, it.total_price, it.vat_rate, it.consump_rate, it.tax_amount);
  }
  opLog(req, 'CREATE', 'INVENTORY', invId, { order_no: orderNo, type });
  ok(res, { id: invId, order_no: orderNo, goods_amount: +goods.toFixed(4), tax_total: +taxTotal.toFixed(4) });
});

// T09 由订单生成清单
function genFromOrder(orderId, req) {
  const order = db.prepare(`SELECT * FROM ceb_order WHERE id = ?`).get(orderId);
  if (!order) throw new Error('订单不存在');
  if (order.status === 'CHECK_FAIL') throw new Error('订单校验未通过,不能生成清单');
  const exist = db.prepare(`SELECT id FROM ceb_inventory WHERE order_no = ?`).get(order.order_no);
  if (exist) throw new Error(`订单 ${order.order_no} 已生成清单`);
  const oItems = db.prepare(`SELECT * FROM ceb_order_item WHERE order_id = ? ORDER BY seq_no`).all(orderId);
  if (!oItems.length) throw new Error('订单无明细');
  const discount = Number(param('TAX_DISCOUNT', '0.7'));

  // 取账册号(以第一条商品绑定的账册为准)
  let emsNo = 'T901625A00100';
  const firstProd = oItems.find(it => it.product_id);
  if (firstProd) {
    const rel = db.prepare(`SELECT ems_no FROM goods_ems_rel WHERE product_id = ?`).get(firstProd.product_id);
    if (rel) emsNo = rel.ems_no;
  }

  let goods = 0, taxTotal = 0, netWeight = 0;
  const items = oItems.map((it, i) => {
    const prod = it.product_id ? db.prepare(`SELECT * FROM goods_product WHERE id = ?`).get(it.product_id) : null;
    const hs = prod ? db.prepare(`SELECT * FROM goods_hs_tax WHERE hs_code = ?`).get(prod.hs_code) : null;
    const vat = hs ? hs.vat_rate : 0.13, con = hs ? hs.consump_rate : 0;
    const tax = calcItemTax(it.total_price, vat, con, discount);
    goods += Number(it.total_price); taxTotal += tax; netWeight += Number(it.qty) * 0.5;
    return { seq_no: i + 1, sku: it.sku, hs_code: prod ? prod.hs_code : '', product_name: it.product_name,
             origin_country: prod ? prod.origin_country : null, unit: prod ? prod.unit_declare : '007',
             qty: it.qty, unit_price: it.unit_price, total_price: it.total_price,
             vat_rate: vat, consump_rate: con, tax_amount: tax };
  });

  const preNo = genNo('YL');
  const r = db.prepare(`INSERT INTO ceb_inventory
      (order_id, order_no, pre_no, ebc_code, ebp_code, agent_code, ems_no, logistics_no,
       buyer_name, buyer_id_no, gross_weight, net_weight, goods_amount, freight, tax_total, status, channel)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'DRAFT', 'SIMULATOR')`)
    .run(order.id, order.order_no, preNo, '610166BA05', order.platform_code || null, '610166BA05', emsNo,
         genNo('YD'), order.buyer_name, order.buyer_id_no,
         +(netWeight + 0.2).toFixed(3), +netWeight.toFixed(3),
         +goods.toFixed(4), order.freight || 0, +taxTotal.toFixed(4));
  const invId = Number(r.lastInsertRowid);
  const insItem = db.prepare(`INSERT INTO ceb_inventory_item
      (inventory_id, seq_no, sku, hs_code, product_name, origin_country, unit, qty, unit_price, total_price, vat_rate, consump_rate, tax_amount)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const it of items) {
    insItem.run(invId, it.seq_no, it.sku, it.hs_code, it.product_name, it.origin_country,
                it.unit, it.qty, it.unit_price, it.total_price, it.vat_rate, it.consump_rate, it.tax_amount);
  }
  db.prepare(`UPDATE ceb_order SET status='INVT_CREATED', updated_at=datetime('now','localtime') WHERE id=?`).run(order.id);
  if (req) opLog(req, 'CREATE', 'INVENTORY', invId, { order_no: order.order_no, from: 'order' });
  return { id: invId, order_no: order.order_no, goods_amount: +goods.toFixed(4), tax_total: +taxTotal.toFixed(4) };
}

// 回写订单状态(清单申报后)
function syncOrder(orderNo, invStatus) {
  const map = { RELEASED: 'RELEASED', CUSTOMS_REJECT: 'INVT_CREATED', CANCELLED: 'CHECKED' };
  const os = map[invStatus];
  if (os) db.prepare(`UPDATE ceb_order SET status=?, updated_at=datetime('now','localtime') WHERE order_no=? AND status NOT IN ('OUTBOUND','SIGNED','CLOSED')`).run(os, orderNo);
}

// POST /api/inventories/from-order/:orderId
router.post('/from-order/:orderId', (req, res) => {
  try { ok(res, genFromOrder(req.params.orderId, req)); }
  catch (e) { fail(res, e.message); }
});

// 申报(推送单一窗口/模拟器)
router.post('/:id/declare', (req, res) => {
  try {
    const r = engine.declareInventory(req.params.id, req, req.body && req.body.channel);
    const inv = db.prepare(`SELECT * FROM ceb_inventory WHERE id = ?`).get(req.params.id);
    if (inv && inv.order_no) syncOrder(inv.order_no, r.status);
    if (r.status === 'RELEASED') finance.onReleased(inv);  // 放行→生成税单+占用担保
    ok(res, r);
  } catch (e) {
    fail(res, e.message);
  }
});

// 批量申报(退单工作台重报 / 批量首报)
router.post('/batch-declare', (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  if (!ids.length) return fail(res, '请选择清单');
  const results = ids.map(id => {
    try {
      const r = engine.declareInventory(id, req, req.body.channel);
      const inv = db.prepare(`SELECT * FROM ceb_inventory WHERE id = ?`).get(id);
      if (inv && inv.order_no) syncOrder(inv.order_no, r.status);
      if (r.status === 'RELEASED') finance.onReleased(inv);
      return { id, ok: true, status: r.status, customsStatus: r.customsStatus, retMsg: r.retMsg };
    } catch (e) { return { id, ok: false, error: e.message }; }
  });
  const released = results.filter(r => r.status === 'RELEASED').length;
  const rejected = results.filter(r => r.status === 'CUSTOMS_REJECT').length;
  ok(res, { total: ids.length, released, rejected, results });
});

// 撤销清单(仅退单/暂存)
router.post('/:id/cancel', (req, res) => {
  const row = db.prepare(`SELECT * FROM ceb_inventory WHERE id = ?`).get(req.params.id);
  if (!row) return fail(res, '清单不存在', 404);
  if (!['DRAFT', 'CUSTOMS_REJECT'].includes(row.status))
    return fail(res, `状态 ${row.status} 不允许撤销`);
  db.prepare(`UPDATE ceb_inventory SET status='CANCELLED', ret_msg=?, updated_at=datetime('now','localtime') WHERE id=?`)
    .run('人工撤销:' + (req.body.reason || ''), req.params.id);
  syncOrder(row.order_no, 'CANCELLED');
  opLog(req, 'CANCEL', 'INVENTORY', req.params.id, { order_no: row.order_no });
  ok(res, { id: Number(req.params.id) });
});

// 删除(仅暂存/退单)
router.delete('/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM ceb_inventory WHERE id = ?`).get(req.params.id);
  if (!row) return fail(res, '清单不存在', 404);
  if (!['DRAFT', 'CUSTOMS_REJECT'].includes(row.status))
    return fail(res, `状态 ${row.status} 不允许删除`);
  db.prepare(`DELETE FROM ceb_inventory_item WHERE inventory_id = ?`).run(req.params.id);
  db.prepare(`DELETE FROM ceb_inventory WHERE id = ?`).run(req.params.id);
  opLog(req, 'DELETE', 'INVENTORY', req.params.id, { order_no: row.order_no });
  ok(res, { id: Number(req.params.id) });
});

module.exports = router;

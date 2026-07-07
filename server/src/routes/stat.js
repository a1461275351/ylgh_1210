// T17 综合查询与统计:业务概览统计 + 放行率/退单率 + 账册余量 + 全链路单证追溯
const router = require('express').Router();
const db = require('../db');
const { ok, fail } = require('../util');

// 业务总览看板
router.get('/overview', (_req, res) => {
  const one = (sql, ...a) => { try { return db.prepare(sql).get(...a); } catch { return {}; } };
  const cnt = (sql, ...a) => (one(sql, ...a).c) || 0;

  const orderTotal = cnt(`SELECT COUNT(*) c FROM ceb_order`);
  const invTotal = cnt(`SELECT COUNT(*) c FROM ceb_inventory`);
  const released = cnt(`SELECT COUNT(*) c FROM ceb_inventory WHERE status='RELEASED'`);
  const rejected = cnt(`SELECT COUNT(*) c FROM ceb_inventory WHERE status='CUSTOMS_REJECT'`);
  const declared = released + rejected + cnt(`SELECT COUNT(*) c FROM ceb_inventory WHERE status IN ('DECLARED','CANCELLED')`);

  // 订单状态分布
  const orderByStatus = db.prepare(`SELECT status, COUNT(*) c FROM ceb_order GROUP BY status`).all();
  // 清单状态分布
  const invByStatus = db.prepare(`SELECT status, COUNT(*) c FROM ceb_inventory GROUP BY status`).all();

  const tax = one(`SELECT
    COALESCE(SUM(total_tax),0) total,
    COALESCE(SUM(CASE WHEN status='PENDING' THEN total_tax ELSE 0 END),0) pending,
    COALESCE(SUM(CASE WHEN status='PAID' THEN total_tax ELSE 0 END),0) paid FROM tax_bill`);
  const ga = one(`SELECT total_amount, used_amount FROM guarantee_account ORDER BY id LIMIT 1`) || {};

  ok(res, {
    cards: {
      orders: orderTotal,
      inventories: invTotal,
      released, rejected,
      refunds: cnt(`SELECT COUNT(*) c FROM ceb_refund`),
      customers: cnt(`SELECT COUNT(*) c FROM cust_customer`),
      products: cnt(`SELECT COUNT(*) c FROM goods_product WHERE status='APPROVED'`),
      ems: cnt(`SELECT COUNT(*) c FROM ems_header WHERE status='APPROVED'`),
    },
    rates: {
      releaseRate: declared ? +(released / declared * 100).toFixed(1) : 0,
      rejectRate: declared ? +(rejected / declared * 100).toFixed(1) : 0,
      declared,
    },
    tax: { total: +Number(tax.total).toFixed(2), pending: +Number(tax.pending).toFixed(2), paid: +Number(tax.paid).toFixed(2) },
    guarantee: {
      total: Number(ga.total_amount) || 0, used: Number(ga.used_amount) || 0,
      available: +((Number(ga.total_amount) || 0) - (Number(ga.used_amount) || 0)).toFixed(2),
      usedRatio: ga.total_amount ? +(Number(ga.used_amount) / Number(ga.total_amount) * 100).toFixed(1) : 0,
    },
    orderByStatus, invByStatus,
  });
});

// 账册余量表
router.get('/ems-balance', (req, res) => {
  const emsNo = req.query.emsNo || 'T901625A00100';
  const ems = db.prepare(`SELECT * FROM ems_header WHERE ems_no=?`).get(emsNo);
  if (!ems) return fail(res, '账册不存在', 404);
  const items = db.prepare(`SELECT * FROM ems_item WHERE ems_id=? ORDER BY item_no`).all(ems.id);
  const list = items.map(it => {
    const rows = db.prepare(`SELECT biz_type, qty, balance FROM ems_stock_ledger WHERE ems_id=? AND item_no=?`).all(ems.id, it.item_no);
    const last = rows.length ? Number(rows[rows.length - 1].balance) : 0;
    const inQty = rows.filter(r => Number(r.qty) > 0).reduce((s, r) => s + Number(r.qty), 0);
    const outQty = rows.filter(r => Number(r.qty) < 0).reduce((s, r) => s + Number(r.qty), 0);
    return { item_no: it.item_no, product_name: it.product_name, hs_code: it.hs_code, unit: it.unit,
      in_qty: +inQty.toFixed(3), out_qty: +Math.abs(outQty).toFixed(3), balance: last };
  });
  ok(res, { ems_no: emsNo, list });
});

// 全链路单证追溯:输入订单号/清单号/运单号,返回全流程节点时间轴
router.get('/trace', (req, res) => {
  const kw = (req.query.kw || '').trim();
  if (!kw) return fail(res, '请输入订单号/清单号/运单号');
  // 定位订单
  let order = db.prepare(`SELECT * FROM ceb_order WHERE order_no=?`).get(kw);
  if (!order) {
    const inv = db.prepare(`SELECT * FROM ceb_inventory WHERE invt_no=? OR order_no=?`).get(kw, kw);
    if (inv) order = db.prepare(`SELECT * FROM ceb_order WHERE order_no=?`).get(inv.order_no);
  }
  if (!order) {
    const log = db.prepare(`SELECT order_no FROM ceb_logistics WHERE logistics_no=?`).get(kw);
    if (log) order = db.prepare(`SELECT * FROM ceb_order WHERE order_no=?`).get(log.order_no);
  }
  if (!order) return fail(res, '未找到相关单据', 404);

  const nodes = [];
  const add = (time, node, detail, status) => { if (time) nodes.push({ time, node, detail, status }); };

  add(order.created_at, '订单接入', `订单 ${order.order_no} · 订购人 ${order.buyer_name} · 货值 ${order.goods_amount}`, order.status);
  const pay = db.prepare(`SELECT * FROM ceb_payment WHERE order_no=? ORDER BY id DESC LIMIT 1`).get(order.order_no);
  if (pay) add(pay.created_at, '支付单', `${pay.pay_no || ''} ${pay.pay_company || ''}`, pay.push_status);
  const logi = db.prepare(`SELECT * FROM ceb_logistics WHERE order_no=? ORDER BY id DESC LIMIT 1`).get(order.order_no);
  if (logi) add(logi.created_at, '运单', `${logi.logistics_no || ''} ${logi.logistics_name || ''}`, logi.track_status);

  const inv = db.prepare(`SELECT * FROM ceb_inventory WHERE order_no=?`).get(order.order_no);
  if (inv) {
    add(inv.created_at, '生成清单', `预录入 ${inv.pre_no || ''}`, inv.status);
    if (inv.declare_time) add(inv.declare_time, '清单申报', `通道 ${inv.channel}`, inv.status);
    if (inv.release_time) add(inv.release_time, '海关放行', `清单号 ${inv.invt_no} · ${inv.ret_msg || ''}`, 'RELEASED');
    const bill = db.prepare(`SELECT * FROM tax_bill WHERE inventory_id=?`).get(inv.id);
    if (bill) add(bill.created_at, '生成税单', `综合税 ${bill.total_tax} · ${bill.status}`, bill.status);
    if (inv.bond_invt_no) {
      const bond = db.prepare(`SELECT * FROM bond_invt_head WHERE internal_no=?`).get(inv.bond_invt_no);
      if (bond) add(bond.updated_at, '出区核注清单', `${bond.internal_no} · 账册核减`, bond.status);
    }
    const out = db.prepare(`SELECT * FROM wms_outbound WHERE inventory_id=?`).get(inv.id);
    if (out) add(out.created_at, 'WMS出库', `${out.outbound_no} · ${out.status}`, out.status);
  }
  const rf = db.prepare(`SELECT * FROM ceb_refund WHERE order_no=? ORDER BY id DESC LIMIT 1`).get(order.order_no);
  if (rf) {
    add(rf.apply_time || rf.created_at, '退货申请', `${rf.refund_no} · ${rf.refund_type}`, rf.status);
    if (rf.inbound_time) add(rf.inbound_time, '退货入区', '账册核增 · 税款冲减', 'CLOSED');
  }

  nodes.sort((a, b) => String(a.time).localeCompare(String(b.time)));
  ok(res, { order_no: order.order_no, current: order.status, nodes });
});

module.exports = router;

// T15 WMS 协同与三账比对:入库单/出库单同步 + 库存快照 + 关务账册 vs 实物 vs 客户系统三账比对
const router = require('express').Router();
const db = require('../db');
const { ok, fail, page, genNo, opLog } = require('../util');

function emsBalances(emsNo) {
  const ems = db.prepare(`SELECT * FROM ems_header WHERE ems_no=?`).get(emsNo);
  if (!ems) return [];
  const items = db.prepare(`SELECT * FROM ems_item WHERE ems_id=? ORDER BY item_no`).all(ems.id);
  return items.map(it => {
    const b = db.prepare(`SELECT balance FROM ems_stock_ledger WHERE ems_id=? AND item_no=? ORDER BY id DESC LIMIT 1`).get(ems.id, it.item_no);
    return { ems_item_no: it.item_no, product_name: it.product_name, balance: b ? Number(b.balance) : 0 };
  });
}

// ---- 入库单:由已核增的入区核注清单同步 ----
router.get('/inbound', (req, res) => {
  const { offset, pageSize, page: p } = page(req);
  const { c: total } = db.prepare(`SELECT COUNT(*) AS c FROM wms_inbound`).get();
  const list = db.prepare(`SELECT * FROM wms_inbound ORDER BY id DESC LIMIT ? OFFSET ?`).all(pageSize, offset);
  ok(res, { list, total, page: p, pageSize });
});
router.post('/inbound/sync', (req, res) => {
  const bonds = db.prepare(`SELECT * FROM bond_invt_head WHERE flow_type='IN' AND status='APPROVED'`).all();
  let created = 0;
  for (const b of bonds) {
    const key = b.bond_invt_no || b.internal_no;
    if (db.prepare(`SELECT id FROM wms_inbound WHERE bond_invt_no=?`).get(key)) continue;
    const qty = db.prepare(`SELECT COALESCE(SUM(qty),0) q FROM bond_invt_item WHERE head_id=?`).get(b.id).q;
    db.prepare(`INSERT INTO wms_inbound (inbound_no, ems_no, bond_invt_no, biz_type, qty_total, status, finished_at) VALUES (?,?,?, 'FIRST_IN', ?, 'FINISHED', datetime('now','localtime'))`)
      .run(genNo('RK'), b.ems_no, key, qty);
    created++;
  }
  ok(res, { created });
});

// ---- 出库单:由放行清单同步(放行即下发拣货指令)----
router.get('/outbound', (req, res) => {
  const { offset, pageSize, page: p } = page(req);
  const { c: total } = db.prepare(`SELECT COUNT(*) AS c FROM wms_outbound`).get();
  const list = db.prepare(`SELECT * FROM wms_outbound ORDER BY id DESC LIMIT ? OFFSET ?`).all(pageSize, offset);
  ok(res, { list, total, page: p, pageSize });
});
router.post('/outbound/sync', (req, res) => {
  const invs = db.prepare(`SELECT * FROM ceb_inventory WHERE status='RELEASED'`).all();
  let created = 0;
  for (const v of invs) {
    if (db.prepare(`SELECT id FROM wms_outbound WHERE inventory_id=?`).get(v.id)) continue;
    const qty = db.prepare(`SELECT COALESCE(SUM(qty),0) q FROM ceb_inventory_item WHERE inventory_id=?`).get(v.id).q;
    db.prepare(`INSERT INTO wms_outbound (outbound_no, inventory_id, order_no, qty_total, status) VALUES (?,?,?,?, 'INSTRUCTED')`)
      .run(genNo('CK'), v.id, v.order_no, qty);
    created++;
  }
  ok(res, { created });
});
// 出库单推进状态
router.post('/outbound/:id/advance', (req, res) => {
  const row = db.prepare(`SELECT * FROM wms_outbound WHERE id=?`).get(req.params.id);
  if (!row) return fail(res, '出库单不存在', 404);
  const next = { INSTRUCTED: 'PICKED', PICKED: 'PACKED', PACKED: 'SHIPPED' }[row.status];
  if (!next) return fail(res, '已发货');
  const shipped = next === 'SHIPPED' ? `, shipped_at=datetime('now','localtime')` : '';
  db.prepare(`UPDATE wms_outbound SET status='${next}'${shipped} WHERE id=?`).run(req.params.id);
  ok(res, { id: Number(req.params.id), status: next });
});

// ---- 库存快照:以当前账册结余为准生成 WMS 实物快照(账实相符)----
router.post('/snapshot/sync', (req, res) => {
  const emsNo = req.body.emsNo || 'T901625A00100';
  const bals = emsBalances(emsNo);
  const up = db.prepare(`INSERT INTO wms_stock_snapshot (ems_no, ems_item_no, qty, snap_time) VALUES (?,?,?, datetime('now','localtime'))
      ON CONFLICT(ems_no, ems_item_no) DO UPDATE SET qty=excluded.qty, snap_time=excluded.snap_time`);
  for (const b of bals) up.run(emsNo, b.ems_item_no, b.balance);
  opLog(req, 'SYNC', 'WMS_SNAPSHOT', emsNo, { items: bals.length });
  ok(res, { synced: bals.length });
});
// 手工调整实物库存(模拟盘盈盘亏/差异,便于演示三账比对)
router.post('/snapshot/adjust', (req, res) => {
  const { emsNo, ems_item_no, qty } = req.body;
  db.prepare(`INSERT INTO wms_stock_snapshot (ems_no, ems_item_no, qty, snap_time) VALUES (?,?,?, datetime('now','localtime'))
      ON CONFLICT(ems_no, ems_item_no) DO UPDATE SET qty=excluded.qty, snap_time=excluded.snap_time`)
    .run(emsNo || 'T901625A00100', ems_item_no, qty);
  ok(res, { ems_item_no, qty });
});
router.get('/snapshot', (req, res) => {
  const emsNo = req.query.emsNo || 'T901625A00100';
  ok(res, db.prepare(`SELECT * FROM wms_stock_snapshot WHERE ems_no=? ORDER BY ems_item_no`).all(emsNo));
});

// ---- 三账比对:关务账册 vs WMS 实物 vs 客户系统 ----
router.post('/diff/run', (req, res) => {
  const emsNo = req.body.emsNo || 'T901625A00100';
  const bals = emsBalances(emsNo);
  if (!bals.length) return fail(res, '账册无表体');
  const date = new Date().toISOString().slice(0, 10);
  db.prepare(`DELETE FROM stock_diff_report WHERE report_date=? AND ems_no=?`).run(date, emsNo);
  const ins = db.prepare(`INSERT INTO stock_diff_report (report_date, ems_no, ems_item_no, product_name, qty_ems, qty_wms, qty_client, diff_flag) VALUES (?,?,?,?,?,?,?,?)`);
  let diffCount = 0;
  for (const b of bals) {
    const snap = db.prepare(`SELECT qty FROM wms_stock_snapshot WHERE ems_no=? AND ems_item_no=?`).get(emsNo, b.ems_item_no);
    const qtyWms = snap ? Number(snap.qty) : 0;
    const qtyClient = b.balance; // 客户系统库存(原型假定与账册同源)
    const diff = (qtyWms !== b.balance) || (qtyClient !== b.balance) ? 1 : 0;
    if (diff) diffCount++;
    ins.run(date, emsNo, b.ems_item_no, b.product_name, b.balance, qtyWms, qtyClient, diff);
  }
  opLog(req, 'RUN', 'STOCK_DIFF', emsNo, { diffCount });
  ok(res, { date, total: bals.length, diffCount });
});
router.get('/diff', (req, res) => {
  const emsNo = req.query.emsNo || 'T901625A00100';
  const rows = db.prepare(`SELECT * FROM stock_diff_report WHERE ems_no=? ORDER BY report_date DESC, ems_item_no`).all(emsNo);
  const latest = rows.length ? rows[0].report_date : null;
  const list = rows.filter(r => r.report_date === latest);
  ok(res, { report_date: latest, list, diffCount: list.filter(r => r.diff_flag).length });
});

module.exports = router;

// T16 报核核销 + 盘点:账册周期报核(账面vs实际差异表)、盘点盈亏调整账册
const router = require('express').Router();
const db = require('../db');
const { ok, fail, page, genNo, opLog } = require('../util');

const V_LABEL = { DRAFT: '编制中', DECLARED: '已报核', APPROVED: '海关通过', CLOSED: '核销结案', REJECTED: '退回' };

function emsBalances(emsId) {
  const items = db.prepare(`SELECT * FROM ems_item WHERE ems_id=? ORDER BY item_no`).all(emsId);
  return items.map(it => {
    const b = db.prepare(`SELECT balance FROM ems_stock_ledger WHERE ems_id=? AND item_no=? ORDER BY id DESC LIMIT 1`).get(emsId, it.item_no);
    return { item_no: it.item_no, product_name: it.product_name, book: b ? Number(b.balance) : 0 };
  });
}

// ============ 报核核销 ============
router.get('/', (req, res) => {
  const { offset, pageSize, page: p } = page(req);
  const where = [], args = [];
  if (req.query.status) { where.push(`status=?`); args.push(req.query.status); }
  const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { c: total } = db.prepare(`SELECT COUNT(*) AS c FROM ems_verification ${cond}`).get(...args);
  const list = db.prepare(`SELECT * FROM ems_verification ${cond} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...args, pageSize, offset).map(r => ({ ...r, status_label: V_LABEL[r.status] || r.status }));
  ok(res, { list, total, page: p, pageSize });
});

router.get('/:id', (req, res) => {
  const v = db.prepare(`SELECT * FROM ems_verification WHERE id=?`).get(req.params.id);
  if (!v) return fail(res, '报核单不存在', 404);
  ok(res, { ...v, status_label: V_LABEL[v.status] || v.status, diff: v.diff_data ? JSON.parse(v.diff_data) : [] });
});

// 生成报核单(账面 vs 实际 差异表,实际取 WMS 快照)
router.post('/', (req, res) => {
  const emsNo = req.body.emsNo || 'T901625A00100';
  const ems = db.prepare(`SELECT * FROM ems_header WHERE ems_no=?`).get(emsNo);
  if (!ems) return fail(res, `账册 ${emsNo} 不存在`);
  const bals = emsBalances(ems.id);
  const diff = bals.map(b => {
    const snap = db.prepare(`SELECT qty FROM wms_stock_snapshot WHERE ems_no=? AND ems_item_no=?`).get(emsNo, b.item_no);
    const actual = snap ? Number(snap.qty) : b.book;
    return { item_no: b.item_no, product_name: b.product_name, book: b.book, actual, diff: +(actual - b.book).toFixed(5) };
  });
  const r = db.prepare(`INSERT INTO ems_verification (verify_no, ems_id, ems_no, period_from, period_to, diff_data, status, created_by)
      VALUES (?,?,?,?,?,?, 'DRAFT', ?)`)
    .run(genNo('BH'), ems.id, emsNo, req.body.period_from || (new Date().getFullYear() + '-01-01'),
         req.body.period_to || new Date().toISOString().slice(0, 10), JSON.stringify(diff), req.user || 'admin');
  opLog(req, 'CREATE', 'VERIFY', Number(r.lastInsertRowid), { emsNo });
  ok(res, { id: Number(r.lastInsertRowid), diffItems: diff.filter(d => d.diff !== 0).length });
});

function vFlow(from, to, stampClose) {
  return (req, res) => {
    const v = db.prepare(`SELECT * FROM ems_verification WHERE id=?`).get(req.params.id);
    if (!v) return fail(res, '报核单不存在', 404);
    if (v.status !== from) return fail(res, `状态 ${V_LABEL[v.status]} 不允许该操作`);
    const extra = to === 'DECLARED' ? `, declare_time=datetime('now','localtime')` : (stampClose ? `, close_time=datetime('now','localtime')` : '');
    db.prepare(`UPDATE ems_verification SET status='${to}'${extra} WHERE id=?`).run(req.params.id);
    opLog(req, 'AUDIT', 'VERIFY', req.params.id, { to });
    ok(res, { id: Number(req.params.id), status: to });
  };
}
router.post('/:id/declare', vFlow('DRAFT', 'DECLARED'));
router.post('/:id/approve', vFlow('DECLARED', 'APPROVED'));
router.post('/:id/close', vFlow('APPROVED', 'CLOSED', true));
router.post('/:id/reject', vFlow('DECLARED', 'REJECTED'));

// ============ 盘点 ============
router.get('/stocktake/list', (req, res) => {
  const { offset, pageSize, page: p } = page(req);
  const { c: total } = db.prepare(`SELECT COUNT(*) AS c FROM stocktake`).get();
  const list = db.prepare(`SELECT * FROM stocktake ORDER BY id DESC LIMIT ? OFFSET ?`).all(pageSize, offset);
  ok(res, { list, total, page: p, pageSize });
});

router.get('/stocktake/:id', (req, res) => {
  const t = db.prepare(`SELECT * FROM stocktake WHERE id=?`).get(req.params.id);
  if (!t) return fail(res, '盘点单不存在', 404);
  ok(res, { ...t, result: t.result_data ? JSON.parse(t.result_data) : [] });
});

// 生成盘点单(账面来自账册,实盘默认取 WMS 快照)
router.post('/stocktake', (req, res) => {
  const emsNo = req.body.emsNo || 'T901625A00100';
  const ems = db.prepare(`SELECT * FROM ems_header WHERE ems_no=?`).get(emsNo);
  if (!ems) return fail(res, `账册 ${emsNo} 不存在`);
  const bals = emsBalances(ems.id);
  const result = bals.map(b => {
    const snap = db.prepare(`SELECT qty FROM wms_stock_snapshot WHERE ems_no=? AND ems_item_no=?`).get(emsNo, b.item_no);
    const actual = snap ? Number(snap.qty) : b.book;
    return { item_no: b.item_no, product_name: b.product_name, book: b.book, actual, diff: +(actual - b.book).toFixed(5) };
  });
  const r = db.prepare(`INSERT INTO stocktake (take_no, ems_id, ems_no, take_date, result_data, status) VALUES (?,?,?,?,?, 'DRAFT')`)
    .run(genNo('PD'), ems.id, emsNo, new Date().toISOString().slice(0, 10), JSON.stringify(result));
  ok(res, { id: Number(r.lastInsertRowid), diffItems: result.filter(d => d.diff !== 0).length });
});

router.post('/stocktake/:id/confirm', (req, res) => {
  const t = db.prepare(`SELECT * FROM stocktake WHERE id=?`).get(req.params.id);
  if (!t) return fail(res, '盘点单不存在', 404);
  if (t.status !== 'DRAFT') return fail(res, '仅编制中可确认');
  db.prepare(`UPDATE stocktake SET status='CONFIRMED' WHERE id=?`).run(req.params.id);
  ok(res, { id: Number(req.params.id), status: 'CONFIRMED' });
});

// 盘盈盘亏调整账册(按差异写核增/核减流水)
router.post('/stocktake/:id/adjust', (req, res) => {
  const t = db.prepare(`SELECT * FROM stocktake WHERE id=?`).get(req.params.id);
  if (!t) return fail(res, '盘点单不存在', 404);
  if (t.status !== 'CONFIRMED') return fail(res, '仅已确认盘点单可调整账册');
  const result = JSON.parse(t.result_data);
  let adjusted = 0;
  for (const it of result) {
    if (!it.diff) continue;
    const last = db.prepare(`SELECT balance FROM ems_stock_ledger WHERE ems_id=? AND item_no=? ORDER BY id DESC LIMIT 1`).get(t.ems_id, it.item_no);
    const bal = (last ? Number(last.balance) : 0) + it.diff;
    db.prepare(`INSERT INTO ems_stock_ledger (ems_id, item_no, biz_type, biz_no, qty, balance) VALUES (?,?, 'ADJUST', ?, ?, ?)`)
      .run(t.ems_id, it.item_no, t.take_no, it.diff, +bal.toFixed(5));
    adjusted++;
  }
  db.prepare(`UPDATE stocktake SET status='ADJUSTED' WHERE id=?`).run(req.params.id);
  opLog(req, 'ADJUST', 'STOCKTAKE', req.params.id, { adjusted });
  ok(res, { id: Number(req.params.id), status: 'ADJUSTED', adjusted });
});

module.exports = router;

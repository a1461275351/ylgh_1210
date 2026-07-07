// T12 报关单:一线进境备货(监管方式 1210 进口)。放行后据此生成入区核注清单。
const router = require('express').Router();
const db = require('../db');
const { ok, fail, page, genNo, opLog } = require('../util');

const STATUS_LABEL = { DRAFT: '录入', DECLARED: '已申报', RELEASED: '放行', REJECTED: '退单' };

router.get('/', (req, res) => {
  const { offset, pageSize, page: p } = page(req);
  const where = [], args = [];
  if (req.query.entryNo) { where.push(`(entry_no LIKE ? OR internal_no LIKE ?)`); args.push(`%${req.query.entryNo}%`, `%${req.query.entryNo}%`); }
  if (req.query.status)  { where.push(`status=?`); args.push(req.query.status); }
  const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { c: total } = db.prepare(`SELECT COUNT(*) AS c FROM decl_head ${cond}`).get(...args);
  const list = db.prepare(`SELECT * FROM decl_head ${cond} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...args, pageSize, offset).map(r => ({ ...r, status_label: STATUS_LABEL[r.status] || r.status }));
  ok(res, { list, total, page: p, pageSize });
});

router.get('/:id', (req, res) => {
  const h = db.prepare(`SELECT * FROM decl_head WHERE id=?`).get(req.params.id);
  if (!h) return fail(res, '报关单不存在', 404);
  const items = db.prepare(`SELECT * FROM decl_item WHERE head_id=? ORDER BY seq_no`).all(req.params.id);
  const bond = db.prepare(`SELECT id, internal_no, bond_invt_no, status FROM bond_invt_head WHERE decl_id=?`).get(req.params.id);
  ok(res, { ...h, status_label: STATUS_LABEL[h.status] || h.status, items, bond });
});

// 新建进境备货报关单(表头 + 表体)
function create(body, req) {
  if (!body.ems_no) throw new Error('账册号必填');
  const ems = db.prepare(`SELECT * FROM ems_header WHERE ems_no=?`).get(body.ems_no);
  if (!ems) throw new Error(`账册 ${body.ems_no} 不存在`);
  if (ems.status !== 'APPROVED') throw new Error('账册未审批通过,不能备货进口');
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) throw new Error('报关单表体不能为空');
  const r = db.prepare(`INSERT INTO decl_head (internal_no, decl_type, trade_mode, ems_no, trade_country, bill_no, status, created_by)
      VALUES (?, 'FIRST_IN', '1210', ?, ?, ?, 'DRAFT', ?)`)
    .run(genNo('BGD'), body.ems_no, body.trade_country || null, body.bill_no || genNo('BL'), req.user || 'admin');
  const headId = Number(r.lastInsertRowid);
  const insI = db.prepare(`INSERT INTO decl_item (head_id, seq_no, ems_item_no, hs_code, product_name, unit, qty, unit_price, total_price) VALUES (?,?,?,?,?,?,?,?,?)`);
  items.forEach((it, i) => {
    const total = it.total_price != null ? Number(it.total_price) : +(Number(it.qty) * Number(it.unit_price || 0)).toFixed(4);
    insI.run(headId, i + 1, it.ems_item_no || null, it.hs_code, it.product_name, it.unit || '007', it.qty, it.unit_price || 0, total);
  });
  opLog(req, 'CREATE', 'DECL', headId, { ems_no: body.ems_no });
  return headId;
}

router.post('/', (req, res) => {
  try { ok(res, { id: create(req.body, req) }); } catch (e) { fail(res, e.message); }
});

// 备货入区样例:按账册现有表体自动造一张进境报关单
router.post('/sample', (req, res) => {
  const emsNo = (req.query.emsNo) || 'T901625A00100';
  const ems = db.prepare(`SELECT * FROM ems_header WHERE ems_no=?`).get(emsNo);
  if (!ems) return fail(res, `账册 ${emsNo} 不存在`);
  const items = db.prepare(`SELECT * FROM ems_item WHERE ems_id=? ORDER BY item_no LIMIT 3`).all(ems.id);
  if (!items.length) return fail(res, '账册无表体商品');
  try {
    const id = create({ ems_no: emsNo, trade_country: '609',
      items: items.map(it => ({ ems_item_no: it.item_no, hs_code: it.hs_code, product_name: it.product_name,
        unit: it.unit, qty: 500, unit_price: it.declare_price || 100 })) }, req);
    ok(res, { id, itemCount: items.length });
  } catch (e) { fail(res, e.message); }
});

// 申报 / 放行(模拟海关)
router.post('/:id/declare', (req, res) => {
  const h = db.prepare(`SELECT * FROM decl_head WHERE id=?`).get(req.params.id);
  if (!h) return fail(res, '报关单不存在', 404);
  if (!['DRAFT', 'REJECTED'].includes(h.status)) return fail(res, `状态 ${STATUS_LABEL[h.status]} 不能申报`);
  db.prepare(`UPDATE decl_head SET status='DECLARED', entry_no=?, declare_time=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE id=?`)
    .run(h.entry_no || ('22' + String(h.id).padStart(16, '0')).slice(0, 18), req.params.id);
  opLog(req, 'DECLARE', 'DECL', req.params.id, {});
  ok(res, { id: Number(req.params.id), status: 'DECLARED' });
});

router.post('/:id/release', (req, res) => {
  const h = db.prepare(`SELECT * FROM decl_head WHERE id=?`).get(req.params.id);
  if (!h) return fail(res, '报关单不存在', 404);
  if (h.status !== 'DECLARED') return fail(res, '仅已申报可放行');
  db.prepare(`UPDATE decl_head SET status='RELEASED', release_time=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE id=?`).run(req.params.id);
  opLog(req, 'RELEASE', 'DECL', req.params.id, {});
  ok(res, { id: Number(req.params.id), status: 'RELEASED' });
});

router.delete('/:id', (req, res) => {
  const h = db.prepare(`SELECT * FROM decl_head WHERE id=?`).get(req.params.id);
  if (!h) return fail(res, '报关单不存在', 404);
  if (!['DRAFT', 'REJECTED'].includes(h.status)) return fail(res, `状态 ${STATUS_LABEL[h.status]} 不可删除`);
  db.prepare(`DELETE FROM decl_item WHERE head_id=?`).run(req.params.id);
  db.prepare(`DELETE FROM decl_head WHERE id=?`).run(req.params.id);
  ok(res, { id: Number(req.params.id) });
});

module.exports = router;

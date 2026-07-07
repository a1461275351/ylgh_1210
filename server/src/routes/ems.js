// T07 电子账册:备案(表头+表体)/ 初审 / 复审 / 申报回执 / 进出存台账 / 变更单
const router = require('express').Router();
const db = require('../db');
const { ok, fail, page, genNo, opLog } = require('../util');

const STATUS_LABEL = {
  DRAFT: '录入', AUDIT1: '待初审', AUDIT2: '待复审', DECLARED: '已申报',
  APPROVED: '金二审批通过', REJECTED: '退单',
};
const CHG_LABEL = { ...STATUS_LABEL };
const EDITABLE = ['DRAFT', 'REJECTED'];

function balanceOf(emsId, itemNo) {
  const row = db.prepare(`SELECT balance FROM ems_stock_ledger WHERE ems_id=? AND item_no=? ORDER BY id DESC LIMIT 1`).get(emsId, itemNo);
  return row ? Number(row.balance) : 0;
}

// ---------------- 账册台账(进出存)----------------
router.get('/:id/ledger', (req, res) => {
  const ems = db.prepare(`SELECT * FROM ems_header WHERE id=?`).get(req.params.id);
  if (!ems) return fail(res, '账册不存在', 404);
  const items = db.prepare(`SELECT * FROM ems_item WHERE ems_id=? ORDER BY item_no`).all(req.params.id);
  const list = items.map(it => {
    const rows = db.prepare(`SELECT biz_type, qty FROM ems_stock_ledger WHERE ems_id=? AND item_no=?`).all(req.params.id, it.item_no);
    const inQty = rows.filter(r => Number(r.qty) > 0).reduce((s, r) => s + Number(r.qty), 0);
    const outQty = rows.filter(r => Number(r.qty) < 0).reduce((s, r) => s + Number(r.qty), 0);
    return { item_no: it.item_no, product_name: it.product_name, hs_code: it.hs_code, unit: it.unit,
      in_qty: +inQty.toFixed(5), out_qty: +Math.abs(outQty).toFixed(5), balance: balanceOf(req.params.id, it.item_no) };
  });
  ok(res, { ems_no: ems.ems_no, list });
});

// 台账流水明细
router.get('/:id/ledger/:itemNo', (req, res) => {
  const rows = db.prepare(`SELECT * FROM ems_stock_ledger WHERE ems_id=? AND item_no=? ORDER BY id`).all(req.params.id, req.params.itemNo);
  ok(res, rows);
});

// ---------------- 变更单 ----------------
router.get('/changes/list', (req, res) => {
  const { offset, pageSize, page: p } = page(req);
  const where = [], args = [];
  if (req.query.status) { where.push(`c.status=?`); args.push(req.query.status); }
  if (req.query.emsNo)  { where.push(`h.ems_no LIKE ?`); args.push(`%${req.query.emsNo}%`); }
  const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { c: total } = db.prepare(`SELECT COUNT(*) AS c FROM ems_change c JOIN ems_header h ON c.ems_id=h.id ${cond}`).get(...args);
  const list = db.prepare(`SELECT c.*, h.ems_no FROM ems_change c JOIN ems_header h ON c.ems_id=h.id ${cond} ORDER BY c.id DESC LIMIT ? OFFSET ?`)
    .all(...args, pageSize, offset).map(r => ({ ...r, status_label: CHG_LABEL[r.status] || r.status }));
  ok(res, { list, total, page: p, pageSize });
});

router.post('/:id/changes', (req, res) => {
  const ems = db.prepare(`SELECT * FROM ems_header WHERE id=?`).get(req.params.id);
  if (!ems) return fail(res, '账册不存在', 404);
  if (ems.status !== 'APPROVED') return fail(res, '仅审批通过的账册可发起变更');
  const b = req.body;
  if (!['ITEM_ADD', 'ITEM_MODIFY', 'EXTEND', 'HEAD'].includes(b.change_type)) return fail(res, '变更类型不合法');
  const r = db.prepare(`INSERT INTO ems_change (ems_id, change_no, change_type, change_desc, change_data, status, created_by)
      VALUES (?,?,?,?,?, 'DRAFT', ?)`)
    .run(req.params.id, genNo('BG'), b.change_type, b.change_desc || null, JSON.stringify(b.change_data || {}), req.user || 'admin');
  opLog(req, 'CREATE', 'EMS_CHANGE', Number(r.lastInsertRowid), { ems_no: ems.ems_no, type: b.change_type });
  ok(res, { id: Number(r.lastInsertRowid) });
});

function chgFlow(fromStates, toState, applyOnPass) {
  return (req, res) => {
    const c = db.prepare(`SELECT * FROM ems_change WHERE id=?`).get(req.params.cid);
    if (!c) return fail(res, '变更单不存在', 404);
    if (!fromStates.includes(c.status)) return fail(res, `当前状态 ${CHG_LABEL[c.status]} 不允许该操作`);
    const remark = (req.body && req.body.remark) || null;
    if (applyOnPass) applyChange(c);
    const extra = toState === 'AUDIT2' ? `, audit1_remark='${remark || ''}', audit1_at=datetime('now','localtime')`
      : (toState === 'APPROVED' ? `, audit2_remark='${remark || ''}', audit2_at=datetime('now','localtime'), declare_time=datetime('now','localtime'), ret_time=datetime('now','localtime'), ret_msg='金二审批通过'` : '');
    db.prepare(`UPDATE ems_change SET status=? ${extra} WHERE id=?`).run(toState, req.params.cid);
    opLog(req, 'AUDIT', 'EMS_CHANGE', req.params.cid, { from: c.status, to: toState });
    ok(res, { id: Number(req.params.cid), status: toState });
  };
}
// 变更复审通过 → 应用变更到账册
function applyChange(c) {
  const data = c.change_data ? JSON.parse(c.change_data) : {};
  if (c.change_type === 'EXTEND' && data.valid_end) {
    db.prepare(`UPDATE ems_header SET valid_end=?, updated_at=datetime('now','localtime') WHERE id=?`).run(data.valid_end, c.ems_id);
  } else if (c.change_type === 'ITEM_ADD' && data.item) {
    const it = data.item;
    const maxNo = db.prepare(`SELECT COALESCE(MAX(item_no),0) AS m FROM ems_item WHERE ems_id=?`).get(c.ems_id).m;
    const no = maxNo + 1;
    db.prepare(`INSERT INTO ems_item (ems_id, item_no, product_code, hs_code, product_name, unit, declare_price) VALUES (?,?,?,?,?,?,?)`)
      .run(c.ems_id, no, it.product_code || null, it.hs_code, it.product_name, it.unit || '007', it.declare_price ?? null);
    db.prepare(`INSERT INTO ems_stock_ledger (ems_id, item_no, biz_type, biz_no, qty, balance) VALUES (?,?, 'ADJUST', ?, 0, 0)`)
      .run(c.ems_id, no, c.change_no);
  }
}
router.post('/changes/:cid/submit', chgFlow(['DRAFT', 'REJECTED'], 'AUDIT1'));
router.post('/changes/:cid/audit1-pass', chgFlow(['AUDIT1'], 'AUDIT2'));
router.post('/changes/:cid/audit2-pass', chgFlow(['AUDIT2'], 'APPROVED', true));
router.post('/changes/:cid/reject', chgFlow(['AUDIT1', 'AUDIT2'], 'REJECTED'));

// ---------------- 账册表头 ----------------
router.get('/', (req, res) => {
  const { offset, pageSize, page: p } = page(req);
  const where = [], args = [];
  if (req.query.emsNo)      { where.push(`ems_no LIKE ?`);      args.push(`%${req.query.emsNo}%`); }
  if (req.query.internalNo) { where.push(`internal_no LIKE ?`); args.push(`%${req.query.internalNo}%`); }
  if (req.query.status)     { where.push(`status=?`);          args.push(req.query.status); }
  const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { c: total } = db.prepare(`SELECT COUNT(*) AS c FROM ems_header ${cond}`).get(...args);
  const list = db.prepare(`SELECT * FROM ems_header ${cond} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...args, pageSize, offset).map(r => ({ ...r, status_label: STATUS_LABEL[r.status] || r.status }));
  ok(res, { list, total, page: p, pageSize });
});

router.get('/:id', (req, res) => {
  const h = db.prepare(`SELECT * FROM ems_header WHERE id=?`).get(req.params.id);
  if (!h) return fail(res, '账册不存在', 404);
  const items = db.prepare(`SELECT * FROM ems_item WHERE ems_id=? ORDER BY item_no`).all(req.params.id)
    .map(it => ({ ...it, balance: balanceOf(req.params.id, it.item_no) }));
  ok(res, { ...h, status_label: STATUS_LABEL[h.status] || h.status, items });
});

router.post('/', (req, res) => {
  const b = req.body;
  if (!b.company_code || !b.company_name) return fail(res, '经营单位代码/名称必填');
  const r = db.prepare(`INSERT INTO ems_header
      (internal_no, ems_type, company_code, company_name, customs_code, usage_type, status, valid_end, input_date, remark, created_by, updated_at)
      VALUES (?,?,?,?,?,?, 'DRAFT', ?, date('now','localtime'), ?, ?, datetime('now','localtime'))`)
    .run(b.internal_no || genNo('ZC'), b.ems_type || 'T', b.company_code, b.company_name,
         b.customs_code || null, b.usage_type || 'CBEC', b.valid_end || null, b.remark || null, req.user || 'admin');
  const emsId = Number(r.lastInsertRowid);
  const items = Array.isArray(b.items) ? b.items : [];
  const insI = db.prepare(`INSERT INTO ems_item (ems_id, item_no, product_code, hs_code, product_name, unit, declare_price) VALUES (?,?,?,?,?,?,?)`);
  items.forEach((it, i) => insI.run(emsId, it.item_no || i + 1, it.product_code || null, it.hs_code, it.product_name, it.unit || '007', it.declare_price ?? null));
  opLog(req, 'CREATE', 'EMS', emsId, { internal_no: b.internal_no });
  ok(res, { id: emsId });
});

router.put('/:id', (req, res) => {
  const h = db.prepare(`SELECT * FROM ems_header WHERE id=?`).get(req.params.id);
  if (!h) return fail(res, '账册不存在', 404);
  if (!EDITABLE.includes(h.status)) return fail(res, `状态 ${STATUS_LABEL[h.status]} 不可编辑`);
  const b = req.body;
  db.prepare(`UPDATE ems_header SET ems_type=?, company_code=?, company_name=?, customs_code=?, valid_end=?, remark=?, updated_at=datetime('now','localtime') WHERE id=?`)
    .run(b.ems_type ?? h.ems_type, b.company_code ?? h.company_code, b.company_name ?? h.company_name,
         b.customs_code ?? h.customs_code, b.valid_end ?? h.valid_end, b.remark ?? h.remark, req.params.id);
  opLog(req, 'UPDATE', 'EMS', req.params.id, {});
  ok(res, { id: Number(req.params.id) });
});

// 表体增删(仅录入/退单)
router.post('/:id/items', (req, res) => {
  const h = db.prepare(`SELECT * FROM ems_header WHERE id=?`).get(req.params.id);
  if (!h) return fail(res, '账册不存在', 404);
  if (!EDITABLE.includes(h.status)) return fail(res, '当前状态不可增删表体');
  const b = req.body;
  if (!b.hs_code || !b.product_name) return fail(res, 'HS/品名必填');
  const maxNo = db.prepare(`SELECT COALESCE(MAX(item_no),0) AS m FROM ems_item WHERE ems_id=?`).get(req.params.id).m;
  const no = b.item_no || maxNo + 1;
  db.prepare(`INSERT INTO ems_item (ems_id, item_no, product_code, hs_code, product_name, unit, declare_price) VALUES (?,?,?,?,?,?,?)`)
    .run(req.params.id, no, b.product_code || null, b.hs_code, b.product_name, b.unit || '007', b.declare_price ?? null);
  ok(res, { item_no: no });
});

router.delete('/:id/items/:itemId', (req, res) => {
  const h = db.prepare(`SELECT * FROM ems_header WHERE id=?`).get(req.params.id);
  if (!h) return fail(res, '账册不存在', 404);
  if (!EDITABLE.includes(h.status)) return fail(res, '当前状态不可删除表体');
  db.prepare(`DELETE FROM ems_item WHERE id=? AND ems_id=?`).run(req.params.itemId, req.params.id);
  ok(res, { id: Number(req.params.itemId) });
});

// 备案流程
function flow(fromStates, toState) {
  return (req, res) => {
    const h = db.prepare(`SELECT * FROM ems_header WHERE id=?`).get(req.params.id);
    if (!h) return fail(res, '账册不存在', 404);
    if (!fromStates.includes(h.status)) return fail(res, `当前状态 ${STATUS_LABEL[h.status]} 不允许该操作`);
    if (toState === 'AUDIT1') {
      const cnt = db.prepare(`SELECT COUNT(*) AS c FROM ems_item WHERE ems_id=?`).get(req.params.id).c;
      if (!cnt) return fail(res, '账册无表体商品,不能提交');
    }
    let extra = '';
    if (toState === 'APPROVED') {
      // 复审通过 = 申报金二并回执通过;若无账册号则生成
      const emsNo = h.ems_no || ('T' + String(h.id).padStart(9, '0') + 'A00100').slice(0, 13);
      extra = `, ems_no='${emsNo}', declare_time=datetime('now','localtime'), approve_time=datetime('now','localtime')`;
    }
    db.prepare(`UPDATE ems_header SET status=? ${extra}, updated_at=datetime('now','localtime') WHERE id=?`).run(toState, req.params.id);
    opLog(req, 'AUDIT', 'EMS', req.params.id, { from: h.status, to: toState });
    ok(res, { id: Number(req.params.id), status: toState });
  };
}
router.post('/:id/submit', flow(['DRAFT', 'REJECTED'], 'AUDIT1'));
router.post('/:id/audit1-pass', flow(['AUDIT1'], 'AUDIT2'));
router.post('/:id/audit2-pass', flow(['AUDIT2'], 'APPROVED'));
router.post('/:id/reject', flow(['AUDIT1', 'AUDIT2'], 'REJECTED'));

router.delete('/:id', (req, res) => {
  const h = db.prepare(`SELECT * FROM ems_header WHERE id=?`).get(req.params.id);
  if (!h) return fail(res, '账册不存在', 404);
  if (!EDITABLE.includes(h.status)) return fail(res, `状态 ${STATUS_LABEL[h.status]} 不可删除`);
  const used = db.prepare(`SELECT COUNT(*) AS c FROM ems_stock_ledger WHERE ems_id=? AND biz_no <> 'INIT-STOCK'`).get(req.params.id).c;
  if (used > 0) return fail(res, '账册已有进出存记录,不能删除');
  db.prepare(`DELETE FROM ems_item WHERE ems_id=?`).run(req.params.id);
  db.prepare(`DELETE FROM ems_stock_ledger WHERE ems_id=?`).run(req.params.id);
  db.prepare(`DELETE FROM ems_header WHERE id=?`).run(req.params.id);
  opLog(req, 'DELETE', 'EMS', req.params.id, {});
  ok(res, { id: Number(req.params.id) });
});

module.exports = router;

// T11 核放单:货物过卡口(保税区大门)放行凭证。入区(IN)/ 出区(OUT)。
// 出区核放单过卡后,关联零售订单状态置为「已出库」。
const router = require('express').Router();
const db = require('../db');
const { ok, fail, page, genNo, opLog } = require('../util');

const STATUS_LABEL = {
  DRAFT: '录入', DECLARED: '已申报', APPROVED: '审批通过',
  GATE_IN: '已过卡入区', GATE_OUT: '已过卡出区', CANCELLED: '作废', ABNORMAL: '卡口异常',
};

router.get('/', (req, res) => {
  const { offset, pageSize, page: p } = page(req);
  const where = [], args = [];
  if (req.query.type)   { where.push(`passport_type=?`); args.push(req.query.type); }
  if (req.query.status) { where.push(`status=?`);        args.push(req.query.status); }
  if (req.query.no)     { where.push(`(passport_no LIKE ? OR internal_no LIKE ?)`); args.push(`%${req.query.no}%`, `%${req.query.no}%`); }
  const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { c: total } = db.prepare(`SELECT COUNT(*) AS c FROM passport_head ${cond}`).get(...args);
  const list = db.prepare(`SELECT * FROM passport_head ${cond} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...args, pageSize, offset)
    .map(r => ({ ...r, status_label: STATUS_LABEL[r.status] || r.status, type_label: r.passport_type === 'IN' ? '一线入区' : '二线出区' }));
  ok(res, { list, total, page: p, pageSize });
});

router.get('/:id', (req, res) => {
  const h = db.prepare(`SELECT * FROM passport_head WHERE id=?`).get(req.params.id);
  if (!h) return fail(res, '核放单不存在', 404);
  const bond = h.bond_invt_id ? db.prepare(`SELECT id, internal_no, bond_invt_no, flow_type, rlt_invt_nos FROM bond_invt_head WHERE id=?`).get(h.bond_invt_id) : null;
  ok(res, { ...h, status_label: STATUS_LABEL[h.status] || h.status, type_label: h.passport_type === 'IN' ? '一线入区' : '二线出区', bond });
});

// 由核注清单生成核放单
router.post('/from-bond/:bondId', (req, res) => {
  const bond = db.prepare(`SELECT * FROM bond_invt_head WHERE id=?`).get(req.params.bondId);
  if (!bond) return fail(res, '核注清单不存在', 404);
  if (bond.status !== 'APPROVED') return fail(res, '核注清单未审批通过,不能生成核放单');
  const exist = db.prepare(`SELECT id FROM passport_head WHERE bond_invt_id=?`).get(req.params.bondId);
  if (exist) return fail(res, '该核注清单已生成核放单');
  const r = db.prepare(`INSERT INTO passport_head (internal_no, passport_type, ems_no, bond_invt_id, vehicle_no, vehicle_ic, status, created_by)
      VALUES (?,?,?,?,?,?, 'DRAFT', ?)`)
    .run(genNo('HF'), bond.flow_type, bond.ems_no, bond.id,
         (req.body && req.body.vehicle_no) || '陕A' + Math.floor(10000 + (bond.id * 7) % 89999),
         (req.body && req.body.vehicle_ic) || 'IC' + String(bond.id).padStart(8, '0'), req.user || 'admin');
  opLog(req, 'CREATE', 'PASSPORT', Number(r.lastInsertRowid), { bond_invt_id: bond.id, type: bond.flow_type });
  ok(res, { id: Number(r.lastInsertRowid) });
});

router.post('/:id/declare', (req, res) => {
  const h = db.prepare(`SELECT * FROM passport_head WHERE id=?`).get(req.params.id);
  if (!h) return fail(res, '核放单不存在', 404);
  if (!['DRAFT'].includes(h.status)) return fail(res, `状态 ${STATUS_LABEL[h.status]} 不能申报`);
  db.prepare(`UPDATE passport_head SET status='APPROVED', passport_no=?, declare_time=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE id=?`)
    .run(h.passport_no || ('16' + String(h.id).padStart(10, '0')), req.params.id);
  opLog(req, 'DECLARE', 'PASSPORT', req.params.id, {});
  ok(res, { id: Number(req.params.id), status: 'APPROVED' });
});

// 卡口验放(过卡)。出区过卡 → 关联订单置为已出库
router.post('/:id/gate', (req, res) => {
  const h = db.prepare(`SELECT * FROM passport_head WHERE id=?`).get(req.params.id);
  if (!h) return fail(res, '核放单不存在', 404);
  if (h.status !== 'APPROVED') return fail(res, '核放单未审批通过,不能过卡');
  const newStatus = h.passport_type === 'IN' ? 'GATE_IN' : 'GATE_OUT';
  db.prepare(`UPDATE passport_head SET status=?, gate_time=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE id=?`).run(newStatus, req.params.id);

  let shipped = 0;
  if (h.passport_type === 'OUT' && h.bond_invt_id) {
    const bond = db.prepare(`SELECT * FROM bond_invt_head WHERE id=?`).get(h.bond_invt_id);
    if (bond) {
      const invs = db.prepare(`SELECT * FROM ceb_inventory WHERE bond_invt_no=?`).all(bond.internal_no);
      for (const v of invs) {
        db.prepare(`UPDATE ceb_order SET status='OUTBOUND', updated_at=datetime('now','localtime') WHERE order_no=? AND status='RELEASED'`).run(v.order_no);
        shipped++;
      }
    }
  }
  opLog(req, 'GATE', 'PASSPORT', req.params.id, { status: newStatus, shipped });
  ok(res, { id: Number(req.params.id), status: newStatus, shippedOrders: shipped });
});

router.post('/:id/abnormal', (req, res) => {
  const h = db.prepare(`SELECT * FROM passport_head WHERE id=?`).get(req.params.id);
  if (!h) return fail(res, '核放单不存在', 404);
  db.prepare(`UPDATE passport_head SET status='ABNORMAL', abnormal_msg=?, updated_at=datetime('now','localtime') WHERE id=?`)
    .run((req.body && req.body.msg) || '卡口过卡异常', req.params.id);
  ok(res, { id: Number(req.params.id), status: 'ABNORMAL' });
});

module.exports = router;

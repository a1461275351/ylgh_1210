// T10 核注清单:一线入区(核增)/ 二线出区(核减),审批通过时真实驱动账册库存
const router = require('express').Router();
const db = require('../db');
const { ok, fail, page, genNo, opLog } = require('../util');

const STATUS_LABEL = {
  DRAFT: '录入', DECLARED: '已申报', APPROVED: '审批通过', REJECTED: '退单', DELETED: '作废',
};

function balanceOf(emsId, itemNo) {
  const row = db.prepare(`SELECT balance FROM ems_stock_ledger WHERE ems_id=? AND item_no=? ORDER BY id DESC LIMIT 1`).get(emsId, itemNo);
  return row ? Number(row.balance) : 0;
}

// 审批通过 → 核增/核减账册(每项写一条流水,防重复)
function applyStock(head) {
  const items = db.prepare(`SELECT * FROM bond_invt_item WHERE head_id=?`).all(head.id);
  // 出区先校验余量
  if (head.flow_type === 'OUT') {
    for (const it of items) {
      const bal = balanceOf(head.ems_id, it.ems_item_no);
      if (bal < Number(it.qty))
        throw new Error(`序号 ${it.ems_item_no} ${it.product_name} 账册余量不足(余 ${bal},需核减 ${it.qty}),不能核放出区`);
    }
  }
  const ins = db.prepare(`INSERT INTO ems_stock_ledger (ems_id, item_no, biz_type, biz_no, qty, balance, amount) VALUES (?,?,?,?,?,?,?)`);
  for (const it of items) {
    const signed = head.flow_type === 'IN' ? Number(it.qty) : -Number(it.qty);
    const bal = balanceOf(head.ems_id, it.ems_item_no) + signed;
    ins.run(head.ems_id, it.ems_item_no, head.flow_type === 'IN' ? 'IN' : 'OUT',
            head.bond_invt_no || head.internal_no, signed, +bal.toFixed(5), it.total_price || 0);
  }
}

// 列表
router.get('/', (req, res) => {
  const { offset, pageSize, page: p } = page(req);
  const where = [], args = [];
  if (req.query.flowType) { where.push(`flow_type=?`);       args.push(req.query.flowType); }
  if (req.query.status)   { where.push(`status=?`);          args.push(req.query.status); }
  if (req.query.bondNo)   { where.push(`(bond_invt_no LIKE ? OR internal_no LIKE ?)`); args.push(`%${req.query.bondNo}%`, `%${req.query.bondNo}%`); }
  const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { c: total } = db.prepare(`SELECT COUNT(*) AS c FROM bond_invt_head ${cond}`).get(...args);
  const list = db.prepare(`SELECT * FROM bond_invt_head ${cond} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...args, pageSize, offset)
    .map(r => ({ ...r, status_label: STATUS_LABEL[r.status] || r.status, flow_label: r.flow_type === 'IN' ? '一线入区' : '二线出区' }));
  ok(res, { list, total, page: p, pageSize });
});

router.get('/:id', (req, res) => {
  const h = db.prepare(`SELECT * FROM bond_invt_head WHERE id=?`).get(req.params.id);
  if (!h) return fail(res, '核注清单不存在', 404);
  const items = db.prepare(`SELECT * FROM bond_invt_item WHERE head_id=? ORDER BY seq_no`).all(req.params.id);
  ok(res, { ...h, status_label: STATUS_LABEL[h.status] || h.status, flow_label: h.flow_type === 'IN' ? '一线入区' : '二线出区', items });
});

// 由进境报关单生成入区核注清单(核增)
router.post('/from-decl/:declId', (req, res) => {
  const decl = db.prepare(`SELECT * FROM decl_head WHERE id=?`).get(req.params.declId);
  if (!decl) return fail(res, '报关单不存在', 404);
  const exist = db.prepare(`SELECT id FROM bond_invt_head WHERE decl_id=?`).get(req.params.declId);
  if (exist) return fail(res, '该报关单已生成核注清单');
  const ems = db.prepare(`SELECT * FROM ems_header WHERE ems_no=?`).get(decl.ems_no);
  if (!ems) return fail(res, `账册 ${decl.ems_no} 不存在`);
  const dItems = db.prepare(`SELECT * FROM decl_item WHERE head_id=?`).all(req.params.declId);
  if (!dItems.length) return fail(res, '报关单无表体');
  try {
    const id = createHead({ ems, flow_type: 'IN', mtpck_endprd: 'I', decl_id: decl.id,
      items: dItems.map(it => ({ ems_item_no: it.ems_item_no, hs_code: it.hs_code, product_name: it.product_name,
        unit: it.unit, qty: it.qty, unit_price: it.unit_price, total_price: it.total_price })) }, req);
    ok(res, { id });
  } catch (e) { fail(res, e.message); }
});

// 由放行零售清单汇总生成出区核注清单(核减)
router.post('/from-inventories', (req, res) => {
  const ids = Array.isArray(req.body.inventoryIds) ? req.body.inventoryIds : [];
  if (!ids.length) return fail(res, '请选择放行清单');
  const invs = ids.map(id => db.prepare(`SELECT * FROM ceb_inventory WHERE id=?`).get(id)).filter(Boolean);
  const bad = invs.find(v => v.status !== 'RELEASED');
  if (bad) return fail(res, `清单 ${bad.order_no} 未放行,不能出区`);
  if (!invs.length) return fail(res, '无有效清单');
  const emsNo = invs[0].ems_no;
  const ems = db.prepare(`SELECT * FROM ems_header WHERE ems_no=?`).get(emsNo);
  if (!ems) return fail(res, `账册 ${emsNo} 不存在`);

  // 汇总:按账册备案序号合并数量
  const agg = {};
  for (const v of invs) {
    const items = db.prepare(`SELECT * FROM ceb_inventory_item WHERE inventory_id=?`).all(v.id);
    for (const it of items) {
      const rel = db.prepare(`SELECT ger.item_no FROM goods_ems_rel ger JOIN goods_product gp ON ger.product_id=gp.id WHERE gp.sku=?`).get(it.sku);
      if (!rel) return fail(res, `商品 ${it.sku} 未绑定账册备案序号,无法核减`);
      const key = rel.item_no;
      if (!agg[key]) agg[key] = { ems_item_no: rel.item_no, hs_code: it.hs_code, product_name: it.product_name, unit: it.unit, qty: 0, total_price: 0 };
      agg[key].qty += Number(it.qty);
      agg[key].total_price += Number(it.total_price);
    }
  }
  try {
    const id = createHead({ ems, flow_type: 'OUT', mtpck_endprd: 'E',
      rlt_invt_nos: invs.map(v => v.invt_no || v.order_no).join(','),
      items: Object.values(agg) }, req);
    // 回填清单关联核注清单号
    const head = db.prepare(`SELECT * FROM bond_invt_head WHERE id=?`).get(id);
    for (const v of invs) db.prepare(`UPDATE ceb_inventory SET bond_invt_no=? WHERE id=?`).run(head.internal_no, v.id);
    ok(res, { id, itemCount: Object.keys(agg).length });
  } catch (e) { fail(res, e.message); }
});

function createHead(o, req) {
  const internalNo = genNo('HZ');
  const r = db.prepare(`INSERT INTO bond_invt_head
      (internal_no, ems_id, ems_no, flow_type, mtpck_endprd, decl_id, rlt_invt_nos, status, created_by)
      VALUES (?,?,?,?,?,?,?, 'DRAFT', ?)`)
    .run(internalNo, o.ems.id, o.ems.ems_no, o.flow_type, o.mtpck_endprd, o.decl_id || null, o.rlt_invt_nos || null, req.user || 'admin');
  const headId = Number(r.lastInsertRowid);
  const insI = db.prepare(`INSERT INTO bond_invt_item (head_id, seq_no, ems_item_no, hs_code, product_name, unit, qty, unit_price, total_price) VALUES (?,?,?,?,?,?,?,?,?)`);
  o.items.forEach((it, i) => insI.run(headId, i + 1, it.ems_item_no, it.hs_code, it.product_name, it.unit, it.qty, it.unit_price || 0, it.total_price || 0));
  opLog(req, 'CREATE', 'BOND_INVT', headId, { flow: o.flow_type, internal_no: internalNo });
  return headId;
}

// 申报金二
router.post('/:id/declare', (req, res) => {
  const h = db.prepare(`SELECT * FROM bond_invt_head WHERE id=?`).get(req.params.id);
  if (!h) return fail(res, '核注清单不存在', 404);
  if (!['DRAFT', 'REJECTED'].includes(h.status)) return fail(res, `状态 ${STATUS_LABEL[h.status]} 不能申报`);
  const bondNo = h.bond_invt_no || (h.flow_type === 'IN' ? 'Z16' : 'Z26') + String(h.id).padStart(10, '0');
  db.prepare(`UPDATE bond_invt_head SET status='DECLARED', bond_invt_no=?, declare_time=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE id=?`).run(bondNo, req.params.id);
  opLog(req, 'DECLARE', 'BOND_INVT', req.params.id, { bondNo });
  ok(res, { id: Number(req.params.id), status: 'DECLARED', bond_invt_no: bondNo });
});

// 金二审批通过 → 核增/核减账册
router.post('/:id/approve', (req, res) => {
  const h = db.prepare(`SELECT * FROM bond_invt_head WHERE id=?`).get(req.params.id);
  if (!h) return fail(res, '核注清单不存在', 404);
  if (h.status !== 'DECLARED') return fail(res, '仅已申报的核注清单可审批');
  try {
    if (!h.stock_applied) applyStock(h);
  } catch (e) { return fail(res, e.message); }
  db.prepare(`UPDATE bond_invt_head SET status='APPROVED', stock_applied=1, ret_msg='金二审批通过,账册已${h.flow_type === 'IN' ? '核增' : '核减'}', updated_at=datetime('now','localtime') WHERE id=?`).run(req.params.id);
  opLog(req, 'AUDIT', 'BOND_INVT', req.params.id, { to: 'APPROVED', flow: h.flow_type });
  ok(res, { id: Number(req.params.id), status: 'APPROVED', flow: h.flow_type });
});

router.post('/:id/reject', (req, res) => {
  const h = db.prepare(`SELECT * FROM bond_invt_head WHERE id=?`).get(req.params.id);
  if (!h) return fail(res, '核注清单不存在', 404);
  if (h.status !== 'DECLARED') return fail(res, '仅已申报可退单');
  db.prepare(`UPDATE bond_invt_head SET status='REJECTED', ret_msg=?, updated_at=datetime('now','localtime') WHERE id=?`).run((req.body && req.body.remark) || '海关退单', req.params.id);
  ok(res, { id: Number(req.params.id), status: 'REJECTED' });
});

router.delete('/:id', (req, res) => {
  const h = db.prepare(`SELECT * FROM bond_invt_head WHERE id=?`).get(req.params.id);
  if (!h) return fail(res, '核注清单不存在', 404);
  if (!['DRAFT', 'REJECTED'].includes(h.status)) return fail(res, `状态 ${STATUS_LABEL[h.status]} 不可删除`);
  db.prepare(`DELETE FROM bond_invt_item WHERE head_id=?`).run(req.params.id);
  db.prepare(`DELETE FROM bond_invt_head WHERE id=?`).run(req.params.id);
  ok(res, { id: Number(req.params.id) });
});

module.exports = router;

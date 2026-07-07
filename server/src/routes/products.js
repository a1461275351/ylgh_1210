// T06 商品备案资料库:CRUD + 备案流程(录入→初审→复审)+ 正面清单/税率校验 + 账册料号绑定
const router = require('express').Router();
const db = require('../db');
const { ok, fail, page, opLog } = require('../util');

const STATUS_LABEL = {
  DRAFT: '草稿', AUDIT1: '待初审', AUDIT2: '待复审', APPROVED: '备案通过', REJECTED: '驳回',
};
// 允许编辑/删除的状态
const EDITABLE = ['DRAFT', 'REJECTED'];

function withExtra(r) {
  const hs = db.prepare(`SELECT * FROM goods_hs_tax WHERE hs_code = ?`).get(r.hs_code);
  return {
    ...r,
    status_label: STATUS_LABEL[r.status] || r.status,
    in_positive_list: hs ? !!hs.in_positive_list : false,
    vat_rate: hs ? hs.vat_rate : null,
    consump_rate: hs ? hs.consump_rate : null,
  };
}

// 列表
router.get('/', (req, res) => {
  const { offset, pageSize, page: p } = page(req);
  const where = [], args = [];
  if (req.query.sku)        { where.push(`sku LIKE ?`);          args.push(`%${req.query.sku}%`); }
  if (req.query.name)       { where.push(`product_name LIKE ?`); args.push(`%${req.query.name}%`); }
  if (req.query.hs)         { where.push(`hs_code LIKE ?`);      args.push(`%${req.query.hs}%`); }
  if (req.query.status)     { where.push(`status = ?`);         args.push(req.query.status); }
  if (req.query.customerId) { where.push(`customer_id = ?`);    args.push(req.query.customerId); }
  const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { c: total } = db.prepare(`SELECT COUNT(*) AS c FROM goods_product ${cond}`).get(...args);
  const list = db.prepare(`SELECT * FROM goods_product ${cond} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...args, pageSize, offset).map(withExtra);
  ok(res, { list, total, page: p, pageSize });
});

// 详情 + 账册绑定
router.get('/:id', (req, res) => {
  const r = db.prepare(`SELECT * FROM goods_product WHERE id = ?`).get(req.params.id);
  if (!r) return fail(res, '商品不存在', 404);
  const rels = db.prepare(`SELECT * FROM goods_ems_rel WHERE product_id = ?`).all(req.params.id);
  ok(res, { ...withExtra(r), ems_rels: rels });
});

// 校验:必填 + HS 必须存在于税率库
function validateBody(b) {
  if (!b.customer_id) return '货主(客户)必选';
  if (!b.sku) return '商品货号SKU必填';
  if (!b.product_name) return '申报品名必填';
  if (!b.hs_code) return 'HS编码必填';
  const hs = db.prepare(`SELECT * FROM goods_hs_tax WHERE hs_code = ?`).get(b.hs_code);
  if (!hs) return `HS编码 ${b.hs_code} 不在税率库,请先在 HS税率库 维护`;
  return null;
}

// 新增(草稿)
router.post('/', (req, res) => {
  const b = req.body;
  const err = validateBody(b);
  if (err) return fail(res, err);
  const dup = db.prepare(`SELECT id FROM goods_product WHERE customer_id = ? AND sku = ?`).get(b.customer_id, b.sku);
  if (dup) return fail(res, `该货主下 SKU ${b.sku} 已存在`);
  const r = db.prepare(`INSERT INTO goods_product
      (customer_id, sku, product_name, hs_code, declare_elements, spec_model, brand, barcode,
       origin_country, unit_declare, unit_legal, net_weight, gross_weight, declare_price, currency,
       status, version, created_by, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'DRAFT', 1, ?, datetime('now','localtime'), datetime('now','localtime'))`)
    .run(b.customer_id, b.sku, b.product_name, b.hs_code, b.declare_elements || null, b.spec_model || null,
         b.brand || null, b.barcode || null, b.origin_country || null, b.unit_declare || null,
         b.unit_legal || null, b.net_weight ?? null, b.gross_weight ?? null, b.declare_price ?? null,
         b.currency || '142', req.user || 'admin');
  opLog(req, 'CREATE', 'PRODUCT', Number(r.lastInsertRowid), { sku: b.sku });
  ok(res, { id: Number(r.lastInsertRowid) });
});

// 编辑(仅草稿/驳回)
router.put('/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM goods_product WHERE id = ?`).get(req.params.id);
  if (!row) return fail(res, '商品不存在', 404);
  if (!EDITABLE.includes(row.status)) return fail(res, `状态 ${STATUS_LABEL[row.status]} 不可编辑`);
  const b = req.body;
  const err = validateBody({ ...row, ...b });
  if (err) return fail(res, err);
  db.prepare(`UPDATE goods_product SET
      product_name=?, hs_code=?, declare_elements=?, spec_model=?, brand=?, barcode=?,
      origin_country=?, unit_declare=?, unit_legal=?, net_weight=?, gross_weight=?, declare_price=?, currency=?,
      updated_at=datetime('now','localtime') WHERE id=?`)
    .run(b.product_name ?? row.product_name, b.hs_code ?? row.hs_code, b.declare_elements ?? row.declare_elements,
         b.spec_model ?? row.spec_model, b.brand ?? row.brand, b.barcode ?? row.barcode,
         b.origin_country ?? row.origin_country, b.unit_declare ?? row.unit_declare, b.unit_legal ?? row.unit_legal,
         b.net_weight ?? row.net_weight, b.gross_weight ?? row.gross_weight, b.declare_price ?? row.declare_price,
         b.currency ?? row.currency, req.params.id);
  opLog(req, 'UPDATE', 'PRODUCT', req.params.id, { sku: row.sku });
  ok(res, { id: Number(req.params.id) });
});

// 备案流程流转
function flow(fromStates, toState) {
  return (req, res) => {
    const row = db.prepare(`SELECT * FROM goods_product WHERE id = ?`).get(req.params.id);
    if (!row) return fail(res, '商品不存在', 404);
    if (!fromStates.includes(row.status))
      return fail(res, `当前状态 ${STATUS_LABEL[row.status]} 不允许该操作`);
    const remark = (req.body && req.body.remark) || null;
    db.prepare(`UPDATE goods_product SET status=?, audit_remark=?, updated_at=datetime('now','localtime') WHERE id=?`)
      .run(toState, remark, req.params.id);
    opLog(req, 'AUDIT', 'PRODUCT', req.params.id, { from: row.status, to: toState });
    ok(res, { id: Number(req.params.id), status: toState });
  };
}
router.post('/:id/submit', flow(['DRAFT', 'REJECTED'], 'AUDIT1')); // 提交初审
router.post('/:id/audit1-pass', flow(['AUDIT1'], 'AUDIT2'));        // 初审通过
router.post('/:id/audit2-pass', flow(['AUDIT2'], 'APPROVED'));      // 复审通过→备案
router.post('/:id/reject', flow(['AUDIT1', 'AUDIT2'], 'REJECTED')); // 驳回

// 绑定账册料号
router.post('/:id/bind-ems', (req, res) => {
  const row = db.prepare(`SELECT * FROM goods_product WHERE id = ?`).get(req.params.id);
  if (!row) return fail(res, '商品不存在', 404);
  const { ems_no, item_no } = req.body;
  if (!ems_no || !item_no) return fail(res, '账册号与备案序号必填');
  const ems = db.prepare(`SELECT id FROM ems_header WHERE ems_no = ?`).get(ems_no);
  if (!ems) return fail(res, `账册 ${ems_no} 不存在`);
  const exist = db.prepare(`SELECT id FROM goods_ems_rel WHERE product_id = ? AND ems_no = ?`).get(req.params.id, ems_no);
  if (exist) {
    db.prepare(`UPDATE goods_ems_rel SET item_no=?, enabled=1 WHERE id=?`).run(item_no, exist.id);
  } else {
    db.prepare(`INSERT INTO goods_ems_rel (product_id, ems_no, item_no) VALUES (?,?,?)`).run(req.params.id, ems_no, item_no);
  }
  opLog(req, 'UPDATE', 'PRODUCT', req.params.id, { bindEms: ems_no, item_no });
  ok(res, { product_id: Number(req.params.id), ems_no, item_no });
});

// 删除(仅草稿/驳回)
router.delete('/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM goods_product WHERE id = ?`).get(req.params.id);
  if (!row) return fail(res, '商品不存在', 404);
  if (!EDITABLE.includes(row.status)) return fail(res, `状态 ${STATUS_LABEL[row.status]} 不可删除`);
  db.prepare(`DELETE FROM goods_ems_rel WHERE product_id = ?`).run(req.params.id);
  db.prepare(`DELETE FROM goods_product WHERE id = ?`).run(req.params.id);
  opLog(req, 'DELETE', 'PRODUCT', req.params.id, { sku: row.sku });
  ok(res, { id: Number(req.params.id) });
});

module.exports = router;

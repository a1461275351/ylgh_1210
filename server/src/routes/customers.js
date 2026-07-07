// T04 客户管理:档案 CRUD / 查询 / 分页
const router = require('express').Router();
const db = require('../db');
const { ok, fail, page, genNo, opLog } = require('../util');

const RECORD_TYPES = ['EBC', 'EBP', 'PAY', 'LOGISTICS', 'WAREHOUSE'];
const SETTLE_TYPES = ['MONTHLY', 'SINGLE', 'PREPAY'];

function validate(body, isUpdate = false) {
  if (!body.cust_name || !String(body.cust_name).trim()) return '企业名称不能为空';
  if (!RECORD_TYPES.includes(body.record_type)) return '备案类型无效';
  if (body.uscc && !/^[0-9A-Z]{18}$/.test(body.uscc)) return '统一社会信用代码须为18位数字/大写字母';
  if (body.customs_code && !/^[0-9A-Z]{10}$/.test(body.customs_code)) return '海关注册编码须为10位';
  if (body.settle_type && !SETTLE_TYPES.includes(body.settle_type)) return '结算方式无效';
  if (isUpdate && body.status && !['ENABLED', 'DISABLED'].includes(body.status)) return '状态无效';
  return null;
}

// 列表查询:GET /api/customers?custName=&uscc=&recordType=&status=&page=&pageSize=
router.get('/', (req, res) => {
  const { offset, pageSize, page: p } = page(req);
  const where = [];
  const args = [];
  if (req.query.custName) { where.push(`cust_name LIKE ?`); args.push(`%${req.query.custName}%`); }
  if (req.query.uscc)     { where.push(`uscc LIKE ?`);      args.push(`%${req.query.uscc}%`); }
  if (req.query.recordType) { where.push(`record_type = ?`); args.push(req.query.recordType); }
  if (req.query.status)     { where.push(`status = ?`);      args.push(req.query.status); }
  const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { c: total } = db.prepare(`SELECT COUNT(*) AS c FROM cust_customer ${cond}`).get(...args);
  const list = db.prepare(
    `SELECT * FROM cust_customer ${cond} ORDER BY is_self DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...args, pageSize, offset);
  ok(res, { list, total, page: p, pageSize });
});

// 详情
router.get('/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM cust_customer WHERE id = ?`).get(req.params.id);
  if (!row) return fail(res, '客户不存在', 404);
  ok(res, row);
});

// 新增
router.post('/', (req, res) => {
  const msg = validate(req.body);
  if (msg) return fail(res, msg);
  const dup = db.prepare(`SELECT id FROM cust_customer WHERE cust_name = ?`).get(req.body.cust_name.trim());
  if (dup) return fail(res, '同名客户已存在');
  const custCode = genNo('C');
  const r = db.prepare(`INSERT INTO cust_customer
      (cust_code, cust_name, uscc, customs_code, record_type, contact, contact_tel, settle_type, address, remark, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(custCode, req.body.cust_name.trim(), req.body.uscc || null, req.body.customs_code || null,
         req.body.record_type, req.body.contact || null, req.body.contact_tel || null,
         req.body.settle_type || null, req.body.address || null, req.body.remark || null,
         req.headers['x-user'] || 'admin');
  opLog(req, 'CREATE', 'CUSTOMER', r.lastInsertRowid, { cust_name: req.body.cust_name });
  ok(res, { id: Number(r.lastInsertRowid), cust_code: custCode });
});

// 修改
router.put('/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM cust_customer WHERE id = ?`).get(req.params.id);
  if (!row) return fail(res, '客户不存在', 404);
  const msg = validate(req.body, true);
  if (msg) return fail(res, msg);
  const dup = db.prepare(`SELECT id FROM cust_customer WHERE cust_name = ? AND id <> ?`)
    .get(req.body.cust_name.trim(), req.params.id);
  if (dup) return fail(res, '同名客户已存在');
  db.prepare(`UPDATE cust_customer SET
      cust_name = ?, uscc = ?, customs_code = ?, record_type = ?, contact = ?, contact_tel = ?,
      settle_type = ?, address = ?, status = ?, remark = ?, updated_at = datetime('now','localtime')
      WHERE id = ?`)
    .run(req.body.cust_name.trim(), req.body.uscc || null, req.body.customs_code || null,
         req.body.record_type, req.body.contact || null, req.body.contact_tel || null,
         req.body.settle_type || null, req.body.address || null, req.body.status || row.status,
         req.body.remark || null, req.params.id);
  opLog(req, 'UPDATE', 'CUSTOMER', req.params.id, { cust_name: req.body.cust_name });
  ok(res, { id: Number(req.params.id) });
});

// 删除(自营主体保护)
router.delete('/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM cust_customer WHERE id = ?`).get(req.params.id);
  if (!row) return fail(res, '客户不存在', 404);
  if (row.is_self) return fail(res, '自营主体不允许删除');
  db.prepare(`DELETE FROM cust_customer WHERE id = ?`).run(req.params.id);
  opLog(req, 'DELETE', 'CUSTOMER', req.params.id, { cust_name: row.cust_name });
  ok(res, { id: Number(req.params.id) });
});

module.exports = router;

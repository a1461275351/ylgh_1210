// T05 合同管理:服务合同维护 / 查询 / 到期提醒
const router = require('express').Router();
const db = require('../db');
const { ok, fail, page, genNo, opLog } = require('../util');

const STATUSES = ['DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED'];
const SCOPES = ['WAREHOUSE', 'CLEARANCE', 'DELIVERY'];

function validate(body) {
  if (!body.contract_name || !String(body.contract_name).trim()) return '合同名称不能为空';
  if (!body.customer_id) return '请选择客户';
  const cust = db.prepare(`SELECT id FROM cust_customer WHERE id = ?`).get(body.customer_id);
  if (!cust) return '客户不存在';
  if (body.status && !STATUSES.includes(body.status)) return '合同状态无效';
  if (body.service_scope) {
    const bad = String(body.service_scope).split(',').filter(s => s && !SCOPES.includes(s));
    if (bad.length) return `服务范围无效:${bad.join(',')}`;
  }
  if (body.amount !== undefined && body.amount !== null && body.amount !== '' && !(Number(body.amount) >= 0)) return '合同金额无效';
  if (body.valid_from && body.valid_to && body.valid_from > body.valid_to) return '有效期起始不能晚于结束';
  return null;
}

// 到期状态:结合参数 EMS_EXPIRE_WARN_DAYS 同源的提醒逻辑,合同用固定 30 天提前量
function expireFlag(row) {
  if (!row.valid_to || row.status !== 'ACTIVE') return 'NONE';
  const today = new Date().toISOString().slice(0, 10);
  if (row.valid_to < today) return 'EXPIRED';
  const warn = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  return row.valid_to <= warn ? 'EXPIRING' : 'NONE';
}

// 列表:GET /api/contracts?contractNo=&contractName=&customerId=&status=&expiring=1
router.get('/', (req, res) => {
  const { offset, pageSize, page: p } = page(req);
  const where = [];
  const args = [];
  if (req.query.contractNo)   { where.push(`c.contract_no LIKE ?`);   args.push(`%${req.query.contractNo}%`); }
  if (req.query.contractName) { where.push(`c.contract_name LIKE ?`); args.push(`%${req.query.contractName}%`); }
  if (req.query.customerId)   { where.push(`c.customer_id = ?`);      args.push(req.query.customerId); }
  if (req.query.status)       { where.push(`c.status = ?`);           args.push(req.query.status); }
  const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { c: total } = db.prepare(`SELECT COUNT(*) AS c FROM cust_contract c ${cond}`).get(...args);
  let list = db.prepare(
    `SELECT c.*, cu.cust_name FROM cust_contract c
     LEFT JOIN cust_customer cu ON cu.id = c.customer_id
     ${cond} ORDER BY c.id DESC LIMIT ? OFFSET ?`)
    .all(...args, pageSize, offset)
    .map(r => ({ ...r, expire_flag: expireFlag(r) }));
  if (req.query.expiring === '1') list = list.filter(r => r.expire_flag !== 'NONE');
  ok(res, { list, total, page: p, pageSize });
});

router.get('/:id', (req, res) => {
  const row = db.prepare(
    `SELECT c.*, cu.cust_name FROM cust_contract c
     LEFT JOIN cust_customer cu ON cu.id = c.customer_id WHERE c.id = ?`).get(req.params.id);
  if (!row) return fail(res, '合同不存在', 404);
  ok(res, { ...row, expire_flag: expireFlag(row) });
});

router.post('/', (req, res) => {
  const msg = validate(req.body);
  if (msg) return fail(res, msg);
  const contractNo = genNo('HT');
  const r = db.prepare(`INSERT INTO cust_contract
      (contract_no, customer_id, contract_name, service_scope, amount, currency,
       sign_date, valid_from, valid_to, billing_rule, status, remark)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(contractNo, req.body.customer_id, req.body.contract_name.trim(),
         req.body.service_scope || null, req.body.amount ?? null, req.body.currency || '142',
         req.body.sign_date || null, req.body.valid_from || null, req.body.valid_to || null,
         req.body.billing_rule || null, req.body.status || 'ACTIVE', req.body.remark || null);
  opLog(req, 'CREATE', 'CONTRACT', r.lastInsertRowid, { contract_no: contractNo });
  ok(res, { id: Number(r.lastInsertRowid), contract_no: contractNo });
});

router.put('/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM cust_contract WHERE id = ?`).get(req.params.id);
  if (!row) return fail(res, '合同不存在', 404);
  const msg = validate(req.body);
  if (msg) return fail(res, msg);
  db.prepare(`UPDATE cust_contract SET
      customer_id = ?, contract_name = ?, service_scope = ?, amount = ?, currency = ?,
      sign_date = ?, valid_from = ?, valid_to = ?, billing_rule = ?, status = ?, remark = ?,
      updated_at = datetime('now','localtime') WHERE id = ?`)
    .run(req.body.customer_id, req.body.contract_name.trim(), req.body.service_scope || null,
         req.body.amount ?? null, req.body.currency || '142', req.body.sign_date || null,
         req.body.valid_from || null, req.body.valid_to || null, req.body.billing_rule || null,
         req.body.status || row.status, req.body.remark || null, req.params.id);
  opLog(req, 'UPDATE', 'CONTRACT', req.params.id, { contract_no: row.contract_no });
  ok(res, { id: Number(req.params.id) });
});

router.delete('/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM cust_contract WHERE id = ?`).get(req.params.id);
  if (!row) return fail(res, '合同不存在', 404);
  if (row.status === 'ACTIVE') return fail(res, '生效中的合同不允许删除,请先终止');
  db.prepare(`DELETE FROM cust_contract WHERE id = ?`).run(req.params.id);
  opLog(req, 'DELETE', 'CONTRACT', req.params.id, { contract_no: row.contract_no });
  ok(res, { id: Number(req.params.id) });
});

module.exports = router;

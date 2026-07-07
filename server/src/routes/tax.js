// T13 税费与担保额度台账
const router = require('express').Router();
const db = require('../db');
const { ok, fail, page, opLog } = require('../util');
const finance = require('../ceb/finance');

const BILL_LABEL = { PENDING: '待缴', PAID: '已汇缴', REVERSED: '已冲减' };

// 税单列表
router.get('/bills', (req, res) => {
  const { offset, pageSize, page: p } = page(req);
  const where = [], args = [];
  if (req.query.orderNo) { where.push(`order_no LIKE ?`); args.push(`%${req.query.orderNo}%`); }
  if (req.query.status)  { where.push(`status=?`);       args.push(req.query.status); }
  const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { c: total } = db.prepare(`SELECT COUNT(*) AS c FROM tax_bill ${cond}`).get(...args);
  const list = db.prepare(`SELECT * FROM tax_bill ${cond} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...args, pageSize, offset).map(r => ({ ...r, status_label: BILL_LABEL[r.status] || r.status }));
  // 汇总
  const sum = db.prepare(`SELECT
      COALESCE(SUM(total_tax),0) total,
      COALESCE(SUM(CASE WHEN status='PENDING' THEN total_tax ELSE 0 END),0) pending,
      COALESCE(SUM(CASE WHEN status='PAID' THEN total_tax ELSE 0 END),0) paid
      FROM tax_bill`).get();
  ok(res, { list, total, page: p, pageSize, sum });
});

// 月度汇缴(批量缴税+释放额度)
router.post('/bills/pay', (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  if (!ids.length) return fail(res, '请选择待缴税单');
  const results = finance.payBills(ids);
  opLog(req, 'PAY', 'TAX', '', { count: ids.length });
  ok(res, { total: ids.length, paid: results.filter(r => r.ok).length });
});

// 担保额度台账
router.get('/guarantee', (req, res) => {
  const s = finance.summary();
  const ledger = db.prepare(`SELECT * FROM guarantee_ledger ORDER BY id DESC LIMIT 100`).all();
  const usedRatio = s.account ? +(Number(s.account.used_amount) / Number(s.account.total_amount) * 100).toFixed(1) : 0;
  ok(res, { ...s, usedRatio, ledger });
});

module.exports = router;

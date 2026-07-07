// T06 HS 税率库与正面清单维护
const router = require('express').Router();
const db = require('../db');
const { ok, fail, page, opLog } = require('../util');

router.get('/', (req, res) => {
  const { offset, pageSize, page: p } = page(req);
  const where = [], args = [];
  if (req.query.hs)   { where.push(`hs_code LIKE ?`); args.push(`%${req.query.hs}%`); }
  if (req.query.name) { where.push(`hs_name LIKE ?`); args.push(`%${req.query.name}%`); }
  if (req.query.inList === '1') where.push(`in_positive_list = 1`);
  if (req.query.inList === '0') where.push(`in_positive_list = 0`);
  const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { c: total } = db.prepare(`SELECT COUNT(*) AS c FROM goods_hs_tax ${cond}`).get(...args);
  const list = db.prepare(`SELECT * FROM goods_hs_tax ${cond} ORDER BY hs_code LIMIT ? OFFSET ?`).all(...args, pageSize, offset);
  ok(res, { list, total, page: p, pageSize });
});

router.post('/', (req, res) => {
  const b = req.body;
  if (!b.hs_code) return fail(res, 'HS编码必填');
  const dup = db.prepare(`SELECT id FROM goods_hs_tax WHERE hs_code = ?`).get(b.hs_code);
  if (dup) return fail(res, `HS ${b.hs_code} 已存在`);
  const r = db.prepare(`INSERT INTO goods_hs_tax (hs_code, hs_name, vat_rate, consump_rate, in_positive_list) VALUES (?,?,?,?,?)`)
    .run(b.hs_code, b.hs_name || null, b.vat_rate ?? 0.13, b.consump_rate ?? 0, b.in_positive_list ? 1 : 0);
  opLog(req, 'CREATE', 'HSTAX', Number(r.lastInsertRowid), { hs_code: b.hs_code });
  ok(res, { id: Number(r.lastInsertRowid) });
});

router.put('/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM goods_hs_tax WHERE id = ?`).get(req.params.id);
  if (!row) return fail(res, '记录不存在', 404);
  const b = req.body;
  db.prepare(`UPDATE goods_hs_tax SET hs_name=?, vat_rate=?, consump_rate=?, in_positive_list=? WHERE id=?`)
    .run(b.hs_name ?? row.hs_name, b.vat_rate ?? row.vat_rate, b.consump_rate ?? row.consump_rate,
         b.in_positive_list !== undefined ? (b.in_positive_list ? 1 : 0) : row.in_positive_list, req.params.id);
  opLog(req, 'UPDATE', 'HSTAX', req.params.id, { hs_code: row.hs_code });
  ok(res, { id: Number(req.params.id) });
});

router.delete('/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM goods_hs_tax WHERE id = ?`).get(req.params.id);
  if (!row) return fail(res, '记录不存在', 404);
  const used = db.prepare(`SELECT COUNT(*) AS c FROM goods_product WHERE hs_code = ?`).get(row.hs_code);
  if (used.c > 0) return fail(res, `已有 ${used.c} 个商品使用该HS,不能删除`);
  db.prepare(`DELETE FROM goods_hs_tax WHERE id = ?`).run(req.params.id);
  opLog(req, 'DELETE', 'HSTAX', req.params.id, { hs_code: row.hs_code });
  ok(res, { id: Number(req.params.id) });
});

module.exports = router;

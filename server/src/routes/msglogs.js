// T19 报文日志:收发留痕查询 / 查看原文 / 失败重发
const router = require('express').Router();
const db = require('../db');
const { ok, fail, page, opLog } = require('../util');
const engine = require('../ceb/engine');

// 列表:GET /api/msglogs?msgType=&bizNo=&direction=&status=
router.get('/', (req, res) => {
  const { offset, pageSize, page: p } = page(req);
  const where = [];
  const args = [];
  if (req.query.msgType)   { where.push(`msg_type = ?`);  args.push(req.query.msgType); }
  if (req.query.bizNo)     { where.push(`biz_no LIKE ?`);  args.push(`%${req.query.bizNo}%`); }
  if (req.query.direction) { where.push(`direction = ?`);  args.push(req.query.direction); }
  if (req.query.status)    { where.push(`status = ?`);     args.push(req.query.status); }
  const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { c: total } = db.prepare(`SELECT COUNT(*) AS c FROM msg_log ${cond}`).get(...args);
  const list = db.prepare(
    `SELECT id, direction, channel, msg_type, biz_no, msg_id, status, retry_count, error_msg, created_at, updated_at
     FROM msg_log ${cond} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, pageSize, offset);
  ok(res, { list, total, page: p, pageSize });
});

// 查看报文原文
router.get('/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM msg_log WHERE id = ?`).get(req.params.id);
  if (!row) return fail(res, '报文不存在', 404);
  ok(res, row);
});

// 失败重发:仅对 SEND + FAIL 的清单报文,重新走引擎申报
router.post('/:id/resend', (req, res) => {
  const row = db.prepare(`SELECT * FROM msg_log WHERE id = ?`).get(req.params.id);
  if (!row) return fail(res, '报文不存在', 404);
  if (row.direction !== 'SEND') return fail(res, '仅发送报文可重发');
  if (row.status !== 'FAIL') return fail(res, '仅失败报文可重发');
  db.prepare(`UPDATE msg_log SET retry_count = retry_count + 1, updated_at=datetime('now','localtime') WHERE id=?`)
    .run(req.params.id);
  opLog(req, 'RESEND', 'MSG', req.params.id, { biz_no: row.biz_no });
  try {
    if (row.msg_type === 'CEB621') {
      const inv = db.prepare(`SELECT id FROM ceb_inventory WHERE order_no = ?`).get(row.biz_no);
      if (!inv) return fail(res, '关联清单不存在,无法重发');
      const r = engine.declareInventory(inv.id, req);
      return ok(res, { resent: true, ...r });
    }
    return fail(res, `报文类型 ${row.msg_type} 暂不支持自动重发`);
  } catch (e) {
    return fail(res, '重发失败:' + e.message);
  }
});

module.exports = router;

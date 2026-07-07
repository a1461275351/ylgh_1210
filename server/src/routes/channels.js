// T19 申报通道配置:查看 / 启停 / 设默认 / 改 endpoint 与加签配置
const router = require('express').Router();
const db = require('../db');
const { ok, fail, opLog } = require('../util');

router.get('/', (_req, res) => {
  ok(res, db.prepare(`SELECT * FROM channel_config ORDER BY is_default DESC, id ASC`).all());
});

// 更新:endpoint / remark / sign_config / enabled
router.put('/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM channel_config WHERE id = ?`).get(req.params.id);
  if (!row) return fail(res, '通道不存在', 404);
  db.prepare(`UPDATE channel_config SET endpoint=?, remark=?, sign_config=?, enabled=? WHERE id=?`)
    .run(req.body.endpoint ?? row.endpoint, req.body.remark ?? row.remark,
         req.body.sign_config ?? row.sign_config,
         req.body.enabled !== undefined ? (req.body.enabled ? 1 : 0) : row.enabled, req.params.id);
  opLog(req, 'UPDATE', 'CHANNEL', req.params.id, { channel_code: row.channel_code });
  ok(res, { id: Number(req.params.id) });
});

// 设为默认通道(互斥)
router.post('/:id/default', (req, res) => {
  const row = db.prepare(`SELECT * FROM channel_config WHERE id = ?`).get(req.params.id);
  if (!row) return fail(res, '通道不存在', 404);
  if (!row.enabled) return fail(res, '已停用的通道不能设为默认');
  db.prepare(`UPDATE channel_config SET is_default = 0`).run();
  db.prepare(`UPDATE channel_config SET is_default = 1 WHERE id = ?`).run(req.params.id);
  opLog(req, 'UPDATE', 'CHANNEL', req.params.id, { setDefault: row.channel_code });
  ok(res, { id: Number(req.params.id) });
});

module.exports = router;

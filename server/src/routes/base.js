// 基础数据:代码表 / 政策参数(前端下拉与配置使用)
const router = require('express').Router();
const db = require('../db');
const { ok } = require('../util');

// GET /api/base/codes?type=CURRENCY
router.get('/codes', (req, res) => {
  const rows = req.query.type
    ? db.prepare(`SELECT code_type, code, name FROM base_code WHERE code_type = ? AND enabled = 1 ORDER BY code`).all(req.query.type)
    : db.prepare(`SELECT code_type, code, name FROM base_code WHERE enabled = 1 ORDER BY code_type, code`).all();
  ok(res, rows);
});

// GET /api/base/params
router.get('/params', (_req, res) => {
  ok(res, db.prepare(`SELECT param_key, param_value, param_desc, updated_at FROM sys_param ORDER BY id`).all());
});

module.exports = router;

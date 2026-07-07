// 公共工具:响应封装 / 分页 / 单号生成 / 操作日志
const db = require('./db');

function ok(res, data) { res.json({ code: 0, message: 'ok', data }); }
function fail(res, message, code = 400) { res.status(200).json({ code, message }); }

// 解析分页参数
function page(req) {
  const p = Math.max(1, parseInt(req.query.page) || 1);
  const ps = Math.min(200, Math.max(1, parseInt(req.query.pageSize) || 10));
  return { page: p, pageSize: ps, offset: (p - 1) * ps };
}

// 单号:{前缀}{yyyyMMdd}{6位流水},如 INV20260706000001
function genNo(prefix) {
  const d = new Date();
  const ymd = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  const key = `${prefix}${ymd}`;
  db.prepare(`INSERT INTO sys_seq (seq_key, seq_val) VALUES (?, 1)
              ON CONFLICT(seq_key) DO UPDATE SET seq_val = seq_val + 1`).run(key);
  const { seq_val } = db.prepare(`SELECT seq_val FROM sys_seq WHERE seq_key = ?`).get(key);
  return `${key}${String(seq_val).padStart(6, '0')}`;
}

// 操作日志(审计留痕)
function opLog(req, action, bizType, bizId, detail) {
  db.prepare(`INSERT INTO sys_op_log (username, action, biz_type, biz_id, detail, ip)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(req.headers['x-user'] || 'admin', action, bizType, String(bizId ?? ''),
         detail ? JSON.stringify(detail) : null, req.ip || '');
}

// 读取政策参数
function param(key, dft) {
  const row = db.prepare(`SELECT param_value FROM sys_param WHERE param_key = ?`).get(key);
  return row ? row.param_value : dft;
}

module.exports = { ok, fail, page, genNo, opLog, param };

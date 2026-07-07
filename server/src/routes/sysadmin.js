// T18 系统管理:用户 / 角色 / 参数配置 / 代码表
const router = require('express').Router();
const db = require('../db');
const { ok, fail, page, opLog } = require('../util');
const auth = require('../auth');

// ---- 角色 ----
router.get('/roles', (_req, res) => ok(res, db.prepare(`SELECT * FROM sys_role ORDER BY id`).all()));

// ---- 用户 ----
function withRoles(u) {
  const roles = db.prepare(`SELECT r.id, r.role_code, r.role_name FROM sys_role r JOIN sys_user_role ur ON ur.role_id=r.id WHERE ur.user_id=?`).all(u.id);
  return { id: u.id, username: u.username, real_name: u.real_name, mobile: u.mobile, email: u.email, status: u.status, created_at: u.created_at, roles };
}

router.get('/users', (req, res) => {
  const { offset, pageSize, page: p } = page(req);
  const where = [], args = [];
  if (req.query.kw) { where.push(`(username LIKE ? OR real_name LIKE ?)`); args.push(`%${req.query.kw}%`, `%${req.query.kw}%`); }
  const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { c: total } = db.prepare(`SELECT COUNT(*) c FROM sys_user ${cond}`).get(...args);
  const list = db.prepare(`SELECT * FROM sys_user ${cond} ORDER BY id LIMIT ? OFFSET ?`).all(...args, pageSize, offset).map(withRoles);
  ok(res, { list, total, page: p, pageSize });
});

router.post('/users', (req, res) => {
  const b = req.body;
  if (!b.username || !b.real_name) return fail(res, '用户名与姓名必填');
  if (db.prepare(`SELECT id FROM sys_user WHERE username=?`).get(b.username)) return fail(res, '用户名已存在');
  const r = db.prepare(`INSERT INTO sys_user (username, password_hash, real_name, mobile, email, status) VALUES (?,?,?,?,?, 'ENABLED')`)
    .run(b.username, auth.hashPassword(b.password || '123456'), b.real_name, b.mobile || null, b.email || null);
  const uid = Number(r.lastInsertRowid);
  for (const rid of (b.roleIds || [])) db.prepare(`INSERT OR IGNORE INTO sys_user_role (user_id, role_id) VALUES (?,?)`).run(uid, rid);
  opLog(req, 'CREATE', 'USER', uid, { username: b.username });
  ok(res, { id: uid });
});

router.put('/users/:id', (req, res) => {
  const u = db.prepare(`SELECT * FROM sys_user WHERE id=?`).get(req.params.id);
  if (!u) return fail(res, '用户不存在', 404);
  const b = req.body;
  db.prepare(`UPDATE sys_user SET real_name=?, mobile=?, email=?, status=?, updated_at=datetime('now','localtime') WHERE id=?`)
    .run(b.real_name ?? u.real_name, b.mobile ?? u.mobile, b.email ?? u.email, b.status ?? u.status, req.params.id);
  if (Array.isArray(b.roleIds)) {
    db.prepare(`DELETE FROM sys_user_role WHERE user_id=?`).run(req.params.id);
    for (const rid of b.roleIds) db.prepare(`INSERT OR IGNORE INTO sys_user_role (user_id, role_id) VALUES (?,?)`).run(req.params.id, rid);
  }
  opLog(req, 'UPDATE', 'USER', req.params.id, {});
  ok(res, { id: Number(req.params.id) });
});

router.post('/users/:id/reset-pwd', (req, res) => {
  const u = db.prepare(`SELECT * FROM sys_user WHERE id=?`).get(req.params.id);
  if (!u) return fail(res, '用户不存在', 404);
  const pwd = (req.body && req.body.password) || '123456';
  db.prepare(`UPDATE sys_user SET password_hash=?, updated_at=datetime('now','localtime') WHERE id=?`).run(auth.hashPassword(pwd), req.params.id);
  opLog(req, 'RESET_PWD', 'USER', req.params.id, {});
  ok(res, { id: Number(req.params.id) });
});

router.delete('/users/:id', (req, res) => {
  const u = db.prepare(`SELECT * FROM sys_user WHERE id=?`).get(req.params.id);
  if (!u) return fail(res, '用户不存在', 404);
  if (u.username === 'admin') return fail(res, '内置管理员不可删除');
  db.prepare(`DELETE FROM sys_user_role WHERE user_id=?`).run(req.params.id);
  db.prepare(`DELETE FROM sys_user WHERE id=?`).run(req.params.id);
  opLog(req, 'DELETE', 'USER', req.params.id, { username: u.username });
  ok(res, { id: Number(req.params.id) });
});

// ---- 政策参数 ----
router.get('/params', (_req, res) => ok(res, db.prepare(`SELECT * FROM sys_param ORDER BY id`).all()));
router.put('/params/:key', (req, res) => {
  const row = db.prepare(`SELECT * FROM sys_param WHERE param_key=?`).get(req.params.key);
  if (!row) return fail(res, '参数不存在', 404);
  db.prepare(`UPDATE sys_param SET param_value=?, updated_by=?, updated_at=datetime('now','localtime') WHERE param_key=?`)
    .run(String(req.body.param_value), req.user || 'admin', req.params.key);
  opLog(req, 'UPDATE', 'PARAM', req.params.key, { value: req.body.param_value });
  ok(res, { key: req.params.key });
});

// ---- 代码表 ----
router.get('/codes', (req, res) => {
  const where = [], args = [];
  if (req.query.type) { where.push(`code_type=?`); args.push(req.query.type); }
  const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
  ok(res, db.prepare(`SELECT * FROM base_code ${cond} ORDER BY code_type, code`).all(...args));
});
router.post('/codes', (req, res) => {
  const b = req.body;
  if (!b.code_type || !b.code || !b.name) return fail(res, '类型/代码/名称必填');
  if (db.prepare(`SELECT id FROM base_code WHERE code_type=? AND code=?`).get(b.code_type, b.code)) return fail(res, '该类型下代码已存在');
  const r = db.prepare(`INSERT INTO base_code (code_type, code, name, enabled) VALUES (?,?,?,1)`).run(b.code_type, b.code, b.name);
  ok(res, { id: Number(r.lastInsertRowid) });
});
router.delete('/codes/:id', (req, res) => {
  db.prepare(`DELETE FROM base_code WHERE id=?`).run(req.params.id);
  ok(res, { id: Number(req.params.id) });
});

// ---- 操作日志 ----
router.get('/oplog', (req, res) => {
  const { offset, pageSize, page: p } = page(req);
  const { c: total } = db.prepare(`SELECT COUNT(*) c FROM sys_op_log`).get();
  const list = db.prepare(`SELECT * FROM sys_op_log ORDER BY id DESC LIMIT ? OFFSET ?`).all(pageSize, offset);
  ok(res, { list, total, page: p, pageSize });
});

module.exports = router;

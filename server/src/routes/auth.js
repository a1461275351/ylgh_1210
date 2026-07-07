// T18 登录认证:登录 / 当前用户
const router = require('express').Router();
const db = require('../db');
const { ok, fail, opLog } = require('../util');
const auth = require('../auth');

function userRoles(userId) {
  return db.prepare(`SELECT r.role_code, r.role_name FROM sys_role r
      JOIN sys_user_role ur ON ur.role_id=r.id WHERE ur.user_id=?`).all(userId);
}

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return fail(res, '请输入用户名和密码');
  const u = db.prepare(`SELECT * FROM sys_user WHERE username=?`).get(username);
  if (!u || !auth.verifyPassword(password, u.password_hash)) return fail(res, '用户名或密码错误', 401);
  if (u.status !== 'ENABLED') return fail(res, '账号已停用', 403);
  const roles = userRoles(u.id);
  const token = auth.sign({ uid: u.id, username: u.username });
  opLog({ headers: { 'x-user': username }, ip: req.ip }, 'LOGIN', 'AUTH', u.id, {});
  ok(res, { token, user: { id: u.id, username: u.username, real_name: u.real_name, roles } });
});

router.get('/me', (req, res) => {
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : (req.headers['x-token'] || '');
  const p = auth.verifyToken(token);
  if (!p) return fail(res, '未登录', 401);
  const u = db.prepare(`SELECT id, username, real_name FROM sys_user WHERE id=?`).get(p.uid);
  if (!u) return fail(res, '用户不存在', 401);
  ok(res, { ...u, roles: userRoles(u.id) });
});

module.exports = router;

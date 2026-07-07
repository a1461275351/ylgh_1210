// T18 认证工具:口令散列(scrypt)+ 轻量签名令牌(HMAC),零外部依赖
// 说明:原型鉴权。生产建议换标准 JWT + 更强密钥管理。
const crypto = require('crypto');
const SECRET = process.env.AUTH_SECRET || 'ccs1210-dev-secret';
const TOKEN_TTL = 8 * 3600 * 1000; // 8 小时

function hashPassword(pw) {
  const salt = crypto.randomBytes(8).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 32).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(pw, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const calc = crypto.scryptSync(String(pw), salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash));
}
function b64u(s) { return Buffer.from(s).toString('base64url'); }
function sign(payload) {
  const body = b64u(JSON.stringify({ ...payload, exp: Date.now() + TOKEN_TTL }));
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expect = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig !== expect) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!p.exp || p.exp < Date.now()) return null;
    return p;
  } catch { return null; }
}

// 解析令牌并挂到 req.user(软鉴权:不阻断,供审计/展示用)
function attachUser(req, _res, next) {
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : (req.headers['x-token'] || '');
  const p = verifyToken(token);
  if (p) req.user = p.username;
  next();
}

// 强鉴权中间件(仅当 AUTH_ENFORCE=1 时启用;默认关闭以兼容原型/测试)
function requireAuth(req, res, next) {
  if (process.env.AUTH_ENFORCE !== '1') return next();
  if (req.path === '/api/auth/login' || req.path === '/api/health') return next();
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : (req.headers['x-token'] || '');
  if (!verifyToken(token)) return res.status(200).json({ code: 401, message: '未登录或登录已过期' });
  next();
}

module.exports = { hashPassword, verifyPassword, sign, verifyToken, attachUser, requireAuth };

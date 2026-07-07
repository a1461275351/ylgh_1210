// 1210 保税跨境电商关务管理系统 - 服务入口
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));
const auth = require('./auth');
app.use(auth.attachUser);   // 软鉴权:解析令牌挂 req.user(审计用)
app.use(auth.requireAuth);  // 强鉴权:仅 AUTH_ENFORCE=1 时生效

// 前端静态库(本地依赖,免 CDN)
const nm = path.join(__dirname, '..', 'node_modules');
const libs = {
  '/libs/vue.js': 'vue/dist/vue.global.prod.js',
  '/libs/element-plus.js': 'element-plus/dist/index.full.min.js',
  '/libs/element-plus.css': 'element-plus/dist/index.css',
  '/libs/element-locale.js': 'element-plus/dist/locale/zh-cn.min.js',
  '/libs/element-icons.js': '@element-plus/icons-vue/dist/index.iife.min.js',
};
for (const [url, file] of Object.entries(libs)) {
  app.get(url, (_req, res) => res.sendFile(path.join(nm, file)));
}

// 健康检查(部署/测试脚本用于判断服务就绪 + 关键数据概览)
app.get('/api/health', (_req, res) => {
  try {
    const db = require('./db');
    const one = (sql) => { try { return db.prepare(sql).get().c; } catch { return 0; } };
    res.json({
      code: 0, message: 'ok',
      data: {
        service: 'ccs1210', version: '1.0', time: new Date().toISOString(),
        db: 'sqlite',
        counts: {
          customers: one('SELECT COUNT(*) c FROM cust_customer'),
          products: one('SELECT COUNT(*) c FROM goods_product'),
          ems: one('SELECT COUNT(*) c FROM ems_header'),
          orders: one('SELECT COUNT(*) c FROM ceb_order'),
          inventories: one('SELECT COUNT(*) c FROM ceb_inventory'),
          bondInvt: one('SELECT COUNT(*) c FROM bond_invt_head'),
          taxBills: one('SELECT COUNT(*) c FROM tax_bill'),
        },
      },
    });
  } catch (e) {
    res.status(200).json({ code: 500, message: e.message });
  }
});

// 前端页面
app.use(express.static(path.join(__dirname, '..', '..', 'web')));

// 业务路由(按功能任务递增挂载)
app.use('/api/customers', require('./routes/customers'));
app.use('/api/contracts', require('./routes/contracts'));
app.use('/api/products', require('./routes/products'));
app.use('/api/ems', require('./routes/ems'));
app.use('/api/decl', require('./routes/decl'));
app.use('/api/bond-invt', require('./routes/bondInvt'));
app.use('/api/passport', require('./routes/passport'));
app.use('/api/tax', require('./routes/tax'));
app.use('/api/refund', require('./routes/refund'));
app.use('/api/wms', require('./routes/wms'));
app.use('/api/verify', require('./routes/verify'));
app.use('/api/stat', require('./routes/stat'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/sys', require('./routes/sysadmin'));
app.use('/api/hstax', require('./routes/hstax'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/channels', require('./routes/channels'));
app.use('/api/msglogs', require('./routes/msglogs'));
app.use('/api/inventories', require('./routes/inventories'));
app.use('/api/base', require('./routes/base'));

// 统一错误处理
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(200).json({ code: 500, message: err.message || '服务器内部错误' });
});

const PORT = process.env.PORT || 3010;
app.listen(PORT, () => console.log(`[ccs1210] server running at http://localhost:${PORT}`));

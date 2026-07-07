// 重置 SQLite 数据库到初始状态(删除 app.db,下次启动自动重建表+种子数据)
// 用法:node server/tools/reset-db.js
const path = require('path');
const fs = require('fs');
const DATA_DIR = path.join(__dirname, '..', 'data');
let n = 0;
for (const f of ['app.db', 'app.db-wal', 'app.db-shm']) {
  const p = path.join(DATA_DIR, f);
  if (fs.existsSync(p)) { fs.rmSync(p); console.log('已删除', f); n++; }
}
console.log(n ? '数据库已重置,下次启动将重建。' : '无数据库文件,无需重置。');

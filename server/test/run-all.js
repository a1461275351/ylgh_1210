// 一键全量测试编排器:自动拉起服务 → 等待就绪 → 依次运行全部测试套件 → 汇总详细报告
//   node server/test/run-all.js            # 在当前数据库上运行
//   node server/test/run-all.js --fresh    # 先重置数据库(干净环境)再运行
// 退出码:0 全部通过;1 有失败或异常
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const SERVER_DIR = path.join(__dirname, '..');
const DATA_DIR = path.join(SERVER_DIR, 'data');
const PORT = process.env.TEST_PORT || 3020;
const BASE = `http://localhost:${PORT}`;
const fresh = process.argv.includes('--fresh');

// 依赖顺序:备案基础 → 清关链路 → 进口闭环 → 财务/退货 → 对账合规
const SUITES = [
  ['客户管理',        'customer.test.js'],
  ['合同管理',        'contract.test.js'],
  ['接口平台/报文引擎', 'engine.test.js'],
  ['商品备案',        'products.test.js'],
  ['电子账册',        'ems.test.js'],
  ['三单+清单',       'order-inventory.test.js'],
  ['1210进口闭环',    'import-flow.test.js'],
  ['税费+退货',       'finance-refund.test.js'],
  ['WMS+报核',        'wms-verify.test.js'],
];

const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', b: '\x1b[36m', d: '\x1b[90m', x: '\x1b[0m', bold: '\x1b[1m' };
const log = (s = '') => process.stdout.write(s + '\n');

function resetDb() {
  for (const f of ['app.db', 'app.db-wal', 'app.db-shm']) {
    const p = path.join(DATA_DIR, f);
    if (fs.existsSync(p)) { fs.rmSync(p); log(`${C.d}  已删除 ${f}${C.x}`); }
  }
}

async function waitHealth(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      const j = await r.json();
      if (j.code === 0) return j.data;
    } catch { /* not ready */ }
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error('服务在超时时间内未就绪');
}

function runSuite(file) {
  const started = Date.now();
  const res = spawnSync(process.execPath, [path.join(__dirname, file)], {
    cwd: SERVER_DIR, encoding: 'utf8', env: { ...process.env, BASE_URL: BASE }, timeout: 120000,
  });
  const out = (res.stdout || '') + (res.stderr || '');
  const m = out.match(/结果:(\d+)\s*通过,(\d+)\s*失败/);
  const pass = m ? Number(m[1]) : 0;
  const failn = m ? Number(m[2]) : 0;
  const ok = res.status === 0 && failn === 0 && !!m;
  return { pass, fail: failn, ok, out, ms: Date.now() - started, crashed: !m };
}

(async () => {
  log(`${C.bold}${C.b}╔══════════════════════════════════════════════════════╗${C.x}`);
  log(`${C.bold}${C.b}║   1210 保税跨境电商关务系统 · 全量自动化测试            ║${C.x}`);
  log(`${C.bold}${C.b}╚══════════════════════════════════════════════════════╝${C.x}`);
  log(`${C.d}端口 ${PORT} · ${fresh ? '干净数据库(--fresh)' : '当前数据库'} · Node ${process.version}${C.x}\n`);

  if (fresh) { log(`${C.y}▶ 重置数据库...${C.x}`); resetDb(); }

  log(`${C.y}▶ 启动服务...${C.x}`);
  const server = spawn(process.execPath, [path.join(SERVER_DIR, 'src', 'index.js')], {
    cwd: SERVER_DIR, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore',
  });
  let serverExited = false;
  server.on('exit', () => { serverExited = true; });

  let health;
  try {
    health = await waitHealth();
  } catch (e) {
    log(`${C.r}✘ ${e.message}${C.x}`);
    if (!serverExited) server.kill();
    process.exit(1);
  }
  log(`${C.g}✔ 服务就绪${C.x} ${C.d}(客户 ${health.counts.customers} · 商品 ${health.counts.products} · 账册 ${health.counts.ems} · 订单 ${health.counts.orders})${C.x}\n`);

  const results = [];
  for (const [name, file] of SUITES) {
    process.stdout.write(`  ${name.padEnd(20, ' ')} `);
    const r = runSuite(file);
    results.push({ name, file, ...r });
    if (r.ok) log(`${C.g}✔ ${r.pass} 通过${C.x} ${C.d}${r.ms}ms${C.x}`);
    else if (r.crashed) log(`${C.r}✘ 执行异常/未产出结果${C.x}`);
    else log(`${C.r}✘ ${r.pass} 通过 / ${r.fail} 失败${C.x}`);
  }

  // 汇总
  const totalPass = results.reduce((s, r) => s + r.pass, 0);
  const totalFail = results.reduce((s, r) => s + r.fail, 0);
  const failedSuites = results.filter(r => !r.ok);
  const totalMs = results.reduce((s, r) => s + r.ms, 0);

  log(`\n${C.bold}────────────────────  汇总  ────────────────────${C.x}`);
  log(`  套件:${results.length}   通过用例:${C.g}${totalPass}${C.x}   失败用例:${totalFail ? C.r : C.g}${totalFail}${C.x}   耗时:${(totalMs / 1000).toFixed(1)}s`);

  // 失败详情
  if (failedSuites.length) {
    log(`\n${C.r}${C.bold}失败套件详情:${C.x}`);
    for (const r of failedSuites) {
      log(`${C.r}【${r.name}】${r.file}${C.x}`);
      r.out.split('\n').filter(l => l.includes('✘')).forEach(l => log('   ' + l.trim()));
    }
  }

  if (!serverExited) server.kill();
  log('');
  if (totalFail === 0 && failedSuites.length === 0) {
    log(`${C.g}${C.bold}✔ 全部通过(${totalPass} 个用例)${C.x}`);
    process.exit(0);
  } else {
    log(`${C.r}${C.bold}✘ 存在失败(${totalFail} 个用例失败 / ${failedSuites.length} 个套件)${C.x}`);
    process.exit(1);
  }
})().catch(e => { console.error(e); process.exit(1); });

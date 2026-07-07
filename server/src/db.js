// SQLite 数据库初始化(原型环境;生产环境执行 db/schema.mysql.sql)
// 结构与 MySQL DDL 保持字段级等价,按功能任务递增建表
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'app.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// 幂等加列:表已存在时补齐新增字段,不破坏历史数据
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}
db.ensureColumn = ensureColumn;

// ---------- T03 脚手架:系统基础表 ----------
db.exec(`
CREATE TABLE IF NOT EXISTS sys_param (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  param_key   TEXT NOT NULL UNIQUE,
  param_value TEXT NOT NULL,
  param_desc  TEXT,
  updated_by  TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS base_code (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code_type TEXT NOT NULL,
  code      TEXT NOT NULL,
  name      TEXT NOT NULL,
  enabled   INTEGER NOT NULL DEFAULT 1,
  UNIQUE (code_type, code)
);

CREATE TABLE IF NOT EXISTS sys_op_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id  INTEGER,
  username TEXT,
  action   TEXT NOT NULL,
  biz_type TEXT,
  biz_id   TEXT,
  detail   TEXT,
  ip       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sys_seq (
  seq_key TEXT PRIMARY KEY,
  seq_val INTEGER NOT NULL
);
`);

// ---------- T04 客户管理 ----------
db.exec(`
CREATE TABLE IF NOT EXISTS cust_customer (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cust_code    TEXT NOT NULL UNIQUE,
  cust_name    TEXT NOT NULL,
  uscc         TEXT,
  customs_code TEXT,
  record_type  TEXT NOT NULL,
  is_self      INTEGER NOT NULL DEFAULT 0,
  contact      TEXT,
  contact_tel  TEXT,
  settle_type  TEXT,
  address      TEXT,
  status       TEXT NOT NULL DEFAULT 'ENABLED',
  remark       TEXT,
  created_by   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_cust_name ON cust_customer (cust_name);
`);

// ---------- T05 合同管理 ----------
db.exec(`
CREATE TABLE IF NOT EXISTS cust_contract (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_no   TEXT NOT NULL UNIQUE,
  customer_id   INTEGER NOT NULL,
  contract_name TEXT NOT NULL,
  service_scope TEXT,
  amount        NUMERIC,
  currency      TEXT DEFAULT '142',
  sign_date     TEXT,
  valid_from    TEXT,
  valid_to      TEXT,
  billing_rule  TEXT,
  status        TEXT NOT NULL DEFAULT 'ACTIVE',
  file_path     TEXT,
  remark        TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_contract_cust ON cust_contract (customer_id);
`);

// ---------- T19 接口平台:通道配置 / 报文日志 / 申报清单(引擎输入) ----------
db.exec(`
CREATE TABLE IF NOT EXISTS channel_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_code TEXT NOT NULL UNIQUE,
  channel_name TEXT NOT NULL,
  msg_types    TEXT,
  endpoint     TEXT,
  sign_config  TEXT,
  is_default   INTEGER NOT NULL DEFAULT 0,
  enabled      INTEGER NOT NULL DEFAULT 1,
  remark       TEXT
);

CREATE TABLE IF NOT EXISTS msg_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  direction   TEXT NOT NULL,
  channel     TEXT,
  msg_type    TEXT NOT NULL,
  biz_no      TEXT,
  msg_id      TEXT,
  content     TEXT,
  status      TEXT NOT NULL DEFAULT 'PENDING',
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_msg   TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_msglog_biz ON msg_log (msg_type, biz_no);
CREATE INDEX IF NOT EXISTS idx_msglog_status ON msg_log (status);

CREATE TABLE IF NOT EXISTS ceb_inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id       INTEGER,
  order_no       TEXT NOT NULL,
  pre_no         TEXT,
  invt_no        TEXT,
  ebc_code       TEXT,
  ebp_code       TEXT,
  agent_code     TEXT,
  area_code      TEXT,
  ems_no         TEXT,
  logistics_no   TEXT,
  buyer_name     TEXT,
  buyer_id_no    TEXT,
  gross_weight   NUMERIC,
  net_weight     NUMERIC,
  goods_amount   NUMERIC,
  freight        NUMERIC DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'DRAFT',
  customs_status TEXT,
  ret_msg        TEXT,
  tax_total      NUMERIC,
  channel        TEXT DEFAULT 'SIMULATOR',
  declare_time   TEXT,
  release_time   TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_invt_status ON ceb_inventory (status);
CREATE INDEX IF NOT EXISTS idx_invt_no ON ceb_inventory (invt_no);

CREATE TABLE IF NOT EXISTS ceb_inventory_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_id  INTEGER NOT NULL,
  seq_no        INTEGER NOT NULL,
  sku           TEXT,
  hs_code       TEXT NOT NULL,
  product_name  TEXT NOT NULL,
  origin_country TEXT,
  unit          TEXT NOT NULL,
  qty           NUMERIC NOT NULL,
  unit_price    NUMERIC NOT NULL,
  total_price   NUMERIC NOT NULL,
  vat_rate      NUMERIC,
  consump_rate  NUMERIC,
  tax_amount    NUMERIC
);
CREATE INDEX IF NOT EXISTS idx_invtitem_inv ON ceb_inventory_item (inventory_id);
`);

// 通道种子:原型默认走模拟器;直连(DIRECT)为生产目标,已有电子口岸卡,待联调补 endpoint
const chCount = db.prepare(`SELECT COUNT(*) AS c FROM channel_config`).get();
if (chCount.c === 0) {
  const ins = db.prepare(`INSERT INTO channel_config
    (channel_code, channel_name, msg_types, endpoint, is_default, enabled, remark) VALUES (?,?,?,?,?,?,?)`);
  ins.run('SIMULATOR', '回执模拟器(原型)', 'CEB311,CEB621,CEB622', 'local://simulator', 1, 1, '原型联调用,按规则返回放行/退单');
  ins.run('DIRECT', '单一窗口自建直连', 'CEB311,CEB621,CEB622', '', 0, 1, '生产目标:电子口岸卡加签,待海关测试环境联调补 endpoint');
  ins.run('THIRD', '第三方通关服务商通道', 'CEB311,CEB621,CEB622', '', 0, 0, '备用/灾备通道,报文格式转换适配');
}

// ---------- T06/T07 支撑数据:商品备案 / HS税率 / 账册 / 库存(供 T08 校验;完整界面在 T06/T07) ----------
db.exec(`
CREATE TABLE IF NOT EXISTS goods_hs_tax (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hs_code          TEXT NOT NULL UNIQUE,
  hs_name          TEXT,
  vat_rate         NUMERIC NOT NULL DEFAULT 0.13,
  consump_rate     NUMERIC NOT NULL DEFAULT 0,
  in_positive_list INTEGER NOT NULL DEFAULT 0,
  unit_1           TEXT,
  remark           TEXT
);

CREATE TABLE IF NOT EXISTS goods_product (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id    INTEGER NOT NULL,
  sku            TEXT NOT NULL,
  product_name   TEXT NOT NULL,
  hs_code        TEXT NOT NULL,
  origin_country TEXT,
  unit_declare   TEXT,
  declare_price  NUMERIC,
  currency       TEXT DEFAULT '142',
  status         TEXT NOT NULL DEFAULT 'APPROVED',
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (customer_id, sku)
);

CREATE TABLE IF NOT EXISTS goods_ems_rel (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  ems_no     TEXT NOT NULL,
  item_no    INTEGER NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  UNIQUE (product_id, ems_no)
);

CREATE TABLE IF NOT EXISTS ems_header (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ems_no       TEXT UNIQUE,
  ems_type     TEXT NOT NULL DEFAULT 'T',
  company_code TEXT NOT NULL,
  company_name TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'APPROVED',
  valid_end    TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS ems_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ems_id       INTEGER NOT NULL,
  item_no      INTEGER NOT NULL,
  product_code TEXT,
  hs_code      TEXT NOT NULL,
  product_name TEXT NOT NULL,
  unit         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'NORMAL',
  UNIQUE (ems_id, item_no)
);

CREATE TABLE IF NOT EXISTS ems_stock_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ems_id    INTEGER NOT NULL,
  item_no   INTEGER NOT NULL,
  biz_type  TEXT NOT NULL,
  biz_no    TEXT,
  qty       NUMERIC NOT NULL,
  balance   NUMERIC NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_stock_item ON ems_stock_ledger (ems_id, item_no);
`);

// T07 电子账册:补齐表头字段 + 变更单表
ensureColumn('ems_header', 'internal_no', 'TEXT');
ensureColumn('ems_header', 'pre_no', 'TEXT');
ensureColumn('ems_header', 'customs_code', 'TEXT');
ensureColumn('ems_header', 'usage_type', "TEXT DEFAULT 'CBEC'");
ensureColumn('ems_header', 'declare_time', 'TEXT');
ensureColumn('ems_header', 'approve_time', 'TEXT');
ensureColumn('ems_header', 'input_date', 'TEXT');
ensureColumn('ems_header', 'remark', 'TEXT');
ensureColumn('ems_header', 'created_by', 'TEXT');
ensureColumn('ems_header', 'updated_at', 'TEXT');
ensureColumn('ems_item', 'declare_price', 'NUMERIC');
ensureColumn('ems_item', 'currency', "TEXT DEFAULT '142'");
ensureColumn('ems_stock_ledger', 'amount', 'NUMERIC');
ensureColumn('ceb_inventory', 'bond_invt_no', 'TEXT');
ensureColumn('ceb_inventory', 'summary_id', 'INTEGER');
db.exec(`
CREATE TABLE IF NOT EXISTS ems_change (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ems_id       INTEGER NOT NULL,
  change_no    TEXT NOT NULL UNIQUE,
  change_type  TEXT NOT NULL,
  change_desc  TEXT,
  change_data  TEXT,
  status       TEXT NOT NULL DEFAULT 'DRAFT',
  audit1_by    TEXT, audit1_at TEXT, audit1_remark TEXT,
  audit2_by    TEXT, audit2_at TEXT, audit2_remark TEXT,
  declare_time TEXT,
  ret_time     TEXT,
  ret_msg      TEXT,
  created_by   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_emschange_ems ON ems_change (ems_id);
`);

// T06 商品备案:补齐备案流程字段(幂等,兼容已存在的库)
ensureColumn('goods_product', 'declare_elements', 'TEXT');
ensureColumn('goods_product', 'spec_model', 'TEXT');
ensureColumn('goods_product', 'brand', 'TEXT');
ensureColumn('goods_product', 'barcode', 'TEXT');
ensureColumn('goods_product', 'unit_legal', 'TEXT');
ensureColumn('goods_product', 'net_weight', 'NUMERIC');
ensureColumn('goods_product', 'gross_weight', 'NUMERIC');
ensureColumn('goods_product', 'audit_remark', 'TEXT');
ensureColumn('goods_product', 'version', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('goods_product', 'created_by', 'TEXT');
ensureColumn('goods_product', 'updated_at', 'TEXT');

// ---------- T08 三单数据中心:订单 / 支付单 / 运单 ----------
db.exec(`
CREATE TABLE IF NOT EXISTS ceb_order (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no        TEXT NOT NULL UNIQUE,
  platform_code   TEXT,
  platform_name   TEXT,
  ebc_customer_id INTEGER NOT NULL,
  shop_code       TEXT,
  buyer_name      TEXT NOT NULL,
  buyer_id_no     TEXT NOT NULL,
  buyer_tel       TEXT,
  consignee       TEXT,
  consignee_addr  TEXT,
  goods_amount    NUMERIC NOT NULL DEFAULT 0,
  freight         NUMERIC NOT NULL DEFAULT 0,
  discount        NUMERIC NOT NULL DEFAULT 0,
  tax_amount      NUMERIC NOT NULL DEFAULT 0,
  actual_paid     NUMERIC NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT '142',
  source          TEXT NOT NULL DEFAULT 'API',
  status          TEXT NOT NULL DEFAULT 'RECEIVED',
  check_msg       TEXT,
  order_time      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_order_status ON ceb_order (status);

CREATE TABLE IF NOT EXISTS ceb_order_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     INTEGER NOT NULL,
  seq_no       INTEGER NOT NULL,
  sku          TEXT NOT NULL,
  product_id   INTEGER,
  product_name TEXT NOT NULL,
  qty          NUMERIC NOT NULL,
  unit_price   NUMERIC NOT NULL,
  total_price  NUMERIC NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orderitem_order ON ceb_order_item (order_id);

CREATE TABLE IF NOT EXISTS ceb_payment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER,
  order_no    TEXT NOT NULL,
  pay_no      TEXT,
  pay_company TEXT,
  payer_name  TEXT,
  payer_id_no TEXT,
  pay_amount  NUMERIC,
  pay_time    TEXT,
  push_status TEXT NOT NULL DEFAULT 'UNKNOWN',
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_pay_order ON ceb_payment (order_no);

CREATE TABLE IF NOT EXISTS ceb_logistics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id       INTEGER,
  order_no       TEXT NOT NULL,
  logistics_no   TEXT,
  logistics_name TEXT,
  weight         NUMERIC,
  push_status    TEXT NOT NULL DEFAULT 'UNKNOWN',
  track_status   TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_log_order ON ceb_logistics (order_no);
`);

// 支撑数据种子
const hsCount = db.prepare(`SELECT COUNT(*) AS c FROM goods_hs_tax`).get();
if (hsCount.c === 0) {
  const ins = db.prepare(`INSERT INTO goods_hs_tax (hs_code, hs_name, vat_rate, consump_rate, in_positive_list) VALUES (?,?,?,?,?)`);
  ins.run('1901101000', '婴幼儿配方奶粉', 0.09, 0, 1);
  ins.run('2106909090', '食品(维生素等)', 0.13, 0, 1);
  ins.run('4202210090', '皮革手袋', 0.13, 0, 1);
  ins.run('3304990090', '护肤化妆品', 0.13, 0, 1);
  ins.run('9990001000', '非正面清单示意商品', 0.13, 0, 0);
}

const prodCount = db.prepare(`SELECT COUNT(*) AS c FROM goods_product`).get();
if (prodCount.c === 0) {
  const self = db.prepare(`SELECT id FROM cust_customer WHERE is_self = 1`).get();
  const cid = self ? self.id : 1;
  const insP = db.prepare(`INSERT INTO goods_product (customer_id, sku, product_name, hs_code, origin_country, unit_declare, declare_price) VALUES (?,?,?,?,?,?,?)`);
  const p1 = insP.run(cid, 'SKU-MILK-01', '婴幼儿配方奶粉 900g', '1901101000', '609', '122', 220);
  const p2 = insP.run(cid, 'SKU-VC-02', '维生素C泡腾片', '2106909090', '304', '142', 150);
  const p3 = insP.run(cid, 'SKU-BAG-01', '真皮手袋', '4202210090', '303', '007', 6800);
  const p4 = insP.run(cid, 'SKU-SKIN-03', '精华护肤液 50ml', '3304990090', '133', '142', 380);
  // 账册
  const em = db.prepare(`INSERT INTO ems_header (ems_no, ems_type, company_code, company_name, status, valid_end) VALUES (?,?,?,?,?,?)`)
    .run('T901625A00100', 'T', '610166BA05', '西安市航空基地协航供应链管理有限公司', 'APPROVED', '2026-12-31');
  const emsId = Number(em.lastInsertRowid);
  const insI = db.prepare(`INSERT INTO ems_item (ems_id, item_no, product_code, hs_code, product_name, unit) VALUES (?,?,?,?,?,?)`);
  const insR = db.prepare(`INSERT INTO goods_ems_rel (product_id, ems_no, item_no) VALUES (?,?,?)`);
  const insL = db.prepare(`INSERT INTO ems_stock_ledger (ems_id, item_no, biz_type, biz_no, qty, balance) VALUES (?,?,?,?,?,?)`);
  const prods = [
    { pid: Number(p1.lastInsertRowid), sku: 'SKU-MILK-01', name: '婴幼儿配方奶粉 900g', hs: '1901101000', unit: '122', stock: 1000 },
    { pid: Number(p2.lastInsertRowid), sku: 'SKU-VC-02', name: '维生素C泡腾片', hs: '2106909090', unit: '142', stock: 800 },
    { pid: Number(p3.lastInsertRowid), sku: 'SKU-BAG-01', name: '真皮手袋', hs: '4202210090', unit: '007', stock: 50 },
    { pid: Number(p4.lastInsertRowid), sku: 'SKU-SKIN-03', name: '精华护肤液 50ml', hs: '3304990090', unit: '142', stock: 600 },
  ];
  prods.forEach((p, i) => {
    const no = i + 1;
    insI.run(emsId, no, p.sku, p.hs, p.name, p.unit);
    insR.run(p.pid, 'T901625A00100', no);
    insL.run(emsId, no, 'IN', 'INIT-STOCK', p.stock, p.stock);
  });
}

// ---------- T10/T11/T12 出入区:报关单 / 核注清单 / 核放单 ----------
db.exec(`
CREATE TABLE IF NOT EXISTS decl_head (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  internal_no  TEXT,
  entry_no     TEXT,
  decl_type    TEXT NOT NULL DEFAULT 'FIRST_IN',
  trade_mode   TEXT NOT NULL DEFAULT '1210',
  ems_no       TEXT,
  bond_invt_no TEXT,
  trade_country TEXT,
  bill_no      TEXT,
  status       TEXT NOT NULL DEFAULT 'DRAFT',
  declare_time TEXT,
  release_time TEXT,
  ret_msg      TEXT,
  created_by   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS decl_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  head_id      INTEGER NOT NULL,
  seq_no       INTEGER NOT NULL,
  ems_item_no  INTEGER,
  hs_code      TEXT NOT NULL,
  product_name TEXT NOT NULL,
  unit         TEXT NOT NULL,
  qty          NUMERIC NOT NULL,
  unit_price   NUMERIC NOT NULL DEFAULT 0,
  total_price  NUMERIC NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_declitem_head ON decl_item (head_id);

CREATE TABLE IF NOT EXISTS bond_invt_head (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  internal_no   TEXT,
  bond_invt_no  TEXT,
  ems_id        INTEGER NOT NULL,
  ems_no        TEXT NOT NULL,
  flow_type     TEXT NOT NULL,            -- IN 一线入区 / OUT 二线出区
  mtpck_endprd  TEXT,                     -- I 料件 / E 成品
  trade_mode    TEXT NOT NULL DEFAULT '1210',
  decl_id       INTEGER,                  -- 关联进境报关单(IN)
  rlt_invt_nos  TEXT,                     -- 关联零售清单号(OUT)
  status        TEXT NOT NULL DEFAULT 'DRAFT',
  stock_applied INTEGER NOT NULL DEFAULT 0, -- 是否已核增/核减账册(防重复)
  declare_time  TEXT,
  ret_msg       TEXT,
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_bondinvt_ems ON bond_invt_head (ems_id);
CREATE INDEX IF NOT EXISTS idx_bondinvt_status ON bond_invt_head (status);

CREATE TABLE IF NOT EXISTS bond_invt_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  head_id      INTEGER NOT NULL,
  seq_no       INTEGER NOT NULL,
  ems_item_no  INTEGER NOT NULL,
  hs_code      TEXT NOT NULL,
  product_name TEXT NOT NULL,
  unit         TEXT NOT NULL,
  qty          NUMERIC NOT NULL,
  unit_price   NUMERIC DEFAULT 0,
  total_price  NUMERIC DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_bondinvtitem_head ON bond_invt_item (head_id);

CREATE TABLE IF NOT EXISTS passport_head (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  internal_no   TEXT,
  passport_no   TEXT,
  passport_type TEXT NOT NULL,            -- IN / OUT
  ems_no        TEXT NOT NULL,
  bond_invt_id  INTEGER,
  vehicle_no    TEXT,
  vehicle_ic    TEXT,
  status        TEXT NOT NULL DEFAULT 'DRAFT',
  gate_time     TEXT,
  abnormal_msg  TEXT,
  declare_time  TEXT,
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_passport_status ON passport_head (status);
`);

// ---------- T13 税费与担保额度 / T14 退货 ----------
db.exec(`
CREATE TABLE IF NOT EXISTS tax_bill (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_id   INTEGER NOT NULL,
  invt_no        TEXT,
  order_no       TEXT NOT NULL,
  customs_tax_no TEXT,
  vat            NUMERIC NOT NULL DEFAULT 0,
  consump_tax    NUMERIC NOT NULL DEFAULT 0,
  total_tax      NUMERIC NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING待缴/PAID已汇缴/REVERSED已冲减
  paid_time      TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_taxbill_inv ON tax_bill (inventory_id);
CREATE INDEX IF NOT EXISTS idx_taxbill_status ON tax_bill (status);

CREATE TABLE IF NOT EXISTS guarantee_account (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_name TEXT NOT NULL,
  total_amount NUMERIC NOT NULL,
  used_amount  NUMERIC NOT NULL DEFAULT 0,
  warn_ratio   NUMERIC NOT NULL DEFAULT 0.8,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS guarantee_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  biz_type   TEXT NOT NULL,   -- OCCUPY占用/RELEASE汇缴释放/REFUND退货释放
  biz_no     TEXT,
  amount     NUMERIC NOT NULL,
  balance    NUMERIC NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_gledger_acct ON guarantee_ledger (account_id);

CREATE TABLE IF NOT EXISTS ceb_refund (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  refund_no     TEXT NOT NULL UNIQUE,
  inventory_id  INTEGER NOT NULL,
  order_no      TEXT NOT NULL,
  reason        TEXT,
  refund_type   TEXT NOT NULL DEFAULT 'RETURN_AREA',  -- RETURN_AREA退回区内/REJECT拒收/ABANDON放弃
  apply_time    TEXT,
  status        TEXT NOT NULL DEFAULT 'APPLIED',
  declare_time  TEXT,
  ret_msg       TEXT,
  inbound_time  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_refund_inv ON ceb_refund (inventory_id);
`);

const gaCount = db.prepare(`SELECT COUNT(*) AS c FROM guarantee_account`).get();
if (gaCount.c === 0) {
  db.prepare(`INSERT INTO guarantee_account (account_name, total_amount, used_amount, warn_ratio) VALUES (?,?,?,?)`)
    .run('自营税款担保账户(610166BA05)', 1000000, 0, 0.8);
}

// ---------- T15 WMS 协同与三账比对 / T16 报核核销 ----------
db.exec(`
CREATE TABLE IF NOT EXISTS wms_inbound (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inbound_no  TEXT NOT NULL UNIQUE,
  ems_no      TEXT,
  bond_invt_no TEXT,
  biz_type    TEXT NOT NULL DEFAULT 'FIRST_IN',  -- FIRST_IN备货入区/REFUND退货入区
  qty_total   NUMERIC DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'FINISHED',
  finished_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS wms_outbound (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  outbound_no  TEXT NOT NULL UNIQUE,
  inventory_id INTEGER,
  order_no     TEXT,
  qty_total    NUMERIC DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'INSTRUCTED',  -- INSTRUCTED/PICKED/PACKED/SHIPPED
  shipped_at   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS wms_stock_snapshot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ems_no      TEXT NOT NULL,
  ems_item_no INTEGER NOT NULL,
  qty         NUMERIC NOT NULL,
  snap_time   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (ems_no, ems_item_no)
);
CREATE TABLE IF NOT EXISTS stock_diff_report (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_date TEXT NOT NULL,
  ems_no      TEXT NOT NULL,
  ems_item_no INTEGER NOT NULL,
  product_name TEXT,
  qty_ems     NUMERIC NOT NULL,
  qty_wms     NUMERIC NOT NULL,
  qty_client  NUMERIC,
  diff_flag   INTEGER NOT NULL DEFAULT 0,
  handle_status TEXT DEFAULT 'PENDING',
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS ems_verification (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  verify_no   TEXT NOT NULL UNIQUE,
  ems_id      INTEGER NOT NULL,
  ems_no      TEXT NOT NULL,
  period_from TEXT NOT NULL,
  period_to   TEXT NOT NULL,
  diff_data   TEXT,
  status      TEXT NOT NULL DEFAULT 'DRAFT',  -- DRAFT/DECLARED/APPROVED/CLOSED/REJECTED
  declare_time TEXT,
  close_time  TEXT,
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS stocktake (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  take_no     TEXT NOT NULL UNIQUE,
  ems_id      INTEGER NOT NULL,
  ems_no      TEXT NOT NULL,
  take_date   TEXT NOT NULL,
  result_data TEXT,
  status      TEXT NOT NULL DEFAULT 'DRAFT',  -- DRAFT/CONFIRMED/ADJUSTED
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`);

// ---------- 种子数据 ----------
const seedParam = db.prepare(
  `INSERT OR IGNORE INTO sys_param (param_key, param_value, param_desc) VALUES (?, ?, ?)`);
[
  ['LIMIT_SINGLE', '5000', '跨境电商零售进口单次交易限值(元)'],
  ['LIMIT_ANNUAL', '26000', '个人年度交易限值(元)'],
  ['TAX_DISCOUNT', '0.7', '综合税征收折扣系数'],
  ['REFUND_DAYS', '30', '退货申请期限(天)'],
  ['EMS_EXPIRE_WARN_DAYS', '60', '账册到期预警提前天数'],
  ['PRICE_DIFF_RATIO', '0.3', '订单价格与备案价偏离预警阈值'],
].forEach(r => seedParam.run(...r));

const seedCode = db.prepare(
  `INSERT OR IGNORE INTO base_code (code_type, code, name) VALUES (?, ?, ?)`);
[
  ['TRADE_MODE', '1210', '保税跨境贸易电子商务'],
  ['TRANSPORT', '2', '水路运输'], ['TRANSPORT', '4', '公路运输'], ['TRANSPORT', '5', '航空运输'],
  ['CURRENCY', '142', '人民币'], ['CURRENCY', '502', '美元'], ['CURRENCY', '300', '欧元'],
  ['UNIT', '007', '个'], ['UNIT', '011', '件'], ['UNIT', '035', '千克'], ['UNIT', '122', '盒'], ['UNIT', '142', '瓶'],
  ['COUNTRY', '142', '中国'], ['COUNTRY', '502', '美国'], ['COUNTRY', '116', '日本'], ['COUNTRY', '133', '韩国'],
  ['COUNTRY', '303', '法国'], ['COUNTRY', '304', '德国'], ['COUNTRY', '601', '澳大利亚'], ['COUNTRY', '609', '新西兰'],
].forEach(r => seedCode.run(...r));

// 自营主体(默认租户)
const selfCount = db.prepare(`SELECT COUNT(*) AS c FROM cust_customer WHERE is_self = 1`).get();
if (selfCount.c === 0) {
  db.prepare(`INSERT INTO cust_customer
      (cust_code, cust_name, uscc, customs_code, record_type, is_self, settle_type, status, remark, created_by)
      VALUES (?, ?, ?, ?, ?, 1, ?, 'ENABLED', ?, 'system')`)
    .run('C00000001', '西安市航空基地协航供应链管理有限公司', '91610000MA6TEST000',
         '610166BA05', 'EBC', 'MONTHLY', '自营主体(默认租户)');
}

module.exports = db;

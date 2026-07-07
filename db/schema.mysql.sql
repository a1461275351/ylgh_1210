-- =====================================================================
-- 1210 保税跨境电商关务管理系统 数据库设计(MySQL 8.0)
-- 依据《1210保税跨境电商关务管理系统-需求文档.md》V0.2
-- 字符集 utf8mb4,存储引擎 InnoDB
-- 说明:
--   1. 所有状态字段使用字符串代码,取值范围见字段注释;
--   2. 购买人身份证号等个人信息由应用层加密后存入(AES),库内不存明文;
--   3. 金额统一 DECIMAL(18,4),数量 DECIMAL(18,5)(海关申报最多5位小数);
--   4. 原型阶段使用 SQLite 等价结构,生产部署执行本脚本。
-- =====================================================================

CREATE DATABASE IF NOT EXISTS ccs1210 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
USE ccs1210;

-- =====================================================================
-- 一、系统与基础数据
-- =====================================================================

CREATE TABLE sys_user (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username      VARCHAR(50)  NOT NULL COMMENT '登录名',
  password_hash VARCHAR(255) NOT NULL COMMENT '密码哈希(bcrypt)',
  real_name     VARCHAR(50)  NOT NULL COMMENT '姓名',
  mobile        VARCHAR(20)  DEFAULT NULL,
  email         VARCHAR(100) DEFAULT NULL,
  company_id    BIGINT UNSIGNED DEFAULT NULL COMMENT '所属主体(多公司支持)',
  status        VARCHAR(10)  NOT NULL DEFAULT 'ENABLED' COMMENT 'ENABLED启用/DISABLED停用',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_username (username)
) COMMENT='系统用户';

CREATE TABLE sys_role (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  role_code  VARCHAR(50) NOT NULL COMMENT '角色代码:ADMIN/ENTRY(录入)/AUDIT1(初审)/AUDIT2(复审)/FINANCE/CUSTOMER/WAREHOUSE',
  role_name  VARCHAR(50) NOT NULL,
  remark     VARCHAR(200) DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_role_code (role_code)
) COMMENT='角色';

CREATE TABLE sys_user_role (
  user_id BIGINT UNSIGNED NOT NULL,
  role_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, role_id)
) COMMENT='用户-角色';

CREATE TABLE sys_role_menu (
  role_id   BIGINT UNSIGNED NOT NULL,
  menu_code VARCHAR(50) NOT NULL COMMENT '菜单编码,如 cust.list / ems.change / invt.declare',
  PRIMARY KEY (role_id, menu_code)
) COMMENT='角色-菜单权限(菜单级)';

CREATE TABLE sys_op_log (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED DEFAULT NULL,
  username   VARCHAR(50)  DEFAULT NULL,
  action     VARCHAR(50)  NOT NULL COMMENT '动作:CREATE/UPDATE/DELETE/AUDIT/DECLARE/LOGIN...',
  biz_type   VARCHAR(50)  DEFAULT NULL COMMENT '业务对象:CUSTOMER/EMS/INVENTORY/PASSPORT...',
  biz_id     VARCHAR(64)  DEFAULT NULL COMMENT '业务单据号/ID',
  detail     TEXT COMMENT '变更内容摘要(JSON)',
  ip         VARCHAR(50)  DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_biz (biz_type, biz_id),
  KEY idx_created (created_at)
) COMMENT='操作日志(审计留痕)';

CREATE TABLE sys_param (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  param_key   VARCHAR(50)  NOT NULL COMMENT '参数键:LIMIT_SINGLE(单次限值5000)/LIMIT_ANNUAL(年度26000)/TAX_DISCOUNT(0.7)/REFUND_DAYS(30)/EMS_EXPIRE_WARN_DAYS(60)...',
  param_value VARCHAR(200) NOT NULL,
  param_desc  VARCHAR(200) DEFAULT NULL,
  updated_by  VARCHAR(50)  DEFAULT NULL,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_param_key (param_key)
) COMMENT='政策/系统参数(政策调整只改参数不改代码)';

CREATE TABLE base_code (
  id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code_type VARCHAR(30) NOT NULL COMMENT '代码类型:TRADE_MODE监管方式/TRANSPORT运输方式/CURRENCY币制/COUNTRY国别/UNIT计量单位/CUSTOMS关别/DISTRICT区内场所',
  code      VARCHAR(20) NOT NULL COMMENT '标准代码,如 1210 / 142(美元)/ 502(上海关)',
  name      VARCHAR(100) NOT NULL,
  enabled   TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uk_type_code (code_type, code)
) COMMENT='海关标准参数代码表';

-- =====================================================================
-- 二、客户与合同(多租户:业务表均带 customer_id 实现数据隔离,自营=默认客户)
-- =====================================================================

CREATE TABLE cust_customer (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  cust_code     VARCHAR(30)  NOT NULL COMMENT '客户编码(内部)',
  cust_name     VARCHAR(200) NOT NULL COMMENT '企业名称',
  uscc          VARCHAR(18)  DEFAULT NULL COMMENT '统一社会信用代码(18位)',
  customs_code  VARCHAR(10)  DEFAULT NULL COMMENT '海关注册编码(10位)',
  record_type   VARCHAR(20)  NOT NULL COMMENT '跨境电商备案类型:EBC电商企业/EBP电商平台/PAY支付企业/LOGISTICS物流企业/WAREHOUSE仓储企业',
  is_self       TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '1=自营主体(默认租户)',
  contact       VARCHAR(50)  DEFAULT NULL COMMENT '联系人',
  contact_tel   VARCHAR(30)  DEFAULT NULL,
  settle_type   VARCHAR(20)  DEFAULT NULL COMMENT '结算方式:MONTHLY月结/SINGLE单票/PREPAY预存',
  address       VARCHAR(200) DEFAULT NULL,
  status        VARCHAR(10)  NOT NULL DEFAULT 'ENABLED' COMMENT 'ENABLED启用/DISABLED停用',
  remark        VARCHAR(500) DEFAULT NULL,
  created_by    VARCHAR(50)  DEFAULT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_cust_code (cust_code),
  KEY idx_cust_name (cust_name),
  KEY idx_uscc (uscc)
) COMMENT='客户档案(电商企业/平台/支付/物流/仓储)';

CREATE TABLE cust_qualification (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id  BIGINT UNSIGNED NOT NULL,
  qual_type    VARCHAR(30)  NOT NULL COMMENT '证照类型:LICENSE营业执照/CUSTOMS_REG海关备案回执/FOOD食品经营许可...',
  qual_no      VARCHAR(100) DEFAULT NULL COMMENT '证照编号',
  valid_from   DATE DEFAULT NULL,
  valid_to     DATE DEFAULT NULL COMMENT '到期日(到期提醒)',
  file_path    VARCHAR(300) DEFAULT NULL COMMENT '附件存储路径',
  remark       VARCHAR(200) DEFAULT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_customer (customer_id)
) COMMENT='客户资质证照';

CREATE TABLE cust_contract (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  contract_no   VARCHAR(50)  NOT NULL COMMENT '合同编号',
  customer_id   BIGINT UNSIGNED NOT NULL,
  contract_name VARCHAR(200) NOT NULL,
  service_scope VARCHAR(100) DEFAULT NULL COMMENT '服务范围:WAREHOUSE仓储/CLEARANCE清关/DELIVERY配送(逗号分隔)',
  amount        DECIMAL(18,4) DEFAULT NULL COMMENT '合同金额',
  currency      VARCHAR(3)   DEFAULT '142' COMMENT '币制代码',
  sign_date     DATE DEFAULT NULL,
  valid_from    DATE DEFAULT NULL,
  valid_to      DATE DEFAULT NULL COMMENT '到期提醒',
  billing_rule  TEXT COMMENT '计费规则(JSON)',
  status        VARCHAR(10)  NOT NULL DEFAULT 'ACTIVE' COMMENT 'DRAFT草稿/ACTIVE生效/EXPIRED到期/TERMINATED终止',
  file_path     VARCHAR(300) DEFAULT NULL,
  remark        VARCHAR(500) DEFAULT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_contract_no (contract_no),
  KEY idx_customer (customer_id)
) COMMENT='服务合同';

-- =====================================================================
-- 三、商品备案
-- =====================================================================

CREATE TABLE goods_hs_tax (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  hs_code          VARCHAR(10) NOT NULL COMMENT 'HS编码',
  hs_name          VARCHAR(200) DEFAULT NULL,
  vat_rate         DECIMAL(8,4) NOT NULL DEFAULT 0.13 COMMENT '增值税率',
  consump_rate     DECIMAL(8,4) NOT NULL DEFAULT 0 COMMENT '消费税率',
  in_positive_list TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否在跨境电商零售进口正面清单内',
  declare_elements VARCHAR(500) DEFAULT NULL COMMENT '申报要素模板',
  unit_1           VARCHAR(10) DEFAULT NULL COMMENT '法定第一单位代码',
  unit_2           VARCHAR(10) DEFAULT NULL COMMENT '法定第二单位代码',
  remark           VARCHAR(200) DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_hs (hs_code)
) COMMENT='HS税率库与正面清单';

CREATE TABLE goods_product (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id      BIGINT UNSIGNED NOT NULL COMMENT '货主(电商企业)',
  sku              VARCHAR(60)  NOT NULL COMMENT '商品货号SKU',
  product_name     VARCHAR(255) NOT NULL COMMENT '申报品名',
  hs_code          VARCHAR(10)  NOT NULL,
  declare_elements VARCHAR(1000) DEFAULT NULL COMMENT '申报要素',
  spec_model       VARCHAR(255) DEFAULT NULL COMMENT '规格型号',
  origin_country   VARCHAR(3)   DEFAULT NULL COMMENT '原产国代码',
  brand            VARCHAR(100) DEFAULT NULL,
  barcode          VARCHAR(50)  DEFAULT NULL COMMENT '条码',
  unit_declare     VARCHAR(10)  DEFAULT NULL COMMENT '申报计量单位代码',
  unit_legal       VARCHAR(10)  DEFAULT NULL COMMENT '法定计量单位代码',
  unit_sale        VARCHAR(10)  DEFAULT NULL COMMENT '销售单位',
  net_weight       DECIMAL(18,5) DEFAULT NULL COMMENT '净重kg',
  gross_weight     DECIMAL(18,5) DEFAULT NULL COMMENT '毛重kg',
  declare_price    DECIMAL(18,4) DEFAULT NULL COMMENT '备案申报单价',
  currency         VARCHAR(3)   DEFAULT '142',
  status           VARCHAR(20)  NOT NULL DEFAULT 'DRAFT' COMMENT 'DRAFT草稿/AUDIT1待初审/AUDIT2待复审/APPROVED备案通过/REJECTED驳回',
  audit_remark     VARCHAR(500) DEFAULT NULL COMMENT '审核意见',
  version          INT NOT NULL DEFAULT 1 COMMENT '资料版本号',
  created_by       VARCHAR(50) DEFAULT NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_cust_sku (customer_id, sku),
  KEY idx_hs (hs_code),
  KEY idx_status (status)
) COMMENT='商品备案资料库';

CREATE TABLE goods_ems_rel (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id  BIGINT UNSIGNED NOT NULL,
  ems_no      VARCHAR(30) NOT NULL COMMENT '账册编号',
  item_no     INT NOT NULL COMMENT '账册备案序号(料号序号)',
  enabled     TINYINT(1) NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_prod_ems (product_id, ems_no),
  KEY idx_ems_item (ems_no, item_no)
) COMMENT='商品-账册备案序号对应关系(支持一品多号)';

-- =====================================================================
-- 四、电子账册(金二特殊区域账册)
-- =====================================================================

CREATE TABLE ems_header (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  internal_no    VARCHAR(60) DEFAULT NULL COMMENT '企业内部编号',
  pre_no         VARCHAR(60) DEFAULT NULL COMMENT '平台预录入号',
  ems_no         VARCHAR(30) DEFAULT NULL COMMENT '账册编号(海关审批后回填,如 T901625A00100)',
  ems_type       VARCHAR(10) NOT NULL DEFAULT 'T' COMMENT 'T物流账册/H加工账册',
  company_code   VARCHAR(10) NOT NULL COMMENT '经营单位代码',
  company_name   VARCHAR(200) NOT NULL COMMENT '经营单位名称',
  customs_code   VARCHAR(4)  DEFAULT NULL COMMENT '主管关别',
  usage_type     VARCHAR(20) DEFAULT 'CBEC' COMMENT '用途:CBEC跨境电商/GENERAL一般保税',
  status         VARCHAR(30) NOT NULL DEFAULT 'DRAFT' COMMENT '单证状态:DRAFT录入/AUDIT1待初审/AUDIT2待复审/DECLARED已申报/APPROVED金二审批通过/CHG_DECLARED变更已申报/CHG_APPROVED变更金二审批通过/REJECTED退单',
  valid_end      DATE DEFAULT NULL COMMENT '结束有效期',
  declare_time   DATETIME DEFAULT NULL COMMENT '最近申报时间',
  approve_time   DATETIME DEFAULT NULL COMMENT '最近审批时间',
  input_date     DATE DEFAULT NULL COMMENT '录入日期',
  remark         VARCHAR(500) DEFAULT NULL,
  created_by     VARCHAR(50) DEFAULT NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ems_no (ems_no),
  KEY idx_status (status),
  KEY idx_company (company_code)
) COMMENT='电子账册表头';

CREATE TABLE ems_item (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ems_id         BIGINT UNSIGNED NOT NULL,
  item_no        INT NOT NULL COMMENT '备案序号',
  product_code   VARCHAR(60)  DEFAULT NULL COMMENT '料号',
  hs_code        VARCHAR(10)  NOT NULL,
  product_name   VARCHAR(255) NOT NULL,
  spec_model     VARCHAR(255) DEFAULT NULL,
  unit           VARCHAR(10)  NOT NULL COMMENT '申报计量单位',
  unit_legal     VARCHAR(10)  DEFAULT NULL,
  declare_price  DECIMAL(18,4) DEFAULT NULL,
  currency       VARCHAR(3)   DEFAULT '142',
  origin_country VARCHAR(3)   DEFAULT NULL,
  status         VARCHAR(20)  NOT NULL DEFAULT 'NORMAL' COMMENT 'NORMAL正常/STOP停用',
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ems_item (ems_id, item_no),
  KEY idx_hs (hs_code)
) COMMENT='电子账册表体(备案序号)';

CREATE TABLE ems_change (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ems_id       BIGINT UNSIGNED NOT NULL,
  change_no    VARCHAR(60) NOT NULL COMMENT '变更单号(内部流水)',
  change_type  VARCHAR(20) NOT NULL COMMENT 'HEAD表头变更/ITEM_ADD增加商品/ITEM_MODIFY修改商品/EXTEND延期',
  change_desc  VARCHAR(500) DEFAULT NULL COMMENT '变更说明',
  change_data  JSON DEFAULT NULL COMMENT '变更前后数据(JSON diff)',
  status       VARCHAR(30) NOT NULL DEFAULT 'DRAFT' COMMENT 'DRAFT录入/AUDIT1待初审/AUDIT2待复审/DECLARED已申报/APPROVED审批通过/REJECTED退单',
  audit1_by    VARCHAR(50) DEFAULT NULL, audit1_at DATETIME DEFAULT NULL, audit1_remark VARCHAR(500) DEFAULT NULL,
  audit2_by    VARCHAR(50) DEFAULT NULL, audit2_at DATETIME DEFAULT NULL, audit2_remark VARCHAR(500) DEFAULT NULL,
  declare_time DATETIME DEFAULT NULL,
  ret_time     DATETIME DEFAULT NULL COMMENT '回执时间',
  ret_msg      VARCHAR(500) DEFAULT NULL COMMENT '回执信息',
  created_by   VARCHAR(50) DEFAULT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_change_no (change_no),
  KEY idx_ems (ems_id),
  KEY idx_status (status)
) COMMENT='账册变更单(含初审/复审流转)';

CREATE TABLE ems_stock_ledger (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ems_id       BIGINT UNSIGNED NOT NULL,
  item_no      INT NOT NULL COMMENT '备案序号',
  biz_type     VARCHAR(20) NOT NULL COMMENT 'IN一线入区核增/OUT二线出区核减/REFUND退货核增/ADJUST盘盈盘亏调整',
  biz_no       VARCHAR(60) DEFAULT NULL COMMENT '关联单据号(核注清单号/退货单号/盘点单号)',
  qty          DECIMAL(18,5) NOT NULL COMMENT '数量(正核增负核减)',
  balance      DECIMAL(18,5) NOT NULL COMMENT '记账后结余数量',
  amount       DECIMAL(18,4) DEFAULT NULL COMMENT '金额',
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ems_item (ems_id, item_no),
  KEY idx_biz (biz_type, biz_no)
) COMMENT='账册进出存流水台账(结余可实时查询)';

-- =====================================================================
-- 五、三单数据中心
-- =====================================================================

CREATE TABLE ceb_order (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_no       VARCHAR(60) NOT NULL COMMENT '订单编号(平台)',
  platform_code  VARCHAR(20) DEFAULT NULL COMMENT '电商平台代码(海关备案)',
  platform_name  VARCHAR(100) DEFAULT NULL,
  ebc_customer_id BIGINT UNSIGNED NOT NULL COMMENT '电商企业(客户)ID',
  shop_code      VARCHAR(50)  DEFAULT NULL COMMENT '店铺编码',
  buyer_name     VARCHAR(60)  NOT NULL COMMENT '订购人姓名',
  buyer_id_type  VARCHAR(2)   NOT NULL DEFAULT '1' COMMENT '证件类型:1身份证',
  buyer_id_no    VARCHAR(128) NOT NULL COMMENT '订购人证件号(应用层AES加密)',
  buyer_tel      VARCHAR(30)  DEFAULT NULL,
  consignee      VARCHAR(60)  DEFAULT NULL COMMENT '收货人',
  consignee_tel  VARCHAR(30)  DEFAULT NULL,
  consignee_addr VARCHAR(300) DEFAULT NULL,
  goods_amount   DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '商品金额',
  freight        DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '运费',
  discount       DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '优惠',
  tax_amount     DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '代扣税款',
  actual_paid    DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '实际支付金额',
  currency       VARCHAR(3)   NOT NULL DEFAULT '142',
  source         VARCHAR(10)  NOT NULL DEFAULT 'API' COMMENT '来源:API接口/IMPORT导入/MANUAL手工',
  status         VARCHAR(30)  NOT NULL DEFAULT 'RECEIVED' COMMENT 'RECEIVED已接收/CHECK_FAIL校验失败/CHECKED已校验/INVT_CREATED已生成清单/DECLARING申报中/RELEASED放行/OUTBOUND已出库/SIGNED签收/REFUNDING退货中/CLOSED关闭',
  check_msg      VARCHAR(1000) DEFAULT NULL COMMENT '校验失败原因',
  order_time     DATETIME DEFAULT NULL COMMENT '下单时间',
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_order_no (order_no),
  KEY idx_status (status),
  KEY idx_ebc (ebc_customer_id),
  KEY idx_order_time (order_time)
) COMMENT='跨境电商订单(CEB311 数据源)';

CREATE TABLE ceb_order_item (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id     BIGINT UNSIGNED NOT NULL,
  seq_no       INT NOT NULL COMMENT '序号',
  sku          VARCHAR(60) NOT NULL,
  product_id   BIGINT UNSIGNED DEFAULT NULL COMMENT '关联商品备案',
  product_name VARCHAR(255) NOT NULL,
  qty          DECIMAL(18,5) NOT NULL,
  unit_price   DECIMAL(18,4) NOT NULL,
  total_price  DECIMAL(18,4) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_order (order_id)
) COMMENT='订单商品明细';

CREATE TABLE ceb_payment (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id      BIGINT UNSIGNED DEFAULT NULL,
  order_no      VARCHAR(60) NOT NULL,
  pay_no        VARCHAR(60) DEFAULT NULL COMMENT '支付交易编号',
  pay_company   VARCHAR(100) DEFAULT NULL COMMENT '支付企业名称',
  pay_code      VARCHAR(20)  DEFAULT NULL COMMENT '支付企业海关代码',
  payer_name    VARCHAR(60)  DEFAULT NULL COMMENT '支付人姓名',
  payer_id_no   VARCHAR(128) DEFAULT NULL COMMENT '支付人证件号(加密)',
  pay_amount    DECIMAL(18,4) DEFAULT NULL,
  pay_time      DATETIME DEFAULT NULL,
  push_status   VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN' COMMENT '海关推送状态:UNKNOWN未知/PUSHED已推送/MATCHED已对碰/FAIL失败',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_order_no (order_no)
) COMMENT='支付单(支付企业推海关,本表记录与监控)';

CREATE TABLE ceb_logistics (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id       BIGINT UNSIGNED DEFAULT NULL,
  order_no       VARCHAR(60) NOT NULL,
  logistics_no   VARCHAR(60) DEFAULT NULL COMMENT '运单编号',
  logistics_code VARCHAR(20) DEFAULT NULL COMMENT '物流企业海关代码',
  logistics_name VARCHAR(100) DEFAULT NULL,
  weight         DECIMAL(18,5) DEFAULT NULL COMMENT '毛重kg',
  push_status    VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN' COMMENT 'UNKNOWN/PUSHED/MATCHED/FAIL',
  track_status   VARCHAR(20) DEFAULT NULL COMMENT '轨迹:PICKED揽收/EXIT出区/DELIVERING派送/SIGNED妥投',
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_order_no (order_no),
  KEY idx_logistics_no (logistics_no)
) COMMENT='物流运单';

-- =====================================================================
-- 六、申报清单与退货
-- =====================================================================

CREATE TABLE ceb_inventory (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id       BIGINT UNSIGNED NOT NULL,
  order_no       VARCHAR(60) NOT NULL,
  pre_no         VARCHAR(60) DEFAULT NULL COMMENT '预录入编号',
  invt_no        VARCHAR(60) DEFAULT NULL COMMENT '清单编号(海关回填)',
  ebc_code       VARCHAR(20) DEFAULT NULL COMMENT '电商企业海关代码',
  ebp_code       VARCHAR(20) DEFAULT NULL COMMENT '电商平台代码',
  agent_code     VARCHAR(20) DEFAULT NULL COMMENT '申报单位代码',
  area_code      VARCHAR(20) DEFAULT NULL COMMENT '区内企业代码',
  ems_no         VARCHAR(30) DEFAULT NULL COMMENT '关联账册编号',
  logistics_no   VARCHAR(60) DEFAULT NULL,
  gross_weight   DECIMAL(18,5) DEFAULT NULL,
  net_weight     DECIMAL(18,5) DEFAULT NULL,
  status         VARCHAR(30) NOT NULL DEFAULT 'DRAFT' COMMENT 'DRAFT暂存/AUDIT1待初审/AUDIT2待复审/DECLARED已申报/CUSTOMS_REJECT海关退单/RELEASED放行/INSPECT查验/CANCELLING撤销中/CANCELLED已撤销',
  customs_status VARCHAR(10) DEFAULT NULL COMMENT '海关回执状态码(120电子放行/300退单等)',
  ret_msg        VARCHAR(1000) DEFAULT NULL COMMENT '回执/退单原因',
  tax_total      DECIMAL(18,4) DEFAULT NULL COMMENT '综合税总额',
  declare_time   DATETIME DEFAULT NULL,
  release_time   DATETIME DEFAULT NULL COMMENT '放行时间',
  channel        VARCHAR(20) DEFAULT 'DIRECT' COMMENT '申报通道:DIRECT自建直连/THIRD第三方',
  summary_id     BIGINT UNSIGNED DEFAULT NULL COMMENT '集报汇总ID(汇总后回填)',
  bond_invt_no   VARCHAR(60) DEFAULT NULL COMMENT '关联核注清单号(出区核减)',
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_order (order_id),
  KEY idx_invt_no (invt_no),
  KEY idx_status (status),
  KEY idx_declare_time (declare_time)
) COMMENT='跨境电商零售进口申报清单(CEB621/622,报文号以海关最新规范为准)';

CREATE TABLE ceb_inventory_item (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  inventory_id  BIGINT UNSIGNED NOT NULL,
  seq_no        INT NOT NULL,
  ems_item_no   INT DEFAULT NULL COMMENT '账册备案序号',
  sku           VARCHAR(60) DEFAULT NULL,
  hs_code       VARCHAR(10) NOT NULL,
  product_name  VARCHAR(255) NOT NULL,
  spec_model    VARCHAR(255) DEFAULT NULL,
  origin_country VARCHAR(3) DEFAULT NULL,
  unit          VARCHAR(10) NOT NULL,
  qty           DECIMAL(18,5) NOT NULL,
  unit_price    DECIMAL(18,4) NOT NULL,
  total_price   DECIMAL(18,4) NOT NULL,
  vat_rate      DECIMAL(8,4) DEFAULT NULL,
  consump_rate  DECIMAL(8,4) DEFAULT NULL,
  tax_amount    DECIMAL(18,4) DEFAULT NULL COMMENT '本行综合税',
  PRIMARY KEY (id),
  KEY idx_inventory (inventory_id)
) COMMENT='申报清单表体';

CREATE TABLE ceb_refund (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  refund_no     VARCHAR(60) NOT NULL COMMENT '退货单号(内部)',
  inventory_id  BIGINT UNSIGNED NOT NULL COMMENT '原清单',
  order_no      VARCHAR(60) NOT NULL,
  reason        VARCHAR(500) DEFAULT NULL COMMENT '退货原因',
  refund_type   VARCHAR(20) NOT NULL DEFAULT 'RETURN_AREA' COMMENT 'RETURN_AREA退回区内/REJECT拒收/ABANDON放弃',
  apply_time    DATETIME DEFAULT NULL COMMENT '申请时间(校验原清单放行30日内,天数取 sys_param.REFUND_DAYS)',
  status        VARCHAR(30) NOT NULL DEFAULT 'APPLIED' COMMENT 'APPLIED已申请/DECLARED退货清单已申报/CUSTOMS_REJECT退单/APPROVED海关通过/INBOUND已入区理货/RESTOCKED账册已核增/TAX_REVERSED税款已冲减/CLOSED完结',
  declare_time  DATETIME DEFAULT NULL,
  ret_msg       VARCHAR(500) DEFAULT NULL,
  inbound_time  DATETIME DEFAULT NULL COMMENT '入区理货时间',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_refund_no (refund_no),
  KEY idx_inventory (inventory_id)
) COMMENT='退货管理(CEB625/626)';

CREATE TABLE ceb_summary (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  summary_no   VARCHAR(60) NOT NULL COMMENT '汇总单号',
  ems_no       VARCHAR(30) NOT NULL,
  period       VARCHAR(7)  NOT NULL COMMENT '汇总周期,如 2026-07',
  invt_count   INT NOT NULL DEFAULT 0 COMMENT '汇总清单票数',
  decl_id      BIGINT UNSIGNED DEFAULT NULL COMMENT '生成的汇总报关单ID',
  status       VARCHAR(20) NOT NULL DEFAULT 'DRAFT' COMMENT 'DRAFT汇总中/CONFIRMED已确认/DECL_CREATED已生成报关单/DECLARED已申报/FINISHED结关',
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_summary_no (summary_no),
  KEY idx_period (ems_no, period)
) COMMENT='集报清单汇总(先清单放行后汇总报关)';

-- =====================================================================
-- 七、核注清单 / 核放单 / 报关单
-- =====================================================================

CREATE TABLE bond_invt_head (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  internal_no   VARCHAR(60) DEFAULT NULL COMMENT '企业内部编号',
  pre_no        VARCHAR(60) DEFAULT NULL COMMENT '预录入统一编号',
  bond_invt_no  VARCHAR(60) DEFAULT NULL COMMENT '核注清单编号(海关回填)',
  ems_id        BIGINT UNSIGNED NOT NULL,
  ems_no        VARCHAR(30) NOT NULL,
  flow_type     VARCHAR(10) NOT NULL COMMENT 'IN一线入区/OUT二线出区/TRANSFER区间流转',
  mtpck_endprd  VARCHAR(10) DEFAULT NULL COMMENT '料件成品标记:I料件/E成品',
  trade_mode    VARCHAR(4)  NOT NULL DEFAULT '1210' COMMENT '监管方式',
  invt_type     VARCHAR(10) DEFAULT NULL COMMENT '清单类型(金二代码)',
  rlt_invt_nos  TEXT COMMENT '关联零售清单号集合(出区汇总,逗号分隔或另建关联表)',
  status        VARCHAR(30) NOT NULL DEFAULT 'DRAFT' COMMENT 'DRAFT录入/AUDIT1待初审/AUDIT2待复审/DECLARED已申报/PRE_APPROVED预审批通过/APPROVED审批通过/REJECTED退单/DELETED作废',
  declare_time  DATETIME DEFAULT NULL,
  ret_msg       VARCHAR(500) DEFAULT NULL,
  created_by    VARCHAR(50) DEFAULT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ems (ems_id),
  KEY idx_bond_invt_no (bond_invt_no),
  KEY idx_status (status)
) COMMENT='核注清单表头';

CREATE TABLE bond_invt_item (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  head_id       BIGINT UNSIGNED NOT NULL,
  seq_no        INT NOT NULL,
  ems_item_no   INT NOT NULL COMMENT '账册备案序号',
  hs_code       VARCHAR(10) NOT NULL,
  product_name  VARCHAR(255) NOT NULL,
  unit          VARCHAR(10) NOT NULL,
  qty           DECIMAL(18,5) NOT NULL,
  unit_price    DECIMAL(18,4) DEFAULT NULL,
  total_price   DECIMAL(18,4) DEFAULT NULL,
  currency      VARCHAR(3) DEFAULT '142',
  PRIMARY KEY (id),
  KEY idx_head (head_id)
) COMMENT='核注清单表体';

CREATE TABLE passport_head (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  internal_no   VARCHAR(60) DEFAULT NULL,
  passport_no   VARCHAR(60) DEFAULT NULL COMMENT '核放单编号(海关回填)',
  passport_type VARCHAR(20) NOT NULL COMMENT 'IN一线入区/OUT二线出区/TRANSFER区间流转/BATCH分送集报',
  ems_no        VARCHAR(30) NOT NULL,
  bond_invt_id  BIGINT UNSIGNED DEFAULT NULL COMMENT '关联核注清单(一车一单场景)',
  vehicle_no    VARCHAR(20) DEFAULT NULL COMMENT '车牌号',
  vehicle_ic    VARCHAR(30) DEFAULT NULL COMMENT '车辆IC卡号',
  container_no  VARCHAR(20) DEFAULT NULL COMMENT '集装箱号',
  gross_weight  DECIMAL(18,5) DEFAULT NULL,
  status        VARCHAR(30) NOT NULL DEFAULT 'DRAFT' COMMENT 'DRAFT录入/DECLARED已申报/APPROVED审批通过/GATE_IN已过卡入/GATE_OUT已过卡出/CANCELLED作废/ABNORMAL卡口异常',
  gate_time     DATETIME DEFAULT NULL COMMENT '过卡时间',
  abnormal_msg  VARCHAR(500) DEFAULT NULL COMMENT '卡口异常说明',
  declare_time  DATETIME DEFAULT NULL,
  created_by    VARCHAR(50) DEFAULT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_passport_no (passport_no),
  KEY idx_status (status)
) COMMENT='核放单';

CREATE TABLE decl_head (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  internal_no   VARCHAR(60) DEFAULT NULL,
  pre_no        VARCHAR(60) DEFAULT NULL,
  entry_no      VARCHAR(30) DEFAULT NULL COMMENT '报关单号(海关回填)',
  decl_type     VARCHAR(20) NOT NULL COMMENT 'FIRST_IN一线进境备货/SUMMARY集报汇总',
  trade_mode    VARCHAR(4)  NOT NULL DEFAULT '1210',
  ems_no        VARCHAR(30) DEFAULT NULL,
  bond_invt_no  VARCHAR(60) DEFAULT NULL COMMENT '关联核注清单号',
  customs_code  VARCHAR(4)  DEFAULT NULL COMMENT '申报关别',
  transport     VARCHAR(2)  DEFAULT NULL COMMENT '运输方式',
  bill_no       VARCHAR(60) DEFAULT NULL COMMENT '提运单号',
  trade_country VARCHAR(3)  DEFAULT NULL COMMENT '贸易国别',
  status        VARCHAR(30) NOT NULL DEFAULT 'DRAFT' COMMENT 'DRAFT录入/AUDIT待审核/DECLARED已申报/EXAMINE查验/TAXED已征税/RELEASED放行/FINISHED结关/REJECTED退单',
  declare_time  DATETIME DEFAULT NULL,
  release_time  DATETIME DEFAULT NULL,
  ret_msg       VARCHAR(500) DEFAULT NULL,
  created_by    VARCHAR(50) DEFAULT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_entry_no (entry_no),
  KEY idx_status (status)
) COMMENT='报关单(一线备货/集报汇总)';

CREATE TABLE decl_item (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  head_id       BIGINT UNSIGNED NOT NULL,
  seq_no        INT NOT NULL,
  ems_item_no   INT DEFAULT NULL,
  hs_code       VARCHAR(10) NOT NULL,
  product_name  VARCHAR(255) NOT NULL,
  spec_model    VARCHAR(255) DEFAULT NULL,
  unit          VARCHAR(10) NOT NULL,
  qty           DECIMAL(18,5) NOT NULL,
  unit_price    DECIMAL(18,4) NOT NULL COMMENT '申报单价(表体单价维护)',
  total_price   DECIMAL(18,4) NOT NULL,
  currency      VARCHAR(3) DEFAULT '142',
  origin_country VARCHAR(3) DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_head (head_id)
) COMMENT='报关单表体';

CREATE TABLE doc_attachment (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  biz_type   VARCHAR(30) NOT NULL COMMENT '业务类型:DECL报关单/EMS账册/CONTRACT合同/CUSTOMER客户...',
  biz_id     BIGINT UNSIGNED NOT NULL,
  file_name  VARCHAR(200) NOT NULL,
  file_path  VARCHAR(300) NOT NULL,
  file_type  VARCHAR(30) DEFAULT NULL COMMENT '单证类型:INVOICE发票/PACKING箱单/BILL提运单/CO原产地证...',
  uploaded_by VARCHAR(50) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_biz (biz_type, biz_id)
) COMMENT='单证附件归档';

-- =====================================================================
-- 八、税费与担保额度
-- =====================================================================

CREATE TABLE tax_bill (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  inventory_id  BIGINT UNSIGNED NOT NULL,
  invt_no       VARCHAR(60) DEFAULT NULL,
  order_no      VARCHAR(60) NOT NULL,
  customs_tax_no VARCHAR(60) DEFAULT NULL COMMENT '海关电子税单号',
  vat           DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '增值税(×0.7后)',
  consump_tax   DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '消费税(×0.7后)',
  total_tax     DECIMAL(18,4) NOT NULL DEFAULT 0,
  calc_tax      DECIMAL(18,4) DEFAULT NULL COMMENT '系统试算税额(与海关回执核对)',
  diff_flag     TINYINT(1) NOT NULL DEFAULT 0 COMMENT '试算与回执不一致标记',
  status        VARCHAR(20) NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING待缴/PAID已汇缴/REVERSED已冲减(退货)',
  paid_time     DATETIME DEFAULT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_inventory (inventory_id),
  KEY idx_status (status)
) COMMENT='税单(逐单综合税)';

CREATE TABLE guarantee_account (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  account_name VARCHAR(100) NOT NULL COMMENT '担保账户名(通常=区内企业/申报单位)',
  total_amount DECIMAL(18,4) NOT NULL COMMENT '总担保额度',
  used_amount  DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '已占用',
  warn_ratio   DECIMAL(5,4)  NOT NULL DEFAULT 0.8 COMMENT '预警比例',
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) COMMENT='税款担保账户';

CREATE TABLE guarantee_ledger (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  account_id   BIGINT UNSIGNED NOT NULL,
  biz_type     VARCHAR(20) NOT NULL COMMENT 'OCCUPY清单放行占用/RELEASE汇缴释放/REFUND退货释放/ADJUST调整',
  biz_no       VARCHAR(60) DEFAULT NULL COMMENT '关联单据(清单号/税单号)',
  amount       DECIMAL(18,4) NOT NULL COMMENT '正占用负释放',
  balance      DECIMAL(18,4) NOT NULL COMMENT '记账后已占用余额',
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_account (account_id),
  KEY idx_biz (biz_type, biz_no)
) COMMENT='担保额度占用/释放流水';

-- =====================================================================
-- 九、接口平台与 WMS 协同
-- =====================================================================

CREATE TABLE channel_config (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  channel_code VARCHAR(20) NOT NULL COMMENT 'DIRECT自建直连/THIRD_xxx第三方通道',
  channel_name VARCHAR(100) NOT NULL,
  msg_types    VARCHAR(200) DEFAULT NULL COMMENT '支持的报文类型:CEB311,CEB621,INVT,SAS...',
  endpoint     VARCHAR(300) DEFAULT NULL COMMENT '接口地址',
  sign_config  TEXT COMMENT '加签配置(IC卡/证书,JSON)',
  is_default   TINYINT(1) NOT NULL DEFAULT 0,
  enabled      TINYINT(1) NOT NULL DEFAULT 1,
  remark       VARCHAR(200) DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_channel (channel_code)
) COMMENT='申报通道配置(双轨可切换)';

CREATE TABLE msg_log (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  direction   VARCHAR(4)  NOT NULL COMMENT 'SEND发送/RECV接收',
  channel     VARCHAR(20) DEFAULT NULL COMMENT '通道',
  msg_type    VARCHAR(20) NOT NULL COMMENT '报文类型:CEB311/CEB312/CEB621/CEB625/INVT101...',
  biz_no      VARCHAR(60) DEFAULT NULL COMMENT '关联业务单号',
  msg_id      VARCHAR(64) DEFAULT NULL COMMENT '报文唯一编号',
  content     LONGTEXT COMMENT '报文原文(留存≥3年)',
  status      VARCHAR(20) NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING待发/SENT已发/ACKED已回执/FAIL失败',
  retry_count INT NOT NULL DEFAULT 0,
  error_msg   VARCHAR(1000) DEFAULT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_biz (msg_type, biz_no),
  KEY idx_status (status),
  KEY idx_created (created_at)
) COMMENT='报文收发日志(失败重发)';

CREATE TABLE wms_inbound (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  inbound_no  VARCHAR(60) NOT NULL COMMENT '入库单号',
  ems_no      VARCHAR(30) DEFAULT NULL,
  decl_id     BIGINT UNSIGNED DEFAULT NULL COMMENT '关联一线报关单',
  refund_id   BIGINT UNSIGNED DEFAULT NULL COMMENT '关联退货单',
  biz_type    VARCHAR(20) NOT NULL DEFAULT 'FIRST_IN' COMMENT 'FIRST_IN备货入区/REFUND退货入区',
  status      VARCHAR(20) NOT NULL DEFAULT 'CREATED' COMMENT 'CREATED已创建/TALLYING理货中/FINISHED理货完成/DIFF理货差异',
  tally_result TEXT COMMENT '理货结果(JSON:sku,应收,实收,差异)',
  finished_at DATETIME DEFAULT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_inbound_no (inbound_no)
) COMMENT='WMS入库单(接口同步)';

CREATE TABLE wms_outbound (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  outbound_no  VARCHAR(60) NOT NULL,
  inventory_id BIGINT UNSIGNED DEFAULT NULL COMMENT '关联放行清单',
  order_no     VARCHAR(60) DEFAULT NULL,
  status       VARCHAR(20) NOT NULL DEFAULT 'INSTRUCTED' COMMENT 'INSTRUCTED已下发指令/PICKED已拣货/PACKED已打包/SHIPPED已交接快递',
  shipped_at   DATETIME DEFAULT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_outbound_no (outbound_no),
  KEY idx_inventory (inventory_id)
) COMMENT='WMS出库单(清单放行后自动下发)';

CREATE TABLE wms_stock_snapshot (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  snap_date   DATE NOT NULL,
  ems_no      VARCHAR(30) DEFAULT NULL,
  sku         VARCHAR(60) NOT NULL,
  ems_item_no INT DEFAULT NULL,
  qty         DECIMAL(18,5) NOT NULL COMMENT 'WMS实物库存',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_snap (snap_date, sku),
  KEY idx_ems (ems_no, ems_item_no)
) COMMENT='WMS库存日快照(三账比对数据源)';

CREATE TABLE stock_diff_report (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  report_date DATE NOT NULL,
  ems_no      VARCHAR(30) NOT NULL,
  ems_item_no INT NOT NULL,
  sku         VARCHAR(60) DEFAULT NULL,
  qty_ems     DECIMAL(18,5) NOT NULL COMMENT '关务账册结余',
  qty_wms     DECIMAL(18,5) NOT NULL COMMENT 'WMS实物库存',
  qty_client  DECIMAL(18,5) DEFAULT NULL COMMENT '客户系统库存',
  diff_flag   TINYINT(1) NOT NULL DEFAULT 0,
  handle_status VARCHAR(20) DEFAULT 'PENDING' COMMENT 'PENDING待处理/HANDLING处理中/CLOSED已结案',
  handle_note VARCHAR(500) DEFAULT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_report (report_date, ems_no, ems_item_no)
) COMMENT='三账比对差异报表';

-- =====================================================================
-- 十、报核核销与盘点
-- =====================================================================

CREATE TABLE ems_verification (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  verify_no    VARCHAR(60) NOT NULL COMMENT '报核单号',
  ems_id       BIGINT UNSIGNED NOT NULL,
  ems_no       VARCHAR(30) NOT NULL,
  period_from  DATE NOT NULL,
  period_to    DATE NOT NULL,
  diff_data    TEXT COMMENT '差异表(JSON:序号,账面,实际,差异,处理方式)',
  status       VARCHAR(30) NOT NULL DEFAULT 'DRAFT' COMMENT 'DRAFT编制中/DECLARED已报核/APPROVED海关通过/CLOSED核销结案/REJECTED退回',
  declare_time DATETIME DEFAULT NULL,
  close_time   DATETIME DEFAULT NULL,
  created_by   VARCHAR(50) DEFAULT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_verify_no (verify_no),
  KEY idx_ems (ems_id)
) COMMENT='账册周期报核/核销';

CREATE TABLE stocktake (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  take_no     VARCHAR(60) NOT NULL COMMENT '盘点单号',
  ems_no      VARCHAR(30) NOT NULL,
  take_date   DATE NOT NULL,
  result_data TEXT COMMENT '盘点明细(JSON:序号,账面数,实盘数,盈亏)',
  status      VARCHAR(20) NOT NULL DEFAULT 'DRAFT' COMMENT 'DRAFT进行中/CONFIRMED已确认/ADJUSTED已调整账册(盘盈盘亏补税/核增核减)',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_take_no (take_no)
) COMMENT='盘点管理';

-- =====================================================================
-- 初始化数据
-- =====================================================================

INSERT INTO sys_param (param_key, param_value, param_desc) VALUES
 ('LIMIT_SINGLE',        '5000',  '跨境电商零售进口单次交易限值(元)'),
 ('LIMIT_ANNUAL',        '26000', '个人年度交易限值(元)'),
 ('TAX_DISCOUNT',        '0.7',   '综合税征收折扣系数'),
 ('REFUND_DAYS',         '30',    '退货申请期限(自清单放行日起,天)'),
 ('EMS_EXPIRE_WARN_DAYS','60',    '账册到期预警提前天数'),
 ('PRICE_DIFF_RATIO',    '0.3',   '订单价格与备案价偏离预警阈值');

INSERT INTO sys_role (role_code, role_name) VALUES
 ('ADMIN','系统管理员'),('ENTRY','关务录入员'),('AUDIT1','关务初审员'),
 ('AUDIT2','关务复审员'),('FINANCE','财务'),('CUSTOMER','客户用户'),('WAREHOUSE','仓库操作员');

INSERT INTO base_code (code_type, code, name) VALUES
 ('TRADE_MODE','1210','保税跨境贸易电子商务'),
 ('TRANSPORT','2','水路运输'),('TRANSPORT','4','公路运输'),('TRANSPORT','5','航空运输'),
 ('CURRENCY','142','人民币'),('CURRENCY','502','美元'),('CURRENCY','300','欧元'),
 ('UNIT','007','个'),('UNIT','011','件'),('UNIT','035','千克'),('UNIT','122','盒'),('UNIT','142','瓶'),
 ('COUNTRY','142','中国'),('COUNTRY','502','美国'),('COUNTRY','116','日本'),('COUNTRY','133','韩国'),
 ('COUNTRY','303','法国'),('COUNTRY','304','德国'),('COUNTRY','601','澳大利亚'),('COUNTRY','609','新西兰');

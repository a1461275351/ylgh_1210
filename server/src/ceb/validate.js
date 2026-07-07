// T08 申报前校验:在清单申报前拦截问题订单,降低海关退单率。
// 校验项:商品备案、正面清单、账册余量、单次限值、年度个人额度、价格异常。
const db = require('../db');
const { param } = require('../util');

// 查某账册序号当前结余
function stockBalance(emsNo, itemNo) {
  const ems = db.prepare(`SELECT id FROM ems_header WHERE ems_no = ?`).get(emsNo);
  if (!ems) return null;
  const row = db.prepare(
    `SELECT balance FROM ems_stock_ledger WHERE ems_id = ? AND item_no = ? ORDER BY id DESC LIMIT 1`)
    .get(ems.id, itemNo);
  return row ? Number(row.balance) : 0;
}

// 购买人当年放行累计(个人年度额度)
function annualUsed(buyerIdNo) {
  const year = new Date().getFullYear();
  const row = db.prepare(
    `SELECT COALESCE(SUM(goods_amount),0) AS used FROM ceb_inventory
     WHERE buyer_id_no = ? AND status = 'RELEASED' AND substr(declare_time,1,4) = ?`)
    .get(buyerIdNo, String(year));
  return Number(row.used) || 0;
}

// 返回 { pass, level, issues:[{code,level,msg}] }。level: OK / WARN / FAIL
function validateOrder(order, items) {
  const issues = [];
  const limitSingle = Number(param('LIMIT_SINGLE', '5000'));
  const limitAnnual = Number(param('LIMIT_ANNUAL', '26000'));
  const priceRatio = Number(param('PRICE_DIFF_RATIO', '0.3'));

  // 身份证格式
  if (!/^\d{17}[\dХxX]$/.test(String(order.buyer_id_no || ''))) {
    issues.push({ code: 'ID_FORMAT', level: 'FAIL', msg: '订购人身份证号格式不正确' });
  }

  for (const it of items) {
    const prod = db.prepare(`SELECT * FROM goods_product WHERE customer_id = ? AND sku = ?`)
      .get(order.ebc_customer_id, it.sku);
    if (!prod) {
      issues.push({ code: 'NOT_RECORDED', level: 'FAIL', msg: `商品 ${it.sku} 未备案` });
      continue;
    }
    if (prod.status !== 'APPROVED') {
      issues.push({ code: 'RECORD_UNAPPROVED', level: 'FAIL', msg: `商品 ${it.sku} 备案未通过` });
    }
    // 正面清单
    const hs = db.prepare(`SELECT * FROM goods_hs_tax WHERE hs_code = ?`).get(prod.hs_code);
    if (!hs || !hs.in_positive_list) {
      issues.push({ code: 'NOT_IN_LIST', level: 'FAIL', msg: `商品 ${it.sku}(HS ${prod.hs_code})不在跨境电商零售进口正面清单内` });
    }
    // 账册余量
    const rel = db.prepare(`SELECT * FROM goods_ems_rel WHERE product_id = ? AND enabled = 1`).get(prod.id);
    if (!rel) {
      issues.push({ code: 'NO_EMS_REL', level: 'FAIL', msg: `商品 ${it.sku} 未绑定账册备案序号` });
    } else {
      const bal = stockBalance(rel.ems_no, rel.item_no);
      if (bal === null) {
        issues.push({ code: 'EMS_MISSING', level: 'FAIL', msg: `账册 ${rel.ems_no} 不存在` });
      } else if (bal < Number(it.qty)) {
        issues.push({ code: 'STOCK_SHORT', level: 'FAIL', msg: `商品 ${it.sku} 账册余量不足(余 ${bal},需 ${it.qty})` });
      }
    }
    // 价格异常(仅预警)
    if (prod.declare_price > 0) {
      const diff = Math.abs(Number(it.unit_price) - prod.declare_price) / prod.declare_price;
      if (diff > priceRatio) {
        issues.push({ code: 'PRICE_DIFF', level: 'WARN', msg: `商品 ${it.sku} 单价 ${it.unit_price} 与备案价 ${prod.declare_price} 偏离 ${(diff * 100).toFixed(0)}%` });
      }
    }
  }

  // 单次限值
  const orderValue = Number(order.goods_amount) || 0;
  if (orderValue > limitSingle) {
    issues.push({ code: 'OVER_SINGLE', level: 'FAIL', msg: `订单金额 ${orderValue} 超单次限值 ${limitSingle} 元` });
  }
  // 年度额度
  const used = annualUsed(order.buyer_id_no);
  if (used + orderValue > limitAnnual) {
    issues.push({ code: 'OVER_ANNUAL', level: 'FAIL', msg: `购买人年度额度超限(已用 ${used} + 本单 ${orderValue} > ${limitAnnual})` });
  }

  const hasFail = issues.some(i => i.level === 'FAIL');
  const hasWarn = issues.some(i => i.level === 'WARN');
  return { pass: !hasFail, level: hasFail ? 'FAIL' : (hasWarn ? 'WARN' : 'OK'), issues };
}

module.exports = { validateOrder, stockBalance, annualUsed };

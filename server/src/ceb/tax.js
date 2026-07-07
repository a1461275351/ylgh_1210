// 跨境电商零售进口综合税试算
// 综合税 = 完税价格 × (增值税率 + 消费税率) / (1 − 消费税率) × 折扣系数(通常 0.7)
// 消费税为 0 时简化为:完税价格 × 增值税率 × 折扣系数
function calcItemTax(taxable, vatRate, consumpRate, discount) {
  const vat = Number(vatRate) || 0;
  const con = Number(consumpRate) || 0;
  const dis = Number(discount);
  const combined = (vat + con) / (1 - con);
  return +(Number(taxable) * combined * dis).toFixed(4);
}

module.exports = { calcItemTax };

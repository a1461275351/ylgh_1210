// 加签插槽:对报文体做数字签名。
// 原型:mock 签名(SHA-256 摘要占位),不具法律效力,仅用于打通链路与验证流程。
// 生产:替换为电子口岸 IC 卡/证书加签(国密 SM2/SM3 或 RSA),通过读卡客户端/签名中间件完成。
const crypto = require('crypto');

// 返回 { signValue, certNo, algo }
function sign(xml, signConfig) {
  const cfg = signConfig || {};
  if (cfg.mode === 'DIRECT_CARD') {
    // 生产占位:此处应调用电子口岸卡签名服务
    throw new Error('电子口岸卡加签服务未接入(待联调):请配置读卡客户端/签名中间件');
  }
  // 原型 mock
  const digest = crypto.createHash('sha256').update(xml, 'utf8').digest('base64');
  return { signValue: digest, certNo: 'MOCK-CERT-0001', algo: 'SHA256-MOCK' };
}

module.exports = { sign };

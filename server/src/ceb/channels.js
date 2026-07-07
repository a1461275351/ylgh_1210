// 通道适配层:统一 send(msgType, xml, ctx) 接口,屏蔽底层差异。
//   SIMULATOR 回执模拟器(原型):按规则返回放行/退单
//   DIRECT    单一窗口自建直连(生产目标,已有电子口岸卡,待联调补 endpoint)
//   THIRD     第三方通关服务商通道(备用/灾备)
const db = require('../db');
const { document, fields } = require('./xml');
const { param } = require('../util');

// 组装 CEB622 清单申报回执(模拟器产出)
function buildCEB622(inv, guid, status, note) {
  const root = {
    tag: 'ceb:CEB622Message',
    attrs: { 'xmlns:ceb': 'http://www.chinaport.gov.cn/ceb', version: '1.0', guid },
    children: [{
      tag: 'ceb:InventoryReturn',
      children: fields({
        guid,
        invtNo: inv.invt_no,
        orderNo: inv.order_no,
        returnStatus: status,     // 120-放行 / 300-退单(示意)
        returnInfo: note,
        returnTime: undefined,
      }),
    }],
  };
  return document(root);
}

// 模拟器审结规则:超单次限值 / 缺购买人证件 / HS 以 999 开头(示意不在正面清单)→ 退单;否则放行
function simulatorJudge(inv, items) {
  const limitSingle = Number(param('LIMIT_SINGLE', '5000'));
  const orderValue = (Number(inv.goods_amount) || 0) + (Number(inv.freight) || 0);
  if (!inv.buyer_id_no) return { pass: false, note: '退单:缺少订购人证件号,三单信息不完整' };
  if (orderValue > limitSingle) return { pass: false, note: `退单:订单金额 ${orderValue} 超单次限值 ${limitSingle} 元` };
  const bad = items.find(it => String(it.hs_code || '').startsWith('999'));
  if (bad) return { pass: false, note: `退单:商品 ${bad.product_name} 不在跨境电商零售进口正面清单内` };
  return { pass: true, note: '海关电子放行' };
}

// 返回 { customsStatus, retMsg, invtNo, releaseTime, replyType, replyXml }
function send(channelCode, msgType, xml, ctx) {
  const ch = db.prepare(`SELECT * FROM channel_config WHERE channel_code = ?`).get(channelCode);
  if (!ch) throw new Error(`通道 ${channelCode} 不存在`);
  if (!ch.enabled) throw new Error(`通道 ${ch.channel_name} 已停用`);

  if (channelCode === 'SIMULATOR') {
    const { inv, items } = ctx;
    const invtNo = inv.invt_no || ('I' + String(inv.id).padStart(12, '0'));
    const j = simulatorJudge({ ...inv, invt_no: invtNo }, items);
    const customsStatus = j.pass ? '120' : '300';
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const replyXml = buildCEB622({ ...inv, invt_no: invtNo }, ctx.guid, customsStatus, j.note);
    return {
      customsStatus, retMsg: j.note, invtNo,
      releaseTime: j.pass ? now : null,
      replyType: 'CEB622', replyXml,
    };
  }

  if (channelCode === 'DIRECT') {
    if (!ch.endpoint) throw new Error('直连通道尚未配置 endpoint(待海关测试环境联调);当前请使用模拟器通道');
    throw new Error('直连通道适配器待联调实现');
  }
  if (channelCode === 'THIRD') {
    if (!ch.endpoint) throw new Error('第三方通道尚未配置 endpoint');
    throw new Error('第三方通道适配器待对接实现');
  }
  throw new Error(`未知通道 ${channelCode}`);
}

// 选择可用通道:优先指定,否则取启用且 is_default
function pickChannel(preferred) {
  if (preferred) {
    const c = db.prepare(`SELECT * FROM channel_config WHERE channel_code = ? AND enabled = 1`).get(preferred);
    if (c) return c.channel_code;
  }
  const d = db.prepare(`SELECT * FROM channel_config WHERE enabled = 1 ORDER BY is_default DESC, id ASC`).get();
  if (!d) throw new Error('无可用申报通道');
  return d.channel_code;
}

module.exports = { send, pickChannel };

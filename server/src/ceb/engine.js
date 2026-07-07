// 申报引擎:编排"组装报文 → 加签 → 落日志 → 通道发送 → 接回执 → 更新单据状态"
// 供清单/核注/核放等所有申报动作复用。当前实现:清单(CEB621)申报。
const db = require('../db');
const { genNo, opLog } = require('../util');
const { buildCEB621 } = require('./messages');
const { sign } = require('./sign');
const channels = require('./channels');

// 允许申报的清单状态
const DECLARABLE = ['DRAFT', 'AUDIT2', 'CUSTOMS_REJECT'];

function loadInventory(id) {
  const inv = db.prepare(`SELECT * FROM ceb_inventory WHERE id = ?`).get(id);
  if (!inv) return null;
  inv.items = db.prepare(`SELECT * FROM ceb_inventory_item WHERE inventory_id = ? ORDER BY seq_no`).all(id);
  return inv;
}

// 申报一张清单;req 用于审计;preferredChannel 可选
function declareInventory(id, req, preferredChannel) {
  const inv = loadInventory(id);
  if (!inv) throw new Error('清单不存在');
  if (!DECLARABLE.includes(inv.status)) throw new Error(`当前状态 ${inv.status} 不允许申报`);

  const channel = channels.pickChannel(preferredChannel || inv.channel);
  const guid = genNo('G');
  if (!inv.declare_time) inv.declare_time = new Date().toISOString().slice(0, 19).replace('T', ' ');

  // 1. 组装 CEB621
  const xml = buildCEB621(inv, inv.items, guid);

  // 2. 加签(原型 mock;生产电子口岸卡)
  const ch = db.prepare(`SELECT * FROM channel_config WHERE channel_code = ?`).get(channel);
  let signInfo;
  try {
    signInfo = sign(xml, ch.sign_config ? JSON.parse(ch.sign_config) : null);
  } catch (e) {
    logMsg('SEND', channel, 'CEB621', inv.order_no, guid, xml, 'FAIL', e.message);
    throw e;
  }

  // 3. 落发送日志
  const sendLogId = logMsg('SEND', channel, 'CEB621', inv.order_no, guid,
    xml + `\n<!-- sign: ${signInfo.algo} ${signInfo.certNo} -->`, 'SENT', null);

  // 4. 通道发送 + 接回执
  let reply;
  try {
    reply = channels.send(channel, 'CEB621', xml, { inv, items: inv.items, guid });
  } catch (e) {
    db.prepare(`UPDATE msg_log SET status='FAIL', error_msg=?, updated_at=datetime('now','localtime') WHERE id=?`)
      .run(e.message, sendLogId);
    throw e;
  }
  db.prepare(`UPDATE msg_log SET status='ACKED', updated_at=datetime('now','localtime') WHERE id=?`).run(sendLogId);

  // 5. 落回执日志
  logMsg('RECV', channel, reply.replyType, inv.order_no, guid, reply.replyXml, 'ACKED', null);

  // 6. 更新清单状态
  const released = reply.customsStatus === '120';
  const newStatus = released ? 'RELEASED' : 'CUSTOMS_REJECT';
  db.prepare(`UPDATE ceb_inventory SET
      status=?, customs_status=?, ret_msg=?, invt_no=?, channel=?,
      declare_time=?, release_time=?, updated_at=datetime('now','localtime')
      WHERE id=?`)
    .run(newStatus, reply.customsStatus, reply.retMsg, reply.invtNo, channel,
         inv.declare_time, reply.releaseTime, id);

  if (req) opLog(req, 'DECLARE', 'INVENTORY', id, { channel, customsStatus: reply.customsStatus, invtNo: reply.invtNo });

  return { id, channel, status: newStatus, customsStatus: reply.customsStatus, invtNo: reply.invtNo, retMsg: reply.retMsg };
}

function logMsg(direction, channel, msgType, bizNo, msgId, content, status, errorMsg) {
  const r = db.prepare(`INSERT INTO msg_log (direction, channel, msg_type, biz_no, msg_id, content, status, error_msg)
      VALUES (?,?,?,?,?,?,?,?)`).run(direction, channel, msgType, bizNo, msgId, content, status, errorMsg);
  return Number(r.lastInsertRowid);
}

module.exports = { declareInventory, loadInventory };

// T14 退货管理:30日校验 → 退货清单申报 → 入区理货(账册核增)→ 税款冲减+额度释放
const router = require('express').Router();
const db = require('../db');
const { ok, fail, page, genNo, opLog, param } = require('../util');
const finance = require('../ceb/finance');

const STATUS_LABEL = {
  APPLIED: '已申请', DECLARED: '退货清单已申报', APPROVED: '海关通过',
  RESTOCKED: '账册已核增', CLOSED: '完结', REJECTED: '退单',
};
const TYPE_LABEL = { RETURN_AREA: '退回区内', REJECT: '拒收', ABANDON: '放弃' };

function daysBetween(fromStr) {
  if (!fromStr) return 9999;
  const from = new Date(fromStr.replace(' ', 'T'));
  return Math.floor((Date.now() - from.getTime()) / 86400000);
}

router.get('/', (req, res) => {
  const { offset, pageSize, page: p } = page(req);
  const where = [], args = [];
  if (req.query.orderNo) { where.push(`order_no LIKE ?`); args.push(`%${req.query.orderNo}%`); }
  if (req.query.status)  { where.push(`status=?`);       args.push(req.query.status); }
  const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { c: total } = db.prepare(`SELECT COUNT(*) AS c FROM ceb_refund ${cond}`).get(...args);
  const list = db.prepare(`SELECT * FROM ceb_refund ${cond} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...args, pageSize, offset)
    .map(r => ({ ...r, status_label: STATUS_LABEL[r.status] || r.status, type_label: TYPE_LABEL[r.refund_type] || r.refund_type }));
  ok(res, { list, total, page: p, pageSize });
});

// 可退货的放行清单(供前端选择)
router.get('/candidates', (req, res) => {
  const days = Number(param('REFUND_DAYS', '30'));
  const rows = db.prepare(`SELECT * FROM ceb_inventory WHERE status='RELEASED' ORDER BY id DESC LIMIT 100`).all();
  const list = rows.filter(v => !db.prepare(`SELECT id FROM ceb_refund WHERE inventory_id=? AND status NOT IN ('REJECTED')`).get(v.id))
    .map(v => ({ id: v.id, order_no: v.order_no, invt_no: v.invt_no, buyer_name: v.buyer_name,
      goods_amount: v.goods_amount, release_time: v.release_time, days: daysBetween(v.release_time),
      within: daysBetween(v.release_time) <= days }));
  ok(res, { list, refundDays: days });
});

// 申请退货
router.post('/apply', (req, res) => {
  const { inventoryId, reason, refund_type } = req.body;
  const inv = db.prepare(`SELECT * FROM ceb_inventory WHERE id=?`).get(inventoryId);
  if (!inv) return fail(res, '清单不存在', 404);
  if (inv.status !== 'RELEASED') return fail(res, '仅放行清单可退货');
  const days = Number(param('REFUND_DAYS', '30'));
  const passed = daysBetween(inv.release_time);
  if (passed > days) return fail(res, `已超退货期限(放行 ${passed} 天,限 ${days} 天)`);
  const dup = db.prepare(`SELECT id FROM ceb_refund WHERE inventory_id=? AND status NOT IN ('REJECTED')`).get(inventoryId);
  if (dup) return fail(res, '该清单已有退货单');
  const r = db.prepare(`INSERT INTO ceb_refund (refund_no, inventory_id, order_no, reason, refund_type, apply_time, status)
      VALUES (?,?,?,?,?, datetime('now','localtime'), 'APPLIED')`)
    .run(genNo('TH'), inventoryId, inv.order_no, reason || null, refund_type || 'RETURN_AREA');
  db.prepare(`UPDATE ceb_order SET status='REFUNDING', updated_at=datetime('now','localtime') WHERE order_no=?`).run(inv.order_no);
  opLog(req, 'CREATE', 'REFUND', Number(r.lastInsertRowid), { order_no: inv.order_no });
  ok(res, { id: Number(r.lastInsertRowid) });
});

// 申报退货清单(模拟海关通过)
router.post('/:id/declare', (req, res) => {
  const rf = db.prepare(`SELECT * FROM ceb_refund WHERE id=?`).get(req.params.id);
  if (!rf) return fail(res, '退货单不存在', 404);
  if (rf.status !== 'APPLIED') return fail(res, `状态 ${STATUS_LABEL[rf.status]} 不能申报`);
  db.prepare(`UPDATE ceb_refund SET status='APPROVED', declare_time=datetime('now','localtime'), ret_msg='退货清单海关审核通过', updated_at=datetime('now','localtime') WHERE id=?`).run(req.params.id);
  opLog(req, 'DECLARE', 'REFUND', req.params.id, {});
  ok(res, { id: Number(req.params.id), status: 'APPROVED' });
});

// 入区理货完成:退回区内→账册核增+税款冲减+额度释放;拒收/放弃→仅冲减不核增
router.post('/:id/inbound', (req, res) => {
  const rf = db.prepare(`SELECT * FROM ceb_refund WHERE id=?`).get(req.params.id);
  if (!rf) return fail(res, '退货单不存在', 404);
  if (rf.status !== 'APPROVED') return fail(res, '仅海关通过的退货单可入区理货');
  const inv = db.prepare(`SELECT * FROM ceb_inventory WHERE id=?`).get(rf.inventory_id);

  if (rf.refund_type === 'RETURN_AREA') {
    // 账册核增(按原清单表体的账册序号)
    const ems = db.prepare(`SELECT * FROM ems_header WHERE ems_no=?`).get(inv.ems_no);
    const items = db.prepare(`SELECT * FROM ceb_inventory_item WHERE inventory_id=?`).all(inv.id);
    if (ems) {
      for (const it of items) {
        const rel = db.prepare(`SELECT ger.item_no FROM goods_ems_rel ger JOIN goods_product gp ON ger.product_id=gp.id WHERE gp.sku=?`).get(it.sku);
        if (!rel) continue;
        const last = db.prepare(`SELECT balance FROM ems_stock_ledger WHERE ems_id=? AND item_no=? ORDER BY id DESC LIMIT 1`).get(ems.id, rel.item_no);
        const bal = (last ? Number(last.balance) : 0) + Number(it.qty);
        db.prepare(`INSERT INTO ems_stock_ledger (ems_id, item_no, biz_type, biz_no, qty, balance, amount) VALUES (?,?, 'REFUND', ?, ?, ?, ?)`)
          .run(ems.id, rel.item_no, rf.refund_no, Number(it.qty), +bal.toFixed(5), it.total_price || 0);
      }
    }
  }
  // 税款冲减 + 额度释放
  finance.onRefund(inv);
  db.prepare(`UPDATE ceb_refund SET status='CLOSED', inbound_time=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE id=?`).run(req.params.id);
  db.prepare(`UPDATE ceb_inventory SET status='CANCELLED', ret_msg='已退货', updated_at=datetime('now','localtime') WHERE id=?`).run(inv.id);
  db.prepare(`UPDATE ceb_order SET status='CLOSED', updated_at=datetime('now','localtime') WHERE order_no=?`).run(rf.order_no);
  opLog(req, 'INBOUND', 'REFUND', req.params.id, { type: rf.refund_type });
  ok(res, { id: Number(req.params.id), status: 'CLOSED', restocked: rf.refund_type === 'RETURN_AREA' });
});

module.exports = router;

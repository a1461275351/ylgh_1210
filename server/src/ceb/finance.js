// T13 税费与担保额度:清单放行→生成税单+占用担保;汇缴→释放;退货→冲减税款+释放额度
const db = require('../db');

function account() {
  return db.prepare(`SELECT * FROM guarantee_account ORDER BY id LIMIT 1`).get();
}

// 从清单表体拆分增值税/消费税(税率已在表体)
function splitTax(inventoryId) {
  const items = db.prepare(`SELECT * FROM ceb_inventory_item WHERE inventory_id=?`).all(inventoryId);
  const discount = Number(db.prepare(`SELECT param_value v FROM sys_param WHERE param_key='TAX_DISCOUNT'`).get()?.v || 0.7);
  let vat = 0, consump = 0;
  for (const it of items) {
    const con = Number(it.consump_rate) || 0, vr = Number(it.vat_rate) || 0;
    const base = Number(it.total_price) / (1 - con);
    consump += base * con * discount;
    vat += base * vr * discount;
  }
  return { vat: +vat.toFixed(4), consump: +consump.toFixed(4), total: +(vat + consump).toFixed(4) };
}

// 清单放行:生成税单 + 占用担保额度(幂等:同一清单只生成一次)
function onReleased(inv) {
  const exist = db.prepare(`SELECT id FROM tax_bill WHERE inventory_id=?`).get(inv.id);
  if (exist) return;
  const t = splitTax(inv.id);
  db.prepare(`INSERT INTO tax_bill (inventory_id, invt_no, order_no, customs_tax_no, vat, consump_tax, total_tax, status)
      VALUES (?,?,?,?,?,?,?, 'PENDING')`)
    .run(inv.id, inv.invt_no, inv.order_no, 'SD' + String(inv.id).padStart(10, '0'), t.vat, t.consump, t.total);
  occupy(inv.invt_no || inv.order_no, t.total);
}

function occupy(bizNo, amount) {
  const a = account();
  if (!a || amount <= 0) return;
  const used = +(Number(a.used_amount) + amount).toFixed(4);
  db.prepare(`UPDATE guarantee_account SET used_amount=?, updated_at=datetime('now','localtime') WHERE id=?`).run(used, a.id);
  db.prepare(`INSERT INTO guarantee_ledger (account_id, biz_type, biz_no, amount, balance) VALUES (?, 'OCCUPY', ?, ?, ?)`)
    .run(a.id, bizNo, amount, used);
}

function release(bizType, bizNo, amount) {
  const a = account();
  if (!a || amount <= 0) return;
  const used = +Math.max(0, Number(a.used_amount) - amount).toFixed(4);
  db.prepare(`UPDATE guarantee_account SET used_amount=?, updated_at=datetime('now','localtime') WHERE id=?`).run(used, a.id);
  db.prepare(`INSERT INTO guarantee_ledger (account_id, biz_type, biz_no, amount, balance) VALUES (?, ?, ?, ?, ?)`)
    .run(a.id, bizType, bizNo, -amount, used);
}

// 退货:税款冲减 + 释放担保额度
function onRefund(inv) {
  const bill = db.prepare(`SELECT * FROM tax_bill WHERE inventory_id=?`).get(inv.id);
  if (bill && bill.status !== 'REVERSED') {
    db.prepare(`UPDATE tax_bill SET status='REVERSED' WHERE id=?`).run(bill.id);
    if (bill.status === 'PENDING') release('REFUND', inv.invt_no || inv.order_no, Number(bill.total_tax));
  }
}

// 月度汇缴:PENDING 税单批量缴纳 + 释放占用
function payBills(ids) {
  const results = [];
  for (const id of ids) {
    const b = db.prepare(`SELECT * FROM tax_bill WHERE id=?`).get(id);
    if (!b || b.status !== 'PENDING') { results.push({ id, ok: false }); continue; }
    db.prepare(`UPDATE tax_bill SET status='PAID', paid_time=datetime('now','localtime') WHERE id=?`).run(id);
    release('RELEASE', b.invt_no || b.order_no, Number(b.total_tax));
    results.push({ id, ok: true });
  }
  return results;
}

function summary() {
  const a = account();
  const avail = a ? +(Number(a.total_amount) - Number(a.used_amount)).toFixed(4) : 0;
  const warn = a ? Number(a.used_amount) >= Number(a.total_amount) * Number(a.warn_ratio) : false;
  return { account: a, available: avail, warn };
}

module.exports = { onReleased, onRefund, payBills, summary, account };

// CEB 报文组装。当前实现:CEB621 跨境电商零售进口清单申报。
// 结构为原型示意,字段命名贴近海关统一版,实际以最新报文规范 XSD 为准。
const { document, fields } = require('./xml');

// 组装 CEB621(清单申报),inv 为清单表头 + items 表体
function buildCEB621(inv, items, guid) {
  const head = {
    tag: 'ceb:InventoryHead',
    children: fields({
      guid,
      appType: '1',                 // 1-申报
      appTime: (inv.declare_time || '').replace(/[-: ]/g, '') || undefined,
      appStatus: '2',               // 2-新增
      orderNo: inv.order_no,
      ebcCode: inv.ebc_code,        // 电商企业代码
      ebpCode: inv.ebp_code,        // 电商平台代码
      logisticsNo: inv.logistics_no,
      invtNo: inv.invt_no || undefined,
      ieFlag: 'I',                  // I-进口
      declTime: (inv.declare_time || '').slice(0, 10).replace(/-/g, '') || undefined,
      customsCode: inv.agent_code || undefined,
      emsNo: inv.ems_no,
      buyerName: inv.buyer_name,
      buyerIdNumber: inv.buyer_id_no,   // 生产:密文/脱敏,勿传明文
      grossWeight: inv.gross_weight,
      netWeight: inv.net_weight,
      goodsValue: inv.goods_amount,
      freight: inv.freight,
      taxTotal: inv.tax_total,
      currency: '142',
    }),
  };
  const list = {
    tag: 'ceb:InventoryList',
    children: items.map((it, i) => ({
      tag: 'ceb:InventoryList',
      children: fields({
        gnum: i + 1,
        itemNo: it.sku,
        itemName: it.product_name,
        hsCode: it.hs_code,
        countryCode: it.origin_country,
        unit: it.unit,
        qty: it.qty,
        price: it.unit_price,
        totalPrice: it.total_price,
        currency: '142',
      }),
    })),
  };
  const root = {
    tag: 'ceb:CEB621Message',
    attrs: {
      'xmlns:ceb': 'http://www.chinaport.gov.cn/ceb',
      version: '1.0',
      guid,
    },
    children: [{ tag: 'ceb:Inventory', children: [head, list] }],
  };
  return document(root);
}

module.exports = { buildCEB621 };

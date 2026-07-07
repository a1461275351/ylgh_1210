// T08 支付单查询(支付企业推送状态监控)
window.PageRegistry.payment = {
  data() { return { list: [], loading: false }; },
  created() { this.load(); },
  methods: {
    async load() {
      this.loading = true;
      try {
        // 复用订单对碰监控 + 订单详情聚合;此处直接列出有支付单的订单
        const mon = await api('GET', '/api/orders/match/monitor?pageSize=200');
        const withPay = mon.list.filter(o => o.has.payment);
        const rows = [];
        for (const o of withPay) {
          const d = await api('GET', '/api/orders/' + o.id);
          if (d.payment) rows.push({ order_no: o.order_no, ...d.payment });
        }
        this.list = rows;
      } finally { this.loading = false; }
    },
  },
  template: `
<div class="page-card">
  <el-alert type="info" :closable="false" style="margin-bottom:12px" title="支付单由支付企业向海关推送,本页监控其到位与对碰状态。可在「订单管理→详情」登记支付单。"/>
  <div class="table-toolbar"><el-button :icon="'Refresh'" @click="load">刷新</el-button></div>
  <el-table :data="list" v-loading="loading" border stripe>
    <el-table-column prop="order_no" label="订单号" width="170"/>
    <el-table-column prop="pay_no" label="支付流水号" width="170"/>
    <el-table-column prop="pay_company" label="支付企业" min-width="150"/>
    <el-table-column prop="payer_name" label="支付人" width="100"/>
    <el-table-column prop="pay_amount" label="支付金额" width="110" align="right"/>
    <el-table-column label="推送状态" width="110">
      <template #default="{ row }"><el-tag size="small" type="success">{{ row.push_status }}</el-tag></template>
    </el-table-column>
    <el-table-column prop="created_at" label="登记时间" width="160"/>
  </el-table>
</div>`,
};

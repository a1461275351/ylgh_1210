// T08 运单查询(物流企业推送 + 轨迹)
window.PageRegistry.logistics = {
  data() { return { list: [], loading: false }; },
  created() { this.load(); },
  methods: {
    async load() {
      this.loading = true;
      try {
        const mon = await api('GET', '/api/orders/match/monitor?pageSize=200');
        const withLog = mon.list.filter(o => o.has.logistics);
        const rows = [];
        for (const o of withLog) {
          const d = await api('GET', '/api/orders/' + o.id);
          if (d.logistics) rows.push({ order_no: o.order_no, ...d.logistics });
        }
        this.list = rows;
      } finally { this.loading = false; }
    },
    trackLabel(s) { return { PICKED: '已揽收', EXIT: '已出区', DELIVERING: '派送中', SIGNED: '已妥投' }[s] || s; },
  },
  template: `
<div class="page-card">
  <el-alert type="info" :closable="false" style="margin-bottom:12px" title="运单由物流企业向海关推送并回传轨迹,本页监控运单到位与妥投状态。可在「订单管理→详情」登记运单。"/>
  <div class="table-toolbar"><el-button :icon="'Refresh'" @click="load">刷新</el-button></div>
  <el-table :data="list" v-loading="loading" border stripe>
    <el-table-column prop="order_no" label="订单号" width="170"/>
    <el-table-column prop="logistics_no" label="运单号" width="170"/>
    <el-table-column prop="logistics_name" label="物流企业" min-width="150"/>
    <el-table-column prop="weight" label="毛重(kg)" width="110" align="right"/>
    <el-table-column label="推送状态" width="100">
      <template #default="{ row }"><el-tag size="small" type="success">{{ row.push_status }}</el-tag></template>
    </el-table-column>
    <el-table-column label="轨迹" width="110">
      <template #default="{ row }"><el-tag size="small">{{ trackLabel(row.track_status) }}</el-tag></template>
    </el-table-column>
    <el-table-column prop="created_at" label="登记时间" width="160"/>
  </el-table>
</div>`,
};

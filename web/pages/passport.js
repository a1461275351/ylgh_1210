// T11 核放单:货物过卡口(入区/出区)
window.PageRegistry.passport = {
  data() {
    return {
      query: { type: '', status: '', no: '' }, list: [], total: 0, page: 1, pageSize: 10, loading: false,
      statusMap: {
        DRAFT: { label: '录入', tag: 'info' }, APPROVED: { label: '审批通过', tag: 'warning' },
        GATE_IN: { label: '已过卡入区', tag: 'success' }, GATE_OUT: { label: '已过卡出区', tag: 'success' }, ABNORMAL: { label: '卡口异常', tag: 'danger' },
      },
    };
  },
  created() { this.load(); },
  methods: {
    st(s) { return this.statusMap[s] || { label: s, tag: 'info' }; },
    async load() {
      this.loading = true;
      try {
        const q = new URLSearchParams({ page: this.page, pageSize: this.pageSize });
        for (const [k, v] of Object.entries(this.query)) if (v) q.set(k, v);
        const d = await api('GET', '/api/passport?' + q.toString()); this.list = d.list; this.total = d.total;
      } finally { this.loading = false; }
    },
    search() { this.page = 1; this.load(); },
    async declare(row) { await api('POST', `/api/passport/${row.id}/declare`); ElementPlus.ElMessage.success('已申报'); this.load(); },
    async gate(row) {
      const r = await api('POST', `/api/passport/${row.id}/gate`);
      let msg = row.passport_type === 'IN' ? '货物已过卡入区' : '货物已过卡出区';
      if (r.shippedOrders) msg += `,${r.shippedOrders} 个订单已出库发货`;
      ElementPlus.ElMessage.success(msg); this.load();
    },
    async abnormal(row) { const { value } = await ElementPlus.ElMessageBox.prompt('异常说明', '卡口异常', {}); await api('POST', `/api/passport/${row.id}/abnormal`, { msg: value }); ElementPlus.ElMessage.warning('已登记异常'); this.load(); },
  },
  template: `
<div class="page-card">
  <el-alert type="info" :closable="false" style="margin-bottom:12px"
    title="核放单是货物过卡口(保税区大门)的放行凭证。入区核放单过卡→货入仓;出区核放单过卡→货发出,关联零售订单自动置为「已出库」。"/>
  <el-form class="query-bar" inline @submit.prevent>
    <el-form-item label="方向"><el-select v-model="query.type" placeholder="全部" clearable style="width:120px"><el-option label="一线入区" value="IN"/><el-option label="二线出区" value="OUT"/></el-select></el-form-item>
    <el-form-item label="状态"><el-select v-model="query.status" placeholder="全部" clearable style="width:130px"><el-option v-for="(v,k) in statusMap" :key="k" :label="v.label" :value="k"/></el-select></el-form-item>
    <el-form-item label="单号"><el-input v-model="query.no" clearable style="width:150px" @keyup.enter="search"/></el-form-item>
    <el-form-item><el-button type="primary" :icon="'Search'" @click="search">查询</el-button></el-form-item>
  </el-form>
  <el-table :data="list" v-loading="loading" border stripe>
    <el-table-column label="操作" width="180" fixed>
      <template #default="{ row }">
        <el-button size="small" type="warning" link v-if="row.status==='DRAFT'" @click="declare(row)">申报</el-button>
        <el-button size="small" type="success" link v-if="row.status==='APPROVED'" @click="gate(row)">过卡验放</el-button>
        <el-button size="small" type="danger" link v-if="row.status==='APPROVED'" @click="abnormal(row)">卡口异常</el-button>
      </template>
    </el-table-column>
    <el-table-column prop="internal_no" label="内部编号" width="150"/>
    <el-table-column prop="passport_no" label="核放单号" width="150"><template #default="{ row }">{{ row.passport_no || '-' }}</template></el-table-column>
    <el-table-column label="方向" width="100"><template #default="{ row }"><el-tag :type="row.passport_type==='IN' ? '' : 'warning'" size="small">{{ row.type_label }}</el-tag></template></el-table-column>
    <el-table-column prop="ems_no" label="账册号" width="150"/>
    <el-table-column prop="vehicle_no" label="车牌" width="100"/>
    <el-table-column label="状态" width="120"><template #default="{ row }"><el-tag :type="st(row.status).tag" size="small">{{ st(row.status).label }}</el-tag></template></el-table-column>
    <el-table-column prop="gate_time" label="过卡时间" width="150"/>
  </el-table>
  <div class="pager"><el-pagination background layout="prev, pager, next, jumper, total" :total="total" v-model:current-page="page" v-model:page-size="pageSize" @change="load"/></div>
</div>`,
};

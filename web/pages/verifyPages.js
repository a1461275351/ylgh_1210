// T16 报核管理 + 盘点管理

window.PageRegistry.verify = {
  data() {
    return { list: [], total: 0, page: 1, pageSize: 10, loading: false, emsNo: 'T901625A00100',
      statusMap: { DRAFT: { label: '编制中', tag: 'info' }, DECLARED: { label: '已报核', tag: 'warning' }, APPROVED: { label: '海关通过', tag: 'warning' }, CLOSED: { label: '核销结案', tag: 'success' }, REJECTED: { label: '退回', tag: 'danger' } },
      drawer: { visible: false, head: {}, diff: [] } };
  },
  created() { this.load(); },
  methods: {
    st(s) { return this.statusMap[s] || { label: s, tag: 'info' }; },
    async load() { this.loading = true; try { const d = await api('GET', `/api/verify?page=${this.page}&pageSize=${this.pageSize}`); this.list = d.list; this.total = d.total; } finally { this.loading = false; } },
    async gen() { const r = await api('POST', '/api/verify', { emsNo: this.emsNo }); ElementPlus.ElMessage.success(`已生成报核单,差异 ${r.diffItems} 项`); this.load(); },
    async detail(row) { const d = await api('GET', '/api/verify/' + row.id); this.drawer = { visible: true, head: d, diff: d.diff }; },
    async act(row, path, label) { await ElementPlus.ElMessageBox.confirm(`确认${label}?`, '提示', { type: 'warning' }); await api('POST', `/api/verify/${row.id}/${path}`); ElementPlus.ElMessage.success(label + '完成'); this.load(); },
  },
  template: `
<div class="page-card">
  <el-alert type="info" :closable="false" style="margin-bottom:12px" title="账册报核核销:周期性向海关报核账册进出存,核对账面与实际差异,审批通过后核销结案。账册到期前必须完成报核。"/>
  <el-form inline class="query-bar">
    <el-form-item label="账册"><el-input v-model="emsNo" style="width:180px"/></el-form-item>
    <el-form-item><el-button type="primary" :icon="'Plus'" @click="gen">生成报核单(含差异表)</el-button></el-form-item>
  </el-form>
  <el-table :data="list" v-loading="loading" border stripe>
    <el-table-column label="操作" width="220" fixed>
      <template #default="{ row }">
        <el-button size="small" type="primary" link @click="detail(row)">差异表</el-button>
        <el-button size="small" type="warning" link v-if="row.status==='DRAFT'" @click="act(row,'declare','报核申报')">申报</el-button>
        <el-button size="small" type="success" link v-if="row.status==='DECLARED'" @click="act(row,'approve','海关通过')">通过</el-button>
        <el-button size="small" type="success" link v-if="row.status==='APPROVED'" @click="act(row,'close','核销结案')">结案</el-button>
      </template>
    </el-table-column>
    <el-table-column prop="verify_no" label="报核单号" width="160"/>
    <el-table-column prop="ems_no" label="账册号" width="150"/>
    <el-table-column label="报核区间" width="200"><template #default="{ row }">{{ row.period_from }} ~ {{ row.period_to }}</template></el-table-column>
    <el-table-column label="状态" width="120"><template #default="{ row }"><el-tag :type="st(row.status).tag" size="small">{{ st(row.status).label }}</el-tag></template></el-table-column>
    <el-table-column prop="close_time" label="结案时间" width="160"><template #default="{ row }">{{ row.close_time || '-' }}</template></el-table-column>
  </el-table>
  <div class="pager"><el-pagination background layout="prev, pager, next, jumper, total" :total="total" v-model:current-page="page" v-model:page-size="pageSize" @change="load"/></div>

  <el-drawer v-model="drawer.visible" title="报核差异表" size="50%">
    <el-descriptions :column="2" border size="small">
      <el-descriptions-item label="报核单号">{{ drawer.head.verify_no }}</el-descriptions-item>
      <el-descriptions-item label="账册号">{{ drawer.head.ems_no }}</el-descriptions-item>
    </el-descriptions>
    <el-divider content-position="left">账面 vs 实际</el-divider>
    <el-table :data="drawer.diff" border size="small">
      <el-table-column prop="item_no" label="序号" width="70"/>
      <el-table-column prop="product_name" label="品名" min-width="150"/>
      <el-table-column prop="book" label="账面数" width="100" align="right"/>
      <el-table-column prop="actual" label="实际数" width="100" align="right"/>
      <el-table-column label="差异" width="100" align="right"><template #default="{ row }"><span :style="{color: row.diff===0?'#67c23a':'#f56c6c'}">{{ row.diff>0?'+':'' }}{{ row.diff }}</span></template></el-table-column>
    </el-table>
  </el-drawer>
</div>`,
};

window.PageRegistry.stocktake = {
  data() {
    return { list: [], total: 0, page: 1, pageSize: 10, loading: false, emsNo: 'T901625A00100',
      statusMap: { DRAFT: { label: '编制中', tag: 'info' }, CONFIRMED: { label: '已确认', tag: 'warning' }, ADJUSTED: { label: '已调整账册', tag: 'success' } },
      drawer: { visible: false, head: {}, result: [] } };
  },
  created() { this.load(); },
  methods: {
    st(s) { return this.statusMap[s] || { label: s, tag: 'info' }; },
    async load() { this.loading = true; try { const d = await api('GET', `/api/verify/stocktake/list?page=${this.page}&pageSize=${this.pageSize}`); this.list = d.list; this.total = d.total; } finally { this.loading = false; } },
    async gen() { const r = await api('POST', '/api/verify/stocktake', { emsNo: this.emsNo }); ElementPlus.ElMessage.success(`已生成盘点单,盈亏 ${r.diffItems} 项`); this.load(); },
    async detail(row) { const d = await api('GET', '/api/verify/stocktake/' + row.id); this.drawer = { visible: true, head: d, result: d.result }; },
    async confirm(row) { await api('POST', `/api/verify/stocktake/${row.id}/confirm`); ElementPlus.ElMessage.success('已确认'); this.load(); },
    async adjust(row) { await ElementPlus.ElMessageBox.confirm('确认按盘点盈亏调整账册?将写入核增/核减流水', '盘盈盘亏调整', { type: 'warning' }); const r = await api('POST', `/api/verify/stocktake/${row.id}/adjust`); ElementPlus.ElMessage.success(`已调整 ${r.adjusted} 个序号`); this.load(); },
  },
  template: `
<div class="page-card">
  <el-alert type="info" :closable="false" style="margin-bottom:12px" title="盘点管理:定期盘点实物与账册核对,盘盈盘亏经确认后调整账册(补税/核增核减),保障账实相符。"/>
  <el-form inline class="query-bar">
    <el-form-item label="账册"><el-input v-model="emsNo" style="width:180px"/></el-form-item>
    <el-form-item><el-button type="primary" :icon="'Plus'" @click="gen">生成盘点单</el-button></el-form-item>
  </el-form>
  <el-table :data="list" v-loading="loading" border stripe>
    <el-table-column label="操作" width="200" fixed>
      <template #default="{ row }">
        <el-button size="small" type="primary" link @click="detail(row)">盘点明细</el-button>
        <el-button size="small" type="warning" link v-if="row.status==='DRAFT'" @click="confirm(row)">确认</el-button>
        <el-button size="small" type="success" link v-if="row.status==='CONFIRMED'" @click="adjust(row)">调整账册</el-button>
      </template>
    </el-table-column>
    <el-table-column prop="take_no" label="盘点单号" width="160"/>
    <el-table-column prop="ems_no" label="账册号" width="150"/>
    <el-table-column prop="take_date" label="盘点日期" width="120"/>
    <el-table-column label="状态" width="130"><template #default="{ row }"><el-tag :type="st(row.status).tag" size="small">{{ st(row.status).label }}</el-tag></template></el-table-column>
  </el-table>
  <div class="pager"><el-pagination background layout="prev, pager, next, jumper, total" :total="total" v-model:current-page="page" v-model:page-size="pageSize" @change="load"/></div>

  <el-drawer v-model="drawer.visible" title="盘点明细" size="50%">
    <el-table :data="drawer.result" border size="small">
      <el-table-column prop="item_no" label="序号" width="70"/>
      <el-table-column prop="product_name" label="品名" min-width="150"/>
      <el-table-column prop="book" label="账面数" width="100" align="right"/>
      <el-table-column prop="actual" label="实盘数" width="100" align="right"/>
      <el-table-column label="盈亏" width="100" align="right"><template #default="{ row }"><span :style="{color: row.diff===0?'#67c23a':(row.diff>0?'#e6a23c':'#f56c6c')}">{{ row.diff>0?'+':'' }}{{ row.diff }}</span></template></el-table-column>
    </el-table>
  </el-drawer>
</div>`,
};

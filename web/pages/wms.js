// T15 WMS 协同:入库单 / 出库单 / 三账比对

window.PageRegistry.wmsIn = {
  data() { return { list: [], total: 0, page: 1, pageSize: 10, loading: false }; },
  created() { this.load(); },
  methods: {
    async load() { this.loading = true; try { const d = await api('GET', `/api/wms/inbound?page=${this.page}&pageSize=${this.pageSize}`); this.list = d.list; this.total = d.total; } finally { this.loading = false; } },
    async sync() { const r = await api('POST', '/api/wms/inbound/sync'); ElementPlus.ElMessage.success(`同步完成,新增 ${r.created} 张入库单`); this.load(); },
  },
  template: `
<div class="page-card">
  <el-alert type="info" :closable="false" style="margin-bottom:12px" title="入库单:备货进口货物入区理货(来自审批通过的入区核注清单)。"/>
  <div class="table-toolbar"><el-button type="primary" :icon="'Refresh'" @click="sync">同步入库单</el-button></div>
  <el-table :data="list" v-loading="loading" border stripe>
    <el-table-column prop="inbound_no" label="入库单号" width="170"/>
    <el-table-column prop="ems_no" label="账册号" width="150"/>
    <el-table-column prop="bond_invt_no" label="核注清单号" width="160"/>
    <el-table-column label="类型" width="110"><template #default="{ row }">{{ row.biz_type==='FIRST_IN'?'备货入区':'退货入区' }}</template></el-table-column>
    <el-table-column prop="qty_total" label="入库数量" width="110" align="right"/>
    <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag type="success" size="small">理货完成</el-tag></template></el-table-column>
    <el-table-column prop="finished_at" label="完成时间" width="160"/>
  </el-table>
  <div class="pager"><el-pagination background layout="prev, pager, next, jumper, total" :total="total" v-model:current-page="page" v-model:page-size="pageSize" @change="load"/></div>
</div>`,
};

window.PageRegistry.wmsOut = {
  data() {
    return { list: [], total: 0, page: 1, pageSize: 10, loading: false,
      statusMap: { INSTRUCTED: { label: '待拣货', tag: 'info' }, PICKED: { label: '已拣货', tag: 'warning' }, PACKED: { label: '已打包', tag: 'warning' }, SHIPPED: { label: '已发货', tag: 'success' } } };
  },
  created() { this.load(); },
  methods: {
    st(s) { return this.statusMap[s] || { label: s, tag: 'info' }; },
    async load() { this.loading = true; try { const d = await api('GET', `/api/wms/outbound?page=${this.page}&pageSize=${this.pageSize}`); this.list = d.list; this.total = d.total; } finally { this.loading = false; } },
    async sync() { const r = await api('POST', '/api/wms/outbound/sync'); ElementPlus.ElMessage.success(`同步完成,新增 ${r.created} 张出库单`); this.load(); },
    async advance(row) { const r = await api('POST', `/api/wms/outbound/${row.id}/advance`); ElementPlus.ElMessage.success('状态推进至 ' + this.st(r.status).label); this.load(); },
  },
  template: `
<div class="page-card">
  <el-alert type="info" :closable="false" style="margin-bottom:12px" title="出库单:清单放行后自动下发拣货指令,拣货→打包→交快递发货。"/>
  <div class="table-toolbar"><el-button type="primary" :icon="'Refresh'" @click="sync">同步出库单</el-button></div>
  <el-table :data="list" v-loading="loading" border stripe>
    <el-table-column label="操作" width="110" fixed><template #default="{ row }"><el-button size="small" type="primary" link v-if="row.status!=='SHIPPED'" @click="advance(row)">推进</el-button></template></el-table-column>
    <el-table-column prop="outbound_no" label="出库单号" width="170"/>
    <el-table-column prop="order_no" label="订单号" width="160"/>
    <el-table-column prop="qty_total" label="出库数量" width="110" align="right"/>
    <el-table-column label="状态" width="110"><template #default="{ row }"><el-tag :type="st(row.status).tag" size="small">{{ st(row.status).label }}</el-tag></template></el-table-column>
    <el-table-column prop="shipped_at" label="发货时间" width="160"><template #default="{ row }">{{ row.shipped_at || '-' }}</template></el-table-column>
  </el-table>
  <div class="pager"><el-pagination background layout="prev, pager, next, jumper, total" :total="total" v-model:current-page="page" v-model:page-size="pageSize" @change="load"/></div>
</div>`,
};

window.PageRegistry.stockDiff = {
  data() { return { emsNo: 'T901625A00100', report_date: null, list: [], diffCount: 0, loading: false }; },
  created() { this.load(); },
  methods: {
    async load() { this.loading = true; try { const d = await api('GET', '/api/wms/diff?emsNo=' + this.emsNo); this.report_date = d.report_date; this.list = d.list; this.diffCount = d.diffCount; } finally { this.loading = false; } },
    async syncSnap() { await api('POST', '/api/wms/snapshot/sync', { emsNo: this.emsNo }); ElementPlus.ElMessage.success('已按账册结余同步实物快照'); },
    async run() { const r = await api('POST', '/api/wms/diff/run', { emsNo: this.emsNo }); ElementPlus.ElMessage[r.diffCount?'warning':'success'](`比对完成:${r.total} 项,差异 ${r.diffCount} 项`); this.load(); },
    async adjust(row) {
      const { value } = await ElementPlus.ElMessageBox.prompt(`调整序号${row.ems_item_no}实物库存(模拟盘盈盘亏)`, '调整实物', { inputValue: String(row.qty_wms) });
      await api('POST', '/api/wms/snapshot/adjust', { emsNo: this.emsNo, ems_item_no: row.ems_item_no, qty: Number(value) });
      ElementPlus.ElMessage.success('已调整,请重新比对'); this.run();
    },
  },
  template: `
<div class="page-card">
  <el-alert type="warning" :closable="false" style="margin-bottom:12px" title="三账比对:关务账册结余 vs WMS实物库存 vs 客户系统库存。任一不一致即差异,是海关稽核账实相符的核心。差异应通过盘点/报核处理。"/>
  <el-form inline class="query-bar">
    <el-form-item label="账册"><el-input v-model="emsNo" style="width:180px"/></el-form-item>
    <el-form-item><el-button :icon="'DocumentCopy'" @click="syncSnap">同步实物快照</el-button></el-form-item>
    <el-form-item><el-button type="primary" :icon="'Search'" @click="run">运行三账比对</el-button></el-form-item>
    <el-form-item><span style="color:#909399">比对日期 {{ report_date || '-' }},差异 <b :style="{color: diffCount?'#f56c6c':'#67c23a'}">{{ diffCount }}</b> 项</span></el-form-item>
  </el-form>
  <el-table :data="list" v-loading="loading" border stripe :row-class-name="({row}) => row.diff_flag ? 'diff-row' : ''">
    <el-table-column prop="ems_item_no" label="备案序号" width="90"/>
    <el-table-column prop="product_name" label="品名" min-width="160"/>
    <el-table-column prop="qty_ems" label="关务账册" width="120" align="right"/>
    <el-table-column prop="qty_wms" label="WMS实物" width="120" align="right"/>
    <el-table-column prop="qty_client" label="客户系统" width="120" align="right"/>
    <el-table-column label="结果" width="100"><template #default="{ row }"><el-tag :type="row.diff_flag?'danger':'success'" size="small">{{ row.diff_flag?'差异':'相符' }}</el-tag></template></el-table-column>
    <el-table-column label="操作" width="120"><template #default="{ row }"><el-button size="small" type="warning" link @click="adjust(row)">调实物</el-button></template></el-table-column>
  </el-table>
</div>`,
};

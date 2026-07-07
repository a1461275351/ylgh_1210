// T09 退单工作台:海关退单清单集中处理(批量重报 / 撤销)
window.PageRegistry.reject = {
  data() {
    return { list: [], total: 0, page: 1, pageSize: 10, loading: false, selected: [], msgDlg: { visible: false, title: '', content: '' } };
  },
  created() { this.load(); },
  methods: {
    async load() {
      this.loading = true;
      try {
        const data = await api('GET', `/api/inventories?status=CUSTOMS_REJECT&page=${this.page}&pageSize=${this.pageSize}`);
        this.list = data.list; this.total = data.total;
      } finally { this.loading = false; }
    },
    onSel(rows) { this.selected = rows.map(r => r.id); },
    async redeclare(row) {
      const r = await api('POST', `/api/inventories/${row.id}/declare`);
      ElementPlus.ElMessage[r.customsStatus === '120' ? 'success' : 'warning'](
        r.customsStatus === '120' ? `重报放行 ${r.invtNo}` : `仍退单:${r.retMsg}`);
      this.load();
    },
    async batchRedeclare() {
      if (!this.selected.length) return ElementPlus.ElMessage.warning('请先勾选清单');
      const r = await api('POST', '/api/inventories/batch-declare', { ids: this.selected });
      ElementPlus.ElMessage.success(`批量重报:放行 ${r.released},仍退单 ${r.rejected}`);
      this.load();
    },
    async cancel(row) {
      const { value } = await ElementPlus.ElMessageBox.prompt('请输入撤销原因', '撤销清单', { inputPlaceholder: '如:订单取消' });
      await api('POST', `/api/inventories/${row.id}/cancel`, { reason: value });
      ElementPlus.ElMessage.success('已撤销');
      this.load();
    },
  },
  template: `
<div class="page-card">
  <el-alert type="warning" :closable="false" style="margin-bottom:12px"
    title="退单工作台:集中处理海关退单清单。按退单原因修正备案/账册/信息后可单张或批量重报;确无法申报的可撤销。"/>
  <div class="table-toolbar">
    <el-button type="primary" :icon="'RefreshRight'" @click="batchRedeclare">批量重报</el-button>
    <el-button :icon="'Refresh'" @click="load">刷新</el-button>
  </div>
  <el-table :data="list" v-loading="loading" border stripe @selection-change="onSel">
    <el-table-column type="selection" width="45"/>
    <el-table-column label="操作" width="150" fixed>
      <template #default="{ row }">
        <el-button size="small" type="warning" link @click="redeclare(row)">重报</el-button>
        <el-button size="small" type="danger" link @click="cancel(row)">撤销</el-button>
      </template>
    </el-table-column>
    <el-table-column prop="order_no" label="订单号" width="160"/>
    <el-table-column prop="buyer_name" label="订购人" width="90"/>
    <el-table-column prop="goods_amount" label="货值" width="90" align="right"/>
    <el-table-column prop="customs_status" label="回执码" width="80"/>
    <el-table-column prop="ret_msg" label="退单原因" min-width="260" show-overflow-tooltip/>
    <el-table-column prop="declare_time" label="申报时间" width="150"/>
  </el-table>
  <div class="pager">
    <el-pagination background layout="prev, pager, next, jumper, total"
      :total="total" v-model:current-page="page" v-model:page-size="pageSize" @change="load"/>
  </div>
</div>`,
};

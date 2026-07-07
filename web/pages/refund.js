// T14 退货管理
window.PageRegistry.refund = {
  data() {
    return {
      query: { orderNo: '', status: '' }, list: [], total: 0, page: 1, pageSize: 10, loading: false,
      statusMap: {
        APPLIED: { label: '已申请', tag: 'info' }, DECLARED: { label: '已申报', tag: 'warning' },
        APPROVED: { label: '海关通过', tag: 'warning' }, CLOSED: { label: '完结', tag: 'success' }, REJECTED: { label: '退单', tag: 'danger' },
      },
      typeMap: { RETURN_AREA: '退回区内', REJECT: '拒收', ABANDON: '放弃' },
      applyDlg: { visible: false, candidates: [], refundDays: 30, form: {} },
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
        const d = await api('GET', '/api/refund?' + q.toString()); this.list = d.list; this.total = d.total;
      } finally { this.loading = false; }
    },
    search() { this.page = 1; this.load(); },
    async openApply() {
      const d = await api('GET', '/api/refund/candidates');
      this.applyDlg = { visible: true, candidates: d.list, refundDays: d.refundDays, form: { inventoryId: null, refund_type: 'RETURN_AREA', reason: '' } };
    },
    async submitApply() {
      if (!this.applyDlg.form.inventoryId) return ElementPlus.ElMessage.warning('请选择要退货的清单');
      await api('POST', '/api/refund/apply', this.applyDlg.form);
      ElementPlus.ElMessage.success('退货申请已提交'); this.applyDlg.visible = false; this.load();
    },
    async declare(row) { await api('POST', `/api/refund/${row.id}/declare`); ElementPlus.ElMessage.success('退货清单已申报并通过'); this.load(); },
    async inbound(row) {
      await ElementPlus.ElMessageBox.confirm('确认入区理货完成?将核增账册、冲减税款并释放担保额度', '入区理货', { type: 'warning' });
      const r = await api('POST', `/api/refund/${row.id}/inbound`);
      ElementPlus.ElMessage.success(r.restocked ? '已完结,账册已核增、税款已冲减' : '已完结(拒收/放弃,不核增)'); this.load();
    },
  },
  template: `
<div class="page-card">
  <el-alert type="info" :closable="false" style="margin-bottom:12px"
    title="退货管理:自清单放行起30日内可退货。退回区内→退货清单申报→入区理货→账册核增+税款冲减+担保额度释放。拒收/放弃不核增账册。"/>
  <el-form class="query-bar" inline @submit.prevent>
    <el-form-item label="订单号"><el-input v-model="query.orderNo" clearable style="width:170px" @keyup.enter="search"/></el-form-item>
    <el-form-item label="状态"><el-select v-model="query.status" placeholder="全部" clearable style="width:120px"><el-option v-for="(v,k) in statusMap" :key="k" :label="v.label" :value="k"/></el-select></el-form-item>
    <el-form-item><el-button type="primary" :icon="'Search'" @click="search">查询</el-button></el-form-item>
  </el-form>
  <div class="table-toolbar"><el-button type="primary" :icon="'Plus'" @click="openApply">发起退货申请</el-button></div>
  <el-table :data="list" v-loading="loading" border stripe>
    <el-table-column label="操作" width="150" fixed>
      <template #default="{ row }">
        <el-button size="small" type="warning" link v-if="row.status==='APPLIED'" @click="declare(row)">申报退货清单</el-button>
        <el-button size="small" type="success" link v-if="row.status==='APPROVED'" @click="inbound(row)">入区理货</el-button>
      </template>
    </el-table-column>
    <el-table-column prop="refund_no" label="退货单号" width="160"/>
    <el-table-column prop="order_no" label="订单号" width="160"/>
    <el-table-column label="退货方式" width="100"><template #default="{ row }">{{ row.type_label }}</template></el-table-column>
    <el-table-column prop="reason" label="退货原因" min-width="160" show-overflow-tooltip/>
    <el-table-column label="状态" width="120"><template #default="{ row }"><el-tag :type="st(row.status).tag" size="small">{{ st(row.status).label }}</el-tag></template></el-table-column>
    <el-table-column prop="apply_time" label="申请时间" width="150"/>
  </el-table>
  <div class="pager"><el-pagination background layout="prev, pager, next, jumper, total" :total="total" v-model:current-page="page" v-model:page-size="pageSize" @change="load"/></div>

  <el-dialog v-model="applyDlg.visible" title="发起退货申请" width="720px">
    <el-form :model="applyDlg.form" label-width="90px">
      <el-form-item label="退货方式"><el-select v-model="applyDlg.form.refund_type" style="width:200px"><el-option v-for="(v,k) in typeMap" :key="k" :label="v" :value="k"/></el-select></el-form-item>
      <el-form-item label="退货原因"><el-input v-model="applyDlg.form.reason" placeholder="如:尺寸不合适"/></el-form-item>
      <el-form-item label="选择清单">
        <el-table :data="applyDlg.candidates" border size="small" height="280" highlight-current-row @current-change="row => applyDlg.form.inventoryId = row ? row.id : null">
          <el-table-column width="40"><template #default="{ row }"><el-radio :value="row.id" v-model="applyDlg.form.inventoryId">{{ '' }}</el-radio></template></el-table-column>
          <el-table-column prop="order_no" label="订单号" width="160"/>
          <el-table-column prop="buyer_name" label="订购人" width="90"/>
          <el-table-column prop="goods_amount" label="货值" width="90" align="right"/>
          <el-table-column label="放行天数" width="90"><template #default="{ row }"><span :style="{color: row.within?'#67c23a':'#f56c6c'}">{{ row.days }}天</span></template></el-table-column>
          <el-table-column label="可退" width="70"><template #default="{ row }"><el-tag :type="row.within?'success':'danger'" size="small">{{ row.within?'是':'超期' }}</el-tag></template></el-table-column>
        </el-table>
      </el-form-item>
    </el-form>
    <template #footer><el-button @click="applyDlg.visible=false">取消</el-button><el-button type="primary" @click="submitApply">提交申请</el-button></template>
  </el-dialog>
</div>`,
};

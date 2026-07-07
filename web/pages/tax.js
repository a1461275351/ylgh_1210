// T13 税单管理
window.PageRegistry.tax = {
  data() {
    return {
      query: { orderNo: '', status: '' }, list: [], total: 0, page: 1, pageSize: 10, loading: false,
      sum: { total: 0, pending: 0, paid: 0 }, selected: [],
      statusMap: { PENDING: { label: '待缴', tag: 'warning' }, PAID: { label: '已汇缴', tag: 'success' }, REVERSED: { label: '已冲减', tag: 'info' } },
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
        const d = await api('GET', '/api/tax/bills?' + q.toString());
        this.list = d.list; this.total = d.total; this.sum = d.sum;
      } finally { this.loading = false; }
    },
    search() { this.page = 1; this.load(); },
    onSel(rows) { this.selected = rows.filter(r => r.status === 'PENDING').map(r => r.id); },
    async pay() {
      if (!this.selected.length) return ElementPlus.ElMessage.warning('请勾选待缴税单');
      await ElementPlus.ElMessageBox.confirm(`确认汇缴 ${this.selected.length} 张税单?将释放对应担保额度`, '月度汇缴', { type: 'warning' });
      const r = await api('POST', '/api/tax/bills/pay', { ids: this.selected });
      ElementPlus.ElMessage.success(`已汇缴 ${r.paid} 张`); this.load();
    },
  },
  template: `
<div class="page-card">
  <el-row :gutter="12" style="margin-bottom:12px">
    <el-col :span="8"><el-card shadow="never" body-style="padding:14px"><div style="color:#909399;font-size:13px">税款合计</div><div style="font-size:22px;font-weight:600">￥{{ sum.total }}</div></el-card></el-col>
    <el-col :span="8"><el-card shadow="never" body-style="padding:14px"><div style="color:#909399;font-size:13px">待缴</div><div style="font-size:22px;font-weight:600;color:#e6a23c">￥{{ sum.pending }}</div></el-card></el-col>
    <el-col :span="8"><el-card shadow="never" body-style="padding:14px"><div style="color:#909399;font-size:13px">已汇缴</div><div style="font-size:22px;font-weight:600;color:#67c23a">￥{{ sum.paid }}</div></el-card></el-col>
  </el-row>
  <el-form class="query-bar" inline @submit.prevent>
    <el-form-item label="订单号"><el-input v-model="query.orderNo" clearable style="width:170px" @keyup.enter="search"/></el-form-item>
    <el-form-item label="状态"><el-select v-model="query.status" placeholder="全部" clearable style="width:120px"><el-option v-for="(v,k) in statusMap" :key="k" :label="v.label" :value="k"/></el-select></el-form-item>
    <el-form-item><el-button type="primary" :icon="'Search'" @click="search">查询</el-button></el-form-item>
  </el-form>
  <div class="table-toolbar"><el-button type="primary" :icon="'Money'" @click="pay">月度汇缴(释放额度)</el-button></div>
  <el-table :data="list" v-loading="loading" border stripe @selection-change="onSel">
    <el-table-column type="selection" width="45" :selectable="row => row.status==='PENDING'"/>
    <el-table-column prop="customs_tax_no" label="税单号" width="150"/>
    <el-table-column prop="order_no" label="订单号" width="160"/>
    <el-table-column prop="vat" label="增值税" width="110" align="right"/>
    <el-table-column prop="consump_tax" label="消费税" width="110" align="right"/>
    <el-table-column prop="total_tax" label="综合税" width="110" align="right"><template #default="{ row }"><b>{{ row.total_tax }}</b></template></el-table-column>
    <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="st(row.status).tag" size="small">{{ st(row.status).label }}</el-tag></template></el-table-column>
    <el-table-column prop="paid_time" label="汇缴时间" width="150"><template #default="{ row }">{{ row.paid_time || '-' }}</template></el-table-column>
  </el-table>
  <div class="pager"><el-pagination background layout="prev, pager, next, jumper, total" :total="total" v-model:current-page="page" v-model:page-size="pageSize" @change="load"/></div>
</div>`,
};

// T13 担保额度台账
window.PageRegistry.guarantee = {
  data() { return { s: { account: {}, available: 0, warn: false, usedRatio: 0, ledger: [] }, loading: false }; },
  created() { this.load(); },
  methods: {
    async load() { this.loading = true; try { this.s = await api('GET', '/api/tax/guarantee'); } finally { this.loading = false; } },
    bizLabel(t) { return { OCCUPY: '清单放行占用', RELEASE: '汇缴释放', REFUND: '退货释放' }[t] || t; },
  },
  template: `
<div class="page-card" v-loading="loading">
  <el-alert v-if="s.warn" type="error" :closable="false" style="margin-bottom:12px" :title="'担保额度告警:已占用 ' + s.usedRatio + '%,超过预警线,请及时汇缴释放'"/>
  <el-descriptions :column="4" border style="margin-bottom:16px">
    <el-descriptions-item label="担保账户" :span="2">{{ s.account.account_name }}</el-descriptions-item>
    <el-descriptions-item label="预警比例">{{ (s.account.warn_ratio*100).toFixed(0) }}%</el-descriptions-item>
    <el-descriptions-item label="占用率">{{ s.usedRatio }}%</el-descriptions-item>
    <el-descriptions-item label="总担保额度">￥{{ s.account.total_amount }}</el-descriptions-item>
    <el-descriptions-item label="已占用">￥{{ s.account.used_amount }}</el-descriptions-item>
    <el-descriptions-item label="可用额度" :span="2"><b :style="{color: s.available>0 ? '#67c23a':'#f56c6c'}">￥{{ s.available }}</b></el-descriptions-item>
  </el-descriptions>
  <el-progress :percentage="Math.min(100, s.usedRatio)" :status="s.warn ? 'exception' : 'success'" :stroke-width="18" style="margin-bottom:16px"/>
  <el-divider content-position="left">占用/释放流水</el-divider>
  <el-table :data="s.ledger" border stripe size="small">
    <el-table-column label="类型" width="150"><template #default="{ row }"><el-tag :type="row.biz_type==='OCCUPY'?'warning':'success'" size="small">{{ bizLabel(row.biz_type) }}</el-tag></template></el-table-column>
    <el-table-column prop="biz_no" label="关联单据" min-width="160"/>
    <el-table-column prop="amount" label="变动额" width="120" align="right"><template #default="{ row }"><span :style="{color: row.amount>0?'#e6a23c':'#67c23a'}">{{ row.amount>0?'+':'' }}{{ row.amount }}</span></template></el-table-column>
    <el-table-column prop="balance" label="占用余额" width="120" align="right"/>
    <el-table-column prop="created_at" label="时间" width="160"/>
  </el-table>
</div>`,
};

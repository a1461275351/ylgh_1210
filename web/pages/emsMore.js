// T07 账册初审 / 复审(工作台)/ 台账 / 变更单

// —— 审核工作台工厂:初审(AUDIT1→通过AUDIT2)/ 复审(AUDIT2→通过APPROVED)——
function makeAuditPage(status, passPath, passLabel, tip) {
  return {
    data() { return { list: [], total: 0, page: 1, pageSize: 10, loading: false, drawer: { visible: false, head: {}, items: [] } }; },
    created() { this.load(); },
    methods: {
      async load() {
        this.loading = true;
        try {
          const d = await api('GET', `/api/ems?status=${status}&page=${this.page}&pageSize=${this.pageSize}`);
          this.list = d.list; this.total = d.total;
        } finally { this.loading = false; }
      },
      async view(row) { const d = await api('GET', '/api/ems/' + row.id); this.drawer = { visible: true, head: d, items: d.items }; },
      async pass(row) {
        await ElementPlus.ElMessageBox.confirm(`确认${passLabel}?`, '提示', { type: 'warning' });
        await api('POST', `/api/ems/${row.id}/${passPath}`);
        ElementPlus.ElMessage.success(passLabel + '完成'); this.drawer.visible = false; this.load();
      },
      async reject(row) {
        const { value } = await ElementPlus.ElMessageBox.prompt('请输入驳回意见', '驳回', { inputPlaceholder: '如:表体要素不全' });
        await api('POST', `/api/ems/${row.id}/reject`, { remark: value });
        ElementPlus.ElMessage.success('已驳回'); this.drawer.visible = false; this.load();
      },
    },
    template: `
<div class="page-card">
  <el-alert type="info" :closable="false" style="margin-bottom:12px" :title="'${tip}'"/>
  <div class="table-toolbar"><el-button :icon="'Refresh'" @click="load">刷新</el-button></div>
  <el-table :data="list" v-loading="loading" border stripe>
    <el-table-column label="操作" width="200" fixed>
      <template #default="{ row }">
        <el-button size="small" type="primary" link @click="view(row)">查看表体</el-button>
        <el-button size="small" type="success" link @click="pass(row)">${passLabel}</el-button>
        <el-button size="small" type="danger" link @click="reject(row)">驳回</el-button>
      </template>
    </el-table-column>
    <el-table-column prop="internal_no" label="内部编号" width="150"/>
    <el-table-column prop="ems_no" label="账册编号" width="150"><template #default="{ row }">{{ row.ems_no || '-' }}</template></el-table-column>
    <el-table-column prop="company_name" label="经营单位" min-width="200" show-overflow-tooltip/>
    <el-table-column prop="valid_end" label="有效期" width="120"/>
  </el-table>
  <div class="pager">
    <el-pagination background layout="prev, pager, next, jumper, total" :total="total" v-model:current-page="page" v-model:page-size="pageSize" @change="load"/>
  </div>
  <el-drawer v-model="drawer.visible" title="账册表体审核" size="50%">
    <el-descriptions :column="2" border size="small">
      <el-descriptions-item label="内部编号">{{ drawer.head.internal_no }}</el-descriptions-item>
      <el-descriptions-item label="经营单位">{{ drawer.head.company_name }}</el-descriptions-item>
    </el-descriptions>
    <el-divider content-position="left">表体商品</el-divider>
    <el-table :data="drawer.items" border size="small">
      <el-table-column prop="item_no" label="序号" width="60"/>
      <el-table-column prop="hs_code" label="HS编码" width="120"/>
      <el-table-column prop="product_name" label="品名" min-width="150"/>
      <el-table-column prop="unit" label="单位" width="70"/>
    </el-table>
  </el-drawer>
</div>`,
  };
}
window.PageRegistry.emsAudit1 = makeAuditPage('AUDIT1', 'audit1-pass', '初审通过', '账册初审:核对表头与表体要素,通过后进入复审;有问题可驳回退回录入岗。');
window.PageRegistry.emsAudit2 = makeAuditPage('AUDIT2', 'audit2-pass', '复审通过', '账册复审:复审通过即视为向金二申报并回执通过,系统自动生成账册编号。');

// —— 账册台账(进出存)——
window.PageRegistry.emsLedger = {
  data() { return { emsList: [], emsId: '', ledger: [], loading: false, flowDlg: { visible: false, title: '', rows: [] } }; },
  created() { this.loadEms(); },
  methods: {
    async loadEms() {
      const d = await api('GET', '/api/ems?status=APPROVED&pageSize=200');
      this.emsList = d.list;
      if (this.emsList.length) { this.emsId = this.emsList[0].id; this.load(); }
    },
    async load() {
      if (!this.emsId) return;
      this.loading = true;
      try { const d = await api('GET', `/api/ems/${this.emsId}/ledger`); this.ledger = d.list; }
      finally { this.loading = false; }
    },
    async flow(row) {
      const d = await api('GET', `/api/ems/${this.emsId}/ledger/${row.item_no}`);
      this.flowDlg = { visible: true, title: `序号 ${row.item_no} ${row.product_name} 流水`, rows: d };
    },
    bizLabel(t) { return { IN: '一线入区核增', OUT: '二线出区核减', REFUND: '退货核增', ADJUST: '调整' }[t] || t; },
  },
  template: `
<div class="page-card">
  <el-alert type="info" :closable="false" style="margin-bottom:12px" title="账册台账:按备案序号实时汇总进(核增)、出(核减)、存(结余)。订单申报的账册余量校验即取自此处结余。"/>
  <el-form inline class="query-bar">
    <el-form-item label="账册">
      <el-select v-model="emsId" style="width:260px" @change="load">
        <el-option v-for="e in emsList" :key="e.id" :label="(e.ems_no||e.internal_no) + ' ' + e.company_name" :value="e.id"/>
      </el-select>
    </el-form-item>
    <el-form-item><el-button type="primary" :icon="'Search'" @click="load">查询</el-button></el-form-item>
  </el-form>
  <el-table :data="ledger" v-loading="loading" border stripe>
    <el-table-column prop="item_no" label="备案序号" width="90"/>
    <el-table-column prop="product_name" label="品名" min-width="180"/>
    <el-table-column prop="hs_code" label="HS编码" width="120"/>
    <el-table-column prop="unit" label="单位" width="70"/>
    <el-table-column prop="in_qty" label="累计入区" width="110" align="right"/>
    <el-table-column prop="out_qty" label="累计出区" width="110" align="right"/>
    <el-table-column label="当前结余" width="110" align="right"><template #default="{ row }"><b>{{ row.balance }}</b></template></el-table-column>
    <el-table-column label="操作" width="90"><template #default="{ row }"><el-button size="small" type="primary" link @click="flow(row)">流水</el-button></template></el-table-column>
  </el-table>
  <el-dialog v-model="flowDlg.visible" :title="flowDlg.title" width="620px">
    <el-table :data="flowDlg.rows" border size="small">
      <el-table-column label="类型" width="130"><template #default="{ row }">{{ bizLabel(row.biz_type) }}</template></el-table-column>
      <el-table-column prop="biz_no" label="关联单据" min-width="150"/>
      <el-table-column prop="qty" label="数量" width="100" align="right"/>
      <el-table-column prop="balance" label="结余" width="100" align="right"/>
      <el-table-column prop="created_at" label="时间" width="150"/>
    </el-table>
  </el-dialog>
</div>`,
};

// —— 账册变更单 ——
window.PageRegistry.emsChange = {
  data() {
    return {
      list: [], total: 0, page: 1, pageSize: 10, loading: false,
      statusMap: { DRAFT: { label: '录入', tag: 'info' }, AUDIT1: { label: '待初审', tag: 'warning' }, AUDIT2: { label: '待复审', tag: 'warning' }, APPROVED: { label: '审批通过', tag: 'success' }, REJECTED: { label: '退单', tag: 'danger' } },
      emsList: [],
      dlg: { visible: false, form: {} },
    };
  },
  created() { this.load(); this.loadEms(); },
  methods: {
    st(s) { return this.statusMap[s] || { label: s, tag: 'info' }; },
    async loadEms() { const d = await api('GET', '/api/ems?status=APPROVED&pageSize=200'); this.emsList = d.list; },
    async load() {
      this.loading = true;
      try { const d = await api('GET', `/api/ems/changes/list?page=${this.page}&pageSize=${this.pageSize}`); this.list = d.list; this.total = d.total; }
      finally { this.loading = false; }
    },
    add() { this.dlg = { visible: true, form: { ems_id: this.emsList[0] ? this.emsList[0].id : null, change_type: 'ITEM_ADD', item: { unit: '007' } } }; },
    async save() {
      const f = this.dlg.form;
      if (!f.ems_id) return ElementPlus.ElMessage.warning('请选择账册');
      const body = { change_type: f.change_type, change_desc: f.change_desc };
      if (f.change_type === 'ITEM_ADD') body.change_data = { item: f.item };
      else if (f.change_type === 'EXTEND') body.change_data = { valid_end: f.valid_end };
      await api('POST', `/api/ems/${f.ems_id}/changes`, body);
      ElementPlus.ElMessage.success('变更单已创建'); this.dlg.visible = false; this.load();
    },
    async act(row, path, label, needRemark) {
      let body;
      if (needRemark) { const { value } = await ElementPlus.ElMessageBox.prompt('请输入意见', label, {}); body = { remark: value }; }
      else await ElementPlus.ElMessageBox.confirm(`确认${label}?`, '提示', { type: 'warning' });
      await api('POST', `/api/ems/changes/${row.id}/${path}`, body);
      ElementPlus.ElMessage.success(label + '完成'); this.load();
    },
    typeLabel(t) { return { ITEM_ADD: '增加商品', ITEM_MODIFY: '修改商品', EXTEND: '延期', HEAD: '表头变更' }[t] || t; },
  },
  template: `
<div class="page-card">
  <div class="table-toolbar"><el-button type="primary" :icon="'Plus'" @click="add">新增变更单</el-button><el-button :icon="'Refresh'" @click="load">刷新</el-button></div>
  <el-table :data="list" v-loading="loading" border stripe>
    <el-table-column label="操作" width="210" fixed>
      <template #default="{ row }">
        <el-button size="small" type="success" link v-if="['DRAFT','REJECTED'].includes(row.status)" @click="act(row,'submit','提交初审')">提交</el-button>
        <el-button size="small" type="success" link v-if="row.status==='AUDIT1'" @click="act(row,'audit1-pass','初审通过')">初审</el-button>
        <el-button size="small" type="success" link v-if="row.status==='AUDIT2'" @click="act(row,'audit2-pass','复审通过')">复审</el-button>
        <el-button size="small" type="danger" link v-if="['AUDIT1','AUDIT2'].includes(row.status)" @click="act(row,'reject','驳回',true)">驳回</el-button>
      </template>
    </el-table-column>
    <el-table-column prop="change_no" label="变更单号" width="160"/>
    <el-table-column prop="ems_no" label="账册编号" width="150"/>
    <el-table-column label="变更类型" width="110"><template #default="{ row }">{{ typeLabel(row.change_type) }}</template></el-table-column>
    <el-table-column prop="change_desc" label="变更说明" min-width="180" show-overflow-tooltip/>
    <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="st(row.status).tag" size="small">{{ st(row.status).label }}</el-tag></template></el-table-column>
    <el-table-column prop="created_at" label="创建时间" width="150"/>
  </el-table>
  <div class="pager">
    <el-pagination background layout="prev, pager, next, jumper, total" :total="total" v-model:current-page="page" v-model:page-size="pageSize" @change="load"/>
  </div>

  <el-dialog v-model="dlg.visible" title="新增账册变更单" width="560px">
    <el-form :model="dlg.form" label-width="100px">
      <el-form-item label="账册"><el-select v-model="dlg.form.ems_id" style="width:100%"><el-option v-for="e in emsList" :key="e.id" :label="(e.ems_no||e.internal_no)+' '+e.company_name" :value="e.id"/></el-select></el-form-item>
      <el-form-item label="变更类型"><el-select v-model="dlg.form.change_type" style="width:100%"><el-option label="增加商品" value="ITEM_ADD"/><el-option label="延期" value="EXTEND"/></el-select></el-form-item>
      <el-form-item label="变更说明"><el-input v-model="dlg.form.change_desc"/></el-form-item>
      <template v-if="dlg.form.change_type==='ITEM_ADD'">
        <el-form-item label="新增HS"><el-input v-model="dlg.form.item.hs_code"/></el-form-item>
        <el-form-item label="新增品名"><el-input v-model="dlg.form.item.product_name"/></el-form-item>
        <el-form-item label="单位"><el-input v-model="dlg.form.item.unit"/></el-form-item>
      </template>
      <el-form-item v-if="dlg.form.change_type==='EXTEND'" label="新有效期"><el-date-picker v-model="dlg.form.valid_end" type="date" value-format="YYYY-MM-DD" style="width:100%"/></el-form-item>
    </el-form>
    <template #footer><el-button @click="dlg.visible=false">取消</el-button><el-button type="primary" @click="save">保存</el-button></template>
  </el-dialog>
</div>`,
};

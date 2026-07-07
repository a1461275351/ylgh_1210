// T07 账册备案:表头 CRUD + 表体管理 + 提交流程 + 台账入口
window.PageRegistry.emsRecord = {
  data() {
    return {
      query: { emsNo: '', internalNo: '', status: '' },
      list: [], total: 0, page: 1, pageSize: 10, loading: false,
      statusMap: {
        DRAFT: { label: '录入', tag: 'info' }, AUDIT1: { label: '待初审', tag: 'warning' },
        AUDIT2: { label: '待复审', tag: 'warning' }, DECLARED: { label: '已申报', tag: '' },
        APPROVED: { label: '审批通过', tag: 'success' }, REJECTED: { label: '退单', tag: 'danger' },
      },
      dlg: { visible: false, isNew: true, form: {} },
      drawer: { visible: false, head: {}, items: [] },
      itemForm: { hs_code: '', product_name: '', unit: '007', declare_price: null },
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
        const d = await api('GET', '/api/ems?' + q.toString());
        this.list = d.list; this.total = d.total;
      } finally { this.loading = false; }
    },
    search() { this.page = 1; this.load(); },
    add() { this.dlg = { visible: true, isNew: true, form: { ems_type: 'T', usage_type: 'CBEC', company_code: '610166BA05', company_name: '西安市航空基地协航供应链管理有限公司', valid_end: '2027-12-31' } }; },
    edit(row) { this.dlg = { visible: true, isNew: false, form: { ...row } }; },
    async save() {
      const f = this.dlg.form;
      if (!f.company_code || !f.company_name) return ElementPlus.ElMessage.warning('经营单位必填');
      if (this.dlg.isNew) await api('POST', '/api/ems', f);
      else await api('PUT', '/api/ems/' + f.id, f);
      ElementPlus.ElMessage.success('保存成功'); this.dlg.visible = false; this.load();
    },
    async openDrawer(row) {
      const d = await api('GET', '/api/ems/' + row.id);
      this.drawer = { visible: true, head: d, items: d.items };
    },
    async addItem() {
      const f = this.itemForm;
      if (!f.hs_code || !f.product_name) return ElementPlus.ElMessage.warning('HS/品名必填');
      await api('POST', `/api/ems/${this.drawer.head.id}/items`, f);
      this.itemForm = { hs_code: '', product_name: '', unit: '007', declare_price: null };
      this.openDrawer(this.drawer.head);
    },
    async delItem(it) {
      await api('DELETE', `/api/ems/${this.drawer.head.id}/items/${it.id}`);
      this.openDrawer(this.drawer.head);
    },
    async submit(row) {
      await ElementPlus.ElMessageBox.confirm('确认提交初审?', '提示', { type: 'warning' });
      await api('POST', `/api/ems/${row.id}/submit`);
      ElementPlus.ElMessage.success('已提交至初审岗'); this.drawer.visible = false; this.load();
    },
    async del(row) {
      await ElementPlus.ElMessageBox.confirm(`确认删除账册「${row.internal_no}」?`, '提示', { type: 'warning' });
      await api('DELETE', '/api/ems/' + row.id);
      ElementPlus.ElMessage.success('已删除'); this.load();
    },
  },
  template: `
<div class="page-card">
  <el-form class="query-bar" inline @submit.prevent>
    <el-form-item label="账册编号"><el-input v-model="query.emsNo" clearable style="width:170px" @keyup.enter="search"/></el-form-item>
    <el-form-item label="内部编号"><el-input v-model="query.internalNo" clearable style="width:150px" @keyup.enter="search"/></el-form-item>
    <el-form-item label="状态">
      <el-select v-model="query.status" placeholder="全部" clearable style="width:120px">
        <el-option v-for="(v,k) in statusMap" :key="k" :label="v.label" :value="k"/>
      </el-select>
    </el-form-item>
    <el-form-item><el-button type="primary" :icon="'Search'" @click="search">查询</el-button></el-form-item>
  </el-form>
  <div class="table-toolbar"><el-button type="primary" :icon="'Plus'" @click="add">新增账册备案</el-button></div>

  <el-table :data="list" v-loading="loading" border stripe>
    <el-table-column label="操作" width="180" fixed>
      <template #default="{ row }">
        <el-button size="small" type="primary" link @click="openDrawer(row)">表体/提交</el-button>
        <el-button size="small" type="primary" link v-if="['DRAFT','REJECTED'].includes(row.status)" @click="edit(row)">编辑</el-button>
        <el-button size="small" type="danger" link v-if="['DRAFT','REJECTED'].includes(row.status)" @click="del(row)">删除</el-button>
      </template>
    </el-table-column>
    <el-table-column prop="internal_no" label="内部编号" width="150"/>
    <el-table-column prop="ems_no" label="账册编号" width="150"><template #default="{ row }">{{ row.ems_no || '-' }}</template></el-table-column>
    <el-table-column label="类型" width="90"><template #default="{ row }">{{ row.ems_type === 'T' ? '物流账册' : '加工账册' }}</template></el-table-column>
    <el-table-column prop="company_name" label="经营单位" min-width="200" show-overflow-tooltip/>
    <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="st(row.status).tag" size="small">{{ st(row.status).label }}</el-tag></template></el-table-column>
    <el-table-column prop="valid_end" label="结束有效期" width="120"/>
  </el-table>
  <div class="pager">
    <el-pagination background layout="prev, pager, next, jumper, total, sizes"
      :total="total" v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="[10,20,50]" @change="load"/>
  </div>

  <el-dialog v-model="dlg.visible" :title="dlg.isNew ? '新增账册备案' : '编辑账册'" width="560px">
    <el-form :model="dlg.form" label-width="100px">
      <el-form-item label="账册类型"><el-select v-model="dlg.form.ems_type" style="width:100%"><el-option label="物流账册(T)" value="T"/><el-option label="加工账册(H)" value="H"/></el-select></el-form-item>
      <el-form-item label="经营单位代码" required><el-input v-model="dlg.form.company_code"/></el-form-item>
      <el-form-item label="经营单位名称" required><el-input v-model="dlg.form.company_name"/></el-form-item>
      <el-form-item label="主管关别"><el-input v-model="dlg.form.customs_code"/></el-form-item>
      <el-form-item label="结束有效期"><el-date-picker v-model="dlg.form.valid_end" type="date" value-format="YYYY-MM-DD" style="width:100%"/></el-form-item>
      <el-form-item label="备注"><el-input v-model="dlg.form.remark" type="textarea" :rows="2"/></el-form-item>
    </el-form>
    <template #footer><el-button @click="dlg.visible=false">取消</el-button><el-button type="primary" @click="save">保存</el-button></template>
  </el-dialog>

  <el-drawer v-model="drawer.visible" title="账册表体与提交" size="60%">
    <el-descriptions :column="2" border size="small">
      <el-descriptions-item label="内部编号">{{ drawer.head.internal_no }}</el-descriptions-item>
      <el-descriptions-item label="账册编号">{{ drawer.head.ems_no || '(待审批生成)' }}</el-descriptions-item>
      <el-descriptions-item label="状态"><el-tag :type="st(drawer.head.status).tag" size="small">{{ st(drawer.head.status).label }}</el-tag></el-descriptions-item>
      <el-descriptions-item label="有效期">{{ drawer.head.valid_end }}</el-descriptions-item>
    </el-descriptions>

    <el-divider content-position="left">表体商品(备案序号)</el-divider>
    <el-table :data="drawer.items" border size="small">
      <el-table-column prop="item_no" label="序号" width="60"/>
      <el-table-column prop="hs_code" label="HS编码" width="120"/>
      <el-table-column prop="product_name" label="品名" min-width="150"/>
      <el-table-column prop="unit" label="单位" width="70"/>
      <el-table-column prop="balance" label="当前结余" width="100" align="right"/>
      <el-table-column label="操作" width="70">
        <template #default="{ row }">
          <el-button v-if="['DRAFT','REJECTED'].includes(drawer.head.status)" size="small" type="danger" link @click="delItem(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <template v-if="['DRAFT','REJECTED'].includes(drawer.head.status)">
      <el-form inline style="margin-top:10px">
        <el-form-item label="HS"><el-input v-model="itemForm.hs_code" style="width:130px"/></el-form-item>
        <el-form-item label="品名"><el-input v-model="itemForm.product_name" style="width:150px"/></el-form-item>
        <el-form-item label="单位"><el-input v-model="itemForm.unit" style="width:70px"/></el-form-item>
        <el-form-item><el-button type="primary" @click="addItem">加表体</el-button></el-form-item>
      </el-form>
      <el-button type="success" :icon="'Promotion'" style="margin-top:8px" @click="submit(drawer.head)">提交初审</el-button>
    </template>
  </el-drawer>
</div>`,
};

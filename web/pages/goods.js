// T06 商品备案资料库:CRUD + 备案流程 + 正面清单校验 + 账册绑定
window.PageRegistry.goods = {
  data() {
    return {
      query: { sku: '', name: '', hs: '', status: '' },
      list: [], total: 0, page: 1, pageSize: 10, loading: false,
      customers: [], hsOptions: [],
      statusMap: {
        DRAFT: { label: '草稿', tag: 'info' }, AUDIT1: { label: '待初审', tag: 'warning' },
        AUDIT2: { label: '待复审', tag: 'warning' }, APPROVED: { label: '备案通过', tag: 'success' },
        REJECTED: { label: '驳回', tag: 'danger' },
      },
      dlg: { visible: false, isNew: true, form: {} },
      bindDlg: { visible: false, product_id: null, ems_no: 'T901625A00100', item_no: null },
    };
  },
  created() { this.load(); this.loadRefs(); },
  methods: {
    st(s) { return this.statusMap[s] || { label: s, tag: 'info' }; },
    async loadRefs() {
      try {
        const c = await api('GET', '/api/customers?pageSize=200');
        this.customers = c.list || c;
        const h = await api('GET', '/api/hstax?pageSize=200');
        this.hsOptions = h.list;
      } catch (e) {}
    },
    async load() {
      this.loading = true;
      try {
        const q = new URLSearchParams({ page: this.page, pageSize: this.pageSize });
        for (const [k, v] of Object.entries(this.query)) if (v) q.set(k, v);
        const data = await api('GET', '/api/products?' + q.toString());
        this.list = data.list; this.total = data.total;
      } finally { this.loading = false; }
    },
    search() { this.page = 1; this.load(); },
    add() {
      const self = this.customers.find(c => c.is_self) || this.customers[0];
      this.dlg = { visible: true, isNew: true, form: { customer_id: self ? self.id : 1, currency: '142' } };
    },
    async edit(row) {
      const d = await api('GET', '/api/products/' + row.id);
      this.dlg = { visible: true, isNew: false, form: { ...d } };
    },
    onHsChange(hs) {
      const h = this.hsOptions.find(x => x.hs_code === hs);
      if (h && !h.in_positive_list)
        ElementPlus.ElMessage.warning(`注意:HS ${hs} 不在跨境电商零售进口正面清单内,该商品将无法申报`);
    },
    async save() {
      const f = this.dlg.form;
      if (!f.sku || !f.product_name || !f.hs_code) return ElementPlus.ElMessage.warning('SKU、品名、HS编码必填');
      if (this.dlg.isNew) await api('POST', '/api/products', f);
      else await api('PUT', '/api/products/' + f.id, f);
      ElementPlus.ElMessage.success('保存成功');
      this.dlg.visible = false; this.load();
    },
    async act(row, path, msg, needRemark) {
      let body;
      if (needRemark) {
        const { value } = await ElementPlus.ElMessageBox.prompt('请输入意见', msg, { inputPlaceholder: '如:要素不全' });
        body = { remark: value };
      } else {
        await ElementPlus.ElMessageBox.confirm(`确认${msg}?`, '提示', { type: 'warning' });
      }
      await api('POST', `/api/products/${row.id}/${path}`, body);
      ElementPlus.ElMessage.success(msg + '完成');
      this.load();
    },
    async del(row) {
      await ElementPlus.ElMessageBox.confirm(`确认删除商品「${row.sku}」?`, '提示', { type: 'warning' });
      await api('DELETE', '/api/products/' + row.id);
      ElementPlus.ElMessage.success('已删除'); this.load();
    },
    openBind(row) { this.bindDlg = { visible: true, product_id: row.id, ems_no: 'T901625A00100', item_no: null }; },
    async saveBind() {
      if (!this.bindDlg.item_no) return ElementPlus.ElMessage.warning('请填备案序号');
      await api('POST', `/api/products/${this.bindDlg.product_id}/bind-ems`, { ems_no: this.bindDlg.ems_no, item_no: this.bindDlg.item_no });
      ElementPlus.ElMessage.success('绑定成功'); this.bindDlg.visible = false;
    },
  },
  template: `
<div class="page-card">
  <el-form class="query-bar" inline @submit.prevent>
    <el-form-item label="SKU"><el-input v-model="query.sku" clearable style="width:140px" @keyup.enter="search"/></el-form-item>
    <el-form-item label="品名"><el-input v-model="query.name" clearable style="width:140px" @keyup.enter="search"/></el-form-item>
    <el-form-item label="HS"><el-input v-model="query.hs" clearable style="width:130px" @keyup.enter="search"/></el-form-item>
    <el-form-item label="状态">
      <el-select v-model="query.status" placeholder="全部" clearable style="width:120px">
        <el-option v-for="(v,k) in statusMap" :key="k" :label="v.label" :value="k"/>
      </el-select>
    </el-form-item>
    <el-form-item><el-button type="primary" :icon="'Search'" @click="search">查询</el-button></el-form-item>
  </el-form>

  <div class="table-toolbar"><el-button type="primary" :icon="'Plus'" @click="add">新增商品备案</el-button></div>

  <el-table :data="list" v-loading="loading" border stripe>
    <el-table-column label="操作" width="210" fixed>
      <template #default="{ row }">
        <el-button size="small" type="primary" link v-if="['DRAFT','REJECTED'].includes(row.status)" @click="edit(row)">编辑</el-button>
        <el-button size="small" type="success" link v-if="['DRAFT','REJECTED'].includes(row.status)" @click="act(row,'submit','提交初审')">提交</el-button>
        <el-button size="small" type="success" link v-if="row.status==='AUDIT1'" @click="act(row,'audit1-pass','初审通过')">初审</el-button>
        <el-button size="small" type="success" link v-if="row.status==='AUDIT2'" @click="act(row,'audit2-pass','复审通过')">复审</el-button>
        <el-button size="small" type="danger" link v-if="['AUDIT1','AUDIT2'].includes(row.status)" @click="act(row,'reject','驳回',true)">驳回</el-button>
        <el-button size="small" type="warning" link @click="openBind(row)">绑账册</el-button>
        <el-button size="small" type="danger" link v-if="['DRAFT','REJECTED'].includes(row.status)" @click="del(row)">删除</el-button>
      </template>
    </el-table-column>
    <el-table-column prop="sku" label="SKU" width="130"/>
    <el-table-column prop="product_name" label="申报品名" min-width="150"/>
    <el-table-column prop="hs_code" label="HS编码" width="115"/>
    <el-table-column label="正面清单" width="90">
      <template #default="{ row }">
        <el-tag :type="row.in_positive_list ? 'success' : 'danger'" size="small">{{ row.in_positive_list ? '在册' : '不在册' }}</el-tag>
      </template>
    </el-table-column>
    <el-table-column prop="declare_price" label="备案价" width="90" align="right"/>
    <el-table-column prop="origin_country" label="原产国" width="70"/>
    <el-table-column label="状态" width="100">
      <template #default="{ row }"><el-tag :type="st(row.status).tag" size="small">{{ st(row.status).label }}</el-tag></template>
    </el-table-column>
    <el-table-column prop="audit_remark" label="审核意见" min-width="140" show-overflow-tooltip/>
  </el-table>

  <div class="pager">
    <el-pagination background layout="prev, pager, next, jumper, total, sizes"
      :total="total" v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="[10,20,50]" @change="load"/>
  </div>

  <el-dialog v-model="dlg.visible" :title="dlg.isNew ? '新增商品备案' : '编辑商品备案'" width="640px">
    <el-form :model="dlg.form" label-width="90px">
      <el-row :gutter="12">
        <el-col :span="12"><el-form-item label="货主" required>
          <el-select v-model="dlg.form.customer_id" style="width:100%" :disabled="!dlg.isNew">
            <el-option v-for="c in customers" :key="c.id" :label="c.cust_name" :value="c.id"/>
          </el-select>
        </el-form-item></el-col>
        <el-col :span="12"><el-form-item label="SKU" required><el-input v-model="dlg.form.sku" :disabled="!dlg.isNew"/></el-form-item></el-col>
        <el-col :span="24"><el-form-item label="申报品名" required><el-input v-model="dlg.form.product_name"/></el-form-item></el-col>
        <el-col :span="12"><el-form-item label="HS编码" required>
          <el-select v-model="dlg.form.hs_code" filterable style="width:100%" @change="onHsChange">
            <el-option v-for="h in hsOptions" :key="h.hs_code" :label="h.hs_code + ' ' + (h.hs_name||'')" :value="h.hs_code"/>
          </el-select>
        </el-form-item></el-col>
        <el-col :span="12"><el-form-item label="备案单价"><el-input-number v-model="dlg.form.declare_price" :min="0" style="width:100%"/></el-form-item></el-col>
        <el-col :span="12"><el-form-item label="原产国"><el-input v-model="dlg.form.origin_country" placeholder="国别代码"/></el-form-item></el-col>
        <el-col :span="12"><el-form-item label="申报单位"><el-input v-model="dlg.form.unit_declare" placeholder="单位代码"/></el-form-item></el-col>
        <el-col :span="12"><el-form-item label="品牌"><el-input v-model="dlg.form.brand"/></el-form-item></el-col>
        <el-col :span="12"><el-form-item label="条码"><el-input v-model="dlg.form.barcode"/></el-form-item></el-col>
        <el-col :span="24"><el-form-item label="申报要素"><el-input v-model="dlg.form.declare_elements" type="textarea" :rows="2"/></el-form-item></el-col>
      </el-row>
    </el-form>
    <template #footer><el-button @click="dlg.visible=false">取消</el-button><el-button type="primary" @click="save">保存</el-button></template>
  </el-dialog>

  <el-dialog v-model="bindDlg.visible" title="绑定账册备案序号" width="440px">
    <el-form label-width="90px">
      <el-form-item label="账册号"><el-input v-model="bindDlg.ems_no"/></el-form-item>
      <el-form-item label="备案序号"><el-input-number v-model="bindDlg.item_no" :min="1" style="width:100%"/></el-form-item>
    </el-form>
    <template #footer><el-button @click="bindDlg.visible=false">取消</el-button><el-button type="primary" @click="saveBind">绑定</el-button></template>
  </el-dialog>
</div>`,
};

// T05 合同管理页面
window.PageRegistry.contract = {
  data() {
    return {
      query: { contractNo: '', contractName: '', customerId: '', status: '' },
      customers: [],
      list: [],
      total: 0,
      page: 1,
      pageSize: 10,
      loading: false,
      statusOptions: [
        { value: 'DRAFT', label: '草稿', tag: 'info' },
        { value: 'ACTIVE', label: '生效', tag: 'success' },
        { value: 'EXPIRED', label: '到期', tag: 'warning' },
        { value: 'TERMINATED', label: '终止', tag: 'danger' },
      ],
      scopeOptions: [
        { value: 'WAREHOUSE', label: '仓储' }, { value: 'CLEARANCE', label: '清关' },
        { value: 'DELIVERY', label: '配送' },
      ],
      dlg: { visible: false, isEdit: false, saving: false, form: {}, scopes: [] },
      rules: {
        contract_name: [{ required: true, message: '请输入合同名称', trigger: 'blur' }],
        customer_id: [{ required: true, message: '请选择客户', trigger: 'change' }],
      },
    };
  },
  created() { this.loadCustomers(); this.load(); },
  methods: {
    statusInfo(v) { return this.statusOptions.find(o => o.value === v) || { label: v, tag: 'info' }; },
    scopeText(v) {
      if (!v) return '-';
      return v.split(',').map(s => (this.scopeOptions.find(o => o.value === s) || { label: s }).label).join('、');
    },
    async loadCustomers() {
      const data = await api('GET', '/api/customers?page=1&pageSize=200');
      this.customers = data.list;
    },
    async load() {
      this.loading = true;
      try {
        const q = new URLSearchParams({ page: this.page, pageSize: this.pageSize });
        for (const [k, v] of Object.entries(this.query)) if (v) q.set(k, v);
        const data = await api('GET', '/api/contracts?' + q.toString());
        this.list = data.list;
        this.total = data.total;
      } finally { this.loading = false; }
    },
    search() { this.page = 1; this.load(); },
    reset() { this.query = { contractNo: '', contractName: '', customerId: '', status: '' }; this.search(); },
    openAdd() {
      this.dlg = { visible: true, isEdit: false, saving: false, scopes: ['CLEARANCE'],
        form: { contract_name: '', customer_id: '', amount: null, sign_date: '', valid_from: '',
                valid_to: '', status: 'ACTIVE', remark: '' } };
    },
    openEdit(row) {
      this.dlg = { visible: true, isEdit: true, saving: false,
        scopes: row.service_scope ? row.service_scope.split(',') : [], form: { ...row } };
    },
    async save() {
      await this.$refs.form.validate();
      this.dlg.saving = true;
      try {
        const body = { ...this.dlg.form, service_scope: this.dlg.scopes.join(',') };
        if (this.dlg.isEdit) await api('PUT', '/api/contracts/' + body.id, body);
        else await api('POST', '/api/contracts', body);
        ElementPlus.ElMessage.success('保存成功');
        this.dlg.visible = false;
        this.load();
      } finally { this.dlg.saving = false; }
    },
    async del(row) {
      await ElementPlus.ElMessageBox.confirm(`确认删除合同「${row.contract_name}」?`, '提示', { type: 'warning' });
      await api('DELETE', '/api/contracts/' + row.id);
      ElementPlus.ElMessage.success('删除成功');
      this.load();
    },
  },
  template: `
<div class="page-card">
  <el-form class="query-bar" inline @submit.prevent>
    <el-form-item label="合同编号">
      <el-input v-model="query.contractNo" clearable style="width:170px" @keyup.enter="search"/>
    </el-form-item>
    <el-form-item label="合同名称">
      <el-input v-model="query.contractName" placeholder="模糊查询" clearable style="width:170px" @keyup.enter="search"/>
    </el-form-item>
    <el-form-item label="客户">
      <el-select v-model="query.customerId" placeholder="——请选择——" clearable filterable style="width:220px">
        <el-option v-for="c in customers" :key="c.id" :label="c.cust_name" :value="String(c.id)"/>
      </el-select>
    </el-form-item>
    <el-form-item label="状态">
      <el-select v-model="query.status" placeholder="——请选择——" clearable style="width:120px">
        <el-option v-for="o in statusOptions" :key="o.value" :label="o.label" :value="o.value"/>
      </el-select>
    </el-form-item>
    <el-form-item>
      <el-button type="primary" :icon="'Search'" @click="search">查询</el-button>
      <el-button @click="reset">重置</el-button>
    </el-form-item>
  </el-form>

  <div class="table-toolbar">
    <el-button type="primary" :icon="'Plus'" @click="openAdd">新增合同</el-button>
  </div>

  <el-table :data="list" v-loading="loading" border stripe>
    <el-table-column label="操作" width="130" fixed>
      <template #default="{ row }">
        <el-button size="small" type="primary" link @click="openEdit(row)">编辑</el-button>
        <el-button size="small" type="danger" link @click="del(row)">删除</el-button>
      </template>
    </el-table-column>
    <el-table-column prop="contract_no" label="合同编号" width="160"/>
    <el-table-column prop="contract_name" label="合同名称" min-width="180" show-overflow-tooltip/>
    <el-table-column prop="cust_name" label="客户" min-width="200" show-overflow-tooltip/>
    <el-table-column label="服务范围" width="130">
      <template #default="{ row }">{{ scopeText(row.service_scope) }}</template>
    </el-table-column>
    <el-table-column prop="amount" label="金额" width="110" align="right"/>
    <el-table-column prop="sign_date" label="签订日期" width="105"/>
    <el-table-column prop="valid_to" label="有效期至" width="120">
      <template #default="{ row }">
        {{ row.valid_to || '-' }}
        <el-tag v-if="row.expire_flag === 'EXPIRING'" type="warning" size="small">将到期</el-tag>
        <el-tag v-if="row.expire_flag === 'EXPIRED'" type="danger" size="small">已过期</el-tag>
      </template>
    </el-table-column>
    <el-table-column label="状态" width="80">
      <template #default="{ row }">
        <el-tag :type="statusInfo(row.status).tag" size="small">{{ statusInfo(row.status).label }}</el-tag>
      </template>
    </el-table-column>
  </el-table>

  <div class="pager">
    <el-pagination background layout="prev, pager, next, jumper, total, sizes"
      :total="total" v-model:current-page="page" v-model:page-size="pageSize"
      :page-sizes="[10, 20, 50, 100]" @change="load"/>
  </div>

  <el-dialog v-model="dlg.visible" :title="dlg.isEdit ? '编辑合同' : '新增合同'" width="640px" destroy-on-close>
    <el-form ref="form" :model="dlg.form" :rules="rules" label-width="100px">
      <el-form-item label="合同名称" prop="contract_name">
        <el-input v-model="dlg.form.contract_name" maxlength="100"/>
      </el-form-item>
      <el-form-item label="客户" prop="customer_id">
        <el-select v-model="dlg.form.customer_id" filterable style="width:100%">
          <el-option v-for="c in customers" :key="c.id" :label="c.cust_name" :value="c.id"/>
        </el-select>
      </el-form-item>
      <el-form-item label="服务范围">
        <el-checkbox-group v-model="dlg.scopes">
          <el-checkbox v-for="o in scopeOptions" :key="o.value" :value="o.value">{{ o.label }}</el-checkbox>
        </el-checkbox-group>
      </el-form-item>
      <el-row>
        <el-col :span="12">
          <el-form-item label="合同金额">
            <el-input-number v-model="dlg.form.amount" :min="0" :precision="2" style="width:100%"/>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="签订日期">
            <el-date-picker v-model="dlg.form.sign_date" type="date" value-format="YYYY-MM-DD" style="width:100%"/>
          </el-form-item>
        </el-col>
      </el-row>
      <el-row>
        <el-col :span="12">
          <el-form-item label="有效期起">
            <el-date-picker v-model="dlg.form.valid_from" type="date" value-format="YYYY-MM-DD" style="width:100%"/>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="有效期止">
            <el-date-picker v-model="dlg.form.valid_to" type="date" value-format="YYYY-MM-DD" style="width:100%"/>
          </el-form-item>
        </el-col>
      </el-row>
      <el-form-item label="状态">
        <el-radio-group v-model="dlg.form.status">
          <el-radio v-for="o in statusOptions" :key="o.value" :value="o.value">{{ o.label }}</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="备注"><el-input v-model="dlg.form.remark" type="textarea" :rows="2"/></el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dlg.visible = false">取消</el-button>
      <el-button type="primary" :loading="dlg.saving" @click="save">保存</el-button>
    </template>
  </el-dialog>
</div>`,
};

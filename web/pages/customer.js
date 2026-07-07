// T04 客户管理页面
window.PageRegistry.customer = {
  data() {
    return {
      query: { custName: '', uscc: '', recordType: '', status: '' },
      list: [],
      total: 0,
      page: 1,
      pageSize: 10,
      loading: false,
      typeOptions: [
        { value: 'EBC', label: '电商企业' }, { value: 'EBP', label: '电商平台' },
        { value: 'PAY', label: '支付企业' }, { value: 'LOGISTICS', label: '物流企业' },
        { value: 'WAREHOUSE', label: '仓储企业' },
      ],
      settleOptions: [
        { value: 'MONTHLY', label: '月结' }, { value: 'SINGLE', label: '单票结算' },
        { value: 'PREPAY', label: '预存' },
      ],
      dlg: { visible: false, isEdit: false, saving: false, form: {} },
      rules: {
        cust_name: [{ required: true, message: '请输入企业名称', trigger: 'blur' }],
        record_type: [{ required: true, message: '请选择备案类型', trigger: 'change' }],
        uscc: [{ pattern: /^[0-9A-Z]{18}$/, message: '须为18位数字/大写字母', trigger: 'blur' }],
        customs_code: [{ pattern: /^[0-9A-Z]{10}$/, message: '须为10位', trigger: 'blur' }],
      },
    };
  },
  created() { this.load(); },
  methods: {
    typeLabel(v) { const o = this.typeOptions.find(o => o.value === v); return o ? o.label : v; },
    settleLabel(v) { const o = this.settleOptions.find(o => o.value === v); return o ? o.label : (v || '-'); },
    async load() {
      this.loading = true;
      try {
        const q = new URLSearchParams({ page: this.page, pageSize: this.pageSize });
        for (const [k, v] of Object.entries(this.query)) if (v) q.set(k, v);
        const data = await api('GET', '/api/customers?' + q.toString());
        this.list = data.list;
        this.total = data.total;
      } finally { this.loading = false; }
    },
    search() { this.page = 1; this.load(); },
    reset() { this.query = { custName: '', uscc: '', recordType: '', status: '' }; this.search(); },
    openAdd() {
      this.dlg = { visible: true, isEdit: false, saving: false,
        form: { cust_name: '', uscc: '', customs_code: '', record_type: 'EBC', contact: '',
                contact_tel: '', settle_type: 'MONTHLY', address: '', status: 'ENABLED', remark: '' } };
    },
    openEdit(row) {
      this.dlg = { visible: true, isEdit: true, saving: false, form: { ...row } };
    },
    async save() {
      await this.$refs.form.validate();
      this.dlg.saving = true;
      try {
        if (this.dlg.isEdit) {
          await api('PUT', '/api/customers/' + this.dlg.form.id, this.dlg.form);
        } else {
          await api('POST', '/api/customers', this.dlg.form);
        }
        ElementPlus.ElMessage.success('保存成功');
        this.dlg.visible = false;
        this.load();
      } finally { this.dlg.saving = false; }
    },
    async del(row) {
      await ElementPlus.ElMessageBox.confirm(`确认删除客户「${row.cust_name}」?`, '提示', { type: 'warning' });
      await api('DELETE', '/api/customers/' + row.id);
      ElementPlus.ElMessage.success('删除成功');
      this.load();
    },
  },
  template: `
<div class="page-card">
  <el-form class="query-bar" inline @submit.prevent>
    <el-form-item label="企业名称">
      <el-input v-model="query.custName" placeholder="模糊查询" clearable style="width:180px" @keyup.enter="search"/>
    </el-form-item>
    <el-form-item label="信用代码">
      <el-input v-model="query.uscc" placeholder="统一社会信用代码" clearable style="width:180px" @keyup.enter="search"/>
    </el-form-item>
    <el-form-item label="备案类型">
      <el-select v-model="query.recordType" placeholder="——请选择——" clearable style="width:140px">
        <el-option v-for="o in typeOptions" :key="o.value" :label="o.label" :value="o.value"/>
      </el-select>
    </el-form-item>
    <el-form-item label="状态">
      <el-select v-model="query.status" placeholder="——请选择——" clearable style="width:120px">
        <el-option label="启用" value="ENABLED"/><el-option label="停用" value="DISABLED"/>
      </el-select>
    </el-form-item>
    <el-form-item>
      <el-button type="primary" :icon="'Search'" @click="search">查询</el-button>
      <el-button @click="reset">重置</el-button>
    </el-form-item>
  </el-form>

  <div class="table-toolbar">
    <el-button type="primary" :icon="'Plus'" @click="openAdd">新增客户</el-button>
  </div>

  <el-table :data="list" v-loading="loading" border stripe>
    <el-table-column label="操作" width="130" fixed>
      <template #default="{ row }">
        <el-button size="small" type="primary" link @click="openEdit(row)">编辑</el-button>
        <el-button size="small" type="danger" link :disabled="!!row.is_self" @click="del(row)">删除</el-button>
      </template>
    </el-table-column>
    <el-table-column prop="cust_code" label="客户编码" width="140"/>
    <el-table-column prop="cust_name" label="企业名称" min-width="220" show-overflow-tooltip>
      <template #default="{ row }">
        {{ row.cust_name }} <el-tag v-if="row.is_self" size="small" type="warning">自营</el-tag>
      </template>
    </el-table-column>
    <el-table-column prop="uscc" label="统一社会信用代码" width="170"/>
    <el-table-column prop="customs_code" label="海关注册编码" width="120"/>
    <el-table-column label="备案类型" width="100">
      <template #default="{ row }">{{ typeLabel(row.record_type) }}</template>
    </el-table-column>
    <el-table-column prop="contact" label="联系人" width="90"/>
    <el-table-column prop="contact_tel" label="联系电话" width="120"/>
    <el-table-column label="结算方式" width="100">
      <template #default="{ row }">{{ settleLabel(row.settle_type) }}</template>
    </el-table-column>
    <el-table-column label="状态" width="80">
      <template #default="{ row }">
        <el-tag :type="row.status === 'ENABLED' ? 'success' : 'info'" size="small">
          {{ row.status === 'ENABLED' ? '启用' : '停用' }}
        </el-tag>
      </template>
    </el-table-column>
    <el-table-column prop="created_at" label="创建时间" width="150"/>
  </el-table>

  <div class="pager">
    <el-pagination background layout="prev, pager, next, jumper, total, sizes"
      :total="total" v-model:current-page="page" v-model:page-size="pageSize"
      :page-sizes="[10, 20, 50, 100]" @change="load"/>
  </div>

  <el-dialog v-model="dlg.visible" :title="dlg.isEdit ? '编辑客户' : '新增客户'" width="640px" destroy-on-close>
    <el-form ref="form" :model="dlg.form" :rules="rules" label-width="130px">
      <el-form-item label="企业名称" prop="cust_name">
        <el-input v-model="dlg.form.cust_name" maxlength="100"/>
      </el-form-item>
      <el-row>
        <el-col :span="12">
          <el-form-item label="统一社会信用代码" prop="uscc">
            <el-input v-model="dlg.form.uscc" maxlength="18" placeholder="18位"/>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="海关注册编码" prop="customs_code">
            <el-input v-model="dlg.form.customs_code" maxlength="10" placeholder="10位"/>
          </el-form-item>
        </el-col>
      </el-row>
      <el-row>
        <el-col :span="12">
          <el-form-item label="备案类型" prop="record_type">
            <el-select v-model="dlg.form.record_type" style="width:100%">
              <el-option v-for="o in typeOptions" :key="o.value" :label="o.label" :value="o.value"/>
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="结算方式">
            <el-select v-model="dlg.form.settle_type" style="width:100%">
              <el-option v-for="o in settleOptions" :key="o.value" :label="o.label" :value="o.value"/>
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>
      <el-row>
        <el-col :span="12">
          <el-form-item label="联系人"><el-input v-model="dlg.form.contact"/></el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="联系电话"><el-input v-model="dlg.form.contact_tel"/></el-form-item>
        </el-col>
      </el-row>
      <el-form-item label="地址"><el-input v-model="dlg.form.address"/></el-form-item>
      <el-form-item label="状态" v-if="dlg.isEdit">
        <el-radio-group v-model="dlg.form.status">
          <el-radio value="ENABLED">启用</el-radio><el-radio value="DISABLED">停用</el-radio>
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

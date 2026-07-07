// T06 HS税率库与正面清单维护
window.PageRegistry.hstax = {
  data() {
    return {
      query: { hs: '', name: '', inList: '' },
      list: [], total: 0, page: 1, pageSize: 10, loading: false,
      dlg: { visible: false, isNew: true, form: {} },
    };
  },
  created() { this.load(); },
  methods: {
    async load() {
      this.loading = true;
      try {
        const q = new URLSearchParams({ page: this.page, pageSize: this.pageSize });
        for (const [k, v] of Object.entries(this.query)) if (v !== '') q.set(k, v);
        const data = await api('GET', '/api/hstax?' + q.toString());
        this.list = data.list; this.total = data.total;
      } finally { this.loading = false; }
    },
    search() { this.page = 1; this.load(); },
    add() { this.dlg = { visible: true, isNew: true, form: { vat_rate: 0.13, consump_rate: 0, in_positive_list: 1 } }; },
    edit(row) { this.dlg = { visible: true, isNew: false, form: { ...row } }; },
    async save() {
      const f = this.dlg.form;
      if (!f.hs_code) return ElementPlus.ElMessage.warning('HS编码必填');
      if (this.dlg.isNew) await api('POST', '/api/hstax', f);
      else await api('PUT', '/api/hstax/' + f.id, f);
      ElementPlus.ElMessage.success('保存成功'); this.dlg.visible = false; this.load();
    },
    async del(row) {
      await ElementPlus.ElMessageBox.confirm(`确认删除 HS ${row.hs_code}?`, '提示', { type: 'warning' });
      await api('DELETE', '/api/hstax/' + row.id);
      ElementPlus.ElMessage.success('已删除'); this.load();
    },
    pct(v) { return v != null ? (v * 100).toFixed(1) + '%' : '-'; },
  },
  template: `
<div class="page-card">
  <el-alert type="info" :closable="false" style="margin-bottom:12px"
    title="HS税率库是商品备案与综合税计算的基础:维护每个HS的增值税率、消费税率,以及是否在跨境电商零售进口正面清单内(不在册的商品不能申报)。"/>
  <el-form class="query-bar" inline @submit.prevent>
    <el-form-item label="HS编码"><el-input v-model="query.hs" clearable style="width:150px" @keyup.enter="search"/></el-form-item>
    <el-form-item label="名称"><el-input v-model="query.name" clearable style="width:150px" @keyup.enter="search"/></el-form-item>
    <el-form-item label="正面清单">
      <el-select v-model="query.inList" placeholder="全部" clearable style="width:110px">
        <el-option label="在册" value="1"/><el-option label="不在册" value="0"/>
      </el-select>
    </el-form-item>
    <el-form-item><el-button type="primary" :icon="'Search'" @click="search">查询</el-button></el-form-item>
  </el-form>

  <div class="table-toolbar"><el-button type="primary" :icon="'Plus'" @click="add">新增HS</el-button></div>

  <el-table :data="list" v-loading="loading" border stripe>
    <el-table-column label="操作" width="120" fixed>
      <template #default="{ row }">
        <el-button size="small" type="primary" link @click="edit(row)">编辑</el-button>
        <el-button size="small" type="danger" link @click="del(row)">删除</el-button>
      </template>
    </el-table-column>
    <el-table-column prop="hs_code" label="HS编码" width="140"/>
    <el-table-column prop="hs_name" label="名称" min-width="180"/>
    <el-table-column label="增值税率" width="100" align="right"><template #default="{ row }">{{ pct(row.vat_rate) }}</template></el-table-column>
    <el-table-column label="消费税率" width="100" align="right"><template #default="{ row }">{{ pct(row.consump_rate) }}</template></el-table-column>
    <el-table-column label="正面清单" width="100">
      <template #default="{ row }"><el-tag :type="row.in_positive_list ? 'success' : 'danger'" size="small">{{ row.in_positive_list ? '在册' : '不在册' }}</el-tag></template>
    </el-table-column>
  </el-table>

  <div class="pager">
    <el-pagination background layout="prev, pager, next, jumper, total"
      :total="total" v-model:current-page="page" v-model:page-size="pageSize" @change="load"/>
  </div>

  <el-dialog v-model="dlg.visible" :title="dlg.isNew ? '新增HS税率' : '编辑HS税率'" width="480px">
    <el-form :model="dlg.form" label-width="90px">
      <el-form-item label="HS编码" required><el-input v-model="dlg.form.hs_code" :disabled="!dlg.isNew"/></el-form-item>
      <el-form-item label="名称"><el-input v-model="dlg.form.hs_name"/></el-form-item>
      <el-form-item label="增值税率"><el-input-number v-model="dlg.form.vat_rate" :min="0" :max="1" :step="0.01" :precision="4" style="width:100%"/></el-form-item>
      <el-form-item label="消费税率"><el-input-number v-model="dlg.form.consump_rate" :min="0" :max="1" :step="0.01" :precision="4" style="width:100%"/></el-form-item>
      <el-form-item label="正面清单"><el-switch v-model="dlg.form.in_positive_list" :active-value="1" :inactive-value="0" active-text="在册" inactive-text="不在册"/></el-form-item>
    </el-form>
    <template #footer><el-button @click="dlg.visible=false">取消</el-button><el-button type="primary" @click="save">保存</el-button></template>
  </el-dialog>
</div>`,
};

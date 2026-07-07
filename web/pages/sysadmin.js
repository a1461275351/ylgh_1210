// T18 用户管理 / 参数配置 / 代码表

window.PageRegistry.user = {
  data() {
    return { query: { kw: '' }, list: [], total: 0, page: 1, pageSize: 10, loading: false, roles: [],
      dlg: { visible: false, isNew: true, form: {} } };
  },
  created() { this.loadRoles(); this.load(); },
  methods: {
    async loadRoles() { this.roles = await api('GET', '/api/sys/roles'); },
    async load() {
      this.loading = true;
      try { const d = await api('GET', `/api/sys/users?page=${this.page}&pageSize=${this.pageSize}&kw=${encodeURIComponent(this.query.kw)}`); this.list = d.list; this.total = d.total; }
      finally { this.loading = false; }
    },
    search() { this.page = 1; this.load(); },
    add() { this.dlg = { visible: true, isNew: true, form: { username: '', real_name: '', password: '123456', roleIds: [] } }; },
    edit(row) { this.dlg = { visible: true, isNew: false, form: { id: row.id, username: row.username, real_name: row.real_name, mobile: row.mobile, email: row.email, status: row.status, roleIds: row.roles.map(r => r.id) } }; },
    async save() {
      const f = this.dlg.form;
      if (!f.username || !f.real_name) return ElementPlus.ElMessage.warning('用户名与姓名必填');
      if (this.dlg.isNew) await api('POST', '/api/sys/users', f);
      else await api('PUT', '/api/sys/users/' + f.id, f);
      ElementPlus.ElMessage.success('保存成功'); this.dlg.visible = false; this.load();
    },
    async resetPwd(row) {
      const { value } = await ElementPlus.ElMessageBox.prompt('输入新密码', '重置密码 - ' + row.username, { inputValue: '123456' });
      await api('POST', `/api/sys/users/${row.id}/reset-pwd`, { password: value });
      ElementPlus.ElMessage.success('密码已重置');
    },
    async toggle(row) {
      await api('PUT', '/api/sys/users/' + row.id, { status: row.status === 'ENABLED' ? 'DISABLED' : 'ENABLED' });
      this.load();
    },
    async del(row) {
      await ElementPlus.ElMessageBox.confirm(`确认删除用户「${row.username}」?`, '提示', { type: 'warning' });
      await api('DELETE', '/api/sys/users/' + row.id); ElementPlus.ElMessage.success('已删除'); this.load();
    },
  },
  template: `
<div class="page-card">
  <el-form class="query-bar" inline @submit.prevent>
    <el-form-item label="用户"><el-input v-model="query.kw" clearable style="width:180px" @keyup.enter="search"/></el-form-item>
    <el-form-item><el-button type="primary" :icon="'Search'" @click="search">查询</el-button></el-form-item>
  </el-form>
  <div class="table-toolbar"><el-button type="primary" :icon="'Plus'" @click="add">新增用户</el-button></div>
  <el-table :data="list" v-loading="loading" border stripe>
    <el-table-column label="操作" width="240" fixed>
      <template #default="{ row }">
        <el-button size="small" type="primary" link @click="edit(row)">编辑</el-button>
        <el-button size="small" type="warning" link @click="resetPwd(row)">重置密码</el-button>
        <el-button size="small" link @click="toggle(row)">{{ row.status==='ENABLED'?'停用':'启用' }}</el-button>
        <el-button size="small" type="danger" link v-if="row.username!=='admin'" @click="del(row)">删除</el-button>
      </template>
    </el-table-column>
    <el-table-column prop="username" label="用户名" width="140"/>
    <el-table-column prop="real_name" label="姓名" width="120"/>
    <el-table-column label="角色" min-width="180"><template #default="{ row }"><el-tag v-for="r in row.roles" :key="r.id" size="small" style="margin:1px">{{ r.role_name }}</el-tag></template></el-table-column>
    <el-table-column prop="mobile" label="手机" width="130"/>
    <el-table-column label="状态" width="90"><template #default="{ row }"><el-tag :type="row.status==='ENABLED'?'success':'info'" size="small">{{ row.status==='ENABLED'?'启用':'停用' }}</el-tag></template></el-table-column>
  </el-table>
  <div class="pager"><el-pagination background layout="prev, pager, next, jumper, total" :total="total" v-model:current-page="page" v-model:page-size="pageSize" @change="load"/></div>

  <el-dialog v-model="dlg.visible" :title="dlg.isNew?'新增用户':'编辑用户'" width="500px">
    <el-form :model="dlg.form" label-width="80px">
      <el-form-item label="用户名" required><el-input v-model="dlg.form.username" :disabled="!dlg.isNew"/></el-form-item>
      <el-form-item label="姓名" required><el-input v-model="dlg.form.real_name"/></el-form-item>
      <el-form-item v-if="dlg.isNew" label="初始密码"><el-input v-model="dlg.form.password"/></el-form-item>
      <el-form-item label="手机"><el-input v-model="dlg.form.mobile"/></el-form-item>
      <el-form-item label="角色">
        <el-select v-model="dlg.form.roleIds" multiple style="width:100%">
          <el-option v-for="r in roles" :key="r.id" :label="r.role_name" :value="r.id"/>
        </el-select>
      </el-form-item>
    </el-form>
    <template #footer><el-button @click="dlg.visible=false">取消</el-button><el-button type="primary" @click="save">保存</el-button></template>
  </el-dialog>
</div>`,
};

window.PageRegistry.param = {
  data() { return { list: [], loading: false }; },
  created() { this.load(); },
  methods: {
    async load() { this.loading = true; try { this.list = await api('GET', '/api/sys/params'); } finally { this.loading = false; } },
    async edit(row) {
      const { value } = await ElementPlus.ElMessageBox.prompt(row.param_desc || row.param_key, '修改参数', { inputValue: row.param_value });
      await api('PUT', '/api/sys/params/' + row.param_key, { param_value: value });
      ElementPlus.ElMessage.success('已更新'); this.load();
    },
  },
  template: `
<div class="page-card">
  <el-alert type="info" :closable="false" style="margin-bottom:12px" title="政策/系统参数:限值、额度、税率折扣、退货天数、账册预警等。政策调整只需改这里,无需改代码。"/>
  <el-table :data="list" v-loading="loading" border stripe>
    <el-table-column prop="param_key" label="参数键" width="220"/>
    <el-table-column prop="param_value" label="参数值" width="160"/>
    <el-table-column prop="param_desc" label="说明" min-width="240"/>
    <el-table-column prop="updated_at" label="更新时间" width="160"/>
    <el-table-column label="操作" width="90"><template #default="{ row }"><el-button size="small" type="primary" link @click="edit(row)">修改</el-button></template></el-table-column>
  </el-table>
</div>`,
};

window.PageRegistry.code = {
  data() { return { list: [], loading: false, dlg: { visible: false, form: {} } }; },
  created() { this.load(); },
  methods: {
    async load() { this.loading = true; try { this.list = await api('GET', '/api/sys/codes'); } finally { this.loading = false; } },
    add() { this.dlg = { visible: true, form: { code_type: '', code: '', name: '' } }; },
    async save() {
      const f = this.dlg.form;
      if (!f.code_type || !f.code || !f.name) return ElementPlus.ElMessage.warning('类型/代码/名称必填');
      await api('POST', '/api/sys/codes', f); ElementPlus.ElMessage.success('已新增'); this.dlg.visible = false; this.load();
    },
    async del(row) { await ElementPlus.ElMessageBox.confirm('确认删除?', '提示', { type: 'warning' }); await api('DELETE', '/api/sys/codes/' + row.id); this.load(); },
  },
  template: `
<div class="page-card">
  <el-alert type="info" :closable="false" style="margin-bottom:12px" title="海关标准参数代码表:监管方式、运输方式、币制、国别、计量单位、关别等。"/>
  <div class="table-toolbar"><el-button type="primary" :icon="'Plus'" @click="add">新增代码</el-button></div>
  <el-table :data="list" v-loading="loading" border stripe max-height="560">
    <el-table-column prop="code_type" label="代码类型" width="160"/>
    <el-table-column prop="code" label="代码" width="120"/>
    <el-table-column prop="name" label="名称" min-width="200"/>
    <el-table-column label="操作" width="80"><template #default="{ row }"><el-button size="small" type="danger" link @click="del(row)">删除</el-button></template></el-table-column>
  </el-table>
  <el-dialog v-model="dlg.visible" title="新增代码" width="440px">
    <el-form :model="dlg.form" label-width="80px">
      <el-form-item label="类型" required><el-input v-model="dlg.form.code_type" placeholder="如 CURRENCY"/></el-form-item>
      <el-form-item label="代码" required><el-input v-model="dlg.form.code"/></el-form-item>
      <el-form-item label="名称" required><el-input v-model="dlg.form.name"/></el-form-item>
    </el-form>
    <template #footer><el-button @click="dlg.visible=false">取消</el-button><el-button type="primary" @click="save">保存</el-button></template>
  </el-dialog>
</div>`,
};

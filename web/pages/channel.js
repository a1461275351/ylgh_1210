// T19 申报通道配置
window.PageRegistry.channel = {
  data() {
    return { list: [], loading: false, dlg: { visible: false, form: {} } };
  },
  created() { this.load(); },
  methods: {
    async load() {
      this.loading = true;
      try { this.list = await api('GET', '/api/channels'); }
      finally { this.loading = false; }
    },
    edit(row) { this.dlg = { visible: true, form: { ...row } }; },
    async save() {
      await api('PUT', '/api/channels/' + this.dlg.form.id, {
        endpoint: this.dlg.form.endpoint, remark: this.dlg.form.remark,
        enabled: this.dlg.form.enabled ? 1 : 0,
      });
      ElementPlus.ElMessage.success('保存成功');
      this.dlg.visible = false; this.load();
    },
    async setDefault(row) {
      await api('POST', `/api/channels/${row.id}/default`);
      ElementPlus.ElMessage.success(`已将【${row.channel_name}】设为默认申报通道`);
      this.load();
    },
  },
  template: `
<div class="page-card">
  <el-alert type="info" :closable="false" style="margin-bottom:12px"
    title="双轨通道:DIRECT 单一窗口自建直连(生产目标,已有电子口岸卡,待联调补 endpoint)/ THIRD 第三方通关服务商 / SIMULATOR 回执模拟器(原型联调)。默认通道决定申报走哪条,可随时切换、互为灾备。"/>
  <el-table :data="list" v-loading="loading" border stripe>
    <el-table-column label="操作" width="150" fixed>
      <template #default="{ row }">
        <el-button size="small" type="primary" link @click="edit(row)">配置</el-button>
        <el-button size="small" type="success" link :disabled="!!row.is_default || !row.enabled" @click="setDefault(row)">设为默认</el-button>
      </template>
    </el-table-column>
    <el-table-column prop="channel_code" label="通道代码" width="120"/>
    <el-table-column prop="channel_name" label="通道名称" width="180"/>
    <el-table-column prop="msg_types" label="支持报文" width="180"/>
    <el-table-column prop="endpoint" label="接口地址" min-width="200" show-overflow-tooltip>
      <template #default="{ row }">{{ row.endpoint || '(未配置)' }}</template>
    </el-table-column>
    <el-table-column label="默认" width="70">
      <template #default="{ row }"><el-tag v-if="row.is_default" type="success" size="small">默认</el-tag></template>
    </el-table-column>
    <el-table-column label="状态" width="80">
      <template #default="{ row }">
        <el-tag :type="row.enabled ? 'success' : 'info'" size="small">{{ row.enabled ? '启用' : '停用' }}</el-tag>
      </template>
    </el-table-column>
    <el-table-column prop="remark" label="备注" min-width="220" show-overflow-tooltip/>
  </el-table>

  <el-dialog v-model="dlg.visible" :title="'配置通道:' + (dlg.form.channel_name || '')" width="560px">
    <el-form :model="dlg.form" label-width="100px">
      <el-form-item label="接口地址">
        <el-input v-model="dlg.form.endpoint" placeholder="直连/第三方 endpoint;联调后填写"/>
      </el-form-item>
      <el-form-item label="启用">
        <el-switch v-model="dlg.form.enabled" :active-value="1" :inactive-value="0"/>
      </el-form-item>
      <el-form-item label="备注"><el-input v-model="dlg.form.remark" type="textarea" :rows="2"/></el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dlg.visible = false">取消</el-button>
      <el-button type="primary" @click="save">保存</el-button>
    </template>
  </el-dialog>
</div>`,
};

// T19 报文日志:收发留痕 / 查看原文 / 失败重发
window.PageRegistry.msgLog = {
  data() {
    return {
      query: { msgType: '', bizNo: '', direction: '', status: '' },
      list: [], total: 0, page: 1, pageSize: 15, loading: false,
      dlg: { visible: false, title: '', content: '' },
    };
  },
  created() { this.load(); },
  methods: {
    async load() {
      this.loading = true;
      try {
        const q = new URLSearchParams({ page: this.page, pageSize: this.pageSize });
        for (const [k, v] of Object.entries(this.query)) if (v) q.set(k, v);
        const data = await api('GET', '/api/msglogs?' + q.toString());
        this.list = data.list; this.total = data.total;
      } finally { this.loading = false; }
    },
    search() { this.page = 1; this.load(); },
    statusTag(s) { return { PENDING: 'info', SENT: 'warning', ACKED: 'success', FAIL: 'danger' }[s] || 'info'; },
    async view(row) {
      const d = await api('GET', '/api/msglogs/' + row.id);
      this.dlg = { visible: true, title: `${row.direction === 'SEND' ? '发送' : '接收'} ${row.msg_type} — ${row.biz_no}`, content: d.content };
    },
    async resend(row) {
      await ElementPlus.ElMessageBox.confirm(`确认重发报文「${row.biz_no}」?`, '提示', { type: 'warning' });
      const r = await api('POST', `/api/msglogs/${row.id}/resend`);
      ElementPlus.ElMessage.success('重发完成');
      this.load();
    },
  },
  template: `
<div class="page-card">
  <el-form class="query-bar" inline @submit.prevent>
    <el-form-item label="报文类型">
      <el-select v-model="query.msgType" placeholder="全部" clearable style="width:130px">
        <el-option label="CEB311 订单" value="CEB311"/>
        <el-option label="CEB621 清单申报" value="CEB621"/>
        <el-option label="CEB622 清单回执" value="CEB622"/>
      </el-select>
    </el-form-item>
    <el-form-item label="业务单号">
      <el-input v-model="query.bizNo" clearable style="width:170px" @keyup.enter="search"/>
    </el-form-item>
    <el-form-item label="方向">
      <el-select v-model="query.direction" placeholder="全部" clearable style="width:110px">
        <el-option label="发送" value="SEND"/><el-option label="接收" value="RECV"/>
      </el-select>
    </el-form-item>
    <el-form-item label="状态">
      <el-select v-model="query.status" placeholder="全部" clearable style="width:110px">
        <el-option label="待发" value="PENDING"/><el-option label="已发" value="SENT"/>
        <el-option label="已回执" value="ACKED"/><el-option label="失败" value="FAIL"/>
      </el-select>
    </el-form-item>
    <el-form-item>
      <el-button type="primary" :icon="'Search'" @click="search">查询</el-button>
    </el-form-item>
  </el-form>

  <el-table :data="list" v-loading="loading" border stripe>
    <el-table-column label="操作" width="130" fixed>
      <template #default="{ row }">
        <el-button size="small" type="primary" link @click="view(row)">原文</el-button>
        <el-button size="small" type="warning" link :disabled="row.status !== 'FAIL' || row.direction !== 'SEND'" @click="resend(row)">重发</el-button>
      </template>
    </el-table-column>
    <el-table-column prop="id" label="ID" width="70"/>
    <el-table-column label="方向" width="80">
      <template #default="{ row }">
        <el-tag :type="row.direction === 'SEND' ? '' : 'success'" size="small">{{ row.direction === 'SEND' ? '发送' : '接收' }}</el-tag>
      </template>
    </el-table-column>
    <el-table-column prop="msg_type" label="报文类型" width="110"/>
    <el-table-column prop="biz_no" label="业务单号" width="170"/>
    <el-table-column prop="channel" label="通道" width="110"/>
    <el-table-column label="状态" width="90">
      <template #default="{ row }"><el-tag :type="statusTag(row.status)" size="small">{{ row.status }}</el-tag></template>
    </el-table-column>
    <el-table-column prop="retry_count" label="重试" width="60"/>
    <el-table-column prop="error_msg" label="错误信息" min-width="160" show-overflow-tooltip/>
    <el-table-column prop="created_at" label="时间" width="150"/>
  </el-table>

  <div class="pager">
    <el-pagination background layout="prev, pager, next, jumper, total"
      :total="total" v-model:current-page="page" v-model:page-size="pageSize" @change="load"/>
  </div>

  <el-dialog v-model="dlg.visible" :title="dlg.title" width="720px">
    <pre style="max-height:60vh;overflow:auto;background:#282c34;color:#abb2bf;padding:12px;border-radius:4px;font-size:12px">{{ dlg.content }}</pre>
  </el-dialog>
</div>`,
};

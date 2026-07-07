// T19 申报清单(演示):生成样例 → 申报推送单一窗口(模拟器)→ 查看回执与报文
window.PageRegistry.inventory = {
  data() {
    return {
      query: { orderNo: '', status: '' },
      list: [], total: 0, page: 1, pageSize: 10, loading: false,
      sampleType: 'normal',
      statusMap: {
        DRAFT: { label: '暂存', tag: 'info' }, AUDIT2: { label: '待复审', tag: '' },
        DECLARED: { label: '已申报', tag: 'warning' }, CUSTOMS_REJECT: { label: '海关退单', tag: 'danger' },
        RELEASED: { label: '放行', tag: 'success' }, CANCELLED: { label: '已撤销', tag: 'info' },
      },
      drawer: { visible: false, head: {}, items: [], msgs: [] },
      msgDlg: { visible: false, title: '', content: '' },
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
        const data = await api('GET', '/api/inventories?' + q.toString());
        this.list = data.list; this.total = data.total;
      } finally { this.loading = false; }
    },
    search() { this.page = 1; this.load(); },
    async genSample() {
      const d = await api('POST', '/api/inventories/sample?type=' + this.sampleType);
      ElementPlus.ElMessage.success(`已生成样例清单 ${d.order_no}(货值 ${d.goods_amount},税 ${d.tax_total})`);
      this.search();
    },
    async declare(row) {
      await ElementPlus.ElMessageBox.confirm(
        `确认将清单「${row.order_no}」通过【${row.channel}】通道申报推送单一窗口?`, '申报确认', { type: 'warning' });
      const r = await api('POST', `/api/inventories/${row.id}/declare`);
      if (r.customsStatus === '120')
        ElementPlus.ElMessage.success(`海关放行,清单编号 ${r.invtNo}`);
      else
        ElementPlus.ElMessage.warning(`海关退单:${r.retMsg}`);
      this.load();
    },
    async detail(row) {
      const d = await api('GET', '/api/inventories/' + row.id);
      this.drawer = { visible: true, head: d.head, items: d.items, msgs: d.msgs };
    },
    async viewMsg(m) {
      const d = await api('GET', '/api/msglogs/' + m.id);
      this.msgDlg = { visible: true, title: `${m.direction === 'SEND' ? '发送' : '接收'} ${m.msg_type}`, content: d.content };
    },
    async del(row) {
      await ElementPlus.ElMessageBox.confirm(`确认删除清单「${row.order_no}」?`, '提示', { type: 'warning' });
      await api('DELETE', '/api/inventories/' + row.id);
      ElementPlus.ElMessage.success('删除成功');
      this.load();
    },
  },
  template: `
<div class="page-card">
  <el-alert type="info" :closable="false" style="margin-bottom:12px"
    title="演示说明:此处样例清单用于验证报文引擎与申报通道。生产环境清单由「订单→清单」自动生成(T09)。当前默认走【回执模拟器】,规则:超5000元单次限值 / 不在正面清单 → 退单,否则放行。"/>

  <el-form class="query-bar" inline @submit.prevent>
    <el-form-item label="订单号">
      <el-input v-model="query.orderNo" clearable style="width:180px" @keyup.enter="search"/>
    </el-form-item>
    <el-form-item label="状态">
      <el-select v-model="query.status" placeholder="——请选择——" clearable style="width:130px">
        <el-option v-for="(v,k) in statusMap" :key="k" :label="v.label" :value="k"/>
      </el-select>
    </el-form-item>
    <el-form-item>
      <el-button type="primary" :icon="'Search'" @click="search">查询</el-button>
    </el-form-item>
  </el-form>

  <div class="table-toolbar">
    <el-select v-model="sampleType" style="width:200px">
      <el-option label="样例:正常(将放行)" value="normal"/>
      <el-option label="样例:超单次限值(将退单)" value="overlimit"/>
      <el-option label="样例:不在正面清单(将退单)" value="notlist"/>
    </el-select>
    <el-button type="primary" :icon="'Plus'" @click="genSample">生成样例清单</el-button>
  </div>

  <el-table :data="list" v-loading="loading" border stripe>
    <el-table-column label="操作" width="180" fixed>
      <template #default="{ row }">
        <el-button size="small" type="success" link
          :disabled="!['DRAFT','CUSTOMS_REJECT'].includes(row.status)" @click="declare(row)">申报推送</el-button>
        <el-button size="small" type="primary" link @click="detail(row)">详情/报文</el-button>
        <el-button size="small" type="danger" link
          :disabled="!['DRAFT','CUSTOMS_REJECT'].includes(row.status)" @click="del(row)">删除</el-button>
      </template>
    </el-table-column>
    <el-table-column prop="order_no" label="订单号" width="160"/>
    <el-table-column prop="invt_no" label="清单编号" width="150">
      <template #default="{ row }">{{ row.invt_no || '-' }}</template>
    </el-table-column>
    <el-table-column prop="buyer_name" label="订购人" width="90"/>
    <el-table-column prop="goods_amount" label="货值" width="90" align="right"/>
    <el-table-column prop="tax_total" label="综合税" width="90" align="right"/>
    <el-table-column label="状态" width="100">
      <template #default="{ row }"><el-tag :type="st(row.status).tag" size="small">{{ st(row.status).label }}</el-tag></template>
    </el-table-column>
    <el-table-column prop="ret_msg" label="海关回执" min-width="200" show-overflow-tooltip>
      <template #default="{ row }">{{ row.ret_msg || '-' }}</template>
    </el-table-column>
    <el-table-column prop="channel" label="通道" width="100"/>
    <el-table-column prop="declare_time" label="申报时间" width="150"/>
  </el-table>

  <div class="pager">
    <el-pagination background layout="prev, pager, next, jumper, total, sizes"
      :total="total" v-model:current-page="page" v-model:page-size="pageSize"
      :page-sizes="[10, 20, 50]" @change="load"/>
  </div>

  <el-drawer v-model="drawer.visible" title="清单详情与报文链路" size="55%">
    <el-descriptions :column="2" border size="small" title="表头">
      <el-descriptions-item label="订单号">{{ drawer.head.order_no }}</el-descriptions-item>
      <el-descriptions-item label="清单编号">{{ drawer.head.invt_no || '-' }}</el-descriptions-item>
      <el-descriptions-item label="订购人">{{ drawer.head.buyer_name }}</el-descriptions-item>
      <el-descriptions-item label="账册号">{{ drawer.head.ems_no }}</el-descriptions-item>
      <el-descriptions-item label="货值">{{ drawer.head.goods_amount }}</el-descriptions-item>
      <el-descriptions-item label="综合税">{{ drawer.head.tax_total }}</el-descriptions-item>
      <el-descriptions-item label="状态">
        <el-tag :type="st(drawer.head.status).tag" size="small">{{ st(drawer.head.status).label }}</el-tag>
      </el-descriptions-item>
      <el-descriptions-item label="海关回执">{{ drawer.head.ret_msg || '-' }}</el-descriptions-item>
    </el-descriptions>

    <el-divider content-position="left">表体</el-divider>
    <el-table :data="drawer.items" border size="small">
      <el-table-column prop="seq_no" label="序号" width="55"/>
      <el-table-column prop="product_name" label="品名" min-width="160"/>
      <el-table-column prop="hs_code" label="HS编码" width="110"/>
      <el-table-column prop="qty" label="数量" width="70"/>
      <el-table-column prop="unit_price" label="单价" width="80"/>
      <el-table-column prop="total_price" label="金额" width="90"/>
      <el-table-column prop="tax_amount" label="税额" width="90"/>
    </el-table>

    <el-divider content-position="left">报文收发链路</el-divider>
    <el-timeline>
      <el-timeline-item v-for="m in drawer.msgs" :key="m.id"
        :type="m.direction === 'SEND' ? 'primary' : 'success'" :timestamp="m.created_at">
        <el-link type="primary" @click="viewMsg(m)">
          {{ m.direction === 'SEND' ? '➤ 发送' : '◀ 接收' }} {{ m.msg_type }}(通道 {{ m.channel }})— 点击查看报文原文
        </el-link>
      </el-timeline-item>
      <el-empty v-if="!drawer.msgs.length" description="尚未申报,无报文记录"/>
    </el-timeline>
  </el-drawer>

  <el-dialog v-model="msgDlg.visible" :title="msgDlg.title" width="720px">
    <pre style="max-height:60vh;overflow:auto;background:#282c34;color:#abb2bf;padding:12px;border-radius:4px;font-size:12px">{{ msgDlg.content }}</pre>
  </el-dialog>
</div>`,
};

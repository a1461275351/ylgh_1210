// T10 核注清单:一线入区核增 / 二线出区核减(驱动账册库存)
window.PageRegistry.bondInvt = {
  data() {
    return {
      query: { flowType: '', status: '', bondNo: '' }, list: [], total: 0, page: 1, pageSize: 10, loading: false,
      statusMap: { DRAFT: { label: '录入', tag: 'info' }, DECLARED: { label: '已申报', tag: 'warning' }, APPROVED: { label: '审批通过', tag: 'success' }, REJECTED: { label: '退单', tag: 'danger' } },
      drawer: { visible: false, head: {}, items: [] },
      outDlg: { visible: false, released: [], selected: [] },
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
        const d = await api('GET', '/api/bond-invt?' + q.toString()); this.list = d.list; this.total = d.total;
      } finally { this.loading = false; }
    },
    search() { this.page = 1; this.load(); },
    async declare(row) { const r = await api('POST', `/api/bond-invt/${row.id}/declare`); ElementPlus.ElMessage.success('已申报金二 ' + r.bond_invt_no); this.load(); },
    async approve(row) {
      const r = await api('POST', `/api/bond-invt/${row.id}/approve`);
      ElementPlus.ElMessage.success(`审批通过,账册已${r.flow === 'IN' ? '核增' : '核减'}`); this.load();
    },
    async reject(row) { const { value } = await ElementPlus.ElMessageBox.prompt('退单原因', '退单', {}); await api('POST', `/api/bond-invt/${row.id}/reject`, { remark: value }); ElementPlus.ElMessage.success('已退单'); this.load(); },
    async genPassport(row) { await api('POST', `/api/passport/from-bond/${row.id}`); ElementPlus.ElMessage.success('已生成核放单,请到「核放单管理」过卡'); this.load(); },
    async detail(row) { const d = await api('GET', '/api/bond-invt/' + row.id); this.drawer = { visible: true, head: d, items: d.items }; },
    async del(row) { await ElementPlus.ElMessageBox.confirm('确认删除?', '提示', { type: 'warning' }); await api('DELETE', '/api/bond-invt/' + row.id); ElementPlus.ElMessage.success('已删除'); this.load(); },
    async openOut() {
      const d = await api('GET', '/api/inventories?status=RELEASED&pageSize=100');
      this.outDlg = { visible: true, released: d.list.filter(x => !x.bond_invt_no), selected: [] };
    },
    onSel(rows) { this.outDlg.selected = rows.map(r => r.id); },
    async genOut() {
      if (!this.outDlg.selected.length) return ElementPlus.ElMessage.warning('请勾选放行清单');
      const r = await api('POST', '/api/bond-invt/from-inventories', { inventoryIds: this.outDlg.selected });
      ElementPlus.ElMessage.success(`已生成出区核注清单(汇总 ${r.itemCount} 个备案序号)`); this.outDlg.visible = false; this.load();
    },
  },
  template: `
<div class="page-card">
  <el-alert type="info" :closable="false" style="margin-bottom:12px"
    title="核注清单是账册记账单证:一线入区核增、二线出区核减。审批通过时真实变更账册库存。入区由进境报关单生成,出区由放行清单汇总生成。"/>
  <el-form class="query-bar" inline @submit.prevent>
    <el-form-item label="方向"><el-select v-model="query.flowType" placeholder="全部" clearable style="width:120px"><el-option label="一线入区" value="IN"/><el-option label="二线出区" value="OUT"/></el-select></el-form-item>
    <el-form-item label="状态"><el-select v-model="query.status" placeholder="全部" clearable style="width:120px"><el-option v-for="(v,k) in statusMap" :key="k" :label="v.label" :value="k"/></el-select></el-form-item>
    <el-form-item label="单号"><el-input v-model="query.bondNo" clearable style="width:160px" @keyup.enter="search"/></el-form-item>
    <el-form-item><el-button type="primary" :icon="'Search'" @click="search">查询</el-button></el-form-item>
  </el-form>
  <div class="table-toolbar"><el-button type="primary" :icon="'SoldOut'" @click="openOut">生成出区核注(放行清单汇总)</el-button></div>
  <el-table :data="list" v-loading="loading" border stripe>
    <el-table-column label="操作" width="230" fixed>
      <template #default="{ row }">
        <el-button size="small" type="primary" link @click="detail(row)">详情</el-button>
        <el-button size="small" type="warning" link v-if="['DRAFT','REJECTED'].includes(row.status)" @click="declare(row)">申报</el-button>
        <el-button size="small" type="success" link v-if="row.status==='DECLARED'" @click="approve(row)">审批</el-button>
        <el-button size="small" type="danger" link v-if="row.status==='DECLARED'" @click="reject(row)">退单</el-button>
        <el-button size="small" type="success" link v-if="row.status==='APPROVED'" @click="genPassport(row)">生成核放</el-button>
        <el-button size="small" type="danger" link v-if="['DRAFT','REJECTED'].includes(row.status)" @click="del(row)">删除</el-button>
      </template>
    </el-table-column>
    <el-table-column prop="internal_no" label="内部编号" width="150"/>
    <el-table-column prop="bond_invt_no" label="核注清单号" width="150"><template #default="{ row }">{{ row.bond_invt_no || '-' }}</template></el-table-column>
    <el-table-column label="方向" width="100"><template #default="{ row }"><el-tag :type="row.flow_type==='IN' ? '' : 'warning'" size="small">{{ row.flow_label }}</el-tag></template></el-table-column>
    <el-table-column prop="ems_no" label="账册号" width="150"/>
    <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="st(row.status).tag" size="small">{{ st(row.status).label }}</el-tag></template></el-table-column>
    <el-table-column prop="ret_msg" label="回执" min-width="180" show-overflow-tooltip/>
  </el-table>
  <div class="pager"><el-pagination background layout="prev, pager, next, jumper, total" :total="total" v-model:current-page="page" v-model:page-size="pageSize" @change="load"/></div>

  <el-drawer v-model="drawer.visible" title="核注清单详情" size="52%">
    <el-descriptions :column="2" border size="small">
      <el-descriptions-item label="内部编号">{{ drawer.head.internal_no }}</el-descriptions-item>
      <el-descriptions-item label="方向">{{ drawer.head.flow_label }}</el-descriptions-item>
      <el-descriptions-item label="账册号">{{ drawer.head.ems_no }}</el-descriptions-item>
      <el-descriptions-item label="料件/成品">{{ drawer.head.mtpck_endprd === 'I' ? '料件' : '成品' }}</el-descriptions-item>
      <el-descriptions-item label="关联零售清单" :span="2">{{ drawer.head.rlt_invt_nos || '-' }}</el-descriptions-item>
    </el-descriptions>
    <el-divider content-position="left">表体(账册核算)</el-divider>
    <el-table :data="drawer.items" border size="small">
      <el-table-column prop="seq_no" label="#" width="45"/>
      <el-table-column prop="ems_item_no" label="备案序号" width="90"/>
      <el-table-column prop="product_name" label="品名" min-width="150"/>
      <el-table-column prop="hs_code" label="HS编码" width="120"/>
      <el-table-column prop="qty" label="核注数量" width="100" align="right"/>
    </el-table>
  </el-drawer>

  <el-dialog v-model="outDlg.visible" title="选择放行清单生成出区核注(核减账册)" width="720px">
    <el-table :data="outDlg.released" border size="small" @selection-change="onSel" height="360">
      <el-table-column type="selection" width="45"/>
      <el-table-column prop="order_no" label="订单号" width="160"/>
      <el-table-column prop="invt_no" label="清单号" width="150"/>
      <el-table-column prop="buyer_name" label="订购人" width="90"/>
      <el-table-column prop="goods_amount" label="货值" width="90" align="right"/>
    </el-table>
    <template #footer><el-button @click="outDlg.visible=false">取消</el-button><el-button type="primary" @click="genOut">生成出区核注清单</el-button></template>
  </el-dialog>
</div>`,
};

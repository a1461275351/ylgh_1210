// T12 报关单:一线进境备货(1210 进口)
window.PageRegistry.decl = {
  data() {
    return {
      query: { entryNo: '', status: '' }, list: [], total: 0, page: 1, pageSize: 10, loading: false,
      statusMap: { DRAFT: { label: '录入', tag: 'info' }, DECLARED: { label: '已申报', tag: 'warning' }, RELEASED: { label: '放行', tag: 'success' }, REJECTED: { label: '退单', tag: 'danger' } },
      drawer: { visible: false, head: {}, items: [], bond: null },
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
        const d = await api('GET', '/api/decl?' + q.toString()); this.list = d.list; this.total = d.total;
      } finally { this.loading = false; }
    },
    search() { this.page = 1; this.load(); },
    async genSample() {
      const d = await api('POST', '/api/decl/sample?emsNo=T901625A00100');
      ElementPlus.ElMessage.success(`已生成进境备货报关单(${d.itemCount} 项商品,各 500 件)`); this.search();
    },
    async declare(row) { await api('POST', `/api/decl/${row.id}/declare`); ElementPlus.ElMessage.success('已申报'); this.load(); },
    async release(row) { await api('POST', `/api/decl/${row.id}/release`); ElementPlus.ElMessage.success('海关放行'); this.load(); },
    async genBond(row) {
      await api('POST', `/api/bond-invt/from-decl/${row.id}`);
      ElementPlus.ElMessage.success('已生成入区核注清单,请到「核注清单管理」申报核增账册'); this.detail(row);
    },
    async detail(row) { const d = await api('GET', '/api/decl/' + row.id); this.drawer = { visible: true, head: d, items: d.items, bond: d.bond }; },
    async del(row) { await ElementPlus.ElMessageBox.confirm('确认删除?', '提示', { type: 'warning' }); await api('DELETE', '/api/decl/' + row.id); ElementPlus.ElMessage.success('已删除'); this.load(); },
  },
  template: `
<div class="page-card">
  <el-alert type="info" :closable="false" style="margin-bottom:12px"
    title="一线进境备货报关单(监管方式 1210 进口):境外货物批量备货进保税仓的报关。放行后据此生成入区核注清单核增账册。"/>
  <el-form class="query-bar" inline @submit.prevent>
    <el-form-item label="报关单号"><el-input v-model="query.entryNo" clearable style="width:180px" @keyup.enter="search"/></el-form-item>
    <el-form-item label="状态"><el-select v-model="query.status" placeholder="全部" clearable style="width:120px"><el-option v-for="(v,k) in statusMap" :key="k" :label="v.label" :value="k"/></el-select></el-form-item>
    <el-form-item><el-button type="primary" :icon="'Search'" @click="search">查询</el-button></el-form-item>
  </el-form>
  <div class="table-toolbar"><el-button type="primary" :icon="'Plus'" @click="genSample">生成备货进口报关单</el-button></div>
  <el-table :data="list" v-loading="loading" border stripe>
    <el-table-column label="操作" width="220" fixed>
      <template #default="{ row }">
        <el-button size="small" type="primary" link @click="detail(row)">详情</el-button>
        <el-button size="small" type="warning" link v-if="['DRAFT','REJECTED'].includes(row.status)" @click="declare(row)">申报</el-button>
        <el-button size="small" type="success" link v-if="row.status==='DECLARED'" @click="release(row)">放行</el-button>
        <el-button size="small" type="success" link v-if="row.status==='RELEASED'" @click="genBond(row)">生成核注</el-button>
        <el-button size="small" type="danger" link v-if="['DRAFT','REJECTED'].includes(row.status)" @click="del(row)">删除</el-button>
      </template>
    </el-table-column>
    <el-table-column prop="internal_no" label="内部编号" width="150"/>
    <el-table-column prop="entry_no" label="报关单号" width="170"><template #default="{ row }">{{ row.entry_no || '-' }}</template></el-table-column>
    <el-table-column label="监管方式" width="90"><template #default>1210</template></el-table-column>
    <el-table-column prop="ems_no" label="账册号" width="150"/>
    <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="st(row.status).tag" size="small">{{ st(row.status).label }}</el-tag></template></el-table-column>
    <el-table-column prop="created_at" label="创建时间" width="150"/>
  </el-table>
  <div class="pager"><el-pagination background layout="prev, pager, next, jumper, total" :total="total" v-model:current-page="page" v-model:page-size="pageSize" @change="load"/></div>

  <el-drawer v-model="drawer.visible" title="进境备货报关单" size="52%">
    <el-descriptions :column="2" border size="small">
      <el-descriptions-item label="内部编号">{{ drawer.head.internal_no }}</el-descriptions-item>
      <el-descriptions-item label="报关单号">{{ drawer.head.entry_no || '(待申报)' }}</el-descriptions-item>
      <el-descriptions-item label="监管方式">1210 保税跨境电商</el-descriptions-item>
      <el-descriptions-item label="账册号">{{ drawer.head.ems_no }}</el-descriptions-item>
      <el-descriptions-item label="状态"><el-tag :type="st(drawer.head.status).tag" size="small">{{ st(drawer.head.status).label }}</el-tag></el-descriptions-item>
      <el-descriptions-item label="关联核注清单">{{ drawer.bond ? drawer.bond.internal_no : '未生成' }}</el-descriptions-item>
    </el-descriptions>
    <el-divider content-position="left">表体商品</el-divider>
    <el-table :data="drawer.items" border size="small">
      <el-table-column prop="seq_no" label="#" width="45"/>
      <el-table-column prop="ems_item_no" label="备案序号" width="90"/>
      <el-table-column prop="product_name" label="品名" min-width="150"/>
      <el-table-column prop="hs_code" label="HS编码" width="120"/>
      <el-table-column prop="qty" label="数量" width="90"/>
      <el-table-column prop="unit_price" label="单价" width="80"/>
    </el-table>
  </el-drawer>
</div>`,
};

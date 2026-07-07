// T17 业务统计看板 + 全链路追溯
window.PageRegistry.stat = {
  data() {
    return { d: null, loading: false, balance: { emsNo: 'T901625A00100', list: [] } };
  },
  created() { this.load(); this.loadBalance(); },
  methods: {
    async load() { this.loading = true; try { this.d = await api('GET', '/api/stat/overview'); } finally { this.loading = false; } },
    async loadBalance() { try { const r = await api('GET', '/api/stat/ems-balance?emsNo=' + this.balance.emsNo); this.balance.list = r.list; } catch (e) {} },
    label(s) { return { RECEIVED:'已接收',CHECK_FAIL:'校验失败',CHECKED:'已校验',INVT_CREATED:'已生成清单',RELEASED:'放行',OUTBOUND:'已出库',SIGNED:'签收',REFUNDING:'退货中',CLOSED:'关闭',DRAFT:'暂存',CUSTOMS_REJECT:'退单',CANCELLED:'撤销' }[s] || s; },
  },
  template: `
<div class="page-card" v-loading="loading" v-if="d">
  <el-row :gutter="12">
    <el-col :span="6"><div class="stat-card" style="background:#409eff"><div class="n">{{ d.cards.orders }}</div><div class="t">订单总数</div></div></el-col>
    <el-col :span="6"><div class="stat-card" style="background:#67c23a"><div class="n">{{ d.cards.released }}</div><div class="t">清单放行</div></div></el-col>
    <el-col :span="6"><div class="stat-card" style="background:#e6a23c"><div class="n">{{ d.rates.releaseRate }}%</div><div class="t">放行率(退单率 {{ d.rates.rejectRate }}%)</div></div></el-col>
    <el-col :span="6"><div class="stat-card" style="background:#f56c6c"><div class="n">{{ d.cards.refunds }}</div><div class="t">退货单</div></div></el-col>
  </el-row>
  <el-row :gutter="12" style="margin-top:12px">
    <el-col :span="6"><div class="stat-card" style="background:#909399"><div class="n">{{ d.cards.customers }}</div><div class="t">客户</div></div></el-col>
    <el-col :span="6"><div class="stat-card" style="background:#909399"><div class="n">{{ d.cards.products }}</div><div class="t">备案商品</div></div></el-col>
    <el-col :span="6"><div class="stat-card" style="background:#909399"><div class="n">{{ d.cards.ems }}</div><div class="t">生效账册</div></div></el-col>
    <el-col :span="6"><div class="stat-card" style="background:#606266"><div class="n">￥{{ d.tax.pending }}</div><div class="t">待缴税款(累计 ￥{{ d.tax.total }})</div></div></el-col>
  </el-row>

  <el-row :gutter="12" style="margin-top:16px">
    <el-col :span="12">
      <el-card shadow="never" header="订单状态分布">
        <el-table :data="d.orderByStatus" size="small" :show-header="false">
          <el-table-column><template #default="{row}">{{ label(row.status) }}</template></el-table-column>
          <el-table-column prop="c" width="80" align="right"/>
        </el-table>
      </el-card>
    </el-col>
    <el-col :span="12">
      <el-card shadow="never" header="担保额度">
        <el-descriptions :column="1" size="small" border>
          <el-descriptions-item label="总额度">￥{{ d.guarantee.total }}</el-descriptions-item>
          <el-descriptions-item label="已占用">￥{{ d.guarantee.used }}</el-descriptions-item>
          <el-descriptions-item label="可用">￥{{ d.guarantee.available }}</el-descriptions-item>
        </el-descriptions>
        <el-progress :percentage="Math.min(100,d.guarantee.usedRatio)" :status="d.guarantee.usedRatio>=80?'exception':'success'" style="margin-top:10px"/>
      </el-card>
    </el-col>
  </el-row>

  <el-card shadow="never" header="账册余量(T901625A00100)" style="margin-top:16px">
    <el-table :data="balance.list" size="small" border>
      <el-table-column prop="item_no" label="序号" width="70"/>
      <el-table-column prop="product_name" label="品名" min-width="160"/>
      <el-table-column prop="in_qty" label="累计入区" width="110" align="right"/>
      <el-table-column prop="out_qty" label="累计出区" width="110" align="right"/>
      <el-table-column prop="balance" label="当前结余" width="110" align="right"><template #default="{row}"><b>{{ row.balance }}</b></template></el-table-column>
    </el-table>
  </el-card>
</div>`,
};

// T17 全链路单证追溯
window.PageRegistry.trace = {
  data() { return { kw: '', nodes: [], current: '', orderNo: '', searched: false }; },
  methods: {
    async run() {
      if (!this.kw.trim()) return ElementPlus.ElMessage.warning('请输入订单号/清单号/运单号');
      try {
        const d = await api('GET', '/api/stat/trace?kw=' + encodeURIComponent(this.kw.trim()));
        this.nodes = d.nodes; this.current = d.current; this.orderNo = d.order_no; this.searched = true;
      } catch (e) { this.nodes = []; this.searched = true; }
    },
  },
  template: `
<div class="page-card">
  <el-alert type="info" :closable="false" style="margin-bottom:12px" title="全链路追溯:输入订单号 / 清单号 / 运单号,查看该单从接入到出库/退货的全过程时间轴。"/>
  <el-form inline @submit.prevent>
    <el-form-item label="单号"><el-input v-model="kw" style="width:260px" placeholder="订单号/清单号/运单号" @keyup.enter="run"/></el-form-item>
    <el-form-item><el-button type="primary" :icon="'Search'" @click="run">追溯</el-button></el-form-item>
  </el-form>
  <div v-if="orderNo" style="margin:8px 0 16px;color:#606266">订单 <b>{{ orderNo }}</b> · 当前状态 <el-tag size="small">{{ current }}</el-tag></div>
  <el-timeline v-if="nodes.length">
    <el-timeline-item v-for="(n,i) in nodes" :key="i" :timestamp="n.time" placement="top" type="primary">
      <el-card shadow="never">
        <b>{{ n.node }}</b> <el-tag size="small" style="margin-left:8px">{{ n.status }}</el-tag>
        <div style="color:#909399;font-size:13px;margin-top:4px">{{ n.detail }}</div>
      </el-card>
    </el-timeline-item>
  </el-timeline>
  <el-empty v-else-if="searched" description="未找到相关单据"/>
</div>`,
};

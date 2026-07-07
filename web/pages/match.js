// T08 三单对碰监控:订单/支付/运单/清单 四单状态矩阵
window.PageRegistry.match = {
  data() {
    return { list: [], total: 0, page: 1, pageSize: 15, loading: false };
  },
  created() { this.load(); },
  methods: {
    async load() {
      this.loading = true;
      try {
        const data = await api('GET', `/api/orders/match/monitor?page=${this.page}&pageSize=${this.pageSize}`);
        this.list = data.list; this.total = data.total;
      } finally { this.loading = false; }
    },
    dot(has) { return has ? '✔' : '✘'; },
    dotColor(has) { return has ? '#67c23a' : '#f56c6c'; },
  },
  template: `
<div class="page-card">
  <el-alert type="info" :closable="false" style="margin-bottom:12px"
    title="三单对碰:海关放行前比对 订单/支付单/运单/清单 四类数据的一致性。任一缺失或超时未对碰将预警。支付单、运单通常由支付/物流企业各自推送,本表监控其到位情况。"/>
  <div class="table-toolbar"><el-button :icon="'Refresh'" @click="load">刷新</el-button></div>
  <el-table :data="list" v-loading="loading" border stripe>
    <el-table-column prop="order_no" label="订单号" width="170"/>
    <el-table-column prop="buyer_name" label="订购人" width="100"/>
    <el-table-column prop="goods_amount" label="货值" width="100" align="right"/>
    <el-table-column label="订单" width="70" align="center">
      <template #default="{ row }"><span :style="{color:dotColor(row.has.order)}">{{ dot(row.has.order) }}</span></template>
    </el-table-column>
    <el-table-column label="支付单" width="75" align="center">
      <template #default="{ row }"><span :style="{color:dotColor(row.has.payment)}">{{ dot(row.has.payment) }}</span></template>
    </el-table-column>
    <el-table-column label="运单" width="70" align="center">
      <template #default="{ row }"><span :style="{color:dotColor(row.has.logistics)}">{{ dot(row.has.logistics) }}</span></template>
    </el-table-column>
    <el-table-column label="清单" width="70" align="center">
      <template #default="{ row }"><span :style="{color:dotColor(row.has.inventory)}">{{ dot(row.has.inventory) }}</span></template>
    </el-table-column>
    <el-table-column label="对碰状态" width="110">
      <template #default="{ row }">
        <el-tag :type="row.match_status === '齐全' ? 'success' : 'danger'" size="small">{{ row.match_status }}</el-tag>
      </template>
    </el-table-column>
    <el-table-column prop="missing" label="缺失单证" min-width="160"/>
  </el-table>
  <div class="pager">
    <el-pagination background layout="prev, pager, next, jumper, total"
      :total="total" v-model:current-page="page" v-model:page-size="pageSize" @change="load"/>
  </div>
</div>`,
};

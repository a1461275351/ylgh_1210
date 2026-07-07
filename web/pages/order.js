// T08 订单管理:接入 / 校验结果 / 生成清单 / 详情(支付·运单·清单)
window.PageRegistry.order = {
  data() {
    return {
      query: { orderNo: '', buyer: '', status: '' },
      list: [], total: 0, page: 1, pageSize: 10, loading: false,
      sampleType: 'good',
      statusMap: {
        RECEIVED: { label: '已接收', tag: 'info' }, CHECK_FAIL: { label: '校验失败', tag: 'danger' },
        CHECKED: { label: '已校验', tag: '' }, INVT_CREATED: { label: '已生成清单', tag: 'warning' },
        DECLARING: { label: '申报中', tag: 'warning' }, RELEASED: { label: '放行', tag: 'success' },
        OUTBOUND: { label: '已出库', tag: 'success' }, SIGNED: { label: '签收', tag: 'success' },
      },
      drawer: { visible: false, head: {}, items: [], payment: null, logistics: null, inventory: null },
    };
  },
  created() { this.load(); },
  methods: {
    st(s) { return this.statusMap[s] || { label: s, tag: 'info' }; },
    issueTag(l) { return l === 'FAIL' ? 'danger' : (l === 'WARN' ? 'warning' : 'info'); },
    async load() {
      this.loading = true;
      try {
        const q = new URLSearchParams({ page: this.page, pageSize: this.pageSize });
        for (const [k, v] of Object.entries(this.query)) if (v) q.set(k, v);
        const data = await api('GET', '/api/orders?' + q.toString());
        this.list = data.list; this.total = data.total;
      } finally { this.loading = false; }
    },
    search() { this.page = 1; this.load(); },
    async genSample() {
      const d = await api('POST', '/api/orders/sample?type=' + this.sampleType);
      const v = d.validation;
      if (v.level === 'FAIL') ElementPlus.ElMessage.warning(`订单 ${d.order_no} 校验未通过:${v.issues.filter(i=>i.level==='FAIL').map(i=>i.msg).join(';')}`);
      else if (v.level === 'WARN') ElementPlus.ElMessage.warning(`订单 ${d.order_no} 校验通过(有预警)`);
      else ElementPlus.ElMessage.success(`订单 ${d.order_no} 校验通过`);
      this.search();
    },
    async recheck(row) {
      const d = await api('POST', `/api/orders/${row.id}/recheck`);
      ElementPlus.ElMessage[d.validation.pass ? 'success' : 'warning'](d.validation.pass ? '校验通过' : '仍有拦截项');
      this.load();
    },
    async genInv(row) {
      await api('POST', `/api/inventories/from-order/${row.id}`);
      ElementPlus.ElMessage.success('已生成申报清单,可在「清单管理→申报清单」申报推送');
      this.load();
    },
    async detail(row) {
      const d = await api('GET', '/api/orders/' + row.id);
      this.drawer = { visible: true, ...d };
    },
    async addPayment() {
      await api('POST', `/api/orders/${this.drawer.head.id}/payment`);
      ElementPlus.ElMessage.success('已登记支付单');
      this.detail(this.drawer.head);
    },
    async addLogistics() {
      await api('POST', `/api/orders/${this.drawer.head.id}/logistics`);
      ElementPlus.ElMessage.success('已登记运单');
      this.detail(this.drawer.head);
    },
    async declareInv() {
      const r = await api('POST', `/api/inventories/${this.drawer.inventory.id}/declare`);
      ElementPlus.ElMessage[r.customsStatus === '120' ? 'success' : 'warning'](
        r.customsStatus === '120' ? `海关放行 ${r.invtNo}` : `退单:${r.retMsg}`);
      this.detail(this.drawer.head);
      this.load();
    },
  },
  template: `
<div class="page-card">
  <el-form class="query-bar" inline @submit.prevent>
    <el-form-item label="订单号"><el-input v-model="query.orderNo" clearable style="width:170px" @keyup.enter="search"/></el-form-item>
    <el-form-item label="订购人"><el-input v-model="query.buyer" clearable style="width:120px" @keyup.enter="search"/></el-form-item>
    <el-form-item label="状态">
      <el-select v-model="query.status" placeholder="——请选择——" clearable style="width:140px">
        <el-option v-for="(v,k) in statusMap" :key="k" :label="v.label" :value="k"/>
      </el-select>
    </el-form-item>
    <el-form-item><el-button type="primary" :icon="'Search'" @click="search">查询</el-button></el-form-item>
  </el-form>

  <div class="table-toolbar">
    <el-select v-model="sampleType" style="width:210px">
      <el-option label="样例:正常订单(通过)" value="good"/>
      <el-option label="样例:超单次限值(失败)" value="overlimit"/>
      <el-option label="样例:账册余量不足(失败)" value="short"/>
      <el-option label="样例:非正面清单(失败)" value="notlist"/>
      <el-option label="样例:价格异常(预警)" value="pricediff"/>
    </el-select>
    <el-button type="primary" :icon="'Plus'" @click="genSample">接入样例订单</el-button>
  </div>

  <el-table :data="list" v-loading="loading" border stripe>
    <el-table-column label="操作" width="180" fixed>
      <template #default="{ row }">
        <el-button size="small" type="primary" link @click="detail(row)">详情</el-button>
        <el-button size="small" type="success" link v-if="row.status === 'CHECKED'" @click="genInv(row)">生成清单</el-button>
        <el-button size="small" type="warning" link v-if="row.status === 'CHECK_FAIL'" @click="recheck(row)">重新校验</el-button>
      </template>
    </el-table-column>
    <el-table-column prop="order_no" label="订单号" width="160"/>
    <el-table-column prop="buyer_name" label="订购人" width="90"/>
    <el-table-column prop="goods_amount" label="货值" width="90" align="right"/>
    <el-table-column prop="actual_paid" label="实付" width="90" align="right"/>
    <el-table-column label="状态" width="105">
      <template #default="{ row }"><el-tag :type="st(row.status).tag" size="small">{{ st(row.status).label }}</el-tag></template>
    </el-table-column>
    <el-table-column label="校验" min-width="240">
      <template #default="{ row }">
        <span v-if="!row.issues.length" style="color:#67c23a">✔ 通过</span>
        <el-tag v-for="(is,i) in row.issues" :key="i" :type="issueTag(is.level)" size="small" style="margin:1px" effect="plain">{{ is.msg }}</el-tag>
      </template>
    </el-table-column>
    <el-table-column prop="platform_name" label="平台" width="120"/>
    <el-table-column prop="created_at" label="接入时间" width="150"/>
  </el-table>

  <div class="pager">
    <el-pagination background layout="prev, pager, next, jumper, total, sizes"
      :total="total" v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="[10,20,50]" @change="load"/>
  </div>

  <el-drawer v-model="drawer.visible" title="订单详情 / 三单" size="56%">
    <el-descriptions :column="2" border size="small">
      <el-descriptions-item label="订单号">{{ drawer.head.order_no }}</el-descriptions-item>
      <el-descriptions-item label="状态"><el-tag :type="st(drawer.head.status).tag" size="small">{{ st(drawer.head.status).label }}</el-tag></el-descriptions-item>
      <el-descriptions-item label="订购人">{{ drawer.head.buyer_name }}</el-descriptions-item>
      <el-descriptions-item label="证件号">{{ drawer.head.buyer_id_no }}</el-descriptions-item>
      <el-descriptions-item label="货值">{{ drawer.head.goods_amount }}</el-descriptions-item>
      <el-descriptions-item label="实付">{{ drawer.head.actual_paid }}</el-descriptions-item>
    </el-descriptions>

    <el-divider content-position="left">订单明细</el-divider>
    <el-table :data="drawer.items" border size="small">
      <el-table-column prop="seq_no" label="#" width="45"/>
      <el-table-column prop="sku" label="SKU" width="120"/>
      <el-table-column prop="product_name" label="品名" min-width="150"/>
      <el-table-column prop="qty" label="数量" width="70"/>
      <el-table-column prop="unit_price" label="单价" width="80"/>
      <el-table-column prop="total_price" label="金额" width="90"/>
    </el-table>

    <el-divider content-position="left">校验结果</el-divider>
    <div v-if="!drawer.head.issues || !drawer.head.issues.length" style="color:#67c23a">✔ 全部通过</div>
    <el-tag v-for="(is,i) in drawer.head.issues" :key="i" :type="issueTag(is.level)" size="small" style="margin:2px" effect="plain">
      [{{ is.level }}] {{ is.msg }}
    </el-tag>

    <el-divider content-position="left">三单与清单</el-divider>
    <el-descriptions :column="1" border size="small">
      <el-descriptions-item label="支付单">
        <span v-if="drawer.payment">{{ drawer.payment.pay_no }}({{ drawer.payment.pay_company }})— {{ drawer.payment.push_status }}</span>
        <el-button v-else size="small" @click="addPayment">登记支付单</el-button>
      </el-descriptions-item>
      <el-descriptions-item label="运单">
        <span v-if="drawer.logistics">{{ drawer.logistics.logistics_no }}({{ drawer.logistics.logistics_name }})— {{ drawer.logistics.track_status }}</span>
        <el-button v-else size="small" @click="addLogistics">登记运单</el-button>
      </el-descriptions-item>
      <el-descriptions-item label="清单">
        <template v-if="drawer.inventory">
          {{ drawer.inventory.invt_no || '(未申报)' }} — {{ drawer.inventory.status }}
          <el-button v-if="['DRAFT','CUSTOMS_REJECT'].includes(drawer.inventory.status)" size="small" type="success" @click="declareInv">申报推送</el-button>
        </template>
        <span v-else>未生成(订单校验通过后可在列表「生成清单」)</span>
      </el-descriptions-item>
    </el-descriptions>
  </el-drawer>
</div>`,
};

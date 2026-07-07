// 全局布局:左侧菜单树 + 顶部多页签 + 页面注册器
(function () {
  // ---- 全局 API 封装(自动附带登录令牌)----
  window.api = async function (method, url, data) {
    const opt = { method, headers: { 'Content-Type': 'application/json' } };
    const token = localStorage.getItem('ccs_token');
    if (token) opt.headers['Authorization'] = 'Bearer ' + token;
    if (data !== undefined) opt.body = JSON.stringify(data);
    const resp = await fetch(url, opt);
    const json = await resp.json();
    if (json.code === 401) { localStorage.removeItem('ccs_token'); location.reload(); throw new Error('未登录'); }
    if (json.code !== 0) {
      ElementPlus.ElMessage.error(json.message || '请求失败');
      throw new Error(json.message);
    }
    return json.data;
  };

  // ---- 菜单树(对应需求文档模块;未实现页面显示占位) ----
  const MENUS = [
    { title: '客户管理', icon: 'User', children: [{ key: 'customer', title: '客户档案' }] },
    { title: '合同管理', icon: 'Document', children: [{ key: 'contract', title: '合同维护' }] },
    { title: '商品备案', icon: 'Goods', children: [
      { key: 'goods', title: '商品备案资料库' }, { key: 'hstax', title: 'HS税率库' }] },
    { title: '保税仓/物流账册', icon: 'Notebook', children: [
      { key: 'emsRecord', title: '账册备案' }, { key: 'emsChange', title: '账册变更' },
      { key: 'emsAudit1', title: '账册初审' }, { key: 'emsAudit2', title: '账册复审' },
      { key: 'emsLedger', title: '账册台账' }] },
    { title: '三单数据中心', icon: 'Connection', children: [
      { key: 'order', title: '订单管理' }, { key: 'payment', title: '支付单' },
      { key: 'logistics', title: '运单管理' }, { key: 'match', title: '三单对碰监控' }] },
    { title: '清单管理', icon: 'Tickets', children: [
      { key: 'inventory', title: '申报清单' }, { key: 'reject', title: '退单工作台' },
      { key: 'summary', title: '集报清单' }] },
    { title: '核注清单管理', icon: 'List', children: [{ key: 'bondInvt', title: '核注清单' }] },
    { title: '核放单管理', icon: 'Van', children: [{ key: 'passport', title: '核放单' }] },
    { title: '报关单管理', icon: 'Files', children: [{ key: 'decl', title: '报关单' }] },
    { title: '税费管理', icon: 'Money', children: [
      { key: 'tax', title: '税单管理' }, { key: 'guarantee', title: '担保额度' }] },
    { title: '退货管理', icon: 'RefreshLeft', children: [{ key: 'refund', title: '退货单' }] },
    { title: 'WMS协同', icon: 'Box', children: [
      { key: 'wmsIn', title: '入库单' }, { key: 'wmsOut', title: '出库单' },
      { key: 'stockDiff', title: '三账比对' }] },
    { title: '报核核销', icon: 'Finished', children: [
      { key: 'verify', title: '报核管理' }, { key: 'stocktake', title: '盘点管理' }] },
    { title: '综合查询', icon: 'Search', children: [
      { key: 'stat', title: '业务统计' }, { key: 'trace', title: '链路查询' }] },
    { title: '系统管理', icon: 'Setting', children: [
      { key: 'user', title: '用户管理' }, { key: 'param', title: '参数配置' },
      { key: 'code', title: '代码表' }, { key: 'msgLog', title: '报文日志' },
      { key: 'channel', title: '通道配置' }] },
  ];

  const App = {
    data() {
      return {
        menus: MENUS,
        collapsed: false,
        tabs: [],
        active: '',
        authUser: null,           // 已登录用户
        booting: true,            // 启动校验中
        login: { username: 'admin', password: '', loading: false },
      };
    },
    computed: {
      currentComp() {
        if (!this.active) return null;
        return window.PageRegistry[this.active] ? 'page-' + this.active : 'page-placeholder';
      },
      activeTitle() {
        const t = this.tabs.find(t => t.key === this.active);
        return t ? t.title : '';
      },
    },
    methods: {
      openPage(item) {
        if (!this.tabs.some(t => t.key === item.key)) {
          this.tabs.push({ key: item.key, title: item.title });
        }
        this.active = item.key;
      },
      closeTab(key) {
        const idx = this.tabs.findIndex(t => t.key === key);
        if (idx === -1) return;
        this.tabs.splice(idx, 1);
        if (this.active === key) {
          const next = this.tabs[idx] || this.tabs[idx - 1];
          this.active = next ? next.key : '';
        }
      },
      async doLogin() {
        if (!this.login.username || !this.login.password) return ElementPlus.ElMessage.warning('请输入用户名和密码');
        this.login.loading = true;
        try {
          const resp = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: this.login.username, password: this.login.password }) });
          const json = await resp.json();
          if (json.code !== 0) return ElementPlus.ElMessage.error(json.message || '登录失败');
          localStorage.setItem('ccs_token', json.data.token);
          this.authUser = json.data.user;
          ElementPlus.ElMessage.success('欢迎,' + json.data.user.real_name);
          this.openPage({ key: 'stat', title: '业务统计' });
        } finally { this.login.loading = false; }
      },
      logout() {
        localStorage.removeItem('ccs_token');
        this.authUser = null; this.tabs = []; this.active = '';
      },
      roleText() { return (this.authUser.roles || []).map(r => r.role_name).join('、') || '—'; },
    },
    async mounted() {
      const token = localStorage.getItem('ccs_token');
      if (token) {
        try {
          const resp = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } });
          const json = await resp.json();
          if (json.code === 0) { this.authUser = json.data; this.openPage({ key: 'stat', title: '业务统计' }); }
          else localStorage.removeItem('ccs_token');
        } catch (e) { /* ignore */ }
      }
      this.booting = false;
    },
    template: `
<div v-if="booting" style="height:100vh;display:flex;align-items:center;justify-content:center;color:#888">加载中...</div>

<div v-else-if="!authUser" class="login-wrap">
  <div class="login-card">
    <div class="login-title">1210 保税跨境电商关务管理系统</div>
    <div class="login-sub">综合服务平台 · 登录</div>
    <el-form @submit.prevent="doLogin" style="margin-top:20px">
      <el-form-item>
        <el-input v-model="login.username" size="large" placeholder="用户名" :prefix-icon="'User'"/>
      </el-form-item>
      <el-form-item>
        <el-input v-model="login.password" size="large" type="password" show-password placeholder="密码" :prefix-icon="'Lock'" @keyup.enter="doLogin"/>
      </el-form-item>
      <el-button type="primary" size="large" style="width:100%" :loading="login.loading" @click="doLogin">登 录</el-button>
    </el-form>
    <div class="login-tip">初始账号:admin / admin123</div>
  </div>
</div>

<el-container v-else class="layout">
  <el-aside :width="collapsed ? '64px' : '220px'" class="sidebar">
    <div class="logo">{{ collapsed ? '1210' : '1210 综合服务平台' }}</div>
    <el-menu :collapse="collapsed" :collapse-transition="false" background-color="#2e3b52"
             text-color="#cdd5e3" active-text-color="#ffffff" :default-active="active" unique-opened>
      <el-sub-menu v-for="(m, i) in menus" :key="i" :index="String(i)">
        <template #title><el-icon><component :is="m.icon"/></el-icon><span>{{ m.title }}</span></template>
        <el-menu-item v-for="c in m.children" :key="c.key" :index="c.key" @click="openPage(c)">
          {{ c.title }}
        </el-menu-item>
      </el-sub-menu>
    </el-menu>
  </el-aside>
  <el-container>
    <el-header class="topbar" height="48px">
      <el-icon class="collapse-btn" @click="collapsed = !collapsed">
        <Fold v-if="!collapsed"/><Expand v-else/>
      </el-icon>
      <span class="sys-name">关务管理系统</span>
      <div class="topbar-right">
        <span>{{ authUser.real_name }}({{ roleText() }})┃ 西安市航空基地协航供应链管理有限公司</span>
        <el-button link type="primary" style="margin-left:12px" @click="logout">退出</el-button>
      </div>
    </el-header>
    <div class="tabs-bar" v-if="tabs.length">
      <el-tabs v-model="active" type="card" closable @tab-remove="closeTab">
        <el-tab-pane v-for="t in tabs" :key="t.key" :name="t.key" :label="t.title"/>
      </el-tabs>
    </div>
    <el-main class="content">
      <keep-alive>
        <component v-if="currentComp" :is="currentComp" :key="active" :title="activeTitle"/>
      </keep-alive>
      <el-empty v-if="!currentComp" description="请从左侧菜单选择功能"/>
    </el-main>
  </el-container>
</el-container>`,
  };

  const app = Vue.createApp(App);
  app.use(ElementPlus, { locale: ElementPlusLocaleZhCn });
  // 注册全部图标
  for (const [name, comp] of Object.entries(ElementPlusIconsVue)) app.component(name, comp);
  // 占位页(未实现功能)
  app.component('page-placeholder', {
    props: ['title'],
    template: `<div class="page-card"><el-empty :description="(title || '该功能') + ' 开发中,请参考开发任务拆分文档'"/></div>`,
  });
  // 注册已实现页面
  for (const [key, comp] of Object.entries(window.PageRegistry)) app.component('page-' + key, comp);
  app.mount('#app');
})();

/*
 * Prototype shell: device frame, status bar, the control panel (prototype tooling — not part of the app),
 * theme / font / platform switches and the simulated system notification.
 */
(function () {
  const LV = window.LV, I = LV.icon;
  const device = () => document.getElementById('device');

  /* ── Theme / font / platform / width ─────────────────── */
  LV.setTheme = t => {
    LV.state.theme = t;
    const d = device(); d.classList.remove('theme-light', 'theme-dark');
    if (t !== 'system') d.classList.add(`theme-${t}`);
    LV.savePrefs(); LV.syncPanel();
  };
  LV.setFont = s => { LV.state.fontScale = s; device().style.setProperty('--font-scale', s); LV.savePrefs(); LV.syncPanel(); };
  LV.setPlatform = p => {
    LV.state.platform = p; const d = device();
    d.classList.toggle('platform-harmony', p === 'harmony'); d.classList.toggle('platform-android', p === 'android');
    renderStatusBar(); LV.savePrefs(); LV.syncPanel(); LV.refresh();
  };
  LV.setWidth = w => { LV.state.width = w; document.documentElement.style.setProperty('--device-w', `${w + 20}px`); LV.savePrefs(); LV.syncPanel(); };

  function renderStatusBar() {
    const sb = document.querySelector('.sys-statusbar'); if (!sb) return;
    const harmony = LV.state.platform === 'harmony';
    const signal = '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="10" width="2.5" height="4" rx=".6"/><rect x="5" y="7.5" width="2.5" height="6.5" rx=".6"/><rect x="9" y="5" width="2.5" height="9" rx=".6"/><rect x="13" y="2" width="2.5" height="12" rx=".6" opacity=".35"/></svg>';
    const wifi = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 6.2a9 9 0 0 1 12 0"/><path d="M4.3 8.8a5.6 5.6 0 0 1 7.4 0"/><circle cx="8" cy="11.8" r="1.1" fill="currentColor" stroke="none"/></svg>';
    const battery = '<svg viewBox="0 0 24 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1" y="3" width="19" height="10" rx="2.6"/><rect x="3" y="5" width="13" height="6" rx="1.2" fill="currentColor" stroke="none"/><path d="M22 6.5v3" stroke-linecap="round"/></svg>';
    sb.innerHTML = `<span>10:24</span><span class="sb-cam"></span><span class="sb-icons">${harmony ? `<span style="font-size:11px;font-weight:600">5G</span>${signal}${wifi}` : `${wifi}${signal}`}${battery}</span>`;
  }

  /* ── Simulated system notification (heads-up) ─────────── */
  const PUSHES = {
    lead: () => LV.isAdmin()
      ? { title: 'A 级新线索待分配', text: 'Fatima Zahra · 阿联酋 · 进口商 · 1×40HQ', route: ['customers', 'customer', { id: 'c4' }], channel: '新客户询盘 · 持续响铃' }
      : { title: '新分配客户 · B 级', text: 'Daniel Osei · 加纳 · 请在 5 分钟内联系', route: ['customers', 'customer', { id: 'c15' }], channel: '新客户询盘 · 持续响铃' },
    order: () => ({ title: '新订单 LV20261110-001', text: 'Carlos Méndez · ¥168,000 · 等待 30% 定金', route: ['orders', 'order', { id: 'o1' }], channel: '新订单与付款' }),
    task: () => ({ title: '任务即将到期 · 11:00', text: '回复 Grace：40HQ 装柜量与样品', route: ['home', 'task', { id: 'k2' }], channel: '跟进提醒' }),
    exception: () => ({ title: '物流异常 · 超预计到货 4 天', text: 'LV20261102-002 · Valentina Rojas', route: ['orders', 'order', { id: 'o5' }], channel: '订单与线索异常' }),
    test: () => ({ title: '测试通知', text: '通知设置正常，你会在这里收到新询盘与跟进提醒。', route: null, channel: '测试' }),
  };
  LV.simulatePush = kind => {
    if (!LV.state.session) { LV.toast('请先登录', { icon: 'info' }); return; }
    const p = PUSHES[kind](), hide = LV.state.settings.lockscreen === 'hide' && kind === 'lead';
    const el = document.createElement('div');
    el.className = `heads-up${LV.state.platform === 'harmony' ? ' is-harmony' : ''}`;
    el.setAttribute('role', 'alert');
    el.innerHTML = `<div class="hu-app"><i>L</i>LVANJU BOS · ${p.channel}<em>现在</em></div><div class="hu-title">${p.title}</div><div class="hu-text">${p.text}</div>${p.route ? `<div class="hu-actions"><span>${kind === 'lead' ? '去处理' : '查看'}</span><span>稍后</span></div>` : ''}<span class="hu-sim">模拟系统通知 · ${LV.state.platform === 'harmony' ? 'Push Kit' : '厂商通道 / FCM'}</span>`;
    void hide;
    document.getElementById('app').appendChild(el);
    const close = () => { el.style.transition = 'opacity .2s, transform .2s'; el.style.opacity = 0; el.style.transform = 'translateY(-16px)'; setTimeout(() => el.remove(), 220); };
    el.addEventListener('click', e => {
      close();
      if (e.target.closest('.hu-actions span:last-child')) return;
      if (p.route) LV.nav.open(...p.route);
    });
    setTimeout(close, 6000);
  };

  /** App in foreground: an A/B lead is pinned at the top and keeps ringing until handled (as on the PC). */
  LV.inAppLead = () => {
    if (!LV.state.session) return;
    const c = LV.customer(LV.isAdmin() ? 'c4' : 'c15');
    document.querySelector('.inapp-banner')?.remove();
    const el = document.createElement('div');
    el.className = 'inapp-banner'; el.setAttribute('role', 'alert');
    el.innerHTML = `<div class="ib-head">${I('bell-ring')}<strong>${LV.isAdmin() ? `${c.grade} 级新线索待分配` : '新分配客户 · 5 分钟内首联'}</strong></div><p>${c.name} · ${c.country} · ${c.gradeReason}</p><div class="ib-actions"><button type="button" class="btn btn-clear" data-ib="later">稍后</button><button type="button" class="btn btn-light" data-ib="go">去处理</button></div>`;
    document.getElementById('app').appendChild(el);
    el.addEventListener('click', e => { const b = e.target.closest('[data-ib]'); if (!b) return; el.remove(); if (b.dataset.ib === 'go') LV.nav.open('customers', 'customer', { id: c.id }); });
  };

  /* ── Control panel ───────────────────────────────────── */
  const PAGES = [
    ['登录页', () => { LV.state.session = null; LV.mountApp(); LV.syncPanel(); }],
    ['工作台首页', () => LV.nav.open('home', 'home')],
    ['客户列表', () => LV.nav.open('customers', 'customers')],
    ['客户详情', () => LV.nav.open('customers', 'customer', { id: LV.isAdmin() ? 'c1' : 'c1' })],
    ['新建客户', () => LV.nav.open('customers', 'customer-new')],
    ['订单列表', () => LV.nav.open('orders', 'orders')],
    ['订单详情', () => LV.nav.open('orders', 'order', { id: LV.isAdmin() ? 'o3' : 'o5' })],
    ['消息通知中心', () => LV.nav.open('inbox', 'inbox')],
    ['任务管理', () => LV.nav.open('home', 'tasks')],
    ['数据看板', () => LV.nav.open('home', 'analytics')],
    ['个人中心', () => LV.nav.open('me', 'me')],
    ['通知设置', () => LV.nav.open('me', 'notify-settings')],
    ['报价单详情', () => LV.nav.open('orders', 'quote', { id: 'q1' })],
    ['WhatsApp 会话', () => LV.nav.open('inbox', 'chat', { id: 'c2' })],
  ];
  function ensureLogin(role) {
    if (!LV.state.session || (role && LV.me().role !== role)) { LV.state.session = { userId: LV.DEMO_LOGIN[role || 'ADMIN'] }; LV.resetData(); LV.mountApp(); }
  }
  const seg = (name, value, opts) => `<div class="pp-seg" data-pp="${name}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${String(value) === String(v)}">${l}</button>`).join('')}</div>`;
  LV.syncPanel = () => {
    const panel = document.getElementById('proto-panel'); if (!panel) return;
    const s = LV.state, role = s.session ? LV.me().role : 'NONE';
    panel.innerHTML = `
      <div class="pp-head"><span class="pp-tag">原型控制台 · 不属于 App 界面</span><strong>LVANJU BOS 移动端原型</strong><p>点击设备内任意元素即可操作。返回：设备左边缘向右滑，或按 Esc。</p></div>
      <div class="pp-group"><span>演示身份</span>${seg('role', role, [['ADMIN', '管理员 陈立'], ['SALES', '销售 林晓']])}</div>
      <div class="pp-group"><span>页面直达（第一批 12 页 + 2）</span><div class="pp-pages">${PAGES.map(([l], i) => `<button type="button" data-page="${i}"><b>${String(i + 1).padStart(2, '0')}</b>${l}</button>`).join('')}</div></div>
      <div class="pp-group"><span>平台</span>${seg('platform', s.platform, [['android', 'Android'], ['harmony', 'HarmonyOS']])}</div>
      <div class="pp-group"><span>屏幕宽度（dp）</span>${seg('width', s.width, [[360, '360'], [390, '390'], [412, '412'], [430, '430']])}</div>
      <div class="pp-group"><span>主题</span>${seg('theme', s.theme, [['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']])}</div>
      <div class="pp-group"><span>字体大小</span>${seg('font', s.fontScale, [[1, '标准'], [1.12, '大'], [1.25, '特大']])}</div>
      <div class="pp-group"><span>网络</span>${seg('net', s.offline ? 'off' : 'on', [['on', '在线'], ['off', '离线（只读最近客户）']])}</div>
      <div class="pp-group"><span>数据状态</span>${seg('demo', s.demo, [['normal', '正常'], ['loading', '加载中'], ['empty', '空'], ['error', '出错']])}</div>
      <div class="pp-group"><span>推送与提醒</span><div class="pp-actions">
        <button type="button" data-push="lead">模拟系统推送：新询盘（App 在后台）</button>
        <button type="button" data-push="order">模拟系统推送：新订单</button>
        <button type="button" data-push="task">模拟系统推送：任务到期</button>
        <button type="button" data-push="exception">模拟系统推送：物流异常</button>
        <button type="button" data-inapp="1">App 在前台：A 级线索置顶响铃</button>
        <button type="button" data-reset="1">重置示例数据</button>
      </div></div>
      <p class="pp-note">所有数据为 MOCK 示例。系统推送在真机由 Android 厂商通道 / FCM、HarmonyOS Push Kit 下发，这里只模拟通知外观与点击跳转。</p>`;
  };
  function bindPanel() {
    const panel = document.getElementById('proto-panel');
    panel.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const group = b.closest('[data-pp]')?.dataset.pp, v = b.dataset.v;
      if (group === 'role') { LV.state.session = { userId: LV.DEMO_LOGIN[v] }; LV.resetData(); LV.mountApp(); LV.syncPanel(); return; }
      if (group === 'platform') return LV.setPlatform(v);
      if (group === 'width') return LV.setWidth(Number(v));
      if (group === 'theme') { LV.setTheme(v); LV.refresh(); return; }
      if (group === 'font') return LV.setFont(Number(v));
      if (group === 'net') { if (!LV.state.session) ensureLogin('SALES'); return LV.setOffline(v === 'off'); }
      if (group === 'demo') { LV.state.demo = v; LV.syncPanel(); LV.refresh(); return; }
      if (b.dataset.page) { const i = Number(b.dataset.page); if (i > 0) ensureLogin(LV.state.session ? LV.me().role : 'ADMIN'); PAGES[i][1](); LV.syncPanel(); return; }
      if (b.dataset.push) { ensureLogin(LV.state.session ? LV.me().role : 'ADMIN'); LV.syncPanel(); LV.simulatePush(b.dataset.push); return; }
      if (b.dataset.inapp) { ensureLogin(LV.state.session ? LV.me().role : 'ADMIN'); LV.syncPanel(); LV.inAppLead(); return; }
      if (b.dataset.reset) { LV.resetData(); if (LV.state.session) LV.mountApp(); LV.toast('示例数据已重置', { icon: 'rotate-ccw' }); }
    });
  }

  /* ── Boot ────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', () => {
    LV.setTheme(LV.state.theme); LV.setFont(LV.state.fontScale); LV.setWidth(LV.state.width); LV.setPlatform(LV.state.platform);
    bindPanel();
    // #home / #customers … opens a page directly (shareable link); defaults to the login page.
    const hash = location.hash.replace('#', '');
    LV.boot();
    const direct = { dashboard: 1, customers: 2, customer: 3, 'new-customer': 4, orders: 5, order: 6, inbox: 7, tasks: 8, analytics: 9, me: 10, notifications: 11 };
    if (direct[hash] !== undefined) { ensureLogin('ADMIN'); PAGES[direct[hash]][1](); }
    LV.syncPanel();
  });
})();

/*
 * 我的：个人信息、账号安全、通知设置、语言、外观（主题 / 字体）、关于、退出登录。
 * 通知设置按「通知分类 = 系统通知渠道」设计：Android 8+ 的 NotificationChannel、HarmonyOS 的 NotificationSlot
 * 创建后声音 / 振动由用户在系统里控制，App 内的提醒方式通过切换渠道实现，详见 docs/mobile-app/NATIVE_PLAN.md。
 */
(function () {
  const LV = window.LV, U = LV.ui, I = LV.icon, F = LV.fmt, C = LV.CONST, S = () => LV.state.settings;
  const MODES = { loop: ['持续响铃直到处理', '用于 A/B 级新询盘'], ring: ['响铃 + 振动', '提示一次'], vibrate: ['仅振动', ''], silent: ['静默', '只进通知栏，不响铃不振动'] };
  const SOUNDS = { default: '系统默认提示音', crisp: '清脆（LVANJU）', soft: '柔和（LVANJU）' };
  const THEMES = { system: '跟随系统', light: '浅色', dark: '深色' };
  const FONTS = { 1: '标准', 1.12: '大', 1.25: '特大' };
  const isHarmony = () => LV.state.platform === 'harmony';

  LV.screens.me = {
    root: true, large: true, title: '我的',
    render() {
      const me = LV.me(), admin = LV.isAdmin(), m = LV.METRICS[admin ? 'ADMIN' : 'SALES'].month;
      return {
        title: '我的',
        body: `${U.largeTitle('我的')}
          <div class="stack-lg">
          <div class="pad"><div class="card profile">
            ${U.avatar(me.name, { size: 'lg' })}
            <div><h2>${me.name}</h2><p>${me.title} · ${me.email}</p><p class="muted">LVANJU 绿安居 · ${admin ? '管理工作空间' : '销售工作空间'}</p></div>
          </div></div>
          <div class="pad"><button type="button" class="card card-body mini-perf pressable" ${LV.attr('open', { tab: 'home', to: 'analytics' })}>
            <span><small>${admin ? '公司本月销售额' : '我的本月业绩'}</small><b class="num">${U.money(m.revenue)}</b></span>
            <span><small>目标完成</small><b class="num">${F.pct(m.revenue, m.target)}</b></span>
            <span><small>成交</small><b class="num">${m.won} 笔</b></span>
          </button></div>
          ${U.section('设置', `<div class="pad"><div class="list">
            ${U.cell({ icon: 'bell', title: '通知设置', sub: '分类、铃声、振动、免打扰', attrs: LV.go('notify-settings') })}
            ${U.cell({ icon: 'shield-check', title: '账号与安全', sub: '修改密码、登录设备', attrs: LV.go('security') })}
            ${U.cell({ icon: 'sun-moon', title: '外观', trail: `${THEMES[LV.state.theme]} · 字体${FONTS[LV.state.fontScale]}`, attrs: LV.go('appearance') })}
            ${U.cell({ icon: 'languages', title: '语言', trail: '简体中文', attrs: LV.attr('language') })}
          </div></div>`)}
          ${U.section('其他', `<div class="pad"><div class="list">
            ${U.cell({ icon: 'circle-help', title: '帮助与反馈', attrs: LV.attr('noop-toast', { t: '反馈会发送给管理员（原型略）' }) })}
            ${U.cell({ icon: 'info', title: '关于 LVANJU BOS', trail: '1.0.0（原型）', attrs: LV.go('about') })}
          </div></div>`)}
          ${U.section('原型演示', `<div class="pad"><div class="list">${U.cell({ icon: 'monitor-smartphone', title: '原型演示工具', sub: '切换身份、平台、数据状态，模拟系统推送', attrs: LV.attr('proto-tools') })}</div></div>`)}
          <div class="pad"><div class="list">${U.cell({ icon: 'log-out', title: '退出登录', danger: true, attrs: LV.attr('logout'), chevron: false })}</div></div>
          ${U.mockNote('原型版本 · 所有数据为示例')}
          </div>`,
      };
    },
  };

  /* Prototype tooling reachable on a phone, where the desktop control panel is hidden. */
  const protoBody = () => {
    const s = LV.state, opt = (act, cur, list) => `<div class="option-grid">${list.map(([v, l]) => U.chip(l, { pressed: String(cur) === String(v), attrs: LV.attr(act, { v }) })).join('')}</div>`;
    return `<div class="form">
      <div class="field"><span class="label">演示身份</span>${opt('pt-role', LV.me().role, [['ADMIN', '管理员 陈立'], ['SALES', '销售 林晓']])}</div>
      <div class="field"><span class="label">平台</span>${opt('pt-platform', s.platform, [['android', 'Android'], ['harmony', 'HarmonyOS']])}</div>
      <div class="field"><span class="label">数据状态</span>${opt('pt-demo', s.demo, [['normal', '正常'], ['loading', '加载中'], ['empty', '空'], ['error', '出错']])}</div>
      <div class="field"><span class="label">模拟推送</span>${opt('pt-push', '', [['lead', '新询盘'], ['order', '新订单'], ['task', '任务到期'], ['exception', '物流异常'], ['inapp', '前台置顶响铃']])}</div>
    </div><p class="sheet-note">示例数据（MOCK）。系统推送只模拟通知外观与点击跳转。</p>`;
  };
  LV.on('proto-tools', () => LV.sheet({ name: 'proto', title: '原型演示工具', body: protoBody() }));
  LV.on('pt-role', el => { LV.closeSheet(); LV.state.session = { userId: LV.DEMO_LOGIN[el.dataset.v] }; LV.resetData(); LV.mountApp(); LV.syncPanel?.(); });
  LV.on('pt-platform', el => { LV.setPlatform(el.dataset.v); LV.updateSheet(protoBody(), 'proto'); });
  LV.on('pt-demo', el => { LV.state.demo = el.dataset.v; LV.syncPanel?.(); LV.updateSheet(protoBody(), 'proto'); });
  LV.on('pt-push', el => { LV.closeSheet(); setTimeout(() => (el.dataset.v === 'inapp' ? LV.inAppLead() : LV.simulatePush(el.dataset.v)), 260); });

  LV.on('logout', async () => {
    const ok = await LV.confirm({ title: '退出登录？', message: '退出后，这台手机不再接收这个账号的推送通知。', ok: '退出登录', danger: true });
    if (!ok) return;
    LV.state.session = null; LV.resetData(); LV.mountApp(); LV.syncPanel?.();
  });

  /* ── Notification settings ────────────────────────────── */
  LV.screens['notify-settings'] = {
    render() {
      const s = S(), perm = s.systemPermission;
      const channel = (key) => { const cat = C.notifyCategories[key], ch = s.channels[key]; return `<div class="cell has-lead"><span class="cell-lead">${I(cat.icon)}</span><span class="cell-main"><span class="cell-title" style="display:block">${{ inquiry: '新客户询盘', order: '新订单与付款', followup: '跟进提醒', exception: '订单与线索异常', system: '公告与简报' }[key]}${cat.planned ? ` ${U.planned()}` : ''}</span><button type="button" class="mode-link" ${LV.attr('ch-mode', { k: key })} ${ch.on ? '' : 'disabled'}>${MODES[ch.mode][0]}${I('chevron-right')}</button></span>${U.switch(ch.on, LV.attr('ch-toggle', { k: key }), `接收${cat.label}通知`)}</div>`; };
      return {
        title: '通知设置',
        body: `<div class="stack-lg" style="padding-top:4px">
          <div class="pad">${perm ? `<div class="perm-card is-ok">${I('circle-check')}<div><strong>系统通知已开启</strong><p>${isHarmony() ? 'HarmonyOS 通知 · 推送服务 Push Kit 已注册' : 'Android 通知权限已授予 · 推送通道：厂商通道（华为 / 荣耀 / 小米 / OPPO / vivo）+ FCM'}</p></div></div>`
            : `<div class="perm-card">${I('bell-off')}<div><strong>系统通知未开启</strong><p>新询盘和跟进提醒无法在 App 关闭时送达。${isHarmony() ? '需要在系统设置中允许 LVANJU BOS 发送通知。' : 'Android 13 及以上需要授予通知权限。'}</p>${U.btn('去系统设置开启', { kind: 'primary', size: 'sm', attrs: LV.attr('perm-grant') })}</div></div>`}</div>
          ${U.section('通知分类', `<div class="pad"><div class="list">${Object.keys(C.notifyCategories).map(channel).join('')}</div><p class="list-foot">每个分类对应一个系统通知渠道，也可以在系统设置里单独调整。</p></div>`)}
          ${U.section('提醒方式', `<div class="pad"><div class="list">
            ${U.cell({ icon: 'volume-2', title: '提示音', trail: SOUNDS[s.sound], attrs: LV.attr('sound') })}
            <div class="cell has-lead"><span class="cell-lead">${I('vibrate')}</span><span class="cell-main"><span class="cell-title" style="display:block">振动</span></span>${U.switch(s.vibrate, LV.attr('st-toggle', { k: 'vibrate' }), '振动')}</div>
            ${U.cell({ icon: 'lock', title: '锁屏显示', trail: s.lockscreen === 'hide' ? '隐藏客户姓名' : '显示全部内容', attrs: LV.attr('lockscreen') })}
          </div></div>`)}
          ${U.section('免打扰', `<div class="pad"><div class="list">
            <div class="cell has-lead"><span class="cell-lead">${I('moon-star')}</span><span class="cell-main"><span class="cell-title" style="display:block">定时免打扰</span><span class="cell-sub" style="display:block">${s.dndFrom}–${s.dndTo} 只进通知栏</span></span>${U.switch(s.dnd, LV.attr('st-toggle', { k: 'dnd' }), '定时免打扰')}</div>
            <div class="cell has-lead"><span class="cell-lead">${I('flame')}</span><span class="cell-main"><span class="cell-title" style="display:block">A 级询盘仍然提醒</span><span class="cell-sub" style="display:block">免打扰期间，A 级新询盘照常响铃</span></span>${U.switch(s.dndExceptA, LV.attr('st-toggle', { k: 'dndExceptA' }) + (s.dnd ? '' : ' disabled'), 'A 级询盘仍然提醒')}</div>
          </div></div>`)}
          <div class="pad stack">${U.btn('发送一条测试通知', { kind: 'secondary', icon: 'bell-ring', block: true, attrs: LV.attr('test-push') })}
          <p class="mock-note">${isHarmony() ? 'HarmonyOS：通知渠道对应 NotificationSlot；后台推送走 Push Kit，消息需申请「工作事项」等服务类分类权益才会响铃。' : 'Android：每个分类是一个 NotificationChannel；国内手机通过厂商推送通道送达，海外与有 GMS 的设备走 FCM。'}</p></div>
        </div>`,
      };
    },
  };
  LV.on('ch-toggle', el => { const ch = S().channels[el.dataset.k]; ch.on = !ch.on; LV.refresh(); LV.toast(ch.on ? '已开启' : '已关闭，这类消息仍会出现在消息中心', { icon: ch.on ? 'bell' : 'bell-off' }); });
  LV.on('ch-mode', el => {
    const key = el.dataset.k, ch = S().channels[key];
    LV.sheet({ title: '提醒方式', sub: C.notifyCategories[key].label, body: `<div class="action-list">${Object.entries(MODES).filter(([m]) => m !== 'loop' || key === 'inquiry').map(([m, [l, d]]) => `<button type="button" class="action-item${ch.mode === m ? ' is-selected' : ''}" ${LV.attr('ch-set', { k: key, m })}><span class="radio${ch.mode === m ? ' is-on' : ''}"></span><span><strong>${l}</strong>${d ? `<small>${d}</small>` : ''}</span></button>`).join('')}</div><p class="sheet-note">如果系统设置里关闭了这个渠道的声音，以系统设置为准，App 会提示你去系统设置修改。</p>` });
  });
  LV.on('ch-set', el => { S().channels[el.dataset.k].mode = el.dataset.m; LV.closeSheet(); LV.refresh(); LV.toast(`已改为「${MODES[el.dataset.m][0]}」`); });
  LV.on('st-toggle', el => { const k = el.dataset.k; S()[k] = !S()[k]; LV.refresh(); });
  LV.on('sound', () => LV.sheet({ title: '提示音', body: `<div class="action-list">${Object.entries(SOUNDS).map(([k, l]) => `<button type="button" class="action-item${S().sound === k ? ' is-selected' : ''}" ${LV.attr('sound-set', { k })}><span class="radio${S().sound === k ? ' is-on' : ''}"></span><span><strong>${l}</strong></span>${I('volume-2')}</button>`).join('')}</div>` }));
  LV.on('sound-set', el => { S().sound = el.dataset.k; LV.closeSheet(); LV.refresh(); LV.toast(`提示音：${SOUNDS[el.dataset.k]}（试听需在真机）`, { icon: 'volume-2' }); });
  LV.on('lockscreen', () => LV.sheet({ title: '锁屏显示', body: `<div class="action-list">${[['hide', '隐藏客户姓名', '锁屏上只显示「你有 1 条新询盘」'], ['show', '显示全部内容', '']].map(([k, l, d]) => `<button type="button" class="action-item${S().lockscreen === k ? ' is-selected' : ''}" ${LV.attr('lock-set', { k })}><span class="radio${S().lockscreen === k ? ' is-on' : ''}"></span><span><strong>${l}</strong>${d ? `<small>${d}</small>` : ''}</span></button>`).join('')}</div>` }));
  LV.on('lock-set', el => { S().lockscreen = el.dataset.k; LV.closeSheet(); LV.refresh(); });
  LV.on('perm-grant', () => { S().systemPermission = true; LV.refresh(); LV.toast('已开启系统通知（模拟系统授权）'); });
  LV.on('test-push', () => LV.simulatePush('test'));

  /* ── Security ─────────────────────────────────────────── */
  LV.screens.security = {
    render() {
      const s = S();
      return {
        title: '账号与安全',
        body: `<div class="stack-lg" style="padding-top:4px">
          ${U.section('账号', `<div class="pad"><div class="list">${U.cell({ icon: 'at-sign', title: '登录邮箱', trail: LV.me().email, chevron: false })}${U.cell({ icon: 'key-round', title: '修改登录密码', sub: '修改后，其他设备需要重新登录', attrs: LV.attr('pwd') })}</div></div>`)}
          ${U.section('解锁', `<div class="pad"><div class="list"><div class="cell has-lead"><span class="cell-lead">${I('fingerprint')}</span><span class="cell-main"><span class="cell-title" style="display:block">指纹 / 面容解锁 ${U.planned()}</span><span class="cell-sub" style="display:block">打开 App 时验证本机生物识别，不上传任何生物信息</span></span>${U.switch(s.biometric, LV.attr('st-toggle', { k: 'biometric' }), '生物识别解锁')}</div></div></div>`)}
          ${U.section('登录设备', `<div class="pad"><div class="list">${LV.DEVICES.map(d => U.cell({ icon: d.name.includes('Chrome') ? 'laptop' : 'smartphone', title: d.name, sub: `${d.place} · ${d.at}`, trail: d.current ? U.badge('本机', 'brand') : '', chevron: false })).join('')}</div>
            ${U.btn('退出其他设备', { kind: 'danger-ghost', block: true, attrs: LV.attr('logout-others') })}
            <p class="list-foot">现在修改密码会让所有设备重新登录；按设备单独退出需要新增设备记录 ${U.planned()}</p></div>`)}
        </div>`,
      };
    },
  };
  LV.on('pwd', () => LV.sheet({ name: 'pwd', title: '修改登录密码', body: `<form class="form" data-submit="pwd-save" novalidate>${U.field({ id: 'pw-old', label: '当前密码', type: 'password', autocomplete: 'current-password' })}${U.field({ id: 'pw-new', label: '新密码', type: 'password', hint: '至少 8 位', autocomplete: 'new-password' })}${U.field({ id: 'pw-new2', label: '再次输入新密码', type: 'password', autocomplete: 'new-password' })}</form>`, foot: U.btn('保存新密码', { kind: 'primary', attrs: LV.attr('pwd-save') }) }));
  LV.on('pwd-save', () => {
    const a = document.getElementById('pw-new').value, b = document.getElementById('pw-new2').value, old = document.getElementById('pw-old').value;
    const err = !old ? '请填写当前密码' : a.length < 8 ? '新密码至少 8 位' : a !== b ? '两次输入的新密码不一致' : '';
    if (err) { LV.toast(err, { icon: 'circle-alert', tone: 'danger' }); return; }
    LV.closeSheet(); LV.toast('密码已修改，其他设备需要重新登录', { icon: 'shield-check' });
  });
  LV.on('logout-others', async () => { const ok = await LV.confirm({ title: '退出其他设备？', message: '除这台手机外，所有设备都需要重新登录。', ok: '全部退出', danger: true }); if (ok) LV.toast('其他设备已退出登录', { icon: 'shield-check' }); });

  /* ── Appearance & language ────────────────────────────── */
  LV.screens.appearance = {
    render() {
      return {
        title: '外观',
        body: `<div class="stack-lg" style="padding-top:4px">
          ${U.section('主题', `<div class="pad"><div class="theme-grid">${Object.entries(THEMES).map(([k, l]) => `<button type="button" class="theme-opt${LV.state.theme === k ? ' is-on' : ''}" ${LV.attr('theme-set', { k })} aria-pressed="${LV.state.theme === k}"><span class="theme-prev tp-${k}"><i></i><i></i><i></i></span>${l}</button>`).join('')}</div></div>`)}
          ${U.section('字体大小', `<div class="pad"><div class="card card-body"><div class="font-preview">今日销售业绩 <b class="num">¥168,000</b><small>跟随系统字体大小，并可在这里单独放大</small></div>${U.seg(Object.entries(FONTS).map(([k, l]) => ({ key: k, label: l })), String(LV.state.fontScale), 'font')}</div></div>`)}
        </div>`,
      };
    },
    mount(el, r) { if (r.ui.font && Number(r.ui.font) !== LV.state.fontScale) { LV.setFont(Number(r.ui.font)); } },
  };
  LV.on('theme-set', el => { LV.setTheme(el.dataset.k); LV.refresh(); });
  LV.on('language', () => LV.sheet({ title: '语言', body: `<div class="action-list"><button type="button" class="action-item is-selected"><span class="radio is-on"></span><span><strong>简体中文</strong></span></button><button type="button" class="action-item" ${LV.attr('noop-toast', { t: 'English 界面在规划中，客户资料与报价单已支持英文' })}><span class="radio"></span><span><strong>English ${U.planned()}</strong><small>BOS 目前只有中文界面</small></span></button></div>` }));

  /*
   * Enterprise in-house distribution (decided 2026-11-11): no app store. Android installs a company-signed APK from the
   * BOS download page and updates in the app; HarmonyOS installs through Huawei's enterprise distribution channel.
   * The server tells the app the latest and minimum supported version (planned: GET /api/app/version).
   */
  const UPDATE = { version: '1.0.1', size: '18.6 MB', notes: ['客户列表支持按标签筛选', '修复部分华为手机通知不响铃的问题'], forced: false };
  const updateBody = () => {
    const h = isHarmony(), dl = LV.state.updateProgress;
    return `<div class="update-card"><div class="update-head"><strong>版本 ${UPDATE.version}</strong><span>${h ? '企业内部分发' : `${UPDATE.size} · 公司签名`}</span></div>
      <ul>${UPDATE.notes.map(n => `<li>${n}</li>`).join('')}</ul></div>
      ${dl != null && !h ? `<div class="update-progress"><div class="meter"><i style="width:${dl}%"></i></div><span class="num">${dl < 100 ? `正在下载 ${dl}%` : '下载完成，已校验安装包签名'}</span></div>` : ''}
      <p class="sheet-note">${h ? '点「前往安装」后由系统的企业应用安装页完成更新，数据和登录状态保留。' : '下载完成后由系统安装程序完成更新。首次需要允许「LVANJU BOS 安装未知应用」，之后不再询问。低于最低支持版本时，打开 App 会直接提示更新。'}</p>`;
  };
  LV.on('check-update', () => {
    LV.state.updateSeen = true; LV.state.updateProgress = null;
    LV.sheet({ name: 'update', title: '发现新版本', sub: `当前 1.0.0 → ${UPDATE.version}`, body: updateBody(), foot: `${U.btn('稍后', { kind: 'secondary', attrs: LV.attr('close-overlay') })}${U.btn(isHarmony() ? '前往安装' : '下载并安装', { kind: 'primary', icon: 'cloud-download', attrs: LV.attr('do-update') })}` });
    LV.refresh();
  });
  LV.on('do-update', () => {
    if (isHarmony()) { LV.closeSheet(); LV.toast('将打开企业应用安装页（原型中不跳转）', { icon: 'external-link' }); return; }
    let n = 0; LV.state.updateProgress = 0; LV.updateSheet(updateBody(), 'update');
    const t = setInterval(() => { n = Math.min(100, n + 20); LV.state.updateProgress = n; LV.updateSheet(updateBody(), 'update'); if (n >= 100) { clearInterval(t); setTimeout(() => { LV.closeSheet(); LV.toast('将打开系统安装程序（原型中不安装）', { icon: 'cloud-download' }); }, 700); } }, 260);
  });

  LV.screens.about = {
    render() {
      return {
        title: '关于',
        body: `<div class="pad stack-lg" style="padding-top:12px">
          <div class="about-brand"><img src="assets/brand/lvanju-logo.jpg" alt="LVANJU 绿安居" width="208" height="84"><strong>LVANJU BOS</strong><span class="num">版本 1.0.0 · 企业内部版（原型）</span></div>
          <div class="list">${U.cell({ icon: 'cloud-download', title: '检查更新', trail: LV.state.updateSeen ? '有新版本' : '', attrs: LV.attr('check-update') })}${U.cell({ icon: 'shield-check', title: '安装来源', sub: isHarmony() ? 'LVANJU 企业内部分发（华为企业应用）' : 'LVANJU 企业内部分发 · 公司签名', chevron: false })}${U.cell({ icon: 'file-text', title: '隐私政策与权限说明', attrs: LV.attr('noop-toast', { t: '内部分发同样需要告知员工收集哪些数据、为什么申请通知等权限' }) })}${U.cell({ icon: 'file-check', title: '开源许可', sub: 'Lucide Icons（ISC）等', chevron: false })}</div>
          ${U.mockNote('© LVANJU 绿安居 · 原型仅用于设计评审')}
        </div>`,
      };
    },
  };
})();

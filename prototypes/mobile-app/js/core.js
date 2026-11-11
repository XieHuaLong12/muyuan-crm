/*
 * LVANJU BOS Mobile · prototype core
 * Navigation model (mirrors what the native clients will do):
 *   - five bottom tabs, each with its own back stack (Android Navigation / HarmonyOS Navigation per tab)
 *   - pushing a detail page slides it in and hides the bottom bar; system back pops it
 *   - system back order: dialog → sheet → page → other tab's root → home root ("再按一次退出")
 * Everything is in-memory; nothing is sent anywhere.
 */
(function () {
  const LV = window.LV;
  const app = () => document.getElementById('app');

  /* ── Helpers ─────────────────────────────────────────── */
  LV.esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  LV.icon = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${LV.ICONS[name] || ''}</svg>`;
  LV.attr = (act, data = {}) => `data-act="${act}"` + Object.entries(data).map(([k, v]) => ` data-${k}="${LV.esc(typeof v === 'object' ? JSON.stringify(v) : v)}"`).join('');
  LV.go = (to, params = {}) => LV.attr('go', { to, p: params });
  const d = s => new Date(s);
  const pad = n => String(n).padStart(2, '0');

  LV.fmt = {
    int: n => Number(n).toLocaleString('en-US'),
    money(n, cur = 'CNY') {
      const sym = { CNY: '¥', USD: 'US$ ', EUR: '€' }[cur] ?? `${cur} `;
      return sym + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
    },
    /** 万 for amounts a boss reads at a glance (¥128.6万); full digits on detail pages. */
    wan(n) { return n >= 10000 ? `${(n / 10000).toFixed(n >= 1000000 ? 1 : 2).replace(/\.?0+$/, '')}万` : LV.fmt.int(n); },
    pct: (a, b) => b ? `${(a / b * 100).toFixed(1)}%` : '—',
    change(cur, prev) { if (!prev) return null; return (cur - prev) / prev * 100; },
    time: s => { const t = d(s); return `${pad(t.getHours())}:${pad(t.getMinutes())}`; },
    date: s => { const t = d(s); return `${pad(t.getMonth() + 1)}-${pad(t.getDate())}`; },
    dayDiff(s) { const a = d(`${s.slice(0, 10)}T00:00`), b = d(`${LV.TODAY}T00:00`); return Math.round((a - b) / 86400000); },
    /** Feed time: 刚刚 / 12 分钟前 / 今天 09:40 / 昨天 18:00 / 11-07 16:20 */
    ago(s) {
      const diff = (d(LV.NOW) - d(s)) / 60000;
      if (diff >= 0 && diff < 1) return '刚刚';
      if (diff >= 0 && diff < 60) return `${Math.round(diff)} 分钟前`;
      const dd = LV.fmt.dayDiff(s);
      if (dd === 0) return `今天 ${LV.fmt.time(s)}`;
      if (dd === -1) return `昨天 ${LV.fmt.time(s)}`;
      return `${LV.fmt.date(s)} ${LV.fmt.time(s)}`;
    },
    /** Due label for tasks / follow-ups, with overdue wording. */
    due(s) {
      const diff = (d(s) - d(LV.NOW)) / 60000, dd = LV.fmt.dayDiff(s);
      if (diff < 0) {
        const late = -diff;
        return { text: late < 60 ? `逾期 ${Math.round(late)} 分钟` : late < 1440 ? `逾期 ${Math.round(late / 60)} 小时` : `逾期 ${Math.round(late / 1440)} 天`, late: true };
      }
      if (diff < 60) return { text: `${Math.max(1, Math.round(diff))} 分钟后`, soon: true };
      const label = dd === 0 ? `今天 ${LV.fmt.time(s)}` : dd === 1 ? `明天 ${LV.fmt.time(s)}` : `${LV.fmt.date(s)} ${LV.fmt.time(s)}`;
      return { text: label };
    },
    weekday: s => '日一二三四五六'[d(s).getDay()],
  };

  /* ── State ───────────────────────────────────────────── */
  const prefs = (() => { try { return JSON.parse(localStorage.getItem('lv-proto-prefs') || '{}'); } catch { return {}; } })();
  LV.state = {
    session: null,
    platform: prefs.platform || 'android',
    theme: prefs.theme || 'system',
    fontScale: prefs.fontScale || 1,
    width: prefs.width || 390,
    demo: 'normal',
    tab: 'home',
    stacks: {},
    exitArmed: false,
    settings: {
      channels: { inquiry: { on: true, mode: 'loop' }, order: { on: true, mode: 'ring' }, followup: { on: true, mode: 'ring' }, exception: { on: true, mode: 'ring' }, system: { on: true, mode: 'silent' } },
      sound: 'default', vibrate: true, dnd: true, dndFrom: '22:00', dndTo: '08:00', dndExceptA: true, lockscreen: 'hide', systemPermission: true,
      language: 'zh-CN', biometric: false,
    },
  };
  LV.savePrefs = () => { try { localStorage.setItem('lv-proto-prefs', JSON.stringify({ platform: LV.state.platform, theme: LV.state.theme, fontScale: LV.state.fontScale, width: LV.state.width })); } catch { /* storage may be blocked */ } };
  LV.resetData = () => {
    LV.db = structuredClone({ customers: LV.CUSTOMERS, tasks: LV.TASKS, notifications: LV.NOTIFICATIONS, orders: LV.ORDERS, quotes: LV.QUOTES, timeline: LV.TIMELINE, chats: LV.CHATS });
  };
  LV.resetData();

  /* ── Session & scoping (mirrors lib/auth.ts scope(): admins see all, sales see their own) ── */
  LV.me = () => LV.USERS[LV.state.session?.userId];
  LV.isAdmin = () => LV.me()?.role === 'ADMIN';
  LV.customer = id => LV.db.customers.find(c => c.id === id);
  LV.order = id => LV.db.orders.find(o => o.id === id);
  LV.quote = id => LV.db.quotes.find(q => q.id === id);
  LV.scope = {
    customers: () => LV.db.customers.filter(c => LV.isAdmin() || c.owner === LV.me().id),
    orders: () => LV.db.orders.filter(o => LV.isAdmin() || o.owner === LV.me().id),
    quotes: () => LV.db.quotes.filter(q => LV.isAdmin() || LV.customer(q.customer)?.owner === LV.me().id),
    tasks: (team = false) => LV.db.tasks.filter(t => (LV.isAdmin() && team) || t.assignee === LV.me().id),
    notifications: () => LV.db.notifications.filter(n => n.audience === 'ALL' || (n.audience === 'ADMIN' && LV.isAdmin()) || (n.audience === 'OWNER' && n.owner === LV.me().id)),
  };
  LV.counts = () => {
    const notes = LV.scope.notifications().filter(n => !n.read).length;
    const chats = LV.scope.customers().reduce((s, c) => s + (c.unread || 0), 0);
    const pool = LV.db.customers.filter(c => c.pool).length;
    const firstContact = LV.scope.customers().filter(c => c.firstContactDueAt && !c.lastContactAt).length;
    return { notes, chats, inbox: notes + chats, pool, firstContact, customersBadge: LV.isAdmin() ? pool : firstContact };
  };

  /* ── Tabs & routes ───────────────────────────────────── */
  LV.TABS = [
    { key: 'home', label: '工作台', icon: 'layout-dashboard', root: 'home' },
    { key: 'customers', label: '客户', icon: 'users', root: 'customers' },
    { key: 'orders', label: '订单', icon: 'package', root: 'orders' },
    { key: 'inbox', label: '消息', icon: 'message-circle', root: 'inbox' },
    { key: 'me', label: '我的', icon: 'user-round', root: 'me' },
  ];
  LV.screens = {};
  let seq = 0;
  const route = (name, params = {}) => ({ name, params, ui: {}, key: `${name}-${++seq}` });
  const top = (tab = LV.state.tab) => LV.state.stacks[tab]?.at(-1);
  LV.top = top;
  LV.paneOf = tab => app().querySelector(`.tab-pane[data-tab="${tab}"]`);

  function screenHTML(r) {
    const s = LV.screens[r.name];
    const out = s.render(r.params, r.ui, r) || {};
    const stackLen = LV.state.stacks[LV.state.tab]?.length ?? 1;
    const back = s.root ? '' : `<button class="icon-btn" ${LV.attr('back')} aria-label="返回">${LV.icon('chevron-left')}</button>`;
    const bar = out.appbar === false ? '' : `<header class="appbar${s.large ? ' has-large' : ''}${out.surface ? ' is-surface' : ''}">${back}${s.root && !s.large ? '<span style="width:8px"></span>' : ''}<div class="appbar-title">${out.title ?? s.title ?? ''}${out.sub ? `<small>${out.sub}</small>` : ''}</div><div class="appbar-actions">${out.actions || ''}</div></header>`;
    void stackLen;
    const offlineBar = LV.state.offline && LV.state.session ? `<div class="offline-bar" role="status">${LV.icon('wifi-off')}<span>离线 · 显示 ${LV.fmt.date(LV.OFFLINE_SAVED_AT)} ${LV.fmt.time(LV.OFFLINE_SAVED_AT)} 保存在本机的数据</span></div>` : '';
    return `${bar}${offlineBar}<div class="scroll"${s.ptr ? ' data-ptr' : ''}>${s.ptr ? `<div class="ptr" aria-hidden="true">${LV.icon('refresh-cw')}</div>` : ''}<div class="scroll-inner">${out.body || ''}</div></div>${out.footer ? `<div class="actionbar">${out.footer}</div>` : ''}${out.fab || ''}`;
  }

  function paint(el, r, keepScroll = true) {
    const sc = el.querySelector('.scroll'), y = keepScroll && sc ? sc.scrollTop : 0;
    el.innerHTML = screenHTML(r);
    el.classList.toggle('has-tabbar', !!LV.screens[r.name].root);
    const nsc = el.querySelector('.scroll');
    if (nsc && y) nsc.scrollTop = y;
    onScroll(nsc);
    LV.screens[r.name].mount?.(el, r);
  }

  function makeScreen(r) {
    const el = document.createElement('section');
    el.className = 'screen';
    el.dataset.key = r.key;
    paint(el, r, false);
    return el;
  }

  LV.refresh = () => {
    if (!LV.state.session) return;
    const r = top(), pane = LV.paneOf(LV.state.tab), el = pane?.querySelector(`.screen[data-key="${r.key}"]`);
    if (el) paint(el, r);
    renderTabbar();
  };
  /** Re-render one region of the top screen (keeps focus in inputs elsewhere on the page). */
  LV.refreshRegion = name => {
    const r = top(), el = LV.paneOf(LV.state.tab)?.querySelector(`.screen[data-key="${r.key}"] [data-region="${name}"]`);
    const fn = LV.screens[r.name].regions?.[name];
    if (el && fn) el.innerHTML = fn(r.params, r.ui, r);
  };

  LV.nav = {
    push(name, params = {}) {
      const tab = LV.state.tab, stack = LV.state.stacks[tab], pane = LV.paneOf(tab);
      const prevEl = pane.querySelector(`.screen[data-key="${stack.at(-1).key}"]`);
      const r = route(name, params); stack.push(r);
      const el = makeScreen(r); el.classList.add('is-entering'); pane.appendChild(el);
      requestAnimationFrame(() => requestAnimationFrame(() => { el.classList.remove('is-entering'); prevEl?.classList.add('is-under'); }));
      // Hide the covered page once the slide finishes (unless the user already went back to it).
      setTimeout(() => { if (prevEl && top(tab)?.key !== prevEl.dataset.key) prevEl.hidden = true; }, 340);
      renderTabbar(); LV.closeAllOverlays();
    },
    back() {
      if (LV.closeTopOverlay()) return;
      const tab = LV.state.tab, stack = LV.state.stacks[tab], pane = LV.paneOf(tab);
      if (!LV.state.session) return;
      if (stack.length > 1) {
        // Unsaved form: ask before discarding (system back included).
        const cur = stack.at(-1), guard = LV.screens[cur.name].guard;
        if (guard && !cur.ui.leaving && guard(cur)) {
          LV.confirm({ title: '放弃未保存的内容？', message: '离开后，已填写的信息不会保留。', ok: '放弃', cancel: '继续编辑', danger: true })
            .then(ok => { if (ok) { cur.ui.leaving = true; LV.nav.back(); } });
          return;
        }
        const r = stack.pop(), el = pane.querySelector(`.screen[data-key="${r.key}"]`);
        const prev = stack.at(-1), prevEl = pane.querySelector(`.screen[data-key="${prev.key}"]`);
        if (prevEl) { prevEl.hidden = false; paint(prevEl, prev); requestAnimationFrame(() => prevEl.classList.remove('is-under')); }
        el?.classList.add('is-leaving'); setTimeout(() => el?.remove(), 330);
        renderTabbar();
        return;
      }
      if (tab !== 'home') { LV.nav.tab('home'); return; }
      if (LV.state.exitArmed) { LV.toast('原型中不会真正退出 App', { icon: 'info' }); return; }
      LV.state.exitArmed = true; LV.toast('再按一次退出 LVANJUBOS', { icon: 'info', duration: 2000 });
      setTimeout(() => { LV.state.exitArmed = false; }, 2000);
    },
    tab(tab) {
      if (tab === LV.state.tab) {
        // Tapping the current tab again returns to its root and scrolls to top (platform convention).
        const stack = LV.state.stacks[tab];
        if (stack.length > 1) { LV.state.stacks[tab] = [stack[0]]; buildPane(tab); }
        else LV.paneOf(tab).querySelector('.scroll')?.scrollTo({ top: 0, behavior: 'smooth' });
        renderTabbar(); return;
      }
      LV.paneOf(LV.state.tab).hidden = true;
      LV.state.tab = tab;
      const pane = LV.paneOf(tab); pane.hidden = false;
      const r = top(tab), el = pane.querySelector(`.screen[data-key="${r.key}"]`);
      if (el) { paint(el, r); el.classList.remove('is-fade'); void el.offsetWidth; el.classList.add('is-fade'); }
      renderTabbar(); LV.closeAllOverlays();
    },
    /** Deep link (notification tap, quick action): switch tab, reset its stack, open the page. */
    open(tab, name, params = {}) {
      LV.closeAllOverlays();
      LV.state.stacks[tab] = [route(LV.TABS.find(t => t.key === tab).root)];
      buildPane(tab);
      if (LV.state.tab !== tab) { LV.paneOf(LV.state.tab).hidden = true; LV.state.tab = tab; LV.paneOf(tab).hidden = false; }
      if (name && name !== LV.state.stacks[tab][0].name) LV.nav.push(name, params);
      else { LV.state.stacks[tab][0].params = params; LV.refresh(); }
      renderTabbar();
    },
  };

  function buildPane(tab) {
    const pane = LV.paneOf(tab); pane.innerHTML = '';
    const stack = LV.state.stacks[tab];
    stack.forEach((r, i) => { const el = makeScreen(r); if (i < stack.length - 1) { el.hidden = true; el.classList.add('is-under'); } pane.appendChild(el); });
  }

  /* ── Shell ───────────────────────────────────────────── */
  LV.mountApp = () => {
    const root = app();
    if (!LV.state.session) {
      root.innerHTML = `<div class="tab-pane" data-tab="login"></div><div class="overlay-root"></div><div class="toast-layer" aria-live="polite"></div>`;
      const r = route('login'); LV.state.stacks = { login: [r] }; LV.state.tab = 'login';
      const el = makeScreen(r); root.querySelector('.tab-pane').appendChild(el);
      return;
    }
    root.innerHTML = LV.TABS.map(t => `<div class="tab-pane" data-tab="${t.key}"${t.key === 'home' ? '' : ' hidden'}></div>`).join('') +
      `<nav class="tabbar" aria-label="主导航"></nav><div class="overlay-root"></div><div class="toast-layer" aria-live="polite"></div>`;
    LV.state.stacks = Object.fromEntries(LV.TABS.map(t => [t.key, [route(t.root)]]));
    LV.state.tab = 'home';
    LV.TABS.forEach(t => buildPane(t.key));
    renderTabbar();
  };

  function renderTabbar() {
    const bar = app().querySelector('.tabbar'); if (!bar) return;
    const c = LV.counts(), badges = { customers: c.customersBadge, inbox: c.inbox };
    bar.innerHTML = LV.TABS.map(t => `<button type="button" ${LV.attr('tab', { tab: t.key })} ${LV.state.tab === t.key ? 'aria-current="page"' : ''} aria-label="${t.label}${badges[t.key] ? `，${badges[t.key]} 条未处理` : ''}"><span class="tb-icon">${LV.icon(t.icon)}${badges[t.key] ? `<b class="tb-badge">${badges[t.key] > 99 ? '99+' : badges[t.key]}</b>` : ''}</span>${t.label}</button>`).join('');
    // Detail pages and modes with their own bottom actions (e.g. batch select) take the bar's place.
    const r = top(), hidden = (LV.state.stacks[LV.state.tab]?.length ?? 1) > 1 || !!(r && LV.screens[r.name].hideTabbar?.(r));
    bar.classList.toggle('is-hidden', hidden);
  }
  LV.renderTabbar = renderTabbar;

  /* ── Overlays: sheet / dialog / toast ────────────────── */
  const overlays = [];
  const overlayRoot = () => app().querySelector('.overlay-root');
  LV.sheet = ({ title = '', sub = '', body = '', foot = '', onClose, name = '' } = {}) => {
    const wrap = document.createElement('div');
    wrap.className = 'overlay';
    wrap.innerHTML = `<div class="scrim" ${LV.attr('close-overlay')}></div><div class="sheet" role="dialog" aria-modal="true" aria-label="${LV.esc(title)}" data-sheet="${name}"><div class="sheet-handle" aria-hidden="true"><span></span></div>${title ? `<div class="sheet-head"><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div><button class="icon-btn" ${LV.attr('close-overlay')} aria-label="关闭">${LV.icon('x')}</button></div>` : ''}<div class="sheet-body">${body}</div>${foot ? `<div class="sheet-foot">${foot}</div>` : ''}</div>`;
    overlayRoot().appendChild(wrap);
    const entry = { el: wrap, onClose, kind: 'sheet', name };
    overlays.push(entry);
    attachSheetDrag(wrap.querySelector('.sheet'), entry);
    setTimeout(() => wrap.querySelector('.sheet input, .sheet textarea, .sheet button:not(.icon-btn)')?.focus({ preventScroll: true }), 300);
    return entry;
  };
  LV.updateSheet = (html, name) => { const e = [...overlays].reverse().find(o => o.kind === 'sheet' && (!name || o.name === name)); if (e) e.el.querySelector('.sheet-body').innerHTML = html; };
  function closeEntry(entry) {
    const i = overlays.indexOf(entry); if (i < 0) return;
    overlays.splice(i, 1);
    entry.el.classList.add('is-closing'); entry.el.querySelector('.sheet')?.classList.add('is-closing');
    setTimeout(() => entry.el.remove(), 230);
    entry.onClose?.();
  }
  LV.closeTopOverlay = () => { const e = overlays.at(-1); if (!e) return false; if (e.kind === 'dialog') e.resolve?.(false); closeEntry(e); return true; };
  LV.closeAllOverlays = () => { while (overlays.length) LV.closeTopOverlay(); };
  LV.closeSheet = () => { const e = [...overlays].reverse().find(o => o.kind === 'sheet'); if (e) closeEntry(e); };

  /** Confirmation for dangerous or irreversible actions. Optional reason field (e.g. 取消订单需要原因). */
  LV.confirm = ({ title, message = '', ok = '确定', cancel = '取消', danger = false, field = null } = {}) => new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'overlay';
    wrap.innerHTML = `<div class="scrim"></div><div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-t"><h2 id="dlg-t">${title}</h2>${message ? `<p>${message}</p>` : ''}${field ? `<div class="field"><label for="dlg-field">${field.label}${field.required ? '<i>*</i>' : ''}</label><textarea id="dlg-field" class="textarea" style="min-height:76px" placeholder="${LV.esc(field.placeholder || '')}"></textarea><div class="field-error" hidden>${LV.icon('circle-alert')}<span>${field.error || '请填写'}</span></div></div>` : ''}<div class="dialog-actions"><button class="btn btn-ghost" data-dlg="cancel">${cancel}</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-dlg="ok">${ok}</button></div></div>`;
    overlayRoot().appendChild(wrap);
    const entry = { el: wrap, kind: 'dialog', resolve };
    overlays.push(entry);
    wrap.addEventListener('click', e => {
      const b = e.target.closest('[data-dlg]'); if (!b) return;
      e.stopPropagation();
      if (b.dataset.dlg === 'ok') {
        if (field) {
          const v = wrap.querySelector('#dlg-field').value.trim();
          if (field.required && v.length < (field.min || 1)) { const err = wrap.querySelector('.field-error'); err.hidden = false; wrap.querySelector('.field').classList.add('has-error'); return; }
          entry.resolve = null; closeEntry(entry); resolve(v || true); return;
        }
        entry.resolve = null; closeEntry(entry); resolve(true);
      } else { entry.resolve = null; closeEntry(entry); resolve(false); }
    });
    setTimeout(() => (wrap.querySelector('#dlg-field') || wrap.querySelector('[data-dlg="ok"]')).focus(), 50);
  });

  LV.toast = (text, { icon = 'circle-check', action, onAction, tone = '', duration = 2800 } = {}) => {
    const layer = app().querySelector('.toast-layer'); if (!layer) return;
    const r = top(), s = r && LV.screens[r.name];
    const hasTab = s?.root && LV.state.session;
    const hasBar = LV.paneOf(LV.state.tab)?.querySelector(`.screen[data-key="${r?.key}"] .actionbar`);
    layer.style.setProperty('--toast-bottom', hasTab ? 'calc(var(--h-tabbar) + 12px)' : hasBar ? '84px' : '16px');
    layer.innerHTML = '';
    const t = document.createElement('div');
    t.className = `toast ${tone ? `t-${tone}` : ''}`;
    t.innerHTML = `${LV.icon(icon)}<span>${text}</span>${action ? `<button type="button">${action}</button>` : ''}`;
    if (action) t.querySelector('button').addEventListener('click', ev => { ev.stopPropagation(); onAction?.(); t.remove(); });
    layer.appendChild(t);
    setTimeout(() => { t.classList.add('is-out'); setTimeout(() => t.remove(), 240); }, duration);
  };

  /* ── Events ──────────────────────────────────────────── */
  LV.actions = {};
  LV.on = (name, fn) => { LV.actions[name] = fn; };
  LV.inputs = {};
  LV.onInput = (name, fn) => { LV.inputs[name] = fn; };
  let suppressClick = false;
  const parse = v => { try { return JSON.parse(v); } catch { return v; } };

  LV.on('go', el => LV.nav.push(el.dataset.to, parse(el.dataset.p || '{}')));
  LV.on('back', () => LV.nav.back());
  LV.on('tab', el => LV.nav.tab(el.dataset.tab));
  LV.on('open', el => LV.nav.open(el.dataset.tab, el.dataset.to, parse(el.dataset.p || '{}')));
  LV.on('close-overlay', () => LV.closeTopOverlay());
  LV.on('noop', () => {});
  /** Generic per-screen UI state setter: data-act="set" data-k="seg" data-v="todo". */
  LV.on('set', el => { const r = top(); r.ui[el.dataset.k] = parse(el.dataset.v); if (el.dataset.region) LV.refreshRegion(el.dataset.region); else LV.refresh(); });

  function bindEvents() {
    const root = app();
    root.addEventListener('click', e => {
      if (suppressClick) { suppressClick = false; e.preventDefault(); e.stopPropagation(); return; }
      const el = e.target.closest('[data-act]'); if (!el || !root.contains(el)) return;
      const fn = LV.actions[el.dataset.act];
      if (fn) { e.preventDefault(); fn(el, e, top()); }
    });
    root.addEventListener('input', e => { const el = e.target.closest('[data-input]'); if (el) LV.inputs[el.dataset.input]?.(el, e, top()); });
    root.addEventListener('change', e => { const el = e.target.closest('[data-change]'); if (el) LV.inputs[el.dataset.change]?.(el, e, top()); });
    root.addEventListener('submit', e => { e.preventDefault(); const f = e.target.closest('[data-submit]'); if (f) LV.actions[f.dataset.submit]?.(f, e, top()); });
    root.addEventListener('scroll', e => { if (e.target.classList?.contains('scroll')) onScroll(e.target); }, true);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' || (e.altKey && e.key === 'ArrowLeft')) { e.preventDefault(); LV.nav.back(); }
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[data-act][role="button"]')) { e.preventDefault(); e.target.click(); }
    });
    bindPullToRefresh(root);
    bindBackGesture(root);
  }

  function onScroll(sc) {
    if (!sc) return;
    const bar = sc.parentElement.querySelector('.appbar'); if (!bar) return;
    bar.classList.toggle('is-scrolled', sc.scrollTop > (bar.classList.contains('has-large') ? 40 : 4));
    // Extended FAB collapses to its icon once the list scrolls (Material 3 behaviour), so it covers less content.
    sc.parentElement.querySelector('.fab')?.classList.toggle('is-compact', sc.scrollTop > 80);
  }

  /* ── Pull to refresh (touch + mouse drag) ────────────── */
  function bindPullToRefresh(root) {
    let p = null;
    const start = (x, y, target) => {
      const sc = target.closest?.('.scroll[data-ptr]');
      if (!sc || sc.scrollTop > 0 || target.closest('.overlay')) return;
      p = { sc, x0: x, y0: y, pull: 0, active: false, inner: sc.querySelector('.scroll-inner'), ind: sc.querySelector('.ptr') };
    };
    const move = (x, y, ev) => {
      if (!p) return;
      const dy = y - p.y0, dx = Math.abs(x - p.x0);
      if (!p.active) { if (dy > 10 && dy > dx * 1.5) { p.active = true; p.inner.style.transition = 'none'; } else if (dy < -4 || dx > 12) { p = null; return; } else return; }
      ev?.cancelable && ev.preventDefault();
      p.pull = Math.min(110, dy * .5);
      p.inner.style.transform = `translateY(${p.pull}px)`;
      p.ind.style.opacity = Math.min(1, p.pull / 60);
      p.ind.style.transform = `translateY(${p.pull - 44}px) rotate(${p.pull * 4}deg)`;
    };
    const end = () => {
      if (!p) return;
      const cur = p; p = null;
      if (!cur.active) return;
      suppressClick = true; setTimeout(() => { suppressClick = false; }, 60);
      cur.inner.style.transition = '';
      if (cur.pull > 58) {
        cur.inner.style.transform = 'translateY(52px)';
        cur.ind.style.transform = 'translateY(10px)'; cur.ind.classList.add('is-spinning');
        setTimeout(() => {
          const r = top(); r.ui.updatedAt = '刚刚'; LV.screens[r.name].onRefresh?.(r);
          cur.inner.style.transform = ''; cur.ind.style.opacity = 0; cur.ind.classList.remove('is-spinning');
          LV.refresh(); LV.toast('已更新到最新数据', { icon: 'refresh-cw', duration: 1600 });
        }, 900);
      } else { cur.inner.style.transform = ''; cur.ind.style.opacity = 0; }
    };
    root.addEventListener('touchstart', e => start(e.touches[0].clientX, e.touches[0].clientY, e.target), { passive: true });
    root.addEventListener('touchmove', e => move(e.touches[0].clientX, e.touches[0].clientY, e), { passive: false });
    root.addEventListener('touchend', end); root.addEventListener('touchcancel', end);
    root.addEventListener('mousedown', e => { if (e.button === 0) start(e.clientX, e.clientY, e.target); });
    window.addEventListener('mousemove', e => { if (p) move(e.clientX, e.clientY, e); });
    window.addEventListener('mouseup', end);
  }

  /* ── System back gesture: swipe from the left edge (Android & HarmonyOS 侧滑返回) ── */
  function bindBackGesture(root) {
    let g = null;
    const ind = document.createElement('div');
    ind.className = 'back-indicator'; ind.innerHTML = `<span>${LV.icon('chevron-left')}</span>`;
    root.appendChild(ind);
    const start = (x, y) => {
      const rect = root.getBoundingClientRect();
      if (x - rect.left > 22 || !LV.state.session) return;
      g = { x0: x, y: y - rect.top, dx: 0 };
    };
    const move = (x, ev) => {
      if (!g) return;
      g.dx = Math.max(0, x - g.x0);
      if (g.dx > 6 && ev?.cancelable) ev.preventDefault();
      const k = Math.min(1, g.dx / 80);
      ind.style.opacity = k; ind.style.top = `${g.y}px`; ind.style.transform = `translateX(${Math.min(28, g.dx / 3) - 8}px) scale(${.6 + k * .4})`;
    };
    const end = () => {
      if (!g) return;
      if (g.dx > 80) { suppressClick = true; setTimeout(() => { suppressClick = false; }, 60); LV.nav.back(); }
      g = null; ind.style.opacity = 0;
    };
    root.addEventListener('touchstart', e => start(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
    root.addEventListener('touchmove', e => move(e.touches[0].clientX, e), { passive: false });
    root.addEventListener('touchend', end);
    root.addEventListener('mousedown', e => { if (e.button === 0) start(e.clientX, e.clientY); });
    window.addEventListener('mousemove', e => { if (g) move(e.clientX, e); });
    window.addEventListener('mouseup', end);
  }

  /* ── Sheet drag-to-dismiss ───────────────────────────── */
  function attachSheetDrag(sheet, entry) {
    let s = null;
    const handle = sheet.querySelector('.sheet-handle');
    const begin = y => { s = { y0: y, dy: 0 }; sheet.style.transition = 'none'; };
    const drag = y => { if (!s) return; s.dy = Math.max(0, y - s.y0); sheet.style.transform = `translateY(${s.dy}px)`; };
    const done = () => { if (!s) return; sheet.style.transition = 'transform .2s'; if (s.dy > 110) closeEntry(entry); else sheet.style.transform = ''; s = null; };
    handle.addEventListener('touchstart', e => begin(e.touches[0].clientY), { passive: true });
    handle.addEventListener('touchmove', e => drag(e.touches[0].clientY), { passive: true });
    handle.addEventListener('touchend', done);
    handle.addEventListener('mousedown', e => { begin(e.clientY); const mm = ev => drag(ev.clientY); const mu = () => { done(); window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); }; window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu); });
  }

  /* ── Loading / empty / error gate for data screens ───── */
  LV.gate = (r, ui, content, { skeleton = 'list', empty } = {}) => {
    if (LV.state.offline && !LV.screens[r.name].offline) return LV.ui.offlineBlock();
    const demo = LV.state.demo;
    if (demo === 'loading') return LV.ui.skeleton(skeleton);
    if (demo === 'error') return LV.ui.error();
    if (!ui.loaded) { setTimeout(() => { ui.loaded = true; if (top() === r) LV.refresh(); }, 420); return LV.ui.skeleton(skeleton); }
    if (demo === 'empty' && empty) return empty;
    return content();
  };
  LV.on('retry', () => { LV.state.demo = 'normal'; LV.syncPanel?.(); const r = top(); r.ui.loaded = false; LV.refresh(); });

  /*
   * Offline (decided 2026-11-11: staff may read recent customers offline). Scope: my customers contacted in the last
   * 30 days or with a follow-up scheduled, at most 100, encrypted on the phone. Offline is read-only, except new
   * follow-ups, which are append-only records: they are kept on the phone and sent when the network returns.
   */
  LV.OFFLINE_SAVED_AT = '2026-11-10T10:24';
  // Administrators keep their own customers plus the ones they opened recently, never the whole company.
  LV.state.viewed = ['c1', 'c3', 'c8'];
  LV.offlineCustomers = () => LV.state.offlineCleared ? [] : LV.scope.customers()
    .filter(c => c.owner === LV.me().id || LV.state.viewed.includes(c.id))
    .filter(c => !c.pool && ((c.lastContactAt && LV.fmt.dayDiff(c.lastContactAt) >= -30) || c.nextFollowUpAt))
    .sort((a, b) => (b.lastContactAt || '').localeCompare(a.lastContactAt || '')).slice(0, 100);
  LV.isCached = id => LV.offlineCustomers().some(c => c.id === id);
  LV.needOnline = what => { if (!LV.state.offline) return false; LV.toast(`离线时不能${what}，联网后再试`, { icon: 'wifi-off', tone: 'danger' }); return true; };
  LV.pendingFollowUps = () => Object.values(LV.db.timeline).flat().filter(t => t.pending);
  LV.setOffline = on => {
    LV.state.offline = on;
    if (!on) {
      const pending = LV.pendingFollowUps();
      pending.forEach(t => { t.pending = false; t.title = t.title.replace('（待同步）', ''); });
      if (pending.length) setTimeout(() => LV.toast(`已联网，${pending.length} 条离线跟进已同步`, { icon: 'refresh-cw' }), 50);
    }
    LV.refresh(); LV.syncPanel?.();
  };

  LV.boot = () => { bindEvents(); LV.mountApp(); };
})();

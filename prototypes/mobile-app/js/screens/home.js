/*
 * 工作台 Dashboard — 老板 5 秒看懂经营，销售 5 秒知道先做什么。
 * 数据口径沿用 BOS：销售额按成交日期（Deal.dealDate）、新增客户按询盘日期（Customer.inquiryAt）、
 * 待跟进 = 销售工作台「今日」队列（services/bos-sales-service.ts queueFilters.today），
 * 待处理订单 = 订单页提醒（待付款 / 待发货 / 物流异常 / 待收款，services/order-service.ts）。
 */
(function () {
  const LV = window.LV, U = LV.ui, I = LV.icon, F = LV.fmt;

  const greeting = () => { const h = new Date(LV.NOW).getHours(); return h < 11 ? '上午好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好'; };

  function quickActions() {
    const admin = LV.isAdmin();
    const items = [
      ['user-plus', '新建客户', LV.go('customer-new')],
      ['pencil', '写跟进', LV.attr('quick-follow')],
      ['list-todo', '任务', LV.go('tasks')],
      ['chart-line', admin ? '经营数据' : '我的业绩', LV.go('analytics')],
      ['file-text', '报价单', LV.attr('open', { tab: 'orders', to: 'orders', p: { seg: 'quotes' } })],
      admin ? ['stamp', '审批', LV.attr('open', { tab: 'orders', to: 'orders', p: { seg: 'approvals' } })] : ['message-square-text', '常用话术', LV.attr('quick-replies')],
      admin ? ['user-check', '待分配', LV.attr('open', { tab: 'customers', to: 'customers', p: { queue: 'pool' } })] : ['clipboard-check', '待首联', LV.attr('open', { tab: 'customers', to: 'customers', p: { queue: 'new' } })],
      ['calendar-days', '日历', LV.go('tasks', { view: 'calendar' })],
    ];
    return `<div class="quick-grid">${items.map(([icon, label, attrs]) => `<button type="button" class="quick" ${attrs}><span>${I(icon)}</span>${label}</button>`).join('')}</div>`;
  }

  function myTasks() {
    const list = LV.scope.tasks().filter(t => t.status !== 'DONE' && LV.fmt.dayDiff(t.due) <= 0).sort((a, b) => a.due.localeCompare(b.due));
    const done = LV.scope.tasks().filter(t => t.status === 'DONE' && t.doneAt?.startsWith(LV.TODAY)).length;
    if (!list.length) return `<div class="card">${U.empty({ icon: 'circle-check', title: '今天的待办都完成了', text: '新的跟进提醒会出现在这里。' })}</div>`;
    return `<div class="list">${list.slice(0, 4).map(t => LV.taskRow(t, { compact: true })).join('')}</div>
      <p class="list-foot">今日已完成 ${done} 项 · 共 ${list.length} 项待办</p>`;
  }

  function adminAlerts() {
    const late = LV.db.orders.filter(o => o.status === 'IN_TRANSIT' && o.eta && o.eta < LV.TODAY);
    const stale = LV.db.quotes.filter(q => q.status === 'SENT' && LV.fmt.dayDiff(q.sentAt) <= -3 && !['ORDER', 'WON'].includes(LV.customer(q.customer).stage));
    const pending = LV.db.approvals.filter(a => a.status === 'PENDING');
    const rows = [
      late.length && { icon: 'truck', tone: 'danger', title: `物流异常 ${late.length} 单`, sub: `${late[0].no} 已超预计到货 ${-F.dayDiff(late[0].eta)} 天`, attrs: LV.attr('open', { tab: 'orders', to: 'order', p: { id: late[0].id } }) },
      stale.length && { icon: 'file-text', tone: 'warning', title: `${stale.length} 份报价超过 3 天未确认`, sub: stale.map(q => LV.customer(q.customer).name.split(' ')[0]).join('、'), attrs: LV.attr('open', { tab: 'orders', to: 'orders', p: { seg: 'quotes' } }) },
      { icon: 'timer', tone: 'warning', title: 'A/B 级线索首联超时 1 位', sub: 'Ivan Petrov · 负责人 陈航', attrs: LV.attr('open', { tab: 'customers', to: 'customer', p: { id: 'c5' } }) },
      pending.length && { icon: 'stamp', tone: 'info', title: `${pending.length} 项待审批`, sub: pending.map(a => a.type).join('、'), attrs: LV.attr('open', { tab: 'orders', to: 'orders', p: { seg: 'approvals' } }), planned: true },
    ].filter(Boolean);
    return `<div class="list">${rows.map(r => U.cell({ lead: `<span class="cell-lead tone-${r.tone}">${I(r.icon)}</span>`, title: r.title + (r.planned ? ` ${U.planned()}` : ''), sub: r.sub, attrs: r.attrs })).join('')}</div>`;
  }

  function adminBody(r, ui) {
    const m = LV.METRICS.ADMIN, t = m.today, mo = m.month;
    const pool = LV.db.customers.filter(c => c.pool);
    const orders = LV.db.orders, pay = orders.filter(o => o.payment === 'UNPAID' && o.status !== 'CANCELLED').length,
      ship = orders.filter(o => o.status === 'PRODUCING').length, late = orders.filter(o => o.status === 'IN_TRANSIT' && o.eta < LV.TODAY).length;
    return `
      ${pool.length ? `<div class="pad"><button type="button" class="alert-card" ${LV.attr('open', { tab: 'customers', to: 'customer', p: { id: pool[0].id } })}>
        <span class="alert-icon">${I('bell-ring')}</span>
        <span class="alert-main"><strong>${pool[0].grade} 级新线索待分配 · 已等待 ${t.poolOldestMin} 分钟</strong><span>${pool[0].name} · ${pool[0].country} · ${pool[0].gradeReason}</span></span>
        <span class="alert-go">去分配${I('chevron-right')}</span></button></div>` : ''}
      <div class="pad"><button type="button" class="hero" ${LV.go('analytics')}>
        <span class="hero-top"><span>今日销售业绩</span><span class="hero-badge">${t.todayDeals} 笔成交</span></span>
        <span class="hero-value num">${U.money(t.todayRevenue)}</span>
        <span class="hero-month"><span>本月 <b class="num">¥${F.wan(mo.revenue)}</b> / 目标 ¥${F.wan(mo.target)}</span><span class="num">${F.pct(mo.revenue, mo.target)}</span></span>
        ${U.meter(mo.revenue / mo.target, 'on-dark')}
        <span class="hero-foot"><span>较上月同期 ${U.delta(F.change(mo.revenue, mo.prevRevenue))}</span><span>另有 ${mo.otherCurrency}</span></span>
      </button></div>
      <div class="pad kpi-grid">
        ${U.stat({ label: '今日新增客户', icon: 'user-round-plus', value: t.newCustomers, foot: `较昨日 <b class="num">+${t.newDelta}</b> · 待分配 ${pool.length}`, attrs: LV.attr('open', { tab: 'customers', to: 'customers', p: { queue: 'all' } }) })}
        ${U.stat({ label: '待跟进客户', icon: 'alarm-clock', value: t.pendingFollow, foot: `<span class="warn">${t.overdueFollow} 位已逾期</span>`, attrs: LV.attr('open', { tab: 'customers', to: 'customers', p: { queue: 'today' } }) })}
        ${U.stat({ label: '待处理订单', icon: 'package', value: pay + ship + late, foot: `待付款 ${pay} · 待发货 ${ship} · <span class="warn">异常 ${late}</span>`, attrs: LV.attr('tab', { tab: 'orders' }) })}
        ${U.stat({ label: '本月订单', icon: 'receipt', value: mo.orders, foot: `较上月同期 ${U.delta(F.change(mo.orders, mo.prevOrders))}`, attrs: LV.go('analytics') })}
      </div>
      ${U.section('订单金额趋势', `<div class="pad"><div class="card card-body">${LV.charts.trend(m.trend, { tip: ui['tip-trend'] })}</div></div>`, { sub: '本月累计 · 按成交日期', link: '经营数据', linkAttrs: LV.go('analytics') })}
      ${U.section('快捷操作', `<div class="pad">${quickActions()}</div>`)}
      ${U.section('重要提醒', `<div class="pad">${adminAlerts()}</div>`)}
      ${U.section('我的待办', `<div class="pad">${myTasks()}</div>`, { sub: '今天', link: '全部任务', linkAttrs: LV.go('tasks') })}
      ${U.mockNote()}`;
  }

  function salesBody(r, ui) {
    const m = LV.METRICS.SALES, mo = m.month;
    const mine = LV.scope.customers();
    const first = mine.filter(c => c.firstContactDueAt && !c.lastContactAt);
    const waiting = mine.filter(c => c.waiting);
    const todayWork = m.today.todayWork, overdue = m.today.overdueWork;
    const myOrders = LV.scope.orders();
    const pendingOrders = myOrders.filter(o => (o.payment === 'UNPAID' && o.status !== 'CANCELLED') || o.status === 'PRODUCING' || (o.status === 'IN_TRANSIT' && o.eta < LV.TODAY));
    const newToday = mine.filter(c => c.inquiryAt?.startsWith(LV.TODAY));
    return `
      ${first.map(c => `<div class="pad"><div class="countdown-card">
        <div class="cd-head"><span class="cd-label">${I('timer')}首次联系倒计时</span><span class="cd-time num" data-countdown="${(new Date(c.firstContactDueAt) - new Date(LV.NOW)) / 1000}">04:00</span></div>
        <button type="button" class="cd-main" ${LV.attr('open', { tab: 'customers', to: 'customer', p: { id: c.id } })}>${U.avatar(c.name, { grade: c.grade, size: 'sm' })}<span><strong>${c.name}</strong><small>${U.cc(c.cc)} ${c.country} · ${LV.CONST.sources[c.source]} · ${c.gradeReason}</small></span></button>
        <div class="cd-actions">${U.btn('WhatsApp', { kind: 'primary', icon: 'message-circle', attrs: LV.attr('contact-wa', { id: c.id }) })}${U.btn('拨打电话', { kind: 'secondary', icon: 'phone', attrs: LV.attr('contact-call', { id: c.id }) })}</div>
      </div></div>`).join('')}
      <div class="pad"><button type="button" class="hero" ${LV.attr('open', { tab: 'customers', to: 'customers', p: { queue: 'today' } })}>
        <span class="hero-top"><span>今日需要跟进</span><span class="hero-badge">${overdue} 位已逾期</span></span>
        <span class="hero-value num">${todayWork}<span class="hero-unit">位客户</span></span>
        <span class="hero-split"><span><b class="num">${first.length}</b>待首联</span><span><b class="num">${waiting.length}</b>等你回复</span><span><b class="num">${pendingOrders.length}</b>订单待办</span></span>
      </button></div>
      <div class="pad kpi-grid">
        ${U.stat({ label: '今日新增客户', icon: 'user-round-plus', value: newToday.length, foot: '分配给我的新线索', attrs: LV.attr('open', { tab: 'customers', to: 'customers', p: { queue: 'all' } }) })}
        ${U.stat({ label: '待跟进客户', icon: 'alarm-clock', value: todayWork, foot: `<span class="warn">${overdue} 位已逾期</span>`, attrs: LV.attr('open', { tab: 'customers', to: 'customers', p: { queue: 'today' } }) })}
        ${U.stat({ label: '待处理订单', icon: 'package', value: pendingOrders.length, foot: '待付款 1 · <span class="warn">物流异常 1</span>', attrs: LV.attr('tab', { tab: 'orders' }) })}
        ${U.stat({ label: '今日销售业绩', icon: 'banknote', value: U.money(m.today.todayRevenue), foot: `本月 ¥${F.wan(mo.revenue)} · 目标 ${F.pct(mo.revenue, mo.target)}`, attrs: LV.go('analytics') })}
      </div>
      ${waiting.length ? U.section('客户在等你回复', `<div class="pad"><div class="list">${waiting.map(c => U.cell({ lead: U.avatar(c.name, { grade: c.grade, size: 'sm' }), title: `${c.name}`, sub: `${LV.esc((LV.db.chats[c.id] || []).filter(x => x.dir === 'in').at(-1)?.trans || c.aiSummary)}`, trail: `<span class="unread-pill num">${c.unread}</span>`, attrs: LV.attr('open', { tab: 'inbox', to: 'chat', p: { id: c.id } }) })).join('')}</div></div>`, { sub: `${waiting.length} 位` }) : ''}
      ${U.section('我的待办', `<div class="pad">${myTasks()}</div>`, { sub: '今天', link: '全部任务', linkAttrs: LV.go('tasks') })}
      ${U.section('快捷操作', `<div class="pad">${quickActions()}</div>`)}
      ${U.section('我的成交趋势', `<div class="pad"><div class="card card-body">${LV.charts.trend(m.trend, { tip: ui['tip-trend'] })}</div></div>`, { sub: '本月累计 · 按成交日期', link: '我的业绩', linkAttrs: LV.go('analytics') })}
      ${U.mockNote()}`;
  }

  LV.screens.home = {
    root: true, large: true, ptr: true, title: '工作台',
    render(p, ui, r) {
      const me = LV.me(), c = LV.counts();
      const body = LV.gate(r, ui, () => (LV.isAdmin() ? adminBody : salesBody)(r, ui), { skeleton: 'dash' });
      return {
        title: '工作台',
        actions: U.iconBtn('search', { label: '搜索客户', attrs: LV.attr('open', { tab: 'customers', to: 'customers', p: { focus: true } }) }) + U.iconBtn('bell', { label: `消息，${c.inbox} 条未读`, attrs: LV.attr('tab', { tab: 'inbox' }), count: c.inbox }),
        body: `<div class="home-greet"><h1>${greeting()}，${me.name}</h1><p>${new Date(LV.NOW).getMonth() + 1} 月 ${new Date(LV.NOW).getDate()} 日 周${F.weekday(LV.NOW)} · ${LV.isAdmin() ? '全公司' : '我的客户'}</p></div>
          ${U.updated(ui)}<div class="stack-lg">${body}</div>`,
      };
    },
  };

  /* 写跟进：先选客户（最近联系的在前），再填跟进 */
  LV.on('quick-follow', () => {
    const list = LV.scope.customers().filter(c => !c.pool).sort((a, b) => (b.lastContactAt || '').localeCompare(a.lastContactAt || '')).slice(0, 6);
    LV.sheet({ title: '给哪位客户写跟进？', sub: '按最近联系排序', body: `<div class="action-list">${list.map(c => `<button type="button" class="action-item" ${LV.attr('follow-for', { id: c.id })}>${U.avatar(c.name, { grade: c.grade, size: 'sm' })}<span><strong>${c.name}</strong><small>${c.company} · ${LV.CONST.stages[c.stage]}</small></span></button>`).join('')}</div>` });
  });
  LV.on('follow-for', el => { LV.closeSheet(); setTimeout(() => LV.openFollowSheet(el.dataset.id), 240); });
  LV.on('quick-replies', () => LV.sheet({ title: '常用话术', sub: '点按复制，在会话里粘贴后人工发送', body: `<div class="action-list">${LV.QUICK_REPLIES.map(q => `<button type="button" class="action-item" ${LV.attr('copy-text', { text: q })}>${I('copy')}<span><strong style="font-weight:400">${LV.esc(q)}</strong></span></button>`).join('')}</div>` }));
  LV.on('copy-text', el => { try { navigator.clipboard?.writeText(el.dataset.text).catch(() => {}); } catch { /* clipboard may be refused */ } LV.closeSheet(); LV.toast('已复制'); });

  /* Live countdown for first-contact deadlines (starts from the mock "now"). */
  const started = Date.now();
  setInterval(() => {
    document.querySelectorAll('[data-countdown]').forEach(el => {
      const left = Math.max(0, Number(el.dataset.countdown) - (Date.now() - started) / 1000);
      el.textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
      el.classList.toggle('is-late', left < 60);
    });
  }, 1000);
})();

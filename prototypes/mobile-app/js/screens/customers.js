/*
 * CRM 客户：列表（搜索 / 队列 / 筛选）、详情（一键联系 / 动态 / 资料）、新建客户，以及跟进、回访、阶段、分配四个底部弹层。
 * 队列定义对应 services/bos-sales-service.ts：new 待首联、today 今日跟进、waiting 等我回复、high 高意向；
 * 管理员另有 pool 待分配（Customer.pendingAssignment）。
 */
(function () {
  const LV = window.LV, U = LV.ui, I = LV.icon, F = LV.fmt, C = LV.CONST;
  const owner = id => LV.USERS[id]?.name ?? '待分配';
  const ACTIVE = c => ![...C.closedStages, 'WON'].includes(c.stage);
  const QUEUES = {
    pool: { label: '待分配', test: c => c.pool, admin: true },
    all: { label: '全部', test: () => true },
    today: { label: '今日跟进', test: c => ACTIVE(c) && !c.pool && ((c.nextFollowUpAt && F.dayDiff(c.nextFollowUpAt) <= 0) || (c.firstContactDueAt && !c.lastContactAt)) },
    new: { label: '待首联', test: c => c.firstContactDueAt && !c.lastContactAt && !c.pool },
    waiting: { label: '等我回复', test: c => c.waiting },
    high: { label: '高意向', test: c => ACTIVE(c) && (c.aiScore >= 80 || c.grade === 'A') && !c.pool },
  };
  const SORTS = { next: '下次跟进', inquiry: '最近询盘', contact: '最近联系', score: 'AI 评分' };

  function filtered(ui) {
    const q = (ui.q || '').trim().toLowerCase(), f = ui.filters || {};
    let list = (LV.state.offline ? LV.offlineCustomers() : LV.scope.customers()).filter(QUEUES[ui.queue || 'all'].test);
    if (q) list = list.filter(c => [c.name, c.company, c.country, c.city, c.whatsapp, c.email, c.model].join(' ').toLowerCase().includes(q));
    if (f.stages?.length) list = list.filter(c => f.stages.includes(c.stage));
    if (f.grades?.length) list = list.filter(c => f.grades.includes(c.grade));
    if (f.sources?.length) list = list.filter(c => f.sources.includes(c.source));
    if (f.countries?.length) list = list.filter(c => f.countries.includes(c.country));
    if (f.tags?.length) list = list.filter(c => c.tags.some(t => f.tags.includes(t)));
    if (f.owners?.length) list = list.filter(c => f.owners.includes(c.owner || 'pool'));
    const sort = f.sort || 'next';
    const key = { next: c => c.firstContactDueAt && !c.lastContactAt ? '0' + c.firstContactDueAt : c.nextFollowUpAt || '9', inquiry: c => c.inquiryAt, contact: c => c.lastContactAt || '', score: c => String(1000 - c.aiScore).padStart(4, '0') }[sort];
    list.sort((a, b) => sort === 'inquiry' || sort === 'contact' ? key(b).localeCompare(key(a)) : key(a).localeCompare(key(b)));
    return list;
  }
  const filterCount = f => ['stages', 'grades', 'sources', 'countries', 'tags', 'owners'].reduce((n, k) => n + (f?.[k]?.length ? 1 : 0), 0) + (f?.sort && f.sort !== 'next' ? 1 : 0);

  function customerCard(c) {
    const due = c.firstContactDueAt && !c.lastContactAt ? { ...F.due(c.firstContactDueAt), first: true } : c.nextFollowUpAt ? F.due(c.nextFollowUpAt) : null;
    const dueHtml = due ? `<span class="meta-item ${due.late ? 'is-late' : due.soon ? 'is-soon' : ''}">${I(due.first ? 'timer' : 'alarm-clock')}${due.first ? '首联 ' : ''}${due.text}</span>` : '';
    const actions = c.pool && LV.isAdmin()
      ? U.btn('分配', { kind: 'tonal', size: 'sm', icon: 'user-check', attrs: LV.attr('assign', { id: c.id }) })
      : `<button type="button" class="round-btn" ${LV.attr('contact-call', { id: c.id })} aria-label="给 ${c.name} 打电话">${I('phone')}</button><button type="button" class="round-btn is-wa" ${LV.attr('contact-wa', { id: c.id })} aria-label="WhatsApp 联系 ${c.name}">${I('message-circle')}${c.unread ? `<b>${c.unread}</b>` : ''}</button>`;
    return `<article class="ccard card">
      <div class="ccard-main pressable" role="button" tabindex="0" ${LV.go('customer', { id: c.id })} aria-label="${c.name}，${c.company}">
        ${U.avatar(c.name, { grade: c.grade })}
        <div class="ccard-text">
          <div class="ccard-name"><strong>${LV.esc(c.name)}</strong>${U.cc(c.cc)}</div>
          <div class="ccard-sub">${LV.esc(c.company)} · ${c.country}${c.city ? ` ${c.city}` : ''}</div>
          <div class="ccard-badges">${U.stageBadge(c.stage)}${c.waiting ? U.badge(`客户已回复`, 'danger', 'message-circle') : ''}${c.tags.map(U.tag).join('')}</div>
        </div>
      </div>
      <div class="ccard-foot">
        <div class="ccard-meta">${dueHtml}${LV.isAdmin() ? `<span class="meta-item">${I('user-round')}${owner(c.owner)}</span>` : ''}<span class="meta-item">${I('history')}${c.lastContactAt ? F.ago(c.lastContactAt) : `询盘 ${F.ago(c.inquiryAt)}`}</span></div>
        <div class="ccard-actions">${actions}</div>
      </div>
    </article>`;
  }

  function listRegion(p, ui) {
    const list = filtered(ui), q = (ui.q || '').trim();
    if (LV.state.demo === 'empty' || !list.length) {
      return q ? U.empty({ icon: 'text-search', title: `没有找到「${LV.esc(q)}」`, text: '换个关键词，或按姓名、公司、国家、WhatsApp 号码搜索。', action: U.btn('新建客户', { kind: 'tonal', icon: 'user-plus', attrs: LV.go('customer-new', { name: q }) }) })
        : U.empty({ icon: 'users', title: ui.queue === 'pool' ? '没有待分配的线索' : '这里还没有客户', text: ui.queue === 'pool' ? '新的广告线索会先进入待分配，再由管理员分配。' : '新建客户，或等待广告线索自动进入。', action: U.btn('新建客户', { kind: 'tonal', icon: 'user-plus', attrs: LV.go('customer-new') }) });
    }
    return `<p class="list-count">${LV.state.offline ? `离线 · 本机保存的最近客户中有 ${list.length} 位符合` : `共 ${list.length} 位`} · 按${SORTS[ui.filters?.sort || 'next']}排序</p><div class="stack">${list.map(customerCard).join('')}</div>`;
  }

  LV.screens.customers = {
    root: true, large: true, ptr: true, title: '客户', offline: true,
    render(p, ui, r) {
      if (p.queue && !ui.queueSet) { ui.queue = p.queue; ui.queueSet = true; }
      if (!ui.queue) ui.queue = LV.isAdmin() ? 'all' : 'today';
      const base = LV.state.offline ? LV.offlineCustomers() : LV.scope.customers();
      const counts = Object.fromEntries(Object.entries(QUEUES).map(([k, q]) => [k, base.filter(q.test).length]));
      const n = filterCount(ui.filters);
      const chips = Object.entries(QUEUES).filter(([, q]) => !q.admin || LV.isAdmin()).map(([k, q]) => U.chip(q.label, { pressed: ui.queue === k, count: counts[k], alert: ['pool', 'new', 'waiting'].includes(k) && counts[k] > 0, attrs: LV.attr('set', { k: 'queue', v: JSON.stringify(k) }) })).join('');
      return {
        title: '客户',
        actions: U.iconBtn('user-plus', { label: '新建客户', attrs: LV.go('customer-new') }),
        body: `${U.largeTitle('客户', LV.state.offline ? `离线 · 本机保存 ${base.length} 位最近客户` : LV.isAdmin() ? `全公司 ${LV.db.customers.length} 位 · 待分配 ${counts.pool}` : `我负责的 ${LV.scope.customers().length} 位客户`)}
          <div class="sticky-tools">
            <div class="toolbar"><label class="search">${I('search')}<span class="sr-only">搜索客户</span><input type="search" id="cust-q" placeholder="姓名、公司、国家、WhatsApp" value="${LV.esc(ui.q || '')}" data-input="cust-search" enterkeyhint="search"></label>
            <button type="button" class="filter-btn" ${LV.attr('cust-filter')} aria-label="筛选和排序${n ? `，已选 ${n} 项` : ''}">${I('sliders-horizontal')}筛选${n ? `<b>${n}</b>` : ''}</button></div>
            <div class="chip-row" role="tablist" aria-label="客户队列">${chips}</div>
          </div>
          <div class="pad" data-region="list">${LV.gate(r, ui, () => listRegion(p, ui))}</div>`,
        fab: LV.state.offline ? '' : `<button type="button" class="fab" ${LV.go('customer-new')} aria-label="新建客户">${I('plus')}<span>新建客户</span></button>`,
      };
    },
    mount(el, r) { if (r.params.focus && !r.ui.focused) { r.ui.focused = true; setTimeout(() => el.querySelector('#cust-q')?.focus(), 360); } },
    regions: { list: (p, ui) => listRegion(p, ui) },
  };
  LV.onInput('cust-search', (el, e, r) => { r.ui.q = el.value; LV.refreshRegion('list'); });

  /* ── Filter sheet ──────────────────────────────────────── */
  function filterBody(f) {
    const group = (title, key, entries) => `<div class="filter-group"><h3>${title}</h3><div class="option-grid">${entries.map(([v, l]) => U.chip(l, { pressed: (f[key] || []).includes(v), attrs: LV.attr('cf-toggle', { key, v }) })).join('')}</div></div>`;
    const countries = [...new Set(LV.scope.customers().map(c => c.country))];
    return group('阶段', 'stages', C.stageFlow.concat(C.closedStages).map(s => [s, C.stages[s]]))
      + group('线索等级', 'grades', Object.entries(C.grades))
      + group('来源', 'sources', ['FACEBOOK', 'META_CLICK_TO_WHATSAPP', 'TIKTOK', 'INSTAGRAM', 'ALIBABA', 'WEBSITE', 'EXHIBITION', 'REFERRAL'].map(s => [s, C.sources[s]]))
      + group('国家', 'countries', countries.map(c => [c, c]))
      + group('标签', 'tags', Object.entries(LV.TAGS).map(([k, t]) => [k, t.name]))
      + (LV.isAdmin() ? group('负责人', 'owners', [...Object.values(LV.USERS).filter(u => u.role === 'SALES').map(u => [u.id, u.name]), ['pool', '待分配']]) : '')
      + `<div class="filter-group"><h3>排序</h3><div class="action-list">${Object.entries(SORTS).map(([k, l]) => `<button type="button" class="action-item${(f.sort || 'next') === k ? ' is-selected' : ''}" ${LV.attr('cf-sort', { v: k })}><span class="radio${(f.sort || 'next') === k ? ' is-on' : ''}"></span><span><strong>${l}</strong></span></button>`).join('')}</div></div>`;
  }
  let draft = null;
  const filterFoot = () => { const r = LV.top(); const n = filtered({ ...r.ui, filters: draft }).length; return `${U.btn('重置', { kind: 'secondary', attrs: LV.attr('cf-reset') })}${U.btn(`显示 ${n} 位客户`, { kind: 'primary', attrs: LV.attr('cf-apply') })}`; };
  const repaintFilter = () => { LV.updateSheet(filterBody(draft), 'filter'); document.querySelector('[data-sheet="filter"] .sheet-foot').innerHTML = filterFoot(); };
  LV.on('cust-filter', (el, e, r) => { draft = structuredClone(r.ui.filters || {}); LV.sheet({ name: 'filter', title: '筛选与排序', body: filterBody(draft), foot: filterFoot() }); });
  LV.on('cf-toggle', el => { const { key, v } = el.dataset; const arr = draft[key] || (draft[key] = []); const i = arr.indexOf(v); i < 0 ? arr.push(v) : arr.splice(i, 1); repaintFilter(); });
  LV.on('cf-sort', el => { draft.sort = el.dataset.v; repaintFilter(); });
  LV.on('cf-reset', () => { draft = {}; repaintFilter(); });
  LV.on('cf-apply', () => { const r = LV.top(); r.ui.filters = draft; LV.closeSheet(); LV.refresh(); });

  /* ── Customer detail ───────────────────────────────────── */
  const TL_ICON = { IN: ['message-circle', 't-in'], OUT: ['send', ''], FOLLOW: ['pencil', 't-brand'], STAGE: ['flag', ''], QUOTE: ['file-text', 't-warning'], LEAD: ['user-round-plus', 't-brand'], ORDER: ['package', 't-brand'] };
  function timeline(c) {
    const items = LV.db.timeline[c.id] || [{ at: c.inquiryAt, type: 'LEAD', title: `${C.sources[c.source]} 留资${c.grade ? ` · ${c.grade} 级` : ''}`, body: c.gradeReason }];
    return `<div class="timeline">${items.map(t => { const [icon, tone] = TL_ICON[t.type] || ['circle', '']; return `<div class="tl-item${t.pending ? ' is-pending' : ''}"><span class="tl-dot ${tone}">${I(icon)}</span><div><div class="tl-head"><strong>${t.title}</strong><time>${F.ago(t.at)}</time></div>${t.body ? `<div class="tl-body">${t.type === 'IN' ? `<div class="quote">${LV.esc(t.body)}${t.trans ? `<div class="trans">${I('languages')}${LV.esc(t.trans)}</div>` : ''}</div>` : LV.esc(t.body)}</div>` : ''}${t.by ? `<div class="tl-meta">${owner(t.by)}</div>` : ''}</div></div>`; }).join('')}</div>`;
  }
  function profile(c) {
    const kv = rows => `<dl class="kv">${rows.filter(([, v]) => v).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
    return `<div class="stack">
      ${c.demand?.length ? `<div class="card card-body"><h3 class="card-title">${I('sparkles')}需求画像<span class="card-hint">从聊天中提取 · 请核对</span></h3>${kv(c.demand.map(([k, v]) => [k, LV.esc(v)]))}</div>` : ''}
      <div class="card card-body"><h3 class="card-title">联系方式</h3>${kv([['WhatsApp', c.whatsapp ? `<span class="num">${c.whatsapp}</span>` : ''], ['电话', c.phone ? `<span class="num">${c.phone}</span>` : ''], ['邮箱', LV.esc(c.email)], ['语言', c.language], ['城市', `${c.country} ${c.city}`]])}</div>
      <div class="card card-body"><h3 class="card-title">采购信息</h3>${kv([['采购身份', C.purchases[c.purchase]], ['意向产品', `${c.product}${c.model ? ` · ${c.model}` : ''}`], ['数量', c.quantity], ['等级依据', c.gradeReason]])}</div>
      <div class="card card-body"><h3 class="card-title">来源与归属</h3>${kv([['来源', C.sources[c.source]], ['询盘时间', `${F.date(c.inquiryAt)} ${F.time(c.inquiryAt)}`], ['负责人', owner(c.owner)], ['无效 / 暂停原因', c.invalidReason || '']])}</div>
    </div>`;
  }
  function deals(c) {
    const orders = LV.db.orders.filter(o => o.customer === c.id), quotes = LV.db.quotes.filter(q => q.customer === c.id);
    if (!orders.length && !quotes.length) return U.empty({ icon: 'file-text', title: '还没有报价和订单', text: '在电脑端报价工具生成报价单后，会显示在这里。' });
    return `<div class="stack">${orders.map(o => LV.orderCard(o)).join('')}${quotes.map(q => LV.quoteRow(q)).join('')}</div>`;
  }

  LV.screens.customer = {
    offline: true,
    render(p, ui, r) {
      const c = LV.customer(p.id);
      if (!c) return { title: '客户', body: U.empty({ icon: 'circle-x', title: '客户不存在或已移入回收站' }) };
      if (!LV.state.offline && !LV.state.viewed.includes(c.id)) LV.state.viewed.unshift(c.id);
      if (LV.state.offline && !LV.isCached(c.id)) return { title: LV.esc(c.name), body: U.offlineBlock({ title: '这位客户没有离线保存', text: '本机只保存最近 30 天联系过或有待跟进的客户（最多 100 位）。联网后可以查看。' }) };
      const tab = ui.tab || 'timeline';
      const due = c.firstContactDueAt && !c.lastContactAt ? { ...F.due(c.firstContactDueAt), label: '首次联系截止' } : c.nextFollowUpAt ? { ...F.due(c.nextFollowUpAt), label: '下次跟进' } : null;
      const content = LV.gate(r, ui, () => `
        <div class="pad"><div class="card detail-head">
          <div class="dh-top">${U.avatar(c.name, { grade: c.grade, size: 'lg' })}<div class="dh-name"><h1>${LV.esc(c.name)}</h1><p>${LV.esc(c.company)}</p><p class="dh-loc">${U.cc(c.cc)} ${c.country} ${c.city} · ${C.sources[c.source]}</p></div></div>
          <div class="dh-badges"><button type="button" class="stage-btn" ${LV.attr('stage-sheet', { id: c.id })} aria-label="修改阶段，当前${C.stages[c.stage]}">${U.stageBadge(c.stage)}${I('chevron-down')}</button>${c.grade ? U.badge(C.grades[c.grade], c.grade === 'A' ? 'brand' : '') : ''}${c.tags.map(U.tag).join('')}<button type="button" class="tag-add" ${LV.attr('tag-sheet', { id: c.id })} aria-label="添加标签">${I('plus')}标签</button></div>
          <div class="contact-row">
            <button type="button" ${LV.attr('contact-call', { id: c.id })}><span>${I('phone')}</span>电话</button>
            <button type="button" ${LV.attr('contact-wa', { id: c.id })}><span>${I('message-circle')}${c.unread ? `<b>${c.unread}</b>` : ''}</span>WhatsApp</button>
            <button type="button" ${LV.attr('contact-mail', { id: c.id })} ${c.email ? '' : 'disabled'}><span>${I('mail')}</span>邮件</button>
            <button type="button" ${LV.attr('follow', { id: c.id })}><span>${I('pencil')}</span>写跟进</button>
          </div>
        </div></div>
        ${c.pool ? `<div class="pad">${U.note('这条线索还在待分配池。分配后，负责人需按首联时限联系（24 小时内的广告留资为 5 分钟）。')}</div>` : due ? `<div class="pad"><button type="button" class="due-strip${due.late ? ' is-late' : due.soon ? ' is-soon' : ''}" ${LV.attr('revisit', { id: c.id })}>${I(due.late ? 'triangle-alert' : 'alarm-clock')}<span><small>${due.label}</small><strong>${due.text}</strong></span><em>修改${I('chevron-right')}</em></button></div>` : `<div class="pad"><button type="button" class="due-strip" ${LV.attr('revisit', { id: c.id })}>${I('calendar-clock')}<span><small>下次跟进</small><strong>未设置</strong></span><em>设置回访${I('chevron-right')}</em></button></div>`}
        ${c.aiSummary ? `<div class="pad"><div class="ai-card"><div class="ai-head">${I('sparkles')}AI 建议<span>仅供参考，需人工确认</span></div><p>${LV.esc(c.aiSummary)}</p>${c.aiNext ? `<p class="ai-next"><b>下一步</b>${LV.esc(c.aiNext)}</p>` : ''}</div></div>` : ''}
        <div class="pad">${U.seg([{ key: 'timeline', label: '动态' }, { key: 'profile', label: '资料' }, { key: 'deals', label: '报价与订单' }], tab, 'tab')}</div>
        <div class="pad">${tab === 'timeline' ? timeline(c) : tab === 'profile' ? profile(c) : deals(c)}</div>`, { skeleton: 'detail' });
      return {
        title: LV.esc(c.name), sub: `${c.company}`,
        actions: U.iconBtn('ellipsis', { label: '更多操作', attrs: LV.attr('customer-more', { id: c.id }) }),
        body: `<div class="stack-lg" style="padding-top:4px">${content}</div>`,
        footer: c.pool && LV.isAdmin() ? U.btn('分配给销售', { kind: 'primary', icon: 'user-check', attrs: LV.attr('assign', { id: c.id }) })
          : `${U.btn('设置回访', { kind: 'secondary', icon: 'calendar-clock', attrs: LV.attr('revisit', { id: c.id }) })}${U.btn('写跟进', { kind: 'primary', icon: 'pencil', attrs: LV.attr('follow', { id: c.id }) })}`,
      };
    },
  };

  /* ── Contact: call & WhatsApp ──────────────────────────── */
  LV.on('contact-call', el => {
    const c = LV.customer(el.dataset.id), num = c.phone || c.whatsapp;
    LV.sheet({ title: `联系 ${c.name}`, sub: '拨号后回到 App，可以直接记录这次通话', body: `<div class="number-box"><span class="num">${num}</span>${U.btn('复制', { kind: 'secondary', size: 'sm', icon: 'copy', attrs: LV.attr('copy-text', { text: num }) })}</div>
      <div class="action-list"><a class="action-item" href="tel:${num.replace(/\s/g, '')}" ${LV.attr('dial', { id: c.id })}>${I('phone')}<span><strong>拨打电话</strong><small>调起系统拨号盘（Android / HarmonyOS 均使用系统拨号）</small></span></a></div>` });
  });
  LV.on('dial', (el, e) => { e.preventDefault(); const id = el.dataset.id; LV.closeSheet(); LV.toast('已打开系统拨号（原型示意）', { icon: 'phone' }); setTimeout(() => LV.confirm({ title: '记录这次通话？', message: '通话结束后补一条跟进，方便同事接手。', ok: '记录', cancel: '稍后' }).then(ok => ok && LV.openFollowSheet(id, 'PHONE')), 900); });
  LV.on('contact-wa', el => {
    const c = LV.customer(el.dataset.id);
    if (LV.state.offline) { LV.sheet({ title: `WhatsApp · ${c.name}`, body: `<div class="action-list"><button type="button" class="action-item" ${LV.attr('wa-app', { id: c.id })}>${I('external-link')}<span><strong>打开 WhatsApp App</strong><small>离线时无法在 BOS 会话中发送；手机上发的消息联网后会同步回 BOS</small></span></button></div><div class="number-box"><span class="num">${c.whatsapp}</span>${U.btn('复制号码', { kind: 'secondary', size: 'sm', icon: 'copy', attrs: LV.attr('copy-text', { text: c.whatsapp }) })}</div>` }); return; }
    LV.sheet({ title: `WhatsApp · ${c.name}`, body: `<div class="action-list">
      <button type="button" class="action-item" ${LV.attr('open', { tab: 'inbox', to: 'chat', p: { id: c.id } })}>${I('message-square-text')}<span><strong>在 BOS 会话中回复${c.unread ? ` · ${c.unread} 条未读` : ''}</strong><small>推荐：消息自动留痕，可翻译、用常用话术</small></span></button>
      <button type="button" class="action-item" ${LV.attr('wa-app', { id: c.id })}>${I('external-link')}<span><strong>打开 WhatsApp App</strong><small>公司手机登录的是你在 BOS 连接的号码，手机上发的消息会同步回 BOS 会话</small></span></button>
    </div><div class="number-box"><span class="num">${c.whatsapp}</span>${U.btn('复制号码', { kind: 'secondary', size: 'sm', icon: 'copy', attrs: LV.attr('copy-text', { text: c.whatsapp }) })}</div>` });
  });
  LV.on('wa-app', () => { LV.closeSheet(); LV.toast('将跳转 WhatsApp（原型中不跳转）', { icon: 'external-link' }); });
  LV.on('contact-mail', el => { const c = LV.customer(el.dataset.id); LV.sheet({ title: '发送邮件', body: `<div class="number-box"><span>${c.email}</span>${U.btn('复制', { kind: 'secondary', size: 'sm', icon: 'copy', attrs: LV.attr('copy-text', { text: c.email }) })}</div><p class="sheet-note">用手机邮件 App 发送；发送后记得写一条跟进。</p>` }); });

  /* ── Follow-up sheet ───────────────────────────────────── */
  let fdraft = null;
  const NEXT = [['tomorrow', '明天 10:00'], ['3d', '3 天后'], ['7d', '1 周后'], ['none', '不设置']];
  function followBody() {
    const c = LV.customer(fdraft.id);
    return `<form class="form" data-submit="follow-save" novalidate>
      <div class="field"><span class="label">跟进方式</span><div class="option-grid">${Object.entries(C.followTypes).map(([k, l]) => U.chip(l, { pressed: fdraft.type === k, attrs: LV.attr('fd-type', { v: k }) })).join('')}</div></div>
      <div class="field${fdraft.error ? ' has-error' : ''}"><label for="fd-content">跟进内容<i>*</i></label><textarea class="textarea" id="fd-content" data-input="fd-content" placeholder="客户说了什么、我们答应了什么、下一步是什么" aria-describedby="fd-err">${LV.esc(fdraft.content)}</textarea>${fdraft.error ? `<span class="field-error" id="fd-err">${I('circle-alert')}${fdraft.error}</span>` : ''}
        <div class="option-grid phrase-row">${['客户已读未回', '已发报价', '客户要样品', '约了下次通话', '确认了款式'].map(t => `<button type="button" class="phrase" ${LV.attr('fd-phrase', { t })}>+ ${t}</button>`).join('')}</div></div>
      <div class="field"><label for="fd-stage">阶段</label><select class="select" id="fd-stage" data-change="fd-stage" ${LV.state.offline ? 'disabled' : ''}>${C.stageFlow.concat(C.closedStages).map(s => `<option value="${s}" ${fdraft.stage === s ? 'selected' : ''}>${C.stages[s]}${s === c.stage ? '（当前）' : ''}</option>`).join('')}</select>${LV.state.offline ? '<span class="field-hint">离线时不能改阶段；跟进会保存在本机，联网后自动同步</span>' : ''}</div>
      <div class="field"><span class="label">下次跟进</span><div class="option-grid">${NEXT.map(([k, l]) => U.chip(l, { pressed: fdraft.next === k, attrs: LV.attr('fd-next', { v: k }) })).join('')}</div></div>
    </form>`;
  }
  LV.openFollowSheet = (id, type = 'WHATSAPP') => {
    const c = LV.customer(id);
    fdraft = { id, type, content: '', stage: c.stage, next: 'tomorrow', error: '' };
    LV.sheet({ name: 'follow', title: '写跟进', sub: `${c.name} · ${c.company}`, body: followBody(), foot: U.btn('保存跟进', { kind: 'primary', icon: 'check', attrs: LV.attr('follow-save') }) });
  };
  LV.on('follow', el => LV.openFollowSheet(el.dataset.id));
  LV.on('fd-type', el => { fdraft.type = el.dataset.v; LV.updateSheet(followBody(), 'follow'); });
  LV.on('fd-next', el => { fdraft.next = el.dataset.v; LV.updateSheet(followBody(), 'follow'); });
  LV.on('fd-phrase', el => { fdraft.content = (fdraft.content ? `${fdraft.content.trim()}，` : '') + el.dataset.t; fdraft.error = ''; LV.updateSheet(followBody(), 'follow'); });
  LV.onInput('fd-content', el => { fdraft.content = el.value; });
  LV.onInput('fd-stage', el => { fdraft.stage = el.value; });
  LV.on('follow-save', async () => {
    if (!fdraft.content.trim()) { fdraft.error = '请填写跟进内容'; LV.updateSheet(followBody(), 'follow'); document.getElementById('fd-content')?.focus(); return; }
    const c = LV.customer(fdraft.id), prevStage = c.stage;
    if (LV.state.offline) {
      // Follow-ups are append-only, so an offline one is kept on the phone and sent when the network returns.
      (LV.db.timeline[c.id] ||= []).unshift({ at: LV.NOW, type: 'FOLLOW', title: `跟进 · ${C.followTypes[fdraft.type]}（待同步）`, by: LV.me().id, body: fdraft.content.trim(), pending: true });
      LV.closeSheet(); LV.refresh(); LV.toast('已保存在本机，联网后自动同步', { icon: 'wifi-off' }); return;
    }
    if (fdraft.stage !== c.stage && C.reasonStages.includes(fdraft.stage)) {
      const reason = await LV.confirm({ title: `标记为「${C.stages[fdraft.stage]}」`, message: '暂不需要、已流失、无效客户都需要说明原因，便于管理员复核。', ok: '确认', field: { label: '原因', required: true, min: 2, placeholder: fdraft.stage === 'INVALID' ? C.invalidReasons.join(' / ') : '例如：项目延期到明年', error: '请填写原因（至少 2 个字）' } });
      if (!reason) return;
      c.invalidReason = reason;
    }
    const tl = LV.db.timeline[c.id] || (LV.db.timeline[c.id] = []);
    tl.unshift({ at: LV.NOW, type: 'FOLLOW', title: `跟进 · ${C.followTypes[fdraft.type]}`, by: LV.me().id, body: fdraft.content.trim() });
    if (fdraft.stage !== prevStage) { tl.unshift({ at: LV.NOW, type: 'STAGE', title: `阶段：${C.stages[prevStage]} → ${C.stages[fdraft.stage]}`, by: LV.me().id }); c.stage = fdraft.stage; }
    c.lastContactAt = LV.NOW; c.waiting = false;
    const nextMap = { tomorrow: '2026-11-11T10:00', '3d': '2026-11-13T10:00', '7d': '2026-11-17T10:00', none: null };
    c.nextFollowUpAt = nextMap[fdraft.next];
    LV.closeSheet(); LV.refresh();
    LV.toast(`跟进已保存${c.nextFollowUpAt ? ` · 下次 ${F.due(c.nextFollowUpAt).text}` : ''}`, { action: '撤销', onAction: () => { tl.shift(); if (fdraft.stage !== prevStage) { tl.shift(); c.stage = prevStage; } LV.refresh(); LV.toast('已撤销', { icon: 'undo-2' }); } });
  });

  /* ── Revisit (下次跟进 / 回访) ─────────────────────────── */
  let rdraft = null;
  function revisitBody() {
    const picks = [['2026-11-10T16:00', '今天 16:00'], ['2026-11-11T10:00', '明天 10:00'], ['2026-11-13T10:00', '周四 10:00'], ['2026-11-17T10:00', '下周一 10:00'], ['2026-12-01T10:00', '12 月 1 日']];
    return `<div class="form">
      <div class="field"><span class="label">快速选择</span><div class="option-grid">${picks.map(([v, l]) => U.chip(l, { pressed: rdraft.at === v, attrs: LV.attr('rv-pick', { v }) })).join('')}</div></div>
      <div class="field"><label for="rv-at">自定义时间</label><input class="input" type="datetime-local" id="rv-at" value="${rdraft.at || ''}" data-input="rv-at"></div>
      <div class="field"><span class="label">提前提醒</span><div class="option-grid">${[[0, '准时'], [15, '15 分钟'], [30, '30 分钟'], [60, '1 小时']].map(([v, l]) => U.chip(l, { pressed: rdraft.remind === v, attrs: LV.attr('rv-remind', { v }) })).join('')}</div><span class="field-hint">到时间会推送「跟进提醒」到手机通知栏</span></div>
    </div>`;
  }
  LV.on('revisit', el => { if (LV.needOnline('修改回访时间')) return; const c = LV.customer(el.dataset.id); rdraft = { id: c.id, at: c.nextFollowUpAt || '2026-11-11T10:00', remind: 30 }; LV.sheet({ name: 'revisit', title: '设置回访时间', sub: c.name, body: revisitBody(), foot: `${c.nextFollowUpAt ? U.btn('清除', { kind: 'secondary', attrs: LV.attr('rv-clear') }) : ''}${U.btn('保存', { kind: 'primary', attrs: LV.attr('rv-save') })}` }); });
  LV.on('rv-pick', el => { rdraft.at = el.dataset.v; LV.updateSheet(revisitBody(), 'revisit'); });
  LV.on('rv-remind', el => { rdraft.remind = Number(el.dataset.v); LV.updateSheet(revisitBody(), 'revisit'); });
  LV.onInput('rv-at', el => { rdraft.at = el.value; });
  LV.on('rv-save', () => { const c = LV.customer(rdraft.id); c.nextFollowUpAt = rdraft.at; LV.closeSheet(); LV.refresh(); LV.toast(`已设置回访：${F.due(rdraft.at).text}`, { icon: 'alarm-clock' }); });
  LV.on('rv-clear', () => { const c = LV.customer(rdraft.id); c.nextFollowUpAt = null; LV.closeSheet(); LV.refresh(); LV.toast('已清除下次跟进'); });

  /* ── Stage sheet ──────────────────────────────────────── */
  LV.on('stage-sheet', el => {
    if (LV.needOnline('修改阶段')) return;
    const c = LV.customer(el.dataset.id);
    const item = s => `<button type="button" class="action-item${c.stage === s ? ' is-selected' : ''}" ${LV.attr('stage-set', { id: c.id, s })}><span class="radio${c.stage === s ? ' is-on' : ''}"></span><span><strong>${C.stages[s]}</strong>${C.reasonStages.includes(s) ? '<small>需要填写原因</small>' : ''}</span></button>`;
    LV.sheet({ title: '修改阶段', sub: `${c.name} · 当前：${C.stages[c.stage]}`, body: `<div class="action-list">${C.stageFlow.map(item).join('')}</div><h3 class="sheet-sub">结束跟进</h3><div class="action-list">${C.closedStages.map(item).join('')}</div>` });
  });
  LV.on('stage-set', async el => {
    const c = LV.customer(el.dataset.id), s = el.dataset.s, prev = c.stage;
    if (s === prev) { LV.closeSheet(); return; }
    LV.closeSheet();
    if (C.reasonStages.includes(s)) {
      const reason = await LV.confirm({ title: `标记为「${C.stages[s]}」`, message: '需要说明原因，便于管理员复核。', ok: '确认', danger: s === 'INVALID', field: { label: '原因', required: true, min: 2, placeholder: s === 'INVALID' ? C.invalidReasons.join(' / ') : '', error: '请填写原因（至少 2 个字）' } });
      if (!reason) return;
      c.invalidReason = reason;
    }
    c.stage = s;
    (LV.db.timeline[c.id] ||= []).unshift({ at: LV.NOW, type: 'STAGE', title: `阶段：${C.stages[prev]} → ${C.stages[s]}`, by: LV.me().id });
    LV.refresh();
    LV.toast(`阶段已改为「${C.stages[s]}」`, { action: '撤销', onAction: () => { c.stage = prev; LV.db.timeline[c.id].shift(); LV.refresh(); } });
  });

  /* ── Tags ─────────────────────────────────────────────── */
  LV.on('tag-sheet', el => {
    if (LV.needOnline('修改标签')) return;
    const c = LV.customer(el.dataset.id);
    const body = () => `<div class="option-grid">${Object.entries(LV.TAGS).map(([k, t]) => U.chip(t.name, { pressed: c.tags.includes(k), attrs: LV.attr('tag-toggle', { id: c.id, t: k }) })).join('')}</div><p class="sheet-note">标签全公司共用，在电脑端「消息」里管理标签库。</p>`;
    LV.sheet({ name: 'tags', title: '客户标签', sub: c.name, body: body() });
    LV.on('tag-toggle', b => { const i = c.tags.indexOf(b.dataset.t); i < 0 ? c.tags.push(b.dataset.t) : c.tags.splice(i, 1); LV.updateSheet(body(), 'tags'); LV.refresh(); });
  });

  /* ── Assign (admin) ───────────────────────────────────── */
  LV.on('assign', el => {
    if (LV.needOnline('分配客户')) return;
    const c = LV.customer(el.dataset.id);
    const sales = Object.values(LV.USERS).filter(u => u.role === 'SALES');
    LV.sheet({ title: '分配给', sub: `${c.name} · ${c.grade} 级 · ${c.gradeReason}`, body: `<div class="action-list">${sales.map(u => { const n = LV.db.customers.filter(x => x.owner === u.id && !C.closedStages.includes(x.stage)).length, t = LV.db.tasks.filter(x => x.assignee === u.id && x.status !== 'DONE' && F.dayDiff(x.due) <= 0).length; return `<button type="button" class="action-item" ${LV.attr('assign-to', { id: c.id, u: u.id })}>${U.avatar(u.name, { size: 'sm' })}<span><strong>${u.name}</strong><small>跟进中 ${n} 位 · 今日待办 ${t} 项</small></span></button>`; }).join('')}</div><p class="sheet-note">分配后负责人手机会收到通知；24 小时内的广告留资需在 5 分钟内首次联系。</p>` });
  });
  LV.on('assign-to', async el => {
    const c = LV.customer(el.dataset.id), u = LV.USERS[el.dataset.u];
    LV.closeSheet();
    const ok = await LV.confirm({ title: `分配给 ${u.name}？`, message: `${c.name} 将进入 ${u.name} 的待首联列表，首联计时从现在开始。`, ok: '分配' });
    if (!ok) return;
    c.pool = false; c.owner = u.id; c.firstContactDueAt = '2026-11-10T10:29';
    LV.db.notifications.forEach(n => { if (n.route?.[2]?.id === c.id && n.kind === 'POOL_LEAD') n.read = true; });
    LV.refresh(); LV.renderTabbar();
    LV.toast(`已分配给 ${u.name} · 已推送通知`, { icon: 'user-check' });
  });

  /* ── More actions ─────────────────────────────────────── */
  LV.on('customer-more', el => {
    if (LV.needOnline('编辑客户')) return;
    const c = LV.customer(el.dataset.id);
    LV.sheet({ title: c.name, body: `<div class="action-list">
      <button type="button" class="action-item" ${LV.attr('noop-toast', { t: '编辑资料与新建页使用同一表单（原型略）' })}>${I('pencil')}<span><strong>编辑资料</strong></span></button>
      ${LV.isAdmin() ? `<button type="button" class="action-item" ${LV.attr('assign', { id: c.id })}>${I('user-check')}<span><strong>转交给其他销售</strong></span></button>` : ''}
      <button type="button" class="action-item" ${LV.attr('stage-set', { id: c.id, s: 'INVALID' })}>${I('ban')}<span><strong>标记为无效客户</strong><small>需要填写原因</small></span></button>
      ${LV.isAdmin() ? `<button type="button" class="action-item danger" ${LV.attr('customer-trash', { id: c.id })}>${I('trash-2')}<span><strong>移入回收站</strong><small>可在电脑端回收站恢复</small></span></button>` : ''}
    </div>` });
  });
  LV.on('noop-toast', el => { LV.closeSheet(); LV.toast(el.dataset.t, { icon: 'info' }); });
  LV.on('customer-trash', async el => {
    const c = LV.customer(el.dataset.id); LV.closeSheet();
    const ok = await LV.confirm({ title: '移入回收站？', message: `${c.name} 的跟进记录、报价和订单都会保留，可以在电脑端回收站恢复。`, ok: '移入回收站', danger: true });
    if (!ok) return;
    const i = LV.db.customers.indexOf(c); LV.db.customers.splice(i, 1);
    LV.nav.back();
    LV.toast('已移入回收站', { icon: 'trash-2', action: '撤销', onAction: () => { LV.db.customers.splice(i, 0, c); LV.refresh(); } });
  });

  /* ── New customer ─────────────────────────────────────── */
  const COUNTRIES = [['', '按号码自动识别'], ['沙特', '沙特'], ['阿联酋', '阿联酋'], ['美国', '美国'], ['墨西哥', '墨西哥'], ['尼日利亚', '尼日利亚'], ['肯尼亚', '肯尼亚'], ['菲律宾', '菲律宾'], ['马来西亚', '马来西亚'], ['波兰', '波兰'], ['德国', '德国'], ['智利', '智利'], ['其他', '其他']];
  const CODES = { '+966': '沙特', '+971': '阿联酋', '+1': '美国', '+52': '墨西哥', '+234': '尼日利亚', '+254': '肯尼亚', '+63': '菲律宾', '+60': '马来西亚', '+48': '波兰', '+49': '德国', '+56': '智利', '+86': '中国' };
  const detectCountry = num => { const n = (num || '').replace(/[\s-]/g, ''); const code = Object.keys(CODES).sort((a, b) => b.length - a.length).find(k => n.startsWith(k)); return code ? CODES[code] : ''; };

  LV.screens['customer-new'] = {
    guard: r => Object.entries(r.ui.form || {}).some(([k, v]) => v && !['source', 'purchase', 'product', 'stage', 'currency', 'inquiryAt', 'owner', 'next'].includes(k)),
    render(p, ui) {
      if (LV.state.offline) return { title: '新建客户', body: U.offlineBlock({ title: '新建客户需要联网', text: '保存前要和全公司客户查重，联网后再新建。' }) };
      const f = ui.form || (ui.form = { name: p.name || '', company: '', country: '', city: '', whatsapp: '', phone: '', email: '', source: 'FACEBOOK', inquiryAt: LV.TODAY, purchase: '', product: '', model: '', quantity: '', amount: '', currency: 'USD', stage: 'NEW', owner: LV.isAdmin() ? 'u2' : LV.me().id, next: 'tomorrow', notes: '' });
      const e = ui.errors || {};
      const dup = f.whatsapp && LV.db.customers.find(c => c.whatsapp.replace(/\D/g, '') === f.whatsapp.replace(/\D/g, ''));
      const auto = detectCountry(f.whatsapp || f.phone);
      return {
        title: '新建客户', surface: true,
        body: `<form class="form pad" style="padding-top:8px" data-submit="cn-save" novalidate>
          ${dup && !ui.forceDup ? `<div class="dup-card" role="alert">${I('triangle-alert')}<div><strong>可能是重复客户</strong><p>${dup.name} · ${dup.company} · 负责人 ${owner(dup.owner)}</p><div class="dup-actions">${U.btn('查看该客户', { kind: 'secondary', size: 'sm', attrs: LV.go('customer', { id: dup.id }) })}${U.btn('仍然新建', { kind: 'ghost', size: 'sm', attrs: LV.attr('cn-force') })}</div></div></div>` : ''}
          <div class="fieldset"><div class="fieldset-title">基本信息</div>
            ${U.field({ id: 'cn-name', label: '客户姓名', required: true, value: f.name, placeholder: '例如 Ahmed Al-Harbi', error: e.name, input: 'cn-field', autocomplete: 'name' })}
            ${U.field({ id: 'cn-company', label: '公司', value: f.company, placeholder: '公司或店铺名称', input: 'cn-field', autocomplete: 'organization' })}
            <div class="two-col">${U.field({ id: 'cn-country', label: '国家', value: f.country, options: COUNTRIES, input: 'cn-field', hint: auto && !f.country ? `将识别为：${auto}` : '' })}${U.field({ id: 'cn-city', label: '城市', value: f.city, input: 'cn-field' })}</div>
          </div>
          <div class="fieldset"><div class="fieldset-title">联系方式 · 至少填一项，用于查重</div>
            ${U.field({ id: 'cn-whatsapp', label: 'WhatsApp', type: 'tel', value: f.whatsapp, placeholder: '+966 55 218 4407', inputmode: 'tel', input: 'cn-field', error: e.contact, hint: '带国际区号，国家会自动识别' })}
            ${U.field({ id: 'cn-phone', label: '电话', type: 'tel', value: f.phone, inputmode: 'tel', input: 'cn-field' })}
            ${U.field({ id: 'cn-email', label: '邮箱', type: 'email', value: f.email, inputmode: 'email', input: 'cn-field', error: e.email, autocomplete: 'email' })}
          </div>
          <div class="fieldset"><div class="fieldset-title">询盘信息</div>
            <div class="two-col">${U.field({ id: 'cn-source', label: '来源', value: f.source, options: Object.entries(C.sources), input: 'cn-field' })}${U.field({ id: 'cn-inquiryAt', label: '询盘日期', type: 'date', value: f.inquiryAt, input: 'cn-field' })}</div>
            <div class="field"><span class="label">采购身份</span><div class="option-grid">${Object.entries(C.purchases).map(([k, l]) => U.chip(l, { pressed: f.purchase === k, attrs: LV.attr('cn-pick', { k: 'purchase', v: k }) })).join('')}</div></div>
            <div class="field"><span class="label">意向产品</span><div class="option-grid">${C.productLines.map(l => U.chip(l, { pressed: f.product === l, attrs: LV.attr('cn-pick', { k: 'product', v: l }) })).join('')}</div></div>
            <div class="two-col">${U.field({ id: 'cn-model', label: '型号', value: f.model, placeholder: 'Y-604', input: 'cn-field' })}${U.field({ id: 'cn-quantity', label: '数量', value: f.quantity, placeholder: '300 件 / 1×40HQ', input: 'cn-field' })}</div>
            <div class="field"><label for="cn-amount">预计订单金额</label><div class="input-group"><select class="select" id="cn-currency" data-input="cn-field" aria-label="币种">${['USD', 'CNY', 'EUR'].map(c => `<option ${f.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select><input class="input num" id="cn-amount" inputmode="decimal" value="${LV.esc(f.amount)}" placeholder="0.00" data-input="cn-field"></div></div>
          </div>
          <div class="fieldset"><div class="fieldset-title">跟进安排</div>
            <div class="two-col">${U.field({ id: 'cn-stage', label: '阶段', value: f.stage, options: C.stageFlow.map(s => [s, C.stages[s]]), input: 'cn-field' })}
            ${LV.isAdmin() ? U.field({ id: 'cn-owner', label: '负责人', required: true, value: f.owner, options: Object.values(LV.USERS).map(u => [u.id, u.name]), input: 'cn-field' }) : U.field({ id: 'cn-owner', label: '负责人', value: LV.me().name, extra: `<input class="input" id="cn-owner" value="${LV.me().name}（我）" disabled>` })}</div>
            <div class="field"><span class="label">下次跟进</span><div class="option-grid">${[['today', '今天'], ['tomorrow', '明天 10:00'], ['3d', '3 天后'], ['none', '不设置']].map(([k, l]) => U.chip(l, { pressed: f.next === k, attrs: LV.attr('cn-pick', { k: 'next', v: k }) })).join('')}</div></div>
            ${U.field({ id: 'cn-notes', label: '备注', value: f.notes, rows: 3, placeholder: '客户的特殊要求、沟通背景', input: 'cn-field' })}
          </div>
        </form>`,
        footer: U.btn(ui.saving ? '正在保存' : '保存客户', { kind: 'primary', icon: ui.saving ? 'refresh-cw' : 'check', attrs: LV.attr('cn-save') + (ui.saving ? ' disabled' : '') }),
      };
    },
  };
  LV.onInput('cn-field', (el, e, r) => {
    const key = el.id.replace('cn-', ''); r.ui.form[key] = el.value;
    if (r.ui.errors?.[key]) { delete r.ui.errors[key]; }
    if (key === 'whatsapp' && el.value.replace(/\D/g, '').length >= 9) { const sc = el.closest('.scroll').scrollTop; LV.refresh(); const ne = document.querySelector(`.screen:not([hidden]) #cn-whatsapp`); if (ne) { ne.focus(); ne.setSelectionRange(ne.value.length, ne.value.length); ne.closest('.scroll').scrollTop = sc; } }
  });
  LV.on('cn-pick', (el, e, r) => { const { k, v } = el.dataset; r.ui.form[k] = r.ui.form[k] === v && k !== 'next' ? '' : v; LV.refresh(); });
  LV.on('cn-force', (el, e, r) => { r.ui.forceDup = true; LV.refresh(); });
  LV.on('cn-save', (el, e, r) => {
    const f = r.ui.form, errors = {};
    if (!f.name.trim()) errors.name = '请填写客户姓名';
    if (f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) errors.email = '邮箱格式不正确';
    if (!f.whatsapp && !f.phone && !f.email) errors.contact = '至少填写 WhatsApp、电话或邮箱中的一项';
    r.ui.errors = errors;
    if (Object.keys(errors).length) { LV.refresh(); setTimeout(() => { document.querySelector('.screen:not([hidden]) .field.has-error .input, .screen:not([hidden]) .field.has-error .select')?.focus(); }, 30); LV.toast(`还有 ${Object.keys(errors).length} 项需要修改`, { icon: 'circle-alert', tone: 'danger' }); return; }
    r.ui.saving = true; LV.refresh();
    setTimeout(() => {
      const id = `c${Date.now()}`;
      const country = f.country || detectCountry(f.whatsapp || f.phone);
      LV.db.customers.unshift({ id, name: f.name.trim(), company: f.company, country, cc: '', city: f.city, grade: '', gradeReason: '手动录入，未评级', stage: f.stage, source: f.source, owner: f.owner, tags: [], product: f.product, model: f.model, quantity: f.quantity, purchase: f.purchase || 'OTHER', whatsapp: f.whatsapp, phone: f.phone, email: f.email, language: '', inquiryAt: `${f.inquiryAt}T${LV.NOW.slice(11)}`, lastContactAt: null, nextFollowUpAt: { today: '2026-11-10T17:00', tomorrow: '2026-11-11T10:00', '3d': '2026-11-13T10:00', none: null }[f.next], waiting: false, unread: 0, aiScore: 0, aiSummary: '', aiNext: '', demand: [] });
      r.ui.leaving = true;
      LV.nav.back();
      setTimeout(() => LV.nav.push('customer', { id }), 360);
      LV.toast('客户已创建', { icon: 'circle-check' });
    }, 600);
  });
})();

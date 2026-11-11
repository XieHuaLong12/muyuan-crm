/*
 * 消息：通知中心（分类 / 优先级 / 已读未读 / 批量已读 / 点击跳转）与 WhatsApp 会话。
 * 通知内容来自 services/notification-service.ts 的 notificationFeed（现有种类）；订单、系统公告为新增种类（标「规划」）。
 * 当前 BOS 的已读状态只保存在浏览器里；App 需要服务端保存已读（新增表，见 docs/mobile-app/NATIVE_PLAN.md）。
 */
(function () {
  const LV = window.LV, U = LV.ui, I = LV.icon, F = LV.fmt, C = LV.CONST;
  const CATS = C.notifyCategories;
  const PRIORITY = { urgent: ['紧急', 'danger'], high: ['重要', 'warning'] };

  function notifItem(n, edit, selected) {
    const cat = CATS[n.cat], pr = PRIORITY[n.priority];
    return `<div class="notif${n.read ? '' : ' is-unread'}">
      ${edit ? `<button type="button" class="check-hit" ${LV.attr('nf-select', { id: n.id })} aria-label="选择"><span class="check square${selected ? ' is-on' : ''}">${I('check')}</span></button>` : ''}
      <button type="button" class="notif-main pressable" ${edit ? LV.attr('nf-select', { id: n.id }) : LV.attr('nf-open', { id: n.id })}>
        <span class="notif-icon cat-${n.cat}">${I(cat.icon)}</span>
        <span class="notif-text">
          <span class="notif-head"><strong>${n.title}</strong><time>${F.ago(n.at)}</time></span>
          <span class="notif-body">${LV.esc(n.body)}</span>
          <span class="notif-tags">${pr ? U.badge(pr[0], pr[1]) : ''}${U.badge(cat.label, 'outline')}${n.planned ? U.planned('新增通知') : ''}</span>
        </span>
        ${n.read ? '' : '<span class="unread-dot" aria-label="未读"></span>'}
      </button>
    </div>`;
  }

  function notifRegion(ui) {
    const cat = ui.cat || 'all', edit = !!ui.edit, sel = ui.sel || [];
    let list = LV.scope.notifications().filter(n => cat === 'all' || n.cat === cat);
    if (ui.unreadOnly) list = list.filter(n => !n.read);
    list.sort((a, b) => b.at.localeCompare(a.at));
    if (LV.state.demo === 'empty' || !list.length) return U.empty({ icon: 'bell-off', title: ui.unreadOnly ? '没有未读通知' : '这里还没有通知', text: '新询盘、跟进提醒、订单变化会在这里出现，也会推送到手机通知栏。' });
    const groups = [['今天', n => F.dayDiff(n.at) === 0], ['昨天', n => F.dayDiff(n.at) === -1], ['更早', n => F.dayDiff(n.at) < -1]];
    return groups.map(([label, test]) => { const g = list.filter(test); return g.length ? `<div class="notif-group"><h3>${label}</h3><div class="list">${g.map(n => notifItem(n, edit, sel.includes(n.id))).join('')}</div></div>` : ''; }).join('');
  }

  function chatsRegion() {
    const list = LV.scope.customers().filter(c => LV.db.chats[c.id] || c.lastContactAt).sort((a, b) => ((LV.db.chats[b.id] || []).at(-1)?.at || b.lastContactAt || '').localeCompare((LV.db.chats[a.id] || []).at(-1)?.at || a.lastContactAt || ''));
    if (LV.state.demo === 'empty' || !list.length) return U.empty({ icon: 'message-circle', title: '还没有会话', text: '客户通过 WhatsApp 发来的消息会出现在这里。' });
    return `<div class="list">${list.map(c => {
      const last = (LV.db.chats[c.id] || []).at(-1);
      const preview = last ? (last.dir === 'out' ? `我：${last.text}` : last.trans || last.text) : c.aiSummary || '暂无消息';
      return `<button type="button" class="conv pressable" ${LV.go('chat', { id: c.id })}>${U.avatar(c.name, { grade: c.grade })}<span class="conv-main"><span class="conv-head"><strong>${c.name}</strong><time>${F.ago(last?.at || c.lastContactAt)}</time></span><span class="conv-body">${LV.esc(preview)}</span>${c.waiting ? `<span class="conv-flag">${I('hourglass')}客户在等回复</span>` : ''}</span>${c.unread ? `<span class="unread-pill num">${c.unread}</span>` : ''}</button>`;
    }).join('')}</div>`;
  }

  LV.screens.inbox = {
    root: true, large: true, ptr: true, title: '消息',
    hideTabbar: r => !!r.ui.edit,
    render(p, ui, r) {
      const seg = ui.seg || 'notes', c = LV.counts(), mine = LV.scope.notifications();
      const catChips = [['all', '全部', mine.filter(n => !n.read).length], ...Object.entries(CATS).map(([k, v]) => [k, v.label, mine.filter(n => n.cat === k && !n.read).length])]
        .map(([k, l, n]) => U.chip(l, { pressed: (ui.cat || 'all') === k, count: n || null, alert: n > 0 && k !== 'all', attrs: LV.attr('set', { k: 'cat', v: JSON.stringify(k) }) })).join('');
      const editBar = ui.edit ? `${U.btn(`全选`, { kind: 'secondary', attrs: LV.attr('nf-all') })}${U.btn(`标为已读${ui.sel?.length ? ` (${ui.sel.length})` : ''}`, { kind: 'primary', icon: 'check-check', attrs: LV.attr('nf-mark', { v: 1 }) + (ui.sel?.length ? '' : ' disabled') })}` : '';
      return {
        title: '消息',
        actions: seg === 'notes' ? (ui.edit ? U.btn('完成', { kind: 'ghost', attrs: LV.attr('nf-edit') }) : `${U.iconBtn('check-check', { label: '全部标为已读', attrs: LV.attr('nf-read-all') })}${U.iconBtn('list-todo', { label: '批量选择', attrs: LV.attr('nf-edit') })}${U.iconBtn('settings', { label: '通知设置', attrs: LV.go('notify-settings') })}`) : U.iconBtn('settings', { label: '通知设置', attrs: LV.go('notify-settings') }),
        body: `${U.largeTitle('消息', `${c.notes} 条未读通知 · ${c.chats} 条未读会话`)}
          <div class="pad" style="margin-bottom:10px">${U.seg([{ key: 'notes', label: '通知', count: c.notes }, { key: 'chats', label: 'WhatsApp 会话', count: c.chats }], seg, 'seg')}</div>
          ${seg === 'notes' ? `<div class="chip-row" aria-label="通知分类">${catChips}</div>
            <div class="pad unread-toggle"><span>只看未读</span>${U.switch(!!ui.unreadOnly, LV.attr('set', { k: 'unreadOnly', v: String(!ui.unreadOnly) }), '只看未读')}</div>
            <div class="pad" data-region="list">${LV.gate(r, ui, () => notifRegion(ui))}</div>`
          : `<div class="pad">${LV.gate(r, ui, chatsRegion)}</div>`}`,
        footer: editBar,
      };
    },
    regions: { list: (p, ui) => notifRegion(ui) },
  };

  LV.on('nf-open', el => {
    const n = LV.db.notifications.find(x => x.id === el.dataset.id); n.read = true; LV.renderTabbar();
    if (!n.route) { LV.refresh(); LV.sheet({ title: n.title, body: `<p class="sheet-text">${LV.esc(n.body)}</p><p class="sheet-note">${F.ago(n.at)} · ${CATS[n.cat].label}</p>` }); return; }
    const [tab, name, params] = n.route;
    LV.nav.open(tab, name, params);
  });
  LV.on('nf-edit', (el, e, r) => { r.ui.edit = !r.ui.edit; r.ui.sel = []; LV.refresh(); });
  LV.on('nf-select', (el, e, r) => { const s = r.ui.sel || (r.ui.sel = []); const i = s.indexOf(el.dataset.id); i < 0 ? s.push(el.dataset.id) : s.splice(i, 1); LV.refresh(); });
  LV.on('nf-all', (el, e, r) => { const ids = LV.scope.notifications().filter(n => (r.ui.cat || 'all') === 'all' || n.cat === r.ui.cat).map(n => n.id); r.ui.sel = r.ui.sel?.length === ids.length ? [] : ids; LV.refresh(); });
  LV.on('nf-mark', (el, e, r) => { const ids = r.ui.sel || []; ids.forEach(id => { LV.db.notifications.find(n => n.id === id).read = true; }); const k = ids.length; r.ui.edit = false; r.ui.sel = []; LV.refresh(); LV.toast(`${k} 条通知已标为已读`); });
  LV.on('nf-read-all', (el, e, r) => {
    const unread = LV.scope.notifications().filter(n => !n.read && ((r.ui.cat || 'all') === 'all' || n.cat === r.ui.cat));
    if (!unread.length) { LV.toast('没有未读通知', { icon: 'info' }); return; }
    unread.forEach(n => { n.read = true; }); LV.refresh();
    LV.toast(`${unread.length} 条通知已标为已读`, { icon: 'check-check', action: '撤销', onAction: () => { unread.forEach(n => { n.read = false; }); LV.refresh(); } });
  });

  /* ── Chat ─────────────────────────────────────────────── */
  LV.screens.chat = {
    render(p, ui) {
      const c = LV.customer(p.id), msgs = LV.db.chats[c.id] || (LV.db.chats[c.id] = []);
      if (c.unread) { c.unread = 0; setTimeout(LV.renderTabbar, 0); }
      const showTrans = ui.trans !== false;
      let lastDay = '';
      const bubbles = msgs.map(m => {
        const day = m.at.slice(0, 10), sep = day !== lastDay ? `<div class="chat-day">${F.dayDiff(m.at) === 0 ? '今天' : F.dayDiff(m.at) === -1 ? '昨天' : F.date(m.at)}</div>` : ''; lastDay = day;
        return `${sep}<div class="bubble-row ${m.dir}"><div class="bubble">${m.file ? `<span class="bubble-file">${I('file-text')}${m.file}</span>` : ''}<span>${LV.esc(m.text)}</span>${m.trans && showTrans ? `<span class="bubble-trans">${LV.esc(m.trans)}</span>` : ''}<span class="bubble-meta">${F.time(m.at)}${m.dir === 'out' ? (m.status === 'read' ? I('check-check', 'read') : m.status === 'sending' ? I('clock') : I(m.status === 'delivered' ? 'check-check' : 'check')) : ''}</span></div></div>`;
      }).join('');
      return {
        title: LV.esc(c.name), sub: `WhatsApp · ${c.country} · ${LV.CONST.stages[c.stage]}`, surface: true,
        actions: `${U.iconBtn('phone', { label: '打电话', attrs: LV.attr('contact-call', { id: c.id }) })}${U.iconBtn('user-round', { label: '客户详情', attrs: LV.attr('open', { tab: 'customers', to: 'customer', p: { id: c.id } }) })}`,
        body: `<div class="chat">
          <div class="window-note">${I('clock')}<span>24 小时客服窗口内，可以发送自由消息 · 剩余约 <b class="num">23</b> 小时</span></div>
          ${bubbles || U.empty({ icon: 'message-circle', title: '还没有消息', text: '窗口外只能先发送已审核的 WhatsApp 模板。' })}
        </div>`,
        footer: `<div class="composer">
          <div class="chip-row flush">${['quick', 'polish', 'trans'].map(k => ({ quick: U.chip('常用回复', { icon: 'message-square-text', attrs: LV.attr('chat-quick', { id: c.id }) }), polish: U.chip('优化话术', { icon: 'sparkles', attrs: LV.attr('chat-polish', { id: c.id }) }), trans: U.chip(showTrans ? '隐藏翻译' : '显示翻译', { icon: 'languages', attrs: LV.attr('set', { k: 'trans', v: String(!showTrans) }) }) }[k])).join('')}</div>
          <div class="composer-row"><label class="sr-only" for="chat-input">消息</label><textarea id="chat-input" class="textarea" rows="1" placeholder="输入消息（英文发送）" data-input="chat-draft">${LV.esc(ui.draft || '')}</textarea><button type="button" class="send-btn" ${LV.attr('chat-send', { id: c.id })} aria-label="发送">${I('send')}</button></div>
        </div>`,
      };
    },
    mount(el, r) { const sc = el.querySelector('.scroll'); if (sc && !r.ui.scrolled) { sc.scrollTop = sc.scrollHeight; } },
  };
  LV.onInput('chat-draft', (el, e, r) => { r.ui.draft = el.value; el.style.height = 'auto'; el.style.height = `${Math.min(120, el.scrollHeight)}px`; });
  LV.on('chat-send', (el, e, r) => {
    const text = (r.ui.draft || '').trim(); if (!text) { document.getElementById('chat-input')?.focus(); return; }
    const c = LV.customer(el.dataset.id), m = { dir: 'out', at: LV.NOW, text, status: 'sending' };
    LV.db.chats[c.id].push(m); r.ui.draft = ''; c.waiting = false; c.lastContactAt = LV.NOW;
    LV.refresh(); const sc = document.querySelector('.screen:not([hidden]) .scroll'); if (sc) sc.scrollTop = sc.scrollHeight;
    setTimeout(() => { m.status = 'sent'; if (LV.top() === r) { LV.refresh(); } }, 700);
    setTimeout(() => { m.status = 'delivered'; if (LV.top() === r) { LV.refresh(); const s2 = document.querySelector('.screen:not([hidden]) .scroll'); if (s2) s2.scrollTop = s2.scrollHeight; } }, 1600);
  });
  LV.on('chat-quick', () => LV.sheet({ title: '常用回复', sub: '点按填入输入框，确认后再发送', body: `<div class="action-list">${LV.QUICK_REPLIES.map(q => `<button type="button" class="action-item" ${LV.attr('chat-fill', { text: q })}>${I('message-square-text')}<span><strong style="font-weight:400">${LV.esc(q)}</strong></span></button>`).join('')}</div>` }));
  LV.on('chat-fill', el => { const r = LV.top(); r.ui.draft = el.dataset.text; LV.closeSheet(); LV.refresh(); setTimeout(() => document.querySelector('.screen:not([hidden]) #chat-input')?.focus(), 250); });
  LV.on('chat-polish', (el, e, r) => {
    const base = (r.ui.draft || '').trim();
    const suggestions = base ? [`${base.replace(/\.$/, '')}. I will send you the details within 30 minutes.`, `Thanks for your patience! ${base}`, `${base} Please let me know your destination port so I can confirm the total cost.`]
      : ['Thank you for your message! One 40HQ holds about 520 pcs of 160×200 or 460 pcs of 180×200 (vacuum-packed, rolled). I will confirm the exact loading plan today.', 'Yes, we can arrange 2 samples. May I have your full address and postal code to check the courier cost?', 'Happy to help! Could you tell me which size you need more of, so I can suggest the best mix for one container?'];
    LV.sheet({ title: '优化话术', sub: 'AI 建议 · 不会自动发送，选一条填入后由你确认发送', body: `${suggestions.map((s, i) => `<button type="button" class="polish-item" ${LV.attr('chat-fill', { text: s })}><b>写法 ${i + 1}</b><span>${LV.esc(s)}</span></button>`).join('')}<p class="sheet-note">装柜数量等事实以产品库为准，示例中的数字为演示值。</p>` });
  });
})();

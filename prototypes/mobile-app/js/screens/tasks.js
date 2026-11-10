/*
 * 任务：今日 / 待办 / 已完成 / 日历，任务详情，快速完成（可撤销）与新建任务。
 * 字段与取值来自 Task 表与 lib/task-meta.ts；到期提醒对应 Reminder（EARLY / OVERDUE）。
 */
(function () {
  const LV = window.LV, U = LV.ui, I = LV.icon, F = LV.fmt, C = LV.CONST;
  const PRI_TONE = { HIGH: 'danger', MEDIUM: 'warning', LOW: '' };

  LV.taskRow = (t, { compact = false } = {}) => {
    const c = t.customer && LV.customer(t.customer), done = t.status === 'DONE', due = F.due(t.due);
    return `<div class="task${done ? ' is-done' : ''}">
      <button type="button" class="check-hit" ${LV.attr('task-toggle', { id: t.id })} aria-label="${done ? '标为未完成' : '完成任务'}：${LV.esc(t.title)}"><span class="check${done ? ' is-on' : ''}">${I('check')}</span></button>
      <button type="button" class="task-main pressable" ${LV.attr('open-task', { id: t.id })}>
        <span class="task-title">${LV.esc(t.title)}</span>
        <span class="task-meta">${done ? `<span>完成于 ${F.ago(t.doneAt || LV.NOW)}</span>` : `<span class="${due.late ? 'is-late' : due.soon ? 'is-soon' : ''}">${I(due.late ? 'triangle-alert' : 'clock')}${due.text}</span>`}${c ? `<span>${LV.esc(c.name)}</span>` : ''}${!compact && LV.isAdmin() && t.assignee !== LV.me().id ? `<span>${LV.USERS[t.assignee].name}</span>` : ''}</span>
      </button>
      <span class="task-side">${t.priority === 'HIGH' && !done ? U.badge('高', 'danger') : ''}${!compact ? U.badge(C.taskSources[t.source], 'outline') : ''}</span>
    </div>`;
  };

  function group(title, list, tone = '') { return list.length ? `<div class="task-group"><h3 class="${tone}">${title}<span class="num">${list.length}</span></h3><div class="list">${list.map(t => LV.taskRow(t)).join('')}</div></div>` : ''; }

  function calendar(ui, tasks) {
    const sel = ui.day || LV.TODAY, first = new Date('2026-11-01T00:00'), startPad = (first.getDay() + 6) % 7;
    const cells = [...Array(startPad).fill(null), ...Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`)];
    const dayTasks = d => tasks.filter(t => t.due.startsWith(d));
    const selTasks = dayTasks(sel).sort((a, b) => a.due.localeCompare(b.due));
    return `<div class="card calendar">
      <div class="cal-head"><strong>2026 年 11 月</strong><span>${tasks.filter(t => t.status !== 'DONE' && t.due.startsWith('2026-11')).length} 项待办</span></div>
      <div class="cal-grid" role="grid" aria-label="11 月日历">${['一', '二', '三', '四', '五', '六', '日'].map(w => `<span class="cal-w" role="columnheader">${w}</span>`).join('')}
        ${cells.map(d => { if (!d) return '<span></span>'; const list = dayTasks(d), open = list.filter(t => t.status !== 'DONE'), late = open.some(t => F.due(t.due).late); return `<button type="button" role="gridcell" class="cal-day${d === sel ? ' is-sel' : ''}${d === LV.TODAY ? ' is-today' : ''}" ${LV.attr('set', { k: 'day', v: JSON.stringify(d) })} aria-label="11 月 ${Number(d.slice(8))} 日，${open.length} 项待办"><span class="num">${Number(d.slice(8))}</span>${list.length ? `<i class="${late ? 'late' : open.length ? '' : 'done'}"></i>` : ''}</button>`; }).join('')}
      </div></div>
      <div class="task-group"><h3>${sel === LV.TODAY ? '今天' : `11 月 ${Number(sel.slice(8))} 日 周${F.weekday(`${sel}T00:00`)}`}<span class="num">${selTasks.length}</span></h3>
      ${selTasks.length ? `<div class="list">${selTasks.map(t => LV.taskRow(t)).join('')}</div>` : U.empty({ icon: 'calendar', title: '这一天没有任务' })}</div>`;
  }

  LV.screens.tasks = {
    ptr: true,
    render(p, ui, r) {
      if (p.view && !ui.viewSet) { ui.view = p.view; ui.viewSet = true; }
      const view = ui.view || 'today', team = !!ui.team;
      const all = LV.scope.tasks(team);
      const open = all.filter(t => t.status !== 'DONE');
      const overdue = open.filter(t => F.due(t.due).late), today = open.filter(t => !F.due(t.due).late && F.dayDiff(t.due) === 0);
      const done = all.filter(t => t.status === 'DONE');
      const content = () => {
        if (LV.state.demo === 'empty') return U.empty({ icon: 'circle-check', title: '没有任务', text: '新线索、报价跟进、订单节点会自动生成任务。' });
        if (view === 'today') return (overdue.length || today.length) ? group('已逾期', overdue, 'is-late') + group('今天', today) : U.empty({ icon: 'circle-check', title: '今天的任务都完成了', text: '休息一下，或看看明天的安排。' });
        if (view === 'open') return group('已逾期', overdue, 'is-late') + group('今天', today) + group('明天', open.filter(t => F.dayDiff(t.due) === 1)) + group('之后', open.filter(t => F.dayDiff(t.due) > 1));
        if (view === 'done') return done.length ? group('已完成', done) : U.empty({ icon: 'list-todo', title: '还没有完成的任务' });
        return calendar(ui, all);
      };
      return {
        title: '任务', sub: team ? '全团队' : '我的任务',
        actions: U.iconBtn('plus', { label: '新建任务', attrs: LV.attr('task-new') }),
        body: `<div class="stack" style="padding-top:4px">
          <div class="pad">${U.seg([{ key: 'today', label: '今日', count: overdue.length + today.length }, { key: 'open', label: '待办' }, { key: 'done', label: '已完成' }, { key: 'calendar', label: '日历' }], view, 'view')}</div>
          ${LV.isAdmin() ? `<div class="pad unread-toggle"><span>查看全团队任务</span>${U.switch(team, LV.attr('set', { k: 'team', v: String(!team) }), '查看全团队任务')}</div>` : ''}
          <div class="pad">${LV.gate(r, ui, content)}</div>
        </div>`,
      };
    },
  };

  LV.on('task-toggle', el => {
    const t = LV.db.tasks.find(x => x.id === el.dataset.id), wasDone = t.status === 'DONE', prev = t.status;
    t.status = wasDone ? 'TODO' : 'DONE'; t.doneAt = wasDone ? null : LV.NOW;
    LV.refresh();
    if (!wasDone) LV.toast(`已完成：${t.title}`, { action: '撤销', onAction: () => { t.status = prev; t.doneAt = null; LV.refresh(); } });
  });
  LV.on('open-task', el => {
    const cur = LV.top();
    if (cur.name === 'home' || cur.name === 'tasks') LV.nav.push('task', { id: el.dataset.id }); else LV.nav.open('home', 'task', { id: el.dataset.id });
  });

  LV.screens.task = {
    render(p) {
      const t = LV.db.tasks.find(x => x.id === p.id); if (!t) return { title: '任务', body: U.empty({ icon: 'circle-x', title: '任务已删除' }) };
      const c = t.customer && LV.customer(t.customer), o = t.order && LV.order(t.order), due = F.due(t.due);
      return {
        title: '任务详情',
        actions: U.iconBtn('trash-2', { label: '删除任务', attrs: LV.attr('task-delete', { id: t.id }) }),
        body: `<div class="stack-lg pad" style="padding-top:4px">
          <div class="card card-body task-detail">
            <div class="td-badges">${U.badge(`${C.taskPriority[t.priority]}优先级`, PRI_TONE[t.priority])}${U.badge(C.taskSources[t.source], 'outline')}${t.status === 'DONE' ? U.badge('已完成', 'success') : ''}</div>
            <h1>${LV.esc(t.title)}</h1>
            ${t.desc ? `<p>${LV.esc(t.desc)}</p>` : ''}
            <div class="due-line ${due.late && t.status !== 'DONE' ? 'is-late' : ''}">${I('clock')}<span>${F.date(t.due)} ${F.time(t.due)} 周${F.weekday(t.due)}</span><b>${t.status === 'DONE' ? '' : due.text}</b></div>
          </div>
          ${t.reason ? `<div class="ai-card"><div class="ai-head">${I('sparkles')}为什么出现这个任务</div><p>${LV.esc(t.reason)}${t.amount ? ` · 涉及金额 ${t.amount}` : ''}</p></div>` : ''}
          <div class="seg-status">${Object.entries({ TODO: '待处理', DOING: '进行中', DONE: '已完成' }).map(([k, l]) => `<button type="button" aria-pressed="${t.status === k}" ${LV.attr('task-status', { id: t.id, s: k })}>${l}</button>`).join('')}</div>
          <div class="list">
            ${c ? U.cell({ lead: U.avatar(c.name, { grade: c.grade, size: 'sm' }), title: c.name, sub: `${c.company} · ${C.stages[c.stage]}`, attrs: LV.attr('open', { tab: 'customers', to: 'customer', p: { id: c.id } }) }) : ''}
            ${o ? U.cell({ icon: 'package', title: o.no, sub: `${C.orderStatus[o.status]} · ${LV.fmt.money(o.amountRMB)}`, attrs: LV.attr('open', { tab: 'orders', to: 'order', p: { id: o.id } }) }) : ''}
            ${U.cell({ icon: 'bell', title: '到期前 30 分钟提醒', sub: '逾期后再提醒一次', trail: '' })}
            ${U.cell({ icon: 'user-round', title: `执行人：${LV.USERS[t.assignee].name}`, sub: t.customer ? '关联客户的任务由客户负责人执行' : '' })}
          </div>
        </div>`,
        footer: t.status === 'DONE' ? U.btn('重新打开', { kind: 'secondary', icon: 'rotate-ccw', attrs: LV.attr('task-toggle', { id: t.id }) })
          : `${U.btn('改期', { kind: 'secondary', icon: 'calendar-clock', attrs: LV.attr('task-reschedule', { id: t.id }) })}${U.btn('完成', { kind: 'primary', icon: 'check', attrs: LV.attr('task-toggle', { id: t.id }) })}`,
      };
    },
  };
  LV.on('task-status', el => { const t = LV.db.tasks.find(x => x.id === el.dataset.id); t.status = el.dataset.s; t.doneAt = t.status === 'DONE' ? LV.NOW : null; LV.refresh(); LV.toast(`状态：${{ TODO: '待处理', DOING: '进行中', DONE: '已完成' }[t.status]}`); });
  LV.on('task-reschedule', el => {
    const t = LV.db.tasks.find(x => x.id === el.dataset.id);
    LV.sheet({ title: '改期', sub: t.title, body: `<div class="action-list">${[['2026-11-10T17:00', '今天 17:00'], ['2026-11-11T10:00', '明天 10:00'], ['2026-11-13T10:00', '周四 10:00'], ['2026-11-17T10:00', '下周一 10:00']].map(([v, l]) => `<button type="button" class="action-item" ${LV.attr('task-due', { id: t.id, v })}>${I('calendar-clock')}<span><strong>${l}</strong></span></button>`).join('')}</div>` });
  });
  LV.on('task-due', el => { const t = LV.db.tasks.find(x => x.id === el.dataset.id); t.due = el.dataset.v; LV.closeSheet(); LV.refresh(); LV.toast(`已改到 ${F.due(t.due).text}`, { icon: 'calendar-clock' }); });
  LV.on('task-delete', async el => {
    const t = LV.db.tasks.find(x => x.id === el.dataset.id);
    if (t.source === 'WORKFLOW') { LV.toast('自动跟进任务不能删除，完成后会自动消失', { icon: 'info' }); return; }
    const ok = await LV.confirm({ title: '删除这个任务？', message: `「${t.title}」删除后不会再提醒。`, ok: '删除', danger: true });
    if (!ok) return; const i = LV.db.tasks.indexOf(t); LV.db.tasks.splice(i, 1); LV.nav.back();
    LV.toast('任务已删除', { icon: 'trash-2', action: '撤销', onAction: () => { LV.db.tasks.splice(i, 0, t); LV.refresh(); } });
  });

  /* ── New task ─────────────────────────────────────────── */
  let nt = null;
  const ntBody = () => `<div class="form">
    <div class="field${nt.error ? ' has-error' : ''}"><label for="nt-title">任务<i>*</i></label><input class="input" id="nt-title" data-input="nt-title" value="${LV.esc(nt.title)}" placeholder="例如：给 Ahmed 发 DDP 运费">${nt.error ? `<span class="field-error">${I('circle-alert')}${nt.error}</span>` : ''}</div>
    <div class="field"><label for="nt-cust">关联客户</label><select class="select" id="nt-cust" data-change="nt-cust"><option value="">不关联</option>${LV.scope.customers().map(c => `<option value="${c.id}" ${nt.customer === c.id ? 'selected' : ''}>${c.name} · ${c.company}</option>`).join('')}</select></div>
    <div class="field"><span class="label">到期</span><div class="option-grid">${[['2026-11-10T17:00', '今天 17:00'], ['2026-11-11T10:00', '明天 10:00'], ['2026-11-13T10:00', '周四'], ['2026-11-17T10:00', '下周一']].map(([v, l]) => U.chip(l, { pressed: nt.due === v, attrs: LV.attr('nt-due', { v }) })).join('')}</div></div>
    <div class="field"><span class="label">优先级</span><div class="option-grid">${Object.entries(C.taskPriority).map(([k, l]) => U.chip(l, { pressed: nt.priority === k, attrs: LV.attr('nt-pri', { v: k }) })).join('')}</div></div>
  </div>`;
  LV.on('task-new', () => { nt = { title: '', customer: '', due: '2026-11-11T10:00', priority: 'MEDIUM', error: '' }; LV.sheet({ name: 'nt', title: '新建任务', body: ntBody(), foot: U.btn('保存任务', { kind: 'primary', icon: 'check', attrs: LV.attr('nt-save') }) }); });
  LV.onInput('nt-title', el => { nt.title = el.value; });
  LV.onInput('nt-cust', el => { nt.customer = el.value; });
  LV.on('nt-due', el => { nt.due = el.dataset.v; LV.updateSheet(ntBody(), 'nt'); });
  LV.on('nt-pri', el => { nt.priority = el.dataset.v; LV.updateSheet(ntBody(), 'nt'); });
  LV.on('nt-save', () => {
    if (!nt.title.trim()) { nt.error = '请填写任务内容'; LV.updateSheet(ntBody(), 'nt'); document.getElementById('nt-title')?.focus(); return; }
    LV.db.tasks.push({ id: `k${Date.now()}`, title: nt.title.trim(), desc: '', customer: nt.customer || null, due: nt.due, priority: nt.priority, status: 'TODO', source: 'MANUAL', assignee: LV.me().id });
    LV.closeSheet(); LV.refresh(); LV.toast(`任务已创建 · ${F.due(nt.due).text}提醒`);
  });
})();

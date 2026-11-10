/*
 * LVANJU BOS Mobile · component library (prototype)
 * Each function returns markup for one design-system component. Native mapping is documented in
 * docs/mobile-app/DESIGN_SYSTEM.md (Compose / ArkUI equivalents).
 */
(function () {
  const LV = window.LV, I = (n, c) => LV.icon(n, c), esc = s => LV.esc(s);

  LV.ui = {
    largeTitle: (title, sub = '') => `<div class="large-title"><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div>`,

    section(title, content, { sub = '', link = '', linkAttrs = '' } = {}) {
      return `<section class="section"><div class="section-head"><h2>${title}${sub ? `<small>${sub}</small>` : ''}</h2>${link ? `<button class="link" ${linkAttrs}>${link}${I('chevron-right')}</button>` : ''}</div>${content}</section>`;
    },

    /** List cell. `attrs` makes the whole row pressable. */
    cell({ icon = '', lead = '', title, sub = '', trail = '', attrs = '', chevron = !!attrs, danger = false, cls = '' }) {
      const leadHtml = lead || (icon ? `<span class="cell-lead">${I(icon)}</span>` : '');
      const tag = attrs ? 'button type="button"' : 'div';
      return `<${tag} class="cell${leadHtml ? ' has-lead' : ''}${attrs ? ' pressable' : ''}${danger ? ' is-danger' : ''} ${cls}" ${attrs}>${leadHtml}<span class="cell-main"><span class="cell-title" style="display:block">${title}</span>${sub ? `<span class="cell-sub" style="display:block">${sub}</span>` : ''}</span>${trail || chevron ? `<span class="cell-trail">${trail}${chevron ? I('chevron-right') : ''}</span>` : ''}</${attrs ? 'button' : 'div'}>`;
    },

    badge: (text, tone = '', icon = '') => `<span class="badge ${tone ? `t-${tone}` : ''}">${icon ? I(icon) : ''}${text}</span>`,
    planned: (text = '规划') => `<span class="badge t-planned" title="BOS 当前没有此能力，需要新增后端">${text}</span>`,
    grade: g => g ? `<span class="grade grade-${g}" aria-label="${g} 级线索">${g}</span>` : `<span class="grade grade-none" aria-label="未评级">–</span>`,
    cc: code => code ? `<span class="cc" aria-hidden="true">${code}</span>` : '',
    tag(id) { const t = LV.TAGS[id]; if (!t) return ''; const c = LV.CONST.tagColors[t.color]; return `<span class="tag" style="background:${c.bg};color:${c.ink}">${esc(t.name)}</span>`; },

    stageBadge(stage) {
      const label = LV.CONST.stages[stage] || stage;
      const tone = stage === 'WON' ? 'success' : stage === 'ORDER' ? 'brand' : ['QUOTED', 'FOLLOW_UP'].includes(stage) ? 'info' : ['INVALID', 'LOST'].includes(stage) ? '' : stage === 'PAUSED' ? 'warning' : stage === 'NEW' ? 'outline' : 'brand';
      return LV.ui.badge(label, tone);
    },
    orderBadge(status) {
      const tone = { PENDING_PAYMENT: 'warning', PRODUCING: 'info', SHIPPED: 'brand', IN_TRANSIT: 'brand', COMPLETED: 'success', CANCELLED: '' }[status];
      return LV.ui.badge(LV.CONST.orderStatus[status], tone);
    },
    paymentBadge(p) { return LV.ui.badge(LV.CONST.payment[p], { UNPAID: 'danger', DEPOSIT_PAID: 'warning', PAID: 'success' }[p]); },

    chip(label, { pressed = false, count = null, attrs = '', alert = false, icon = '' } = {}) {
      return `<button type="button" class="chip${alert ? ' is-alert' : ''}" aria-pressed="${pressed}" ${attrs}>${icon ? I(icon) : ''}${label}${count !== null ? `<b>${count}</b>` : ''}</button>`;
    },

    /** Segmented control (tabs within a page). items: [{key,label,count}] */
    seg(items, current, k, { region = '' } = {}) {
      return `<div class="seg" role="tablist">${items.map(it => `<button type="button" role="tab" aria-selected="${it.key === current}" ${LV.attr('set', { k, v: JSON.stringify(it.key), ...(region ? { region } : {}) })}>${it.label}${it.count ? `<b>${it.count}</b>` : ''}</button>`).join('')}</div>`;
    },

    avatar(name, { grade = '', size = '' } = {}) {
      const initials = String(name).split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
      return `<span class="avatar ${size}" aria-hidden="true">${esc(initials)}${grade ? LV.ui.grade(grade) : ''}</span>`;
    },

    btn(label, { kind = 'primary', icon = '', attrs = '', block = false, size = '', type = 'button' } = {}) {
      return `<button type="${type}" class="btn btn-${kind}${block ? ' btn-block' : ''}${size ? ` btn-${size}` : ''}" ${attrs}>${icon ? I(icon) : ''}${label}</button>`;
    },
    iconBtn(icon, { label, attrs = '', dot = false, count = 0 } = {}) {
      return `<button type="button" class="icon-btn" aria-label="${label}" ${attrs}>${I(icon)}${count ? `<span class="count">${count > 99 ? '99+' : count}</span>` : dot ? '<span class="dot"></span>' : ''}</button>`;
    },

    /** Stat tile: label · value · foot (delta / context). */
    stat({ label, icon = '', value, foot = '', attrs = '' }) {
      const tag = attrs ? 'button type="button"' : 'div';
      return `<${tag} class="stat${attrs ? ' pressable' : ''}" ${attrs}><span class="stat-label">${icon ? I(icon) : ''}${label}</span><span class="stat-value num">${value}</span>${foot ? `<span class="stat-foot">${foot}</span>` : ''}</${attrs ? 'button' : 'div'}>`;
    },
    /** Money split into currency unit + digits for big figures. */
    money(n, { cur = 'CNY', wan = false } = {}) {
      const sym = { CNY: '¥', USD: 'US$', EUR: '€' }[cur] ?? cur;
      return `<span class="money-unit">${sym}</span>${wan ? LV.fmt.wan(n) : LV.fmt.int(n)}`;
    },
    delta(change, { suffix = '', invert = false } = {}) {
      if (change === null || change === undefined || !isFinite(change)) return '<span class="delta flat">—</span>';
      const up = change > 0.05, down = change < -0.05, good = invert ? down : up;
      const cls = up || down ? (good ? 'up' : 'down') : 'flat';
      return `<span class="delta ${cls}">${up ? I('trending-up') : down ? I('trending-down') : ''}${change > 0 ? '+' : ''}${change.toFixed(1)}%${suffix}</span>`;
    },
    meter: (ratio, cls = '') => `<div class="meter ${cls}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(ratio * 100)}"><i style="width:${Math.min(100, ratio * 100).toFixed(1)}%"></i></div>`,

    empty({ icon = 'inbox', title, text = '', action = '' }) {
      return `<div class="state"><span class="state-mark">${I(icon)}</span><h3>${title}</h3>${text ? `<p>${text}</p>` : ''}${action}</div>`;
    },
    error({ title = '加载失败', text = '网络连接不稳定，数据没有更新。检查网络后重试，已填写的内容不会丢失。' } = {}) {
      return `<div class="state is-error"><span class="state-mark">${I('wifi-off')}</span><h3>${title}</h3><p>${text}</p>${LV.ui.btn('重新加载', { kind: 'secondary', icon: 'rotate-ccw', attrs: LV.attr('retry') })}</div>`;
    },
    skeleton(kind = 'list') {
      const card = `<div class="card skel-card"><div style="display:flex;gap:12px;align-items:center"><div class="skel" style="width:44px;height:44px;border-radius:14px"></div><div style="flex:1;display:grid;gap:8px"><div class="skel skel-line" style="width:55%"></div><div class="skel skel-line" style="width:80%"></div></div></div><div class="skel skel-line" style="width:40%"></div></div>`;
      if (kind === 'dash') return `<div class="pad stack" aria-busy="true" aria-label="加载中"><div class="skel" style="height:150px;border-radius:16px"></div><div class="kpi-grid">${'<div class="skel" style="height:104px;border-radius:16px"></div>'.repeat(4)}</div><div class="skel" style="height:180px;border-radius:16px"></div></div>`;
      if (kind === 'detail') return `<div class="pad stack" aria-busy="true" aria-label="加载中"><div class="skel" style="height:170px;border-radius:16px"></div><div class="skel" style="height:90px;border-radius:16px"></div>${card}${card}</div>`;
      return `<div class="pad stack" aria-busy="true" aria-label="加载中">${card.repeat(4)}</div>`;
    },

    /** Order 7-stage flow (lib/order-status.ts ORDER_STAGES). */
    steps(status) {
      const last = LV.CONST.statusStage[status] ?? 0, cancelled = status === 'CANCELLED';
      return `<div class="steps${cancelled ? ' is-cancelled' : ''}">${LV.CONST.orderStages.map((s, i) => {
        const done = !cancelled && i < last, cur = !cancelled && i === last && status !== 'COMPLETED', fin = !cancelled && status === 'COMPLETED';
        return `<div class="step${done || fin ? ' is-done' : ''}${cur ? ' is-current' : ''}"><i>${done || fin ? I('check') : ''}</i>${s}</div>`;
      }).join('')}</div>`;
    },
    miniSteps(status, late = false) {
      const last = LV.CONST.statusStage[status] ?? 0, cancelled = status === 'CANCELLED';
      return `<div class="mini-steps${cancelled ? ' is-cancelled' : ''}${late ? ' is-late' : ''}" aria-hidden="true">${LV.CONST.orderStages.map((_, i) => `<i class="${!cancelled && i <= last ? 'on' : ''}"></i>`).join('')}</div>`;
    },

    field({ id, label, required = false, type = 'text', value = '', placeholder = '', error = '', hint = '', options = null, inputmode = '', autocomplete = 'off', rows = 0, input = '', extra = '' }) {
      const common = `id="${id}" name="${id}" ${input ? `data-input="${input}"` : ''} ${error ? 'aria-invalid="true"' : ''} aria-describedby="${id}-msg"`;
      let control;
      if (options) control = `<select class="select" ${common}>${options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
      else if (rows) control = `<textarea class="textarea" rows="${rows}" ${common} placeholder="${esc(placeholder)}">${esc(value)}</textarea>`;
      else control = `<input class="input" type="${type}" ${common} value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="${autocomplete}" ${inputmode ? `inputmode="${inputmode}"` : ''}>`;
      return `<div class="field${error ? ' has-error' : ''}"><label for="${id}">${label}${required ? '<i aria-hidden="true">*</i>' : ''}</label>${extra || control}<div id="${id}-msg">${error ? `<span class="field-error">${I('circle-alert')}${error}</span>` : hint ? `<span class="field-hint">${hint}</span>` : ''}</div></div>`;
    },

    switch: (on, attrs = '', label = '') => `<button type="button" class="switch" role="switch" aria-checked="${on}" aria-label="${label}" ${attrs}></button>`,
    note: text => `<div class="planned">${I('info')}<span>${text}</span></div>`,
    mockNote: (text = '示例数据（MOCK），非真实业务数据') => `<p class="mock-note">${text}</p>`,
    lock: text => `<div class="lock-card">${I('lock')}<span>${text}</span></div>`,
    updated: ui => `<div class="updated-at">${ui.updatedAt ? `${ui.updatedAt}更新` : '下拉刷新'} · 数据截至 ${LV.fmt.time(LV.NOW)}</div>`,
  };
})();

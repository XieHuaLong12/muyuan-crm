/*
 * 订单与报价：订单列表 / 订单详情 / 报价单列表 / 报价单详情 / 审批（规划能力）。
 * 订单字段与七段流程来自 services/order-service.ts 与 lib/order-status.ts；金额统一按人民币展示并保留原币种。
 * 订单行：BOS 的 Order 关联一笔 Deal（单一产品 / 型号 / 数量），逐行明细在报价单（QuotationItem）。
 */
(function () {
  const LV = window.LV, U = LV.ui, I = LV.icon, F = LV.fmt, C = LV.CONST;
  const isLate = o => o.status === 'IN_TRANSIT' && o.eta && o.eta < LV.TODAY;
  const quoteTotal = q => q.items.reduce((s, it) => s + it.qty * it.price, 0) + (q.freight || 0) + (q.other || 0);

  LV.orderCard = o => {
    const c = LV.customer(o.customer), late = isLate(o);
    return `<button type="button" class="ocard card pressable" ${LV.attr('open', { tab: 'orders', to: 'order', p: { id: o.id } })}>
      <span class="ocard-top"><span class="ocard-no num">${o.no}</span>${U.orderBadge(o.status)}</span>
      <span class="ocard-cust"><strong>${LV.esc(c.name)}</strong> ${U.cc(c.cc)} <span>${LV.esc(c.company)}</span></span>
      <span class="ocard-amount"><span class="num">${U.money(o.amountRMB)}</span><small class="num">${F.money(o.source, o.currency)}</small></span>
      ${U.miniSteps(o.status, late)}
      <span class="ocard-foot"><span>${o.product} ${o.model} × <b class="num">${o.qty}</b></span>${late ? `<span class="late">${I('triangle-alert')}超预计到货 ${-F.dayDiff(o.eta)} 天</span>` : `<span>${U.paymentBadge(o.payment)}</span>`}</span>
    </button>`;
  };
  LV.quoteRow = q => {
    const c = LV.customer(q.customer);
    return `<button type="button" class="qrow card pressable" ${LV.attr('open', { tab: 'orders', to: 'quote', p: { id: q.id } })}>
      <span class="qrow-icon">${I('file-text')}</span>
      <span class="qrow-main"><span class="qrow-top"><strong class="num">${q.no}</strong>${q.status === 'SENT' ? U.badge('已发送', 'brand') : U.badge('草稿', 'outline')}${q.approval ? U.badge('待审批', 'warning') : ''}</span>
      <span class="qrow-sub">${LV.esc(c.name)} · ${q.incoterm} · ${q.items.length} 个型号</span></span>
      <span class="qrow-amount num">${F.money(quoteTotal(q), q.currency)}<small>${q.sentAt ? `发送 ${F.ago(q.sentAt)}` : `创建 ${F.ago(q.createdAt)}`}</small></span>
    </button>`;
  };

  /* ── Orders root (订单 | 报价单 | 审批) ───────────────── */
  function ordersRegion(ui) {
    const all = LV.scope.orders();
    const tab = ui.status || 'ALL', q = (ui.q || '').toLowerCase();
    let list = tab === 'ALL' ? all : tab === 'ISSUE' ? all.filter(o => isLate(o) || (o.payment === 'UNPAID' && o.status !== 'CANCELLED')) : all.filter(o => o.status === tab);
    if (q) list = list.filter(o => [o.no, LV.customer(o.customer).name, LV.customer(o.customer).company, LV.customer(o.customer).country].join(' ').toLowerCase().includes(q));
    if (LV.state.demo === 'empty' || !list.length) return U.empty({ icon: 'package', title: q ? `没有找到「${LV.esc(q)}」` : '这个状态下没有订单', text: '成交后会自动生成订单（每笔成交一张订单）。' });
    return `<div class="stack">${list.map(LV.orderCard).join('')}</div>`;
  }
  function quotesRegion(ui) {
    const all = LV.scope.quotes(), f = ui.qstatus || 'ALL';
    const list = all.filter(q => f === 'ALL' || q.status === f).sort((a, b) => (b.sentAt || b.createdAt).localeCompare(a.sentAt || a.createdAt));
    return `<div class="chip-row flush">${[['ALL', '全部'], ['SENT', '已发送'], ['DRAFT', '草稿']].map(([k, l]) => U.chip(l, { pressed: f === k, count: all.filter(q => k === 'ALL' || q.status === k).length, attrs: LV.attr('set', { k: 'qstatus', v: JSON.stringify(k) }) })).join('')}</div>
      ${list.length && LV.state.demo !== 'empty' ? `<div class="stack">${list.map(LV.quoteRow).join('')}</div>` : U.empty({ icon: 'file-text', title: '没有报价单' })}
      ${U.note('手机端查看、转发报价单；逐行编辑报价（选产品、算运费、出 PDF）仍在电脑端报价工具完成。手机快速报价可在第二阶段评估。')}`;
  }
  function approvalsRegion() {
    const list = LV.scope.approvals();
    return `${U.note('<b>规划能力：</b>BOS 目前没有审批流程。以下为交互示意，哪些情况需要审批（低于价格表、改付款条件、更正成交金额等）需要业务确认后再开发。')}
      <div class="stack" style="margin-top:12px">${list.map(a => `<button type="button" class="card card-body pressable approval-row" ${LV.go('approval', { id: a.id })}>
        <span class="ap-top"><span class="badge t-outline">${a.type}</span>${a.status === 'PENDING' ? U.badge('待审批', 'warning') : a.status === 'APPROVED' ? U.badge('已通过', 'success') : U.badge('已驳回', 'danger')}</span>
        <strong class="num">${a.title}</strong><span class="ap-reason">${a.reason}</span>
        <span class="ap-foot">${LV.USERS[a.applicant].name} 提交 · ${F.ago(a.at)}<b class="num">${a.amount}</b></span></button>`).join('')}</div>`;
  }

  LV.screens.orders = {
    root: true, large: true, ptr: true, title: '订单',
    render(p, ui, r) {
      if (p.seg && !ui.segSet) { ui.seg = p.seg; ui.segSet = true; }
      const seg = ui.seg || 'orders';
      const all = LV.scope.orders();
      const pendingAp = LV.scope.approvals().filter(a => a.status === 'PENDING').length;
      const rem = { pay: all.filter(o => o.payment === 'UNPAID' && o.status !== 'CANCELLED').length, ship: all.filter(o => o.status === 'PRODUCING').length, late: all.filter(isLate).length, collect: all.filter(o => o.payment === 'DEPOSIT_PAID' && o.status !== 'CANCELLED').length };
      const statusChips = [['ALL', '全部', all.length], ...Object.entries(C.orderStatus).map(([k, l]) => [k, l, all.filter(o => o.status === k).length])]
        .map(([k, l, n]) => U.chip(l, { pressed: (ui.status || 'ALL') === k, count: n, attrs: LV.attr('set', { k: 'status', v: JSON.stringify(k) }) })).join('');
      const content = seg === 'orders' ? `
          <div class="pad"><div class="reminder-grid">
            ${[['待付款', rem.pay, 'credit-card', 'PENDING_PAYMENT'], ['待发货', rem.ship, 'factory', 'PRODUCING'], ['物流异常', rem.late, 'triangle-alert', 'IN_TRANSIT'], ['待收尾款', rem.collect, 'hand-coins', 'PRODUCING']].map(([l, n, ic, st]) => `<button type="button" class="reminder${l === '物流异常' && n ? ' is-alert' : ''}" ${LV.attr('set', { k: 'status', v: JSON.stringify(st) })}>${I(ic)}<b class="num">${n}</b><span>${l}</span></button>`).join('')}
          </div></div>
          <div class="toolbar"><label class="search">${I('search')}<span class="sr-only">搜索订单</span><input type="search" placeholder="订单号、客户、国家" value="${LV.esc(ui.q || '')}" data-input="order-search"></label></div>
          <div class="chip-row" aria-label="订单状态">${statusChips}</div>
          <div class="pad" data-region="list">${LV.gate(r, ui, () => ordersRegion(ui))}</div>`
        : seg === 'quotes' ? `<div class="pad">${LV.gate(r, ui, () => quotesRegion(ui))}</div>`
          : `<div class="pad">${approvalsRegion()}</div>`;
      return {
        title: '订单',
        body: `${U.largeTitle('订单', LV.isAdmin() ? `全公司 · 金额按人民币展示` : '我负责客户的订单')}
          <div class="pad" style="margin-bottom:12px">${U.seg([{ key: 'orders', label: '订单' }, { key: 'quotes', label: '报价单' }, { key: 'approvals', label: '审批', count: LV.isAdmin() ? pendingAp : 0 }], seg, 'seg')}</div>
          <div class="stack">${content}</div>`,
      };
    },
    regions: { list: (p, ui) => ordersRegion(ui) },
  };
  LV.onInput('order-search', (el, e, r) => { r.ui.q = el.value; LV.refreshRegion('list'); });

  /* ── Order detail ─────────────────────────────────────── */
  LV.screens.order = {
    render(p, ui, r) {
      const o = LV.order(p.id); if (!o) return { title: '订单', body: U.empty({ icon: 'circle-x', title: '订单不存在或无权查看' }) };
      const c = LV.customer(o.customer), late = isLate(o), q = o.quote && LV.quote(o.quote), P = LV.PRODUCTS[o.model];
      const kv = rows => `<dl class="kv">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
      const body = LV.gate(r, ui, () => `
        ${late ? `<div class="pad"><div class="issue-card">${I('triangle-alert')}<div><strong>物流异常 · 超预计到货 ${-F.dayDiff(o.eta)} 天</strong><p>预计 ${o.eta} 到货，目前仍在运输中。${LV.esc(o.notes)}</p></div></div></div>` : ''}
        <div class="pad"><div class="card order-hero">
          <div class="oh-top"><span class="num">${o.no}</span>${U.orderBadge(o.status)}</div>
          <div class="oh-amount num">${U.money(o.amountRMB)}</div>
          <div class="oh-sub">原币 <b class="num">${F.money(o.source, o.currency)}</b> · 下单 ${o.orderDate}</div>
          <div class="oh-steps">${U.steps(o.status)}</div>
        </div></div>
        <div class="pad"><div class="status-grid">
          <div><span>付款</span>${U.paymentBadge(o.payment)}<small>定金 30% ${o.payment === 'UNPAID' ? '未付' : '已付'} · 尾款 70% ${o.payment === 'PAID' ? '已付' : '未付'}</small></div>
          <div><span>生产</span>${U.badge(C.production[o.production], o.production === 'DONE' ? 'success' : o.production === 'IN_PROGRESS' ? 'info' : '')}<small>&nbsp;</small></div>
          <div><span>发货</span>${U.badge(C.shipping[o.shipping], o.shipping === 'DELIVERED' ? 'success' : late ? 'danger' : o.shipping === 'NOT_SHIPPED' ? '' : 'brand')}<small>预计到货 ${o.eta || '—'}</small></div>
        </div></div>
        ${U.section('产品', `<div class="pad"><div class="card product-line">${P ? `<img src="${P.img}" alt="" width="96" height="72" loading="lazy">` : ''}<div><strong>${P ? P.name : `${o.product} ${o.model}`}</strong><small>${P ? P.spec : ''}</small><div class="pl-qty"><span>数量 <b class="num">${o.qty}</b> 件</span><span>均价 <b class="num">${F.money((o.source / o.qty).toFixed(2), o.currency)}</b></span></div></div></div>
          ${q ? `<button type="button" class="link-row" ${LV.go('quote', { id: q.id })}>${I('file-text')}<span>来自报价单 <b class="num">${q.no}</b> · ${q.items.length} 个型号明细</span>${I('chevron-right')}</button>` : ''}</div>`)}
        ${U.section('客户', `<div class="pad"><div class="list">${U.cell({ lead: U.avatar(c.name, { grade: c.grade, size: 'sm' }), title: c.name, sub: `${c.company} · ${c.country}`, attrs: LV.attr('open', { tab: 'customers', to: 'customer', p: { id: c.id } }) })}</div></div>`)}
        ${U.section('订单信息', `<div class="pad"><div class="card card-body">${kv([['负责人', LV.USERS[o.owner].name], ['下单日期', o.orderDate], ['预计到货', o.eta || '—'], ['备注', LV.esc(o.notes) || '—'], ...(o.cancelReason ? [['取消原因', o.cancelReason]] : [])])}</div></div>`)}
        ${U.mockNote()}`, { skeleton: 'detail' });
      const canAdvance = LV.isAdmin() && !['COMPLETED', 'CANCELLED'].includes(o.status);
      return {
        title: '订单详情', sub: o.no,
        actions: LV.isAdmin() && o.status !== 'CANCELLED' ? U.iconBtn('ellipsis', { label: '更多操作', attrs: LV.attr('order-more', { id: o.id }) }) : '',
        body: `<div class="stack-lg" style="padding-top:4px">${body}</div>`,
        footer: canAdvance ? `${U.btn('联系客户', { kind: 'secondary', icon: 'message-circle', attrs: LV.attr('contact-wa', { id: c.id }) })}${U.btn('推进状态', { kind: 'primary', icon: 'arrow-right', attrs: LV.attr('order-advance', { id: o.id }) })}`
          : U.btn('联系客户', { kind: 'primary', icon: 'message-circle', attrs: LV.attr('contact-wa', { id: c.id }) }),
      };
    },
  };
  const NEXT = { PENDING_PAYMENT: 'PRODUCING', PRODUCING: 'SHIPPED', SHIPPED: 'IN_TRANSIT', IN_TRANSIT: 'COMPLETED' };
  LV.on('order-advance', el => {
    const o = LV.order(el.dataset.id);
    LV.sheet({ title: '推进订单状态', sub: `${o.no} · 当前：${C.orderStatus[o.status]}`, body: `<div class="action-list">${Object.entries(C.orderStatus).filter(([k]) => k !== 'CANCELLED').map(([k, l]) => `<button type="button" class="action-item${o.status === k ? ' is-selected' : ''}" ${LV.attr('order-set', { id: o.id, s: k })}><span class="radio${o.status === k ? ' is-on' : ''}"></span><span><strong>${l}</strong>${NEXT[o.status] === k ? '<small>下一步</small>' : ''}</span></button>`).join('')}</div><p class="sheet-note">付款、清关等细项由各自字段记录；切换主状态会同步进度条。</p>` });
  });
  LV.on('order-set', el => {
    const o = LV.order(el.dataset.id), prev = o.status, s = el.dataset.s; LV.closeSheet();
    if (s === prev) return;
    o.status = s;
    if (s === 'PRODUCING') { o.production = 'IN_PROGRESS'; if (o.payment === 'UNPAID') o.payment = 'DEPOSIT_PAID'; }
    if (s === 'COMPLETED') { o.shipping = 'DELIVERED'; o.payment = 'PAID'; }
    LV.refresh();
    LV.toast(`订单已改为「${C.orderStatus[s]}」`, { action: '撤销', onAction: () => { o.status = prev; LV.refresh(); } });
  });
  LV.on('order-more', el => {
    const o = LV.order(el.dataset.id);
    LV.sheet({ title: o.no, body: `<div class="action-list">
      <button type="button" class="action-item" ${LV.attr('noop-toast', { t: '导出 Excel 在电脑端订单页（原型略）' })}>${I('copy')}<span><strong>复制订单摘要</strong><small>订单号、金额、状态，用于发给同事</small></span></button>
      <button type="button" class="action-item danger" ${LV.attr('order-cancel', { id: o.id })}>${I('circle-x')}<span><strong>取消订单</strong><small>有关联成交时会同时作废该成交，不再计入业绩</small></span></button></div>` });
  });
  LV.on('order-cancel', async el => {
    const o = LV.order(el.dataset.id); LV.closeSheet();
    const reason = await LV.confirm({ title: '取消这个订单？', message: `${o.no} · ${F.money(o.amountRMB)}。关联的成交会被作废并留下记录，这一步不能撤销。`, ok: '取消订单', cancel: '再想想', danger: true, field: { label: '取消原因', required: true, min: 2, placeholder: '例如：客户资金未到位', error: '请填写取消原因' } });
    if (!reason) return;
    o.status = 'CANCELLED'; o.cancelReason = reason; LV.refresh();
    LV.toast('订单已取消', { icon: 'circle-x' });
  });

  /* ── Quote detail ─────────────────────────────────────── */
  LV.screens.quote = {
    render(p, ui, r) {
      const q = LV.quote(p.id), c = LV.customer(q.customer);
      const sub = q.items.reduce((s, it) => s + it.qty * it.price, 0), cbm = q.items.reduce((s, it) => s + it.qty * it.cbm, 0), qty = q.items.reduce((s, it) => s + it.qty, 0);
      const body = LV.gate(r, ui, () => `
        <div class="pad"><div class="card quote-head">
          <div class="oh-top"><span class="num">${q.no}</span>${q.status === 'SENT' ? U.badge('已发送', 'brand') : U.badge('草稿', 'outline')}</div>
          <div class="oh-amount num">${F.money(quoteTotal(q), q.currency)}</div>
          <div class="oh-sub">${q.incoterm} · 目的港 ${q.destination} · 有效期至 ${q.validUntil}</div>
          <div class="quote-stats"><span><b class="num">${qty}</b>件</span><span><b class="num">${cbm.toFixed(1)}</b>CBM</span><span><b class="num">${q.items.length}</b>个型号</span></div>
        </div></div>
        ${q.approval ? `<div class="pad"><button type="button" class="issue-card is-warning" ${LV.go('approval', { id: q.approval })}>${I('stamp')}<div><strong>等待管理员审批 ${U.planned()}</strong><p>单价低于价格表，审批通过后才能发送。</p></div>${I('chevron-right')}</button></div>` : ''}
        ${U.section('报价明细', `<div class="pad"><div class="list">${q.items.map(it => { const P = LV.PRODUCTS[it.model]; return `<div class="qitem">${P ? `<img src="${P.img}" alt="" width="72" height="54" loading="lazy">` : ''}<div class="qitem-main"><strong>${P ? P.name : it.model}</strong><small>${P ? P.spec : ''}</small><div class="qitem-nums"><span class="num">${F.money(it.price, q.currency)} × ${it.qty}</span><b class="num">${F.money(it.qty * it.price, q.currency)}</b></div>${it.listPrice ? `<small class="below">价格表 ${F.money(it.listPrice, q.currency)} · 低 ${((1 - it.price / it.listPrice) * 100).toFixed(1)}%</small>` : ''}</div></div>`; }).join('')}
          <dl class="kv totals"><div><dt>货值小计</dt><dd class="num">${F.money(sub, q.currency)}</dd></div><div><dt>运费</dt><dd class="num">${q.freight ? F.money(q.freight, q.currency) : '—'}</dd></div><div class="total"><dt>合计</dt><dd class="num">${F.money(quoteTotal(q), q.currency)}</dd></div></dl></div></div>`, { sub: '示例价格' })}
        ${U.section('客户', `<div class="pad"><div class="list">${U.cell({ lead: U.avatar(c.name, { grade: c.grade, size: 'sm' }), title: c.name, sub: `${c.company} · ${LV.CONST.stages[c.stage]}`, attrs: LV.attr('open', { tab: 'customers', to: 'customer', p: { id: c.id } }) })}</div></div>`)}
        ${U.mockNote('示例数据（MOCK）。真实报价的单价、MOQ、运费只来自产品库与运费库，报价当时的快照不会因之后改价而变化。')}`, { skeleton: 'detail' });
      return {
        title: '报价单', sub: q.no, body: `<div class="stack-lg" style="padding-top:4px">${body}</div>`,
        footer: q.status === 'SENT' ? `${U.btn('转发 PDF', { kind: 'secondary', icon: 'send', attrs: LV.attr('noop-toast', { t: '调用系统分享面板发送 PDF（原型略）' }) })}${U.btn('跟进客户', { kind: 'primary', icon: 'pencil', attrs: LV.attr('follow', { id: c.id }) })}`
          : `${U.btn('在电脑端编辑', { kind: 'secondary', icon: 'laptop', attrs: LV.attr('noop-toast', { t: '逐行编辑在电脑端报价工具完成' }) })}${U.btn(q.approval ? '等待审批' : '登记为已发送', { kind: 'primary', icon: 'send', attrs: q.approval ? 'disabled' : LV.attr('quote-sent', { id: q.id }) })}`,
      };
    },
  };
  LV.on('quote-sent', async el => {
    const q = LV.quote(el.dataset.id);
    const ok = await LV.confirm({ title: '登记为已发送？', message: '登记后报价不能再修改，需要改价请复制为新报价。客户阶段会更新为「已报价」。', ok: '登记发送' });
    if (!ok) return; q.status = 'SENT'; q.sentAt = LV.NOW; LV.customer(q.customer).stage = 'QUOTED'; LV.refresh(); LV.toast('已登记发送');
  });

  /* ── Approval detail (planned) ────────────────────────── */
  LV.screens.approval = {
    render(p) {
      const a = LV.db.approvals.find(x => x.id === p.id);
      const canDecide = LV.isAdmin() && a.status === 'PENDING';
      return {
        title: '审批详情', sub: a.type,
        body: `<div class="stack-lg" style="padding-top:4px">
          <div class="pad">${U.note('规划能力，BOS 目前没有审批流程。审批规则、审批人与金额阈值需要业务确认。')}</div>
          <div class="pad"><div class="card card-body approval-detail">
            <div class="ap-top"><span class="badge t-outline">${a.type}</span>${a.status === 'PENDING' ? U.badge('待审批', 'warning') : a.status === 'APPROVED' ? U.badge('已通过', 'success') : U.badge('已驳回', 'danger')}</div>
            <h2 class="num">${a.title}</h2><p>${a.reason}</p>
            <dl class="kv"><div><dt>金额</dt><dd class="num">${a.amount}</dd></div><div><dt>申请人</dt><dd>${LV.USERS[a.applicant].name}</dd></div><div><dt>提交时间</dt><dd>${F.ago(a.at)}</dd></div></dl>
            ${a.quote ? `<button type="button" class="link-row" ${LV.go('quote', { id: a.quote })}>${I('file-text')}<span>查看报价单</span>${I('chevron-right')}</button>` : ''}
            ${a.order ? `<button type="button" class="link-row" ${LV.go('order', { id: a.order })}>${I('package')}<span>查看订单</span>${I('chevron-right')}</button>` : ''}
          </div></div>
          ${a.decision ? `<div class="pad"><div class="card card-body"><strong>${a.status === 'APPROVED' ? '已通过' : '已驳回'}</strong><p class="muted">${LV.esc(a.decision)}</p></div></div>` : ''}
        </div>`,
        footer: canDecide ? `${U.btn('驳回', { kind: 'danger-ghost', attrs: LV.attr('ap-decide', { id: a.id, v: 'REJECTED' }) })}${U.btn('通过', { kind: 'primary', icon: 'check', attrs: LV.attr('ap-decide', { id: a.id, v: 'APPROVED' }) })}` : '',
      };
    },
  };
  LV.on('ap-decide', async el => {
    const a = LV.db.approvals.find(x => x.id === el.dataset.id), v = el.dataset.v;
    const res = await LV.confirm({ title: v === 'APPROVED' ? '通过这项审批？' : '驳回这项审批？', message: `${a.title}`, ok: v === 'APPROVED' ? '通过' : '驳回', danger: v === 'REJECTED', field: { label: v === 'APPROVED' ? '审批意见（选填）' : '驳回原因', required: v === 'REJECTED', min: 2, error: '请填写驳回原因' } });
    if (!res) return;
    a.status = v; a.decision = res === true ? '同意' : res;
    if (a.quote) { const q = LV.quote(a.quote); if (q) q.approval = null; }
    LV.refresh(); LV.renderTabbar();
    LV.toast(v === 'APPROVED' ? `已通过 · 已通知 ${LV.USERS[a.applicant].name}` : '已驳回', { icon: v === 'APPROVED' ? 'circle-check' : 'circle-x' });
  });
})();

/*
 * 经营数据与财务（管理员）/ 我的业绩（销售）。
 * 权限与 BOS 一致：财务（services/finance-service.ts）仅管理员；毛利在驾驶舱里对销售返回 null；
 * 销售排行（services/sales-team-service.ts）管理员看全员，销售只看自己。
 * 口径：销售额与毛利按成交日期，询盘与转化按询盘日期；不同币种分别统计、不折算（lib/metrics.ts）。
 */
(function () {
  const LV = window.LV, U = LV.ui, I = LV.icon, F = LV.fmt;

  function period(m, key) {
    const t = m.trend, sum = arr => arr.reduce((a, b) => a + b, 0) * 1000;
    if (key === 'week') return { label: '本周（11-09 至今）', revenue: sum(t.cur.slice(8)), prev: sum(t.prev.slice(8)), scale: 2 / 10 };
    return { label: '本月（11-01 至今）', revenue: m.month.revenue, prev: m.month.prevRevenue, scale: 1 };
  }

  LV.screens.analytics = {
    ptr: true,
    render(p, ui, r) {
      const admin = LV.isAdmin(), m = LV.METRICS[admin ? 'ADMIN' : 'SALES'], mo = m.month, per = ui.period || 'month', P = period(m, per);
      const k = n => Math.round(n * P.scale);
      const funnel = [
        { label: '询盘', value: k(mo.inquiries), display: `${k(mo.inquiries)}` },
        { label: '有效客户', value: k(mo.qualified), display: `${k(mo.qualified)} · ${F.pct(mo.qualified, mo.inquiries)}`, sub: '客户回复了我们的第一条消息' },
        { label: '已报价', value: k(mo.quoted), display: `${k(mo.quoted)} · ${F.pct(mo.quoted, mo.qualified)}` },
        { label: '成交', value: k(mo.won), display: `${k(mo.won)} · ${F.pct(mo.won, mo.quoted)}` },
      ];
      const pay = m.payments;
      const body = () => `
        <div class="pad"><div class="card report-hero">
          <span class="rh-label">${admin ? '销售额' : '我的销售额'} · ${P.label}</span>
          <span class="rh-value num">${U.money(P.revenue)}</span>
          <span class="rh-row">${U.delta(F.change(P.revenue, P.prev))}<span>较上期 ¥${F.int(Math.round(P.prev))}</span></span>
          ${per === 'month' ? `<div class="rh-target"><span>${admin ? '公司' : '我的'}月目标 ¥${F.wan(mo.target)}</span><b class="num">${F.pct(mo.revenue, mo.target)}</b></div>${U.meter(mo.revenue / mo.target)}` : ''}
          ${mo.otherCurrency ? `<span class="rh-note">另有 ${mo.otherCurrency}，不同币种分别统计</span>` : ''}
        </div></div>
        <div class="pad kpi-grid">
          ${U.stat({ label: '订单数', icon: 'receipt', value: k(mo.orders), foot: per === 'month' ? `上月同期 ${mo.prevOrders}` : '' })}
          ${admin ? U.stat({ label: '毛利', icon: 'banknote', value: `<span class="money-unit">¥</span>${F.wan(k(mo.grossProfit))}`, foot: `毛利率 ${F.pct(mo.grossProfit, mo.revenue)}` }) : U.stat({ label: '平均首联', icon: 'timer', value: `${mo.avgFirstContact}<small class="unit">分钟</small>`, foot: '分配到首次联系' })}
          ${U.stat({ label: '询盘', icon: 'user-round-plus', value: k(mo.inquiries), foot: `有效 ${F.pct(mo.qualified, mo.inquiries)}` })}
          ${U.stat({ label: '询盘成交率', icon: 'percent', value: F.pct(mo.won, mo.inquiries), foot: `${k(mo.won)} 位成交 / ${k(mo.inquiries)} 位询盘` })}
        </div>
        ${U.section('成交额走势', `<div class="pad"><div class="card card-body">${LV.charts.trend(m.trend, { tip: ui['tip-trend'] })}
          <button type="button" class="table-toggle" ${LV.attr('set', { k: 'table', v: String(!ui.table) })} aria-expanded="${!!ui.table}">${I(ui.table ? 'chevron-up' : 'list')}${ui.table ? '收起明细' : '查看明细表'}</button>
          ${ui.table ? `<div class="table-wrap"><table class="data-table"><caption class="sr-only">每日成交额</caption><thead><tr><th>日期</th><th>本月</th><th>上月同期</th></tr></thead><tbody>${m.trend.days.map((d, i) => `<tr><td>11-${d.padStart(2, '0')}</td><td class="tnum">¥${F.int(Math.round(m.trend.cur[i] * 1000))}</td><td class="tnum">¥${F.int(Math.round(m.trend.prev[i] * 1000))}</td></tr>`).join('')}</tbody></table></div>` : ''}
        </div></div>`, { sub: '本月累计 · 按成交日期' })}
        ${U.section('转化漏斗', `<div class="pad"><div class="card card-body">${LV.charts.bars(funnel)}<p class="chart-note">比例为相邻两步的转化率；询盘与有效按询盘日期归属。</p></div></div>`)}
        ${U.section('回款情况', `<div class="pad"><div class="card card-body">${LV.charts.segmented([
          { label: '已付清', value: pay.PAID, color: 'var(--c-seq-1)', ink: 'var(--c-on-brand)' },
          { label: '已付定金', value: pay.DEPOSIT_PAID, color: 'var(--c-seq-2)', ink: '#fff' },
          { label: '未付款', value: pay.UNPAID, color: 'var(--c-seq-3)', ink: 'var(--c-ink)' },
        ], { label: '订单付款状态' })}<p class="chart-note">按订单付款状态统计（单）。目前只记录付款状态，不记录逐笔收款金额。</p></div></div>`, { sub: '进行中的订单' })}
        ${admin ? U.section('销售排行', `<div class="pad"><div class="card card-body">${LV.charts.bars(m.ranking.map(x => ({ label: LV.USERS[x.u].name, value: x.revenue, display: `¥${F.int(x.revenue)}`, sub: `${x.deals} 笔成交 · 占 ${F.pct(x.revenue, mo.revenue)}` })))}</div></div>`, { sub: '本月 · 按成交金额' })
          + U.section('询盘来源', `<div class="pad"><div class="card card-body">${LV.charts.bars(m.sources.map(s => ({ label: s.k, value: s.v, display: `${s.v} · ${F.pct(s.v, mo.inquiries)}` })))}</div></div>`, { sub: '本月' })
          : `<div class="pad">${U.lock('毛利、财务和团队排行只有管理员可以查看，与电脑端权限一致。')}</div>`}
        <p class="mock-note">口径：销售额与毛利按成交日期，询盘与转化按询盘日期；不同币种分别统计，不换算。<br>示例数据（MOCK），非真实经营数据。</p>`;
      return {
        title: admin ? '经营数据' : '我的业绩', sub: admin ? '全公司 · 人民币' : LV.me().name,
        body: `<div class="stack-lg" style="padding-top:4px">
          <div class="pad">${U.seg([{ key: 'week', label: '本周' }, { key: 'month', label: '本月' }, { key: 'quarter', label: '本季' }, { key: 'year', label: '本年' }], per, 'period')}</div>
          ${['quarter', 'year'].includes(per) ? `<div class="pad">${U.empty({ icon: 'chart-column', title: '原型只模拟了本周和本月', text: '真实 App 中，本季、本年与电脑端驾驶舱使用同一接口和口径。' })}</div>` : LV.gate(r, ui, body, { skeleton: 'dash' })}
        </div>`,
      };
    },
  };
})();

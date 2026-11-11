/*
 * LVANJU BOS Mobile · charts (prototype)
 * Rules: one axis, single-hue magnitude, the comparison period recessive grey, 2px lines, area wash ~10%,
 * hairline solid grid, text in ink tokens (never series colour), a legend whenever two series show,
 * tap a day to read its value (the mobile equivalent of hover), and a table fallback in the report view.
 */
(function () {
  const LV = window.LV;

  /**
   * Month-to-date trend: cumulative amount for this month vs the same days last month. Daily deal amounts are sparse
   * (a few big orders), so a cumulative line reads as a trend and answers "are we ahead of last month?"; the tapped
   * day's own amount is in the tooltip and the table view. Values in 千元 (thousand CNY).
   */
  function trend({ days, cur, prev }, { tip = null, id = 'trend' } = {}) {
    const W = 340, H = 168, L = 38, R = 10, T = 14, B = 24;
    const acc = arr => arr.reduce((out, v) => (out.push((out.at(-1) || 0) + v), out), []);
    const cc = acc(cur), pc = acc(prev);
    const max = Math.max(...cc, ...pc, 1);
    const top = [100, 150, 200, 300, 400, 500, 600, 800, 1000, 1500, 2000, 3000, 5000].find(v => v >= max) || Math.ceil(max / 1000) * 1000;
    const x = i => L + (W - L - R) * (i / (days.length - 1));
    const y = v => T + (H - T - B) * (1 - v / top);
    const path = arr => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const area = `${path(cc)} L${x(cc.length - 1).toFixed(1)},${y(0)} L${x(0)},${y(0)} Z`;
    const ticks = [0, top / 2, top];
    const tickLabel = v => v === 0 ? '0' : `${+(v / 10).toFixed(1)}万`; // one unit per axis (万元)
    const last = cur.length - 1, sel = tip ?? last;
    const tipX = x(sel), tipW = 168, tipLeft = Math.min(W - R - tipW, Math.max(L - 30, tipX - tipW / 2));
    const fmt = v => `¥${LV.fmt.int(Math.round(v * 1000))}`;
    const slot = (W - L - R) / (days.length - 1);
    return `<figure class="chart" style="margin:0">
      <svg viewBox="0 0 ${W} ${H + 40}" width="100%" role="img" aria-label="本月累计成交额 ${fmt(cc[last])}，上月同期累计 ${fmt(pc[last])}">
        ${ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" style="stroke:var(--c-chart-grid)" stroke-width="1"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end" font-size="10" style="fill:var(--c-ink-3);font-family:var(--f-num)">${tickLabel(t)}</text>`).join('')}
        ${days.map((dname, i) => (i % 3 === 0 || i === last) ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" font-size="10" style="fill:var(--c-ink-3);font-family:var(--f-num)">${dname}日</text>` : '').join('')}
        <path d="${path(pc)}" fill="none" style="stroke:var(--c-chart-prev)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
        <path d="${area}" style="fill:var(--c-chart-1-wash)" stroke="none"/>
        <path d="${path(cc)}" fill="none" style="stroke:var(--c-chart-1)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        <line x1="${tipX}" x2="${tipX}" y1="${T}" y2="${y(0)}" style="stroke:var(--c-ink-3)" stroke-width="1" opacity=".35"/>
        <circle cx="${tipX}" cy="${y(pc[sel])}" r="3.5" style="fill:var(--c-chart-prev);stroke:var(--c-surface)" stroke-width="2"/>
        <circle cx="${tipX}" cy="${y(cc[sel])}" r="5" style="fill:var(--c-chart-1);stroke:var(--c-surface)" stroke-width="2"/>
        <g transform="translate(${tipLeft},${H + 2})">
          <rect width="${tipW}" height="36" rx="8" style="fill:var(--c-surface-2)"/>
          <text x="10" y="14" font-size="10" style="fill:var(--c-ink-3)">截至 11 月 ${days[sel]} 日 · 当日 ${fmt(cur[sel])}</text>
          <text x="10" y="29" font-size="11.5" font-weight="600" style="fill:var(--c-ink);font-family:var(--f-num)">累计 ${fmt(cc[sel])}</text>
          <text x="${tipW - 8}" y="29" font-size="10" text-anchor="end" style="fill:var(--c-ink-3);font-family:var(--f-num)">上月 ${fmt(pc[sel])}</text>
        </g>
        ${days.map((_, i) => `<rect x="${x(i) - slot / 2}" y="${T}" width="${slot}" height="${H - T - B}" fill="transparent" ${LV.attr('chart-tip', { i, chart: id })} style="cursor:pointer"><title>${days[i]} 日：当日 ${fmt(cur[i])}，累计 ${fmt(cc[i])}</title></rect>`).join('')}
      </svg>
      <figcaption class="legend"><span><i style="background:var(--c-chart-1)"></i>本月累计</span><span><i class="line" style="background:var(--c-chart-prev)"></i>上月同期累计</span><span class="hint">点按某一天查看</span></figcaption>
    </figure>`;
  }

  /** Horizontal bars (ranking, funnel). rows: [{label, value, display, sub, highlight}] */
  function bars(rows, { max = Math.max(...rows.map(r => r.value), 1) } = {}) {
    return `<div class="hbars">${rows.map(r => `<div class="hbar${r.highlight ? ' is-me' : ''}">
      <div class="hbar-head"><span class="hbar-label">${r.label}</span><span class="hbar-value num">${r.display ?? LV.fmt.int(r.value)}</span></div>
      <div class="hbar-track"><i style="width:${Math.max(1.5, r.value / max * 100).toFixed(1)}%"></i></div>
      ${r.sub ? `<div class="hbar-sub">${r.sub}</div>` : ''}
    </div>`).join('')}</div>`;
  }

  /** Parts of a whole (payment status of open orders): tall segmented bar + legend with counts. */
  function segmented(parts, { label = '' } = {}) {
    const total = parts.reduce((s, p) => s + p.value, 0) || 1;
    return `<div class="segbar" role="img" aria-label="${label}：${parts.map(p => `${p.label} ${p.value}`).join('，')}">
      <div class="segbar-track">${parts.filter(p => p.value).map(p => `<i style="flex:${p.value};background:${p.color};color:${p.ink}" title="${p.label} ${p.value}">${p.value / total >= .18 ? `${Math.round(p.value / total * 100)}%` : ''}</i>`).join('')}</div>
      <div class="legend">${parts.map(p => `<span><i style="background:${p.color}"></i>${p.label}<b class="num">${p.value}</b></span>`).join('')}</div>
    </div>`;
  }

  LV.charts = { trend, bars, segmented };
  LV.on('chart-tip', el => { const r = LV.top(); r.ui[`tip-${el.dataset.chart}`] = Number(el.dataset.i); LV.refresh(); });
})();

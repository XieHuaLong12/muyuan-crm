'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Header, Table } from '@/components/ui/bos';
import { api, dateTimeText } from '@/lib/client';
import type { CountryConfig, RadarConfig } from '@/lib/radar';
import type { radarSettings } from '@/services/radar-config-service';
import { MailboxSettings } from './MailboxSettings';

type Jsonify<T> = T extends Date ? string : T extends (infer U)[] ? Jsonify<U>[] : T extends object ? { [K in keyof T]: Jsonify<T[K]> } : T;
type Data = Jsonify<Awaited<ReturnType<typeof radarSettings>>>;

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const CRAWL_STATUS: Record<string, string> = { DONE: '完成', CAPTCHA: '遇到验证码，已停止', ERROR: '失败' };
type CountryForm = CountryConfig & { code: string; holidaysText: string; citiesText: string };
const toForm = (code: string, c: CountryConfig): CountryForm => ({ ...c, code, holidaysText: c.holidays.join('\n'),
  citiesText: Object.entries(c.cityTimezones).map(([city, tz]) => `${city} = ${tz}`).join('\n') });
const fromForm = (f: CountryForm): CountryConfig => ({
  name: f.name, language: f.language, timezone: f.timezone.trim(), workdays: [...f.workdays].sort(), start: f.start, end: f.end,
  holidays: f.holidaysText.split(/[\s,，]+/).map(d => d.trim()).filter(Boolean),
  cityTimezones: Object.fromEntries(f.citiesText.split('\n').map(line => line.split('=').map(part => part.trim())).filter(([city, tz]) => city && tz)),
});

/** Numeric rules shown in the form; each maps to one field of the stored settings. */
const RULES: { key: keyof RadarConfig; label: string; hint: string; step?: number }[] = [
  { key: 'searchesPerDay', label: '每天爬取的关键词 × 城市', hint: '按最久没跑过的先跑' },
  { key: 'intervalMin', label: '发信最短间隔（分钟）', hint: '同一邮箱两封之间随机取值' },
  { key: 'intervalMax', label: '发信最长间隔（分钟）', hint: '' },
  { key: 'riskyPerMailboxPerDay', label: '风险邮箱每邮箱每天上限', hint: '全收、临时邮箱' },
  { key: 'endDays', label: '第 3 封后多少天结束序列', hint: '结束后记为无回复' },
  { key: 'noReplyCooldownDays', label: '无回复冷却天数', hint: '期间不再联系这个域名' },
  { key: 'notInterestedCooldownDays', label: '不感兴趣冷却天数', hint: '' },
  { key: 'bounceWindow', label: '退信检查范围（最近几封）', hint: '' },
  { key: 'maxBouncesInWindow', label: '范围内最多允许退信', hint: '超过即暂停该邮箱' },
  { key: 'maxConsecutiveFailures', label: '连续发送失败几次暂停', hint: '' },
  { key: 'reviewConfidence', label: 'AI 置信度低于多少进待复核', hint: '0–1', step: 0.05 },
  { key: 'strictReviewDays', label: '上线后全部人工审核的天数', hint: '第 1 封整封审核、有效回复先复核' },
  { key: 'minSample', label: '模板对比门槛（封）', hint: '每个版本满这么多封才比较' },
  { key: 'retentionMonths', label: '无回复客户数据保留（月）', hint: '到期清空联系人与正文，只留禁发记录' },
];

/** 设置 · 客户雷达: what the crawler works through, each country's sending hours, and the sending rules. */
export function RadarSettings({ data, notice }: { data: Data; notice?: { connected?: string; error?: string } }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const codes = Object.keys(data.config.countries);
  const [add, setAdd] = useState({ country: codes[0] ?? 'FR', cities: '', keywords: '' });
  const [countries, setCountries] = useState<CountryForm[]>(Object.entries(data.config.countries).map(([code, c]) => toForm(code, c)));
  const [rules, setRules] = useState<RadarConfig>(data.config as RadarConfig);
  const [ramp, setRamp] = useState(data.config.rampLevels.join(', '));
  const [follow, setFollow] = useState(data.config.followUpWorkdays.join(', '));
  const [catalog, setCatalog] = useState(data.config.catalogUrls);

  async function run(task: () => Promise<string>) {
    setBusy(true); setError(''); setMessage('');
    try { setMessage(await task()); router.refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const addSearches = () => run(async () => {
    const r = await api<{ created: number; skipped: number }>('radar/searches', 'POST', add);
    setAdd({ ...add, cities: '', keywords: '' });
    return `已添加 ${r.created} 组${r.skipped ? `，${r.skipped} 组已存在` : ''}`;
  });
  const saveConfig = () => run(async () => {
    const numbers = (text: string) => text.split(/[\s,，]+/).filter(Boolean).map(Number);
    const config = { ...rules, rampLevels: numbers(ramp), followUpWorkdays: numbers(follow), catalogUrls: { fr: catalog.fr.trim(), en: catalog.en.trim() },
      countries: Object.fromEntries(countries.map(c => [c.code.trim().toUpperCase(), fromForm(c)])) };
    await api('radar/settings', 'PUT', config);
    return '设置已保存，立即生效';
  });
  const setCountry = (i: number, patch: Partial<CountryForm>) => setCountries(list => list.map((c, j) => j === i ? { ...c, ...patch } : c));

  const h = data.health;
  return <div className="bos-radar bos-radar-settings">
    <Header title="客户雷达" description="爬虫要跑的关键词和城市、各国家的发送时段和节假日、发信规则。改动保存后立即生效。" />
    {notice?.connected && <p className="bos-radar-message" role="status">已连接发信邮箱 {notice.connected}</p>}
    {notice?.error && <p className="bos-sales-error" role="alert">连接发信邮箱失败：{notice.error}</p>}
    {message && <p className="bos-radar-message" role="status">{message}</p>}
    {error && <p className="bos-sales-error" role="alert">{error}</p>}

    <Card>
      <h2>接入状态</h2>
      <div className="bos-radar-health">
        <div><strong>地图爬虫</strong>{h.ingest ? <Badge tone="green">已配置密钥</Badge> : <Badge tone="warning">未配置</Badge>}
          <small>{data.lastCrawl ? `上次 ${dateTimeText(data.lastCrawl.startedAt)} · ${CRAWL_STATUS[data.lastCrawl.status] ?? data.lastCrawl.status} · 找到 ${data.lastCrawl.found} 家，新入库 ${data.lastCrawl.created} 家` : '还没有运行记录。爬虫部署见 extensions/radar-crawler/README.md'}</small>
          {data.lastCrawl?.error && <small>{data.lastCrawl.error}</small>}</div>
        <div><strong>AI 评分</strong>{h.deepSeek ? <Badge tone="green">DeepSeek 已配置</Badge> : <Badge tone="warning">未配置 DEEPSEEK_API_KEY</Badge>}<small>没有配置时新客户保持「待评分」</small></div>
        <div><strong>邮箱验证</strong>{h.verifier ? <Badge tone="green">{h.verifierName} 已配置</Badge> : <Badge tone="warning">未配置</Badge>}<small>EMAIL_VERIFY_PROVIDER（millionverifier / zerobounce）与 EMAIL_VERIFY_API_KEY；只验证 A、B 级，每家最多 2 个地址</small></div>
        <div><strong>定时任务</strong>{h.cron ? <Badge tone="green">已配置密钥</Badge> : <Badge tone="warning">未配置 META_SYNC_SECRET</Badge>}<small>Hostinger Cron 每分钟 POST /api/cron/radar，请求头 x-cron-secret</small></div>
        <div><strong>Gmail 授权</strong>{h.gmail ? <Badge tone="green">已配置</Badge> : <Badge tone="warning">未配置</Badge>}<small>GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET</small></div>
        <div><strong>真实发信</strong>{h.sending ? <Badge tone="green">已开启</Badge> : <Badge tone="warning">未开启</Badge>}<small>RADAR_SEND_ENABLED=true 时才真正发信；没开时队列照常排，不发出</small></div>
      </div>
    </Card>

    <MailboxSettings data={data} />

    <Card className="bos-radar-form">
      <h2>关键词 × 城市</h2>
      <p className="bos-radar-hint">爬虫每天北京时间 06:00 取最久没跑过的 {data.config.searchesPerDay} 组，在 Google 地图上搜「关键词 城市」。城市和关键词可以一次填多个（每行一个或用逗号分隔），会两两组合。</p>
      <div className="bos-radar-form-grid">
        <label><span>国家</span><select className="bos-input" value={add.country} onChange={e => setAdd({ ...add, country: e.target.value })}>
          {Object.entries(data.config.countries).map(([code, c]) => <option key={code} value={code}>{c.name}（{code}）</option>)}</select></label>
        <label><span>城市</span><textarea className="bos-input" rows={3} value={add.cities} placeholder={'Paris\nLyon\nMarseille'} onChange={e => setAdd({ ...add, cities: e.target.value })} /></label>
        <label><span>关键词</span><textarea className="bos-input" rows={3} value={add.keywords} placeholder={'grossiste meuble\nmagasin canapé\nliterie'} onChange={e => setAdd({ ...add, keywords: e.target.value })} /></label>
      </div>
      <div><Button variant="primary" disabled={busy || !add.cities.trim() || !add.keywords.trim()} onClick={addSearches}><Plus size={15} />添加</Button></div>
      {data.searches.length ? <Table caption="关键词 × 城市" headings={['国家', '城市', '关键词', '上次运行', '结果 / 新入库', '客户数', '启用', '']}>
        {data.searches.map(s => <tr key={s.id}>
          <td>{data.config.countries[s.country]?.name ?? s.country}</td><td>{s.city}</td><td>{s.keyword}</td>
          <td>{s.lastRunAt ? dateTimeText(s.lastRunAt) : '未运行'}</td>
          <td>{s.lastRunAt ? `${s.lastFound} / ${s.lastNew}` : '—'}</td><td>{s.prospects}</td>
          <td><input type="checkbox" checked={s.active} aria-label={`启用 ${s.keyword} ${s.city}`} disabled={busy}
            onChange={e => run(async () => { await api(`radar/searches/${s.id}`, 'PATCH', { active: e.target.checked }); return e.target.checked ? '已启用' : '已停用'; })} /></td>
          <td><Button variant="ghost" aria-label={`删除 ${s.keyword} ${s.city}`} disabled={busy} onClick={() => run(async () => { await api(`radar/searches/${s.id}`, 'DELETE'); return '已删除，已入库的客户保留'; })}><Trash2 size={14} /></Button></td>
        </tr>)}
      </Table> : <EmptyState title="还没有关键词" description="法国可以从 grossiste meuble、magasin de meubles、magasin canapé、literie、importateur mobilier 开始；海湾和澳大利亚用 furniture wholesale、furniture store、mattress store、furniture importer。" />}
    </Card>

    <Card className="bos-radar-form">
      <h2>国家与发送时段</h2>
      <p className="bos-radar-hint">开发信只在客户当地的工作日、发送时段内发出，节假日不发。节假日每年需要录入一次（每行一个日期，如 2026-11-11）。城市时区用于同一国家有多个时区的情况，每行「城市 = 时区」。</p>
      <div className="bos-radar-countries">{countries.map((c, i) => <div key={i} className="bos-radar-country">
        <div className="bos-radar-country-head"><strong>{c.name || '新国家'}{c.holidays.length === 0 && c.holidaysText.trim() === '' && <> <Badge tone="warning">未录入节假日</Badge></>}</strong>
          {countries.length > 1 && <Button variant="ghost" onClick={() => setCountries(list => list.filter((_, j) => j !== i))}>移除</Button>}</div>
        <label><span>国家代码</span><input className="bos-input" value={c.code} maxLength={2} onChange={e => setCountry(i, { code: e.target.value.toUpperCase() })} /></label>
        <label><span>名称</span><input className="bos-input" value={c.name} maxLength={20} onChange={e => setCountry(i, { name: e.target.value })} /></label>
        <label><span>模板语言</span><select className="bos-input" value={c.language} onChange={e => setCountry(i, { language: e.target.value as 'fr' | 'en' })}><option value="fr">法语</option><option value="en">英语</option></select></label>
        <label><span>时区</span><input className="bos-input" value={c.timezone} onChange={e => setCountry(i, { timezone: e.target.value })} /></label>
        <label><span>开始</span><input className="bos-input" type="time" value={c.start} onChange={e => setCountry(i, { start: e.target.value })} /></label>
        <label><span>结束</span><input className="bos-input" type="time" value={c.end} onChange={e => setCountry(i, { end: e.target.value })} /></label>
        <fieldset><legend>工作日</legend>{WEEKDAYS.map((label, day) => <label key={day} className="bos-radar-inline"><input type="checkbox" checked={c.workdays.includes(day)}
          onChange={e => setCountry(i, { workdays: e.target.checked ? [...c.workdays, day] : c.workdays.filter(d => d !== day) })} />周{label}</label>)}</fieldset>
        <label className="is-wide"><span>节假日</span><textarea className="bos-input" rows={3} value={c.holidaysText} placeholder="2026-11-11" onChange={e => setCountry(i, { holidaysText: e.target.value })} /></label>
        <label className="is-wide"><span>城市时区</span><textarea className="bos-input" rows={3} value={c.citiesText} placeholder="Perth = Australia/Perth" onChange={e => setCountry(i, { citiesText: e.target.value })} /></label>
      </div>)}</div>
      <div><Button onClick={() => setCountries(list => [...list, { code: '', name: '', language: 'en', timezone: '', workdays: [1, 2, 3, 4, 5], start: '09:00', end: '16:30', holidays: [], cityTimezones: {}, holidaysText: '', citiesText: '' }])}><Plus size={15} />添加国家</Button></div>
    </Card>

    <Card className="bos-radar-form">
      <h2>发信规则</h2>
      <p className="bos-radar-hint">发送队列上线后按这些规则排队慢发。每个邮箱每天的上限由预热加量表按预热开始日期自动算出：第 1 周取第 1 个数，第 2 周取第 2 个数……之后一直用最后一个数。</p>
      <div className="bos-radar-form-grid">
        <label><span>预热加量表（每邮箱每天）</span><input className="bos-input" value={ramp} onChange={e => setRamp(e.target.value)} /></label>
        <label><span>第 2、3 封各等几个工作日</span><input className="bos-input" value={follow} onChange={e => setFollow(e.target.value)} /></label>
        <label><span>法语目录链接 {'{目录链接}'}</span><input className="bos-input" type="url" value={catalog.fr} placeholder="https://www.lvanju.com/fr/catalogue" onChange={e => setCatalog({ ...catalog, fr: e.target.value })} /></label>
        <label><span>英语目录链接 {'{目录链接}'}</span><input className="bos-input" type="url" value={catalog.en} placeholder="https://www.lvanju.com/catalogue" onChange={e => setCatalog({ ...catalog, en: e.target.value })} /></label>
        {RULES.map(r => <label key={r.key}><span>{r.label}</span><input className="bos-input" type="number" min={0} step={r.step ?? 1} value={rules[r.key] as number}
          onChange={e => setRules({ ...rules, [r.key]: Number(e.target.value) })} />{r.hint && <small className="bos-radar-hint">{r.hint}</small>}</label>)}
        <label className="bos-radar-inline"><input type="checkbox" checked={rules.fairInvitation} onChange={e => setRules({ ...rules, fairInvitation: e.target.checked })} />使用广交会邀请版模板</label>
      </div>
      <div><Button variant="primary" disabled={busy} onClick={saveConfig}>保存国家与发信规则</Button></div>
    </Card>
  </div>;
}

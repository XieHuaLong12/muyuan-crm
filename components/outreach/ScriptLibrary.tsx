'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, PencilLine, Plus, Copy } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Header, Table } from '@/components/ui/bos';
import { api } from '@/lib/client';
import { GRADES, POSITION_LABELS, POSITIONS, QUALITIES, SCRIPT_LANGUAGES, SCRIPT_STATUSES, nextVersionCode, type OutreachConfig, type Position } from '@/lib/outreach';
import type { listScripts } from '@/services/outreach-script-service';

type Jsonify<T> = T extends Date ? string : T extends (infer U)[] ? Jsonify<U>[] : T extends object ? { [K in keyof T]: Jsonify<T[K]> } : T;
type Script = Jsonify<Awaited<ReturnType<typeof listScripts>>>[number];
type Form = { id: string | null; code: string; position: Position; grades: string[]; language: string; content: string; versionNote: string; status: string; templateName: string; buttons: { text: string; quality: string }[]; locked: boolean };
const STATUS_TONE: Record<string, 'green' | 'warning' | 'neutral'> = { WINNER: 'green', TESTING: 'neutral', RETIRED: 'warning' };

/** 话术库: one script per row, grouped by touch position. A script that went out is locked; changing it is a new version. */
export function ScriptLibrary({ scripts, config, admin, templateNames }: { scripts: Script[]; config: OutreachConfig; admin: boolean; templateNames: string[] }) {
  const router = useRouter();
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const codes = scripts.map(s => s.code);
  const blank = (position: Position = 'T0'): Form => ({ id: null, code: nextVersionCode(`${position}-A0`, codes), position, grades: ['A', 'B'], language: 'en', content: '', versionNote: '', status: 'TESTING', templateName: '', buttons: [], locked: false });
  const fromScript = (s: Script, version: boolean): Form => ({ id: version ? null : s.id, code: version ? nextVersionCode(s.code, codes) : s.code, position: s.position as Position, grades: s.grades, language: s.language,
    content: s.content, versionNote: version ? '' : s.versionNote, status: version ? 'TESTING' : s.status, templateName: version ? '' : s.templateName ?? '',
    buttons: Object.entries((s.buttonQualities as Record<string, string> | null) ?? {}).map(([text, quality]) => ({ text, quality })), locked: !version && s.locked });

  async function save() {
    if (!form) return;
    setBusy(true); setError(''); setMessage('');
    const buttonQualities = Object.fromEntries(form.buttons.filter(b => b.text.trim()).map(b => [b.text.trim(), b.quality]));
    const body = { grades: form.grades, language: form.language, versionNote: form.versionNote, status: form.status, templateName: form.templateName || null, buttonQualities,
      ...(form.locked ? {} : { content: form.content }) };
    try {
      if (form.id) await api(`outreach/scripts/${form.id}`, 'PATCH', body);
      else await api('outreach/scripts', 'POST', { ...body, code: form.code, position: form.position, content: form.content });
      setMessage(form.id ? `${form.code} 已保存` : `${form.code} 已加入话术库，${form.status === 'RETIRED' ? '' : '会参与同位置、同等级的轮流分配'}`);
      setForm(null); router.refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function setStatus(s: Script, status: string) {
    setBusy(true); setError(''); setMessage('');
    try { await api(`outreach/scripts/${s.id}`, 'PATCH', { status }); setMessage(`${s.code} 已改为「${SCRIPT_STATUSES[status as keyof typeof SCRIPT_STATUSES]}」`); router.refresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const byPosition = POSITIONS.map(position => ({ position, rows: scripts.filter(s => s.position === position) })).filter(g => g.rows.length);
  return <div className="bos-outreach">
    <Header title="话术库" description="一条话术一行。发出过一次后内容锁定，要改请新建版本（T0-A1 → T0-A2），否则新旧数据混在一起。模板需登记模板名，BOS 发送时直接带编号。"
      actions={admin ? <Button variant="primary" onClick={() => { setForm(blank()); setMessage(''); }}><Plus size={15} />新建话术</Button> : undefined} />
    {message && <p className="bos-outreach-message" role="status">{message}</p>}
    {error && <p className="bos-sales-error" role="alert">{error}</p>}

    {form && admin && <Card className="bos-outreach-form">
      <h2>{form.id ? `编辑 ${form.code}` : '新建话术'}</h2>
      <div className="bos-outreach-form-grid">
        <label><span>触达位置</span><select className="bos-input" value={form.position} disabled={!!form.id} onChange={e => { const position = e.target.value as Position; setForm({ ...form, position, code: nextVersionCode(`${position}-A0`, codes) }); }}>
          {POSITIONS.map(p => <option key={p} value={p}>{POSITION_LABELS[p]}</option>)}</select></label>
        <label><span>话术编号</span><input className="bos-input" value={form.code} disabled={!!form.id} maxLength={32} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} /></label>
        <label><span>语言</span><select className="bos-input" value={form.language} disabled={form.locked} onChange={e => setForm({ ...form, language: e.target.value })}>
          {Object.entries(SCRIPT_LANGUAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label><span>状态</span><select className="bos-input" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
          {Object.entries(SCRIPT_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <fieldset><legend>适用等级</legend>{GRADES.map(g => <label key={g} className="bos-wb-inline"><input type="checkbox" checked={form.grades.includes(g)}
          onChange={e => setForm({ ...form, grades: e.target.checked ? [...form.grades, g].sort() : form.grades.filter(x => x !== g) })} />{g} 类</label>)}</fieldset>
        <label><span>登记的模板名（可选）</span><input className="bos-input" list="approved-templates" value={form.templateName} maxLength={200} placeholder="例如 lvanju_hi_fb_en" onChange={e => setForm({ ...form, templateName: e.target.value })} />
          <datalist id="approved-templates">{templateNames.map(name => <option key={name} value={name} />)}</datalist></label>
      </div>
      <label className="bos-outreach-wide"><span>话术内容{form.locked && <><Lock size={12} aria-hidden="true" /> 已发出过，内容已锁定</>}</span>
        <textarea className="bos-input" rows={5} value={form.content} readOnly={form.locked} maxLength={4000} placeholder="发出的原文，可用 {客户名} {国家} {产品} {业务员}；模板用 {{1}} {{2}}"
          onChange={e => setForm({ ...form, content: e.target.value })} /></label>
      <label className="bos-outreach-wide"><span>版本说明（和上一版相比改了什么）</span><input className="bos-input" value={form.versionNote} maxLength={300} placeholder="例如 开场改为先问销售市场" onChange={e => setForm({ ...form, versionNote: e.target.value })} /></label>
      <fieldset className="bos-outreach-wide"><legend>模板快捷按钮 → 回复质量（客户点按钮时直接判定，不调用 DeepSeek）</legend>
        {form.buttons.map((b, i) => <div key={i} className="bos-outreach-button-row">
          <input className="bos-input" value={b.text} placeholder="按钮文字，如 Get a quote" aria-label={`按钮 ${i + 1} 文字`} onChange={e => setForm({ ...form, buttons: form.buttons.map((x, j) => j === i ? { ...x, text: e.target.value } : x) })} />
          <select className="bos-input" value={b.quality} aria-label={`按钮 ${i + 1} 回复质量`} onChange={e => setForm({ ...form, buttons: form.buttons.map((x, j) => j === i ? { ...x, quality: e.target.value } : x) })}>
            {Object.entries(QUALITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <Button variant="ghost" onClick={() => setForm({ ...form, buttons: form.buttons.filter((_, j) => j !== i) })}>移除</Button>
        </div>)}
        <Button variant="ghost" onClick={() => setForm({ ...form, buttons: [...form.buttons, { text: '', quality: 'HIGH' }] })}><Plus size={14} />添加按钮</Button>
      </fieldset>
      <div className="bos-wb-form-actions"><Button variant="primary" onClick={save} disabled={busy || !form.content.trim() || !form.grades.length}>{busy ? '保存中…' : '保存'}</Button><Button onClick={() => setForm(null)}>取消</Button></div>
    </Card>}

    {byPosition.length ? byPosition.map(group => <Card key={group.position} className="bos-outreach-library">
      <div className="bos-wb-section-head"><h2>{POSITION_LABELS[group.position]}</h2><small>{group.rows.filter(r => r.status !== 'RETIRED').length} 条参与轮换</small></div>
      <Table caption={`${POSITION_LABELS[group.position]} 话术`} headings={['编号', '适用等级 · 语言', '话术内容', '状态', '已发', admin ? '操作' : '创建']}>
        {group.rows.map(s => <tr key={s.id}>
          <td><strong>{s.code}</strong>{s.locked && <small><Lock size={11} aria-hidden="true" /> 已锁定</small>}</td>
          <td>{s.grades.join('、')} 类<small>{SCRIPT_LANGUAGES[s.language as keyof typeof SCRIPT_LANGUAGES] ?? s.language}{s.templateName ? ` · 模板 ${s.templateName}` : ''}</small></td>
          <td className="bos-outreach-content"><span>{s.content}</span>{s.versionNote && <small>版本说明：{s.versionNote}</small>}</td>
          <td>{admin ? <select className="bos-input bos-outreach-status" value={s.status} disabled={busy} aria-label={`${s.code} 状态`} onChange={e => setStatus(s, e.target.value)}>
            {Object.entries(SCRIPT_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select> : <Badge tone={STATUS_TONE[s.status]}>{SCRIPT_STATUSES[s.status as keyof typeof SCRIPT_STATUSES]}</Badge>}</td>
          <td>{s.touches}</td>
          <td>{admin ? <div className="bos-outreach-actions">
            <Button variant="ghost" onClick={() => { setForm(fromScript(s, false)); setMessage(''); }}><PencilLine size={14} />编辑</Button>
            <Button variant="ghost" onClick={() => { setForm(fromScript(s, true)); setMessage(''); }}><Copy size={14} />新建版本</Button>
          </div> : <small>{s.createdByName}</small>}</td>
        </tr>)}
      </Table>
    </Card>) : <Card><EmptyState title="话术库是空的" description="先登记两条 T0 首回话术（如 T0-A1、T0-A2），系统会对同一等级的新线索轮流分配，满 30 条后比较回复率。"
      action={admin ? <Button variant="primary" onClick={() => setForm(blank())}><Plus size={15} />新建话术</Button> : undefined} /></Card>}

    {admin && <Settings config={config} />}
  </div>;
}

const NUMBERS: { key: keyof OutreachConfig; label: string; unit: string; step?: number }[] = [
  { key: 'silentHours', label: '对话中 → 沉默期', unit: '小时' }, { key: 'dormantDays', label: 'T4 / R3 后转沉睡', unit: '天' },
  { key: 'minTouchGapHours', label: '两次主动触达最短间隔', unit: '小时' }, { key: 'templateCap', label: '同一线索模板上限', unit: '条' },
  { key: 'minSample', label: '比较门槛', unit: '条' }, { key: 'reviewConfidence', label: '低于此置信度进人工复核', unit: '0–1', step: 0.05 },
  { key: 'winProbability', label: '建议胜出', unit: '0–1', step: 0.01 }, { key: 'loseProbability', label: '建议停用', unit: '0–1', step: 0.01 },
  { key: 'nonStandardShare', label: '非标准话术提醒', unit: '0–1', step: 0.05 }, { key: 'overrideRate', label: '改判率提醒', unit: '0–1', step: 0.01 },
  { key: 'firstReplyMinutes', label: '新线索首回时限', unit: '分钟' }, { key: 'hotReplyHours', label: 'A 类 / 高意向回复处理时限', unit: '小时', step: 0.5 },
  { key: 'replyRateDropPoints', label: '回复率下滑信号', unit: '个百分点' }, { key: 'businessShareDropPoints', label: '企业线索占比下滑信号', unit: '个百分点' },
  { key: 'staleQuoteCount', label: '报价停滞信号', unit: '位客户' }, { key: 'slowFirstReplyCount', label: '响应变慢信号', unit: '条线索' },
  { key: 'energyDeviationPoints', label: '精力分配偏离', unit: '个百分点' },
];

function Settings({ config }: { config: OutreachConfig }) {
  const [value, setValue] = useState(config);
  const [state, setState] = useState<{ busy: boolean; message: string; error: string }>({ busy: false, message: '', error: '' });
  async function save() {
    setState({ busy: true, message: '', error: '' });
    try { const r = await api<{ config: OutreachConfig }>('outreach/settings', 'PUT', value); setValue(r.config); setState({ busy: false, message: '参数已保存，下一次计算起生效', error: '' }); }
    catch (e) { setState({ busy: false, message: '', error: (e as Error).message }); }
  }
  const list = (key: 'followUpDays' | 'reviveDays', label: string) => <label><span>{label}（天）</span><input className="bos-input" value={value[key].join(' / ')}
    onChange={e => setValue({ ...value, [key]: e.target.value.split(/[\/,，\s]+/).filter(Boolean).map(Number) })} /></label>;
  return <Card className="bos-outreach-settings">
    <h2>统计与判定参数</h2>
    <p className="bos-wb-muted">需求里的 72 小时、7 天、30 条、90% 等都是默认值，可以在这里调整。</p>
    <div className="bos-outreach-form-grid">
      {NUMBERS.map(n => <label key={n.key}><span>{n.label}（{n.unit}）</span><input className="bos-input" type="number" step={n.step ?? 1} value={value[n.key] as number}
        onChange={e => setValue({ ...value, [n.key]: Number(e.target.value) })} /></label>)}
      {list('followUpDays', '跟进节奏 T1–T4，从 T0 算')}
      {list('reviveDays', '唤醒节奏 R1–R3，从进入沉默期算')}
      <label><span>精力目标 转化 / 前端 / 数据（%）</span><input className="bos-input" value={`${value.energyTargets.CONVERT} / ${value.energyTargets.FRONTEND} / ${value.energyTargets.DATA}`}
        onChange={e => { const [CONVERT, FRONTEND, DATA] = e.target.value.split(/[\/,，\s]+/).filter(Boolean).map(Number); setValue({ ...value, energyTargets: { CONVERT, FRONTEND, DATA } }); }} /></label>
    </div>
    {state.message && <p className="bos-outreach-message" role="status">{state.message}</p>}
    {state.error && <p className="bos-sales-error" role="alert">{state.error}</p>}
    <div className="bos-wb-form-actions"><Button variant="primary" onClick={save} disabled={state.busy}>{state.busy ? '保存中…' : '保存参数'}</Button></div>
  </Card>;
}

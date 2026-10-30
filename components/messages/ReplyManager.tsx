'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Sparkles } from 'lucide-react';
import { Header, Card, Table, Badge, Button, EmptyState, Typography } from '@/components/ui/bos';
import { api } from '@/lib/client';
import { QUICK_REPLY_CATEGORIES, REPLY_LANGUAGES, REPLY_VARIABLES, containsPrice, type ReplyBodies, type ReplyLanguage } from '@/lib/quick-replies';

export type ReplyRow = { id: string; scope: 'SHARED' | 'MINE'; title: string; category: string; zh: string; bodies: ReplyBodies; useCount: number; top: boolean };
type Form = { scope: 'SHARED' | 'MINE'; title: string; category: string; zh: string; bodies: Record<ReplyLanguage, string> };
const LANGUAGES = Object.keys(REPLY_LANGUAGES) as ReplyLanguage[];
const EMPTY: Form = { scope: 'MINE', title: '', category: 'LEAD_TIME', zh: '', bodies: { fr: '', en: '', ar: '' } };

/**
 * 常用回复 management: write the Chinese once, let AI draft the French, English and Arabic versions, read them over,
 * save. Administrators keep the company's replies; everyone keeps their own.
 */
export function ReplyManager({ initial, canShare, startNew }: { initial: ReplyRow[]; canShare: boolean; startNew: boolean }) {
  const [rows, setRows] = useState(initial);
  const [scope, setScope] = useState<'SHARED' | 'MINE'>(canShare ? 'SHARED' : 'MINE');
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('');
  useEffect(() => { if (startNew) open('new'); }, [startNew]); // eslint-disable-line react-hooks/exhaustive-deps

  function open(row: ReplyRow | 'new') {
    setError(''); setMessage('');
    setEditing(row === 'new' ? 'new' : row.id);
    setForm(row === 'new' ? { ...EMPTY, scope: canShare && scope === 'SHARED' ? 'SHARED' : 'MINE' }
      : { scope: row.scope, title: row.title, category: row.category, zh: row.zh, bodies: { fr: row.bodies.fr ?? '', en: row.bodies.en ?? '', ar: row.bodies.ar ?? '' } });
  }
  async function reload() {
    const r = await api<{ replies: ReplyRow[] }>('quick-replies');
    setRows(r.replies);
  }
  async function draft() {
    // Only the empty versions, so nothing a person corrected is overwritten; all of them when none is empty.
    const empty = LANGUAGES.filter(l => !form.bodies[l].trim());
    setBusy('draft'); setError('');
    try {
      const r = await api<ReplyBodies>('quick-replies/draft', 'POST', { zh: form.zh, languages: empty.length ? empty : LANGUAGES });
      setForm(f => ({ ...f, bodies: { ...f.bodies, ...Object.fromEntries(Object.entries(r).filter(([, text]) => text)) } }));
      setMessage('AI 初稿已填好，请逐条看一遍、改好再保存');
    } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }
  async function save() {
    setBusy('save'); setError(''); setMessage('');
    try {
      if (editing === 'new') await api('quick-replies', 'POST', form);
      else await api(`quick-replies/${editing}`, 'PATCH', { title: form.title, category: form.category, zh: form.zh, bodies: form.bodies });
      await reload(); setScope(form.scope); setEditing(null); setMessage(`已保存「${form.title}」`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }
  async function remove(row: ReplyRow) {
    if (!window.confirm(`删除「${row.title}」？`)) return;
    setBusy(`delete-${row.id}`); setError('');
    try { await api(`quick-replies/${row.id}`, 'DELETE'); setRows(list => list.filter(r => r.id !== row.id)); setMessage(`已删除「${row.title}」`); }
    catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }

  const priced = [form.zh, ...Object.values(form.bodies)].some(containsPrice);
  const shown = rows.filter(r => r.scope === scope);
  const editable = (row: ReplyRow) => row.scope === 'MINE' || canShare;
  return <>
    <Header title="常用回复" description="交期、起订量、运费、付款这些常问的问题，中文写一次、各语言版本存好；聊天里点一下（或在输入框打 /）就填进输入框，改几个字再发。"
      actions={<><Link href="/messages" className="bos-button">回到消息</Link>{!editing && <Button variant="primary" onClick={() => open('new')}><Plus size={15} /> 新建回复</Button>}</>} />

    {editing && <Card className="bos-freight-form">
      <Typography as="h2" variant="heading">{editing === 'new' ? '新建常用回复' : `修改「${rows.find(r => r.id === editing)?.title ?? ''}」`}</Typography>
      <div className="bos-quote-grid">
        <label className="bos-quote-field bos-quote-grow"><span>标题 *（自己看的，比如「交期 · 下单后 25–30 天」）</span><input className="bos-input" value={form.title} maxLength={60} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
        <label className="bos-quote-field"><span>分类</span>
          <select className="bos-input" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
            {Object.entries(QUICK_REPLY_CATEGORIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
        {editing === 'new' && canShare && <label className="bos-quote-field"><span>给谁用</span>
          <select className="bos-input" value={form.scope} onChange={e => setForm({ ...form, scope: e.target.value as Form['scope'] })}>
            <option value="SHARED">公司共用（所有人）</option><option value="MINE">只有我</option>
          </select></label>}
        <label className="bos-quote-field bos-quote-grow"><span>中文 *（可以用 {REPLY_VARIABLES.join('、')}，发的时候自动换成客户名字和你的名字）</span>
          <textarea className="bos-input" rows={3} value={form.zh} maxLength={1000} onChange={e => setForm({ ...form, zh: e.target.value })} /></label>
      </div>
      <div className="bos-quote-action-row">
        <Button disabled={busy === 'draft' || !form.zh.trim()} onClick={() => void draft()}><Sparkles size={14} /> {busy === 'draft' ? 'AI 翻译中…' : 'AI 生成各语言初稿'}</Button>
        <small>AI 只出初稿，看过、改好再保存。客户是哪种语言就填哪种；还没有的语言先填英语版。</small>
      </div>
      <div className="bos-quote-grid">
        {LANGUAGES.map(language => <label key={language} className="bos-quote-field bos-quote-grow"><span>{REPLY_LANGUAGES[language]}版</span>
          <textarea className="bos-input" rows={3} dir={language === 'ar' ? 'rtl' : undefined} value={form.bodies[language]} maxLength={2000}
            onChange={e => setForm({ ...form, bodies: { ...form.bodies, [language]: e.target.value } })} /></label>)}
      </div>
      {priced && <p className="bos-sales-error" role="alert">常用回复里不放价格：价格、折扣请用报价单发，避免发出过期或前后不一致的价格。</p>}
      {error && <p className="bos-sales-error" role="alert">{error}</p>}
      {message && <p className="bos-quote-message" role="status">{message}</p>}
      <div className="bos-quote-action-row">
        <Button variant="primary" disabled={busy === 'save' || !form.title.trim() || !form.zh.trim() || priced} onClick={() => void save()}>{busy === 'save' ? '保存中…' : '保存'}</Button>
        <Button onClick={() => setEditing(null)}>取消</Button>
      </div>
    </Card>}

    <Card>
      <div className="bos-tabs" role="tablist" aria-label="回复范围">
        <button type="button" role="tab" aria-selected={scope === 'SHARED'} onClick={() => setScope('SHARED')}>公司共用 <span>{rows.filter(r => r.scope === 'SHARED').length}</span></button>
        <button type="button" role="tab" aria-selected={scope === 'MINE'} onClick={() => setScope('MINE')}>我的 <span>{rows.filter(r => r.scope === 'MINE').length}</span></button>
      </div>
      {!editing && message && <p className="bos-quote-message" role="status">{message}</p>}
      {!editing && error && <p className="bos-sales-error" role="alert">{error}</p>}
      {!shown.length ? <EmptyState title={scope === 'SHARED' ? '还没有公司共用的回复' : '还没有自己的常用回复'}
        description={scope === 'SHARED' && !canShare ? '管理员添加后会出现在这里。你可以先存自己的常用回复。' : '点「新建回复」，写好中文，让 AI 出各语言初稿。'} />
        : <Table caption="常用回复" headings={['标题', '分类', '中文', '语言版本', '用过', '操作']}>
          {shown.map(row => <tr key={row.id}>
            <td><strong>{row.title}</strong>{row.top && <> <Badge tone="warning">最常用</Badge></>}</td>
            <td>{QUICK_REPLY_CATEGORIES[row.category as keyof typeof QUICK_REPLY_CATEGORIES] ?? row.category}</td>
            <td style={{ maxWidth: 360, whiteSpace: 'pre-wrap' }}>{row.zh}</td>
            <td>{LANGUAGES.map(l => <span key={l} style={{ marginRight: 4 }}><Badge tone={row.bodies[l] ? 'green' : 'neutral'}>{l.toUpperCase()}{row.bodies[l] ? '' : ' 缺'}</Badge></span>)}</td>
            <td>{row.useCount} 次</td>
            <td>{editable(row) ? <div className="bos-quote-action-row" style={{ flexWrap: 'nowrap' }}>
              <Button variant="ghost" onClick={() => open(row)}>编辑</Button>
              <Button variant="ghost" disabled={busy === `delete-${row.id}`} onClick={() => void remove(row)}>删除</Button>
            </div> : '—'}</td>
          </tr>)}
        </Table>}
    </Card>
  </>;
}

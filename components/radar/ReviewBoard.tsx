'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, ExternalLink } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Header } from '@/components/ui/bos';
import { api } from '@/lib/client';
import type { reviewSends } from '@/services/radar-queue-service';

type Jsonify<T> = T extends Date ? string : T extends (infer U)[] ? Jsonify<U>[] : T extends object ? { [K in keyof T]: Jsonify<T[K]> } : T;
type Send = Jsonify<Awaited<ReturnType<typeof reviewSends>>>[number];

/**
 * 待复核 · 待审核的信: AI-written openings and, in the first two weeks, whole first mails wait here for a person. Each
 * opening sits next to the site quotes it was written from, so the reviewer can check it says nothing that is not true.
 */
export function ReviewBoard({ sends, tabs, replies }: { sends: Send[]; tabs?: React.ReactNode; replies?: React.ReactNode }) {
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function run(task: () => Promise<string>) {
    setBusy(true); setError(''); setMessage('');
    try { setMessage(await task()); setPicked([]); router.refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const save = (s: Send) => api(`radar/sends/${s.id}`, 'PATCH', { action: 'edit', opening: drafts[s.id] });
  const changed = (s: Send) => drafts[s.id] !== undefined && drafts[s.id] !== s.opening;

  return <div className="bos-radar">
    <Header title="待复核" description="发出前：AI 写的个性化开头必须人工通过才会发出，上线后两周内每封第 1 封信都整封审核。收到后：AI 拿不准的回复由人判断有效或无效。" />
    {tabs}
    {replies}
    {message && <p className="bos-radar-message" role="status">{message}</p>}
    {error && <p className="bos-sales-error" role="alert">{error}</p>}
    {!replies && sends.length > 0 && <div className="bos-radar-toolbar"><span>{sends.length} 封等待审核</span>
      <span><label className="bos-radar-inline"><input type="checkbox" checked={picked.length === sends.length} onChange={e => setPicked(e.target.checked ? sends.map(s => s.id) : [])} />全选</label>
        <Button variant="primary" disabled={busy || !picked.length} onClick={() => run(async () => {
          const r = await api<{ approved: number; skipped: number }>('radar/sends/approve', 'POST', { ids: picked });
          return `已通过 ${r.approved} 封${r.skipped ? `，${r.skipped} 封没通过（有没填的变量或状态已变）` : ''}`;
        })}><Check size={15} aria-hidden="true" />通过选中的 {picked.length} 封</Button></span></div>}
    {replies ? null : !sends.length ? <Card><EmptyState title="没有等待审核的信" description="加入发送队列的信写好个性化开头后会出现在这里。" action={<Link className="bos-button bos-button-secondary" href="/radar/queue">看发送队列</Link>} /></Card>
      : <div className="bos-radar-review">{sends.map(s => <Card key={s.id} className="bos-radar-review-card">
        <div className="bos-radar-card-head">
          <label className="bos-radar-inline"><input type="checkbox" checked={picked.includes(s.id)} onChange={e => setPicked(list => e.target.checked ? [...list, s.id] : list.filter(id => id !== s.id))} />
            <strong>{s.prospect.name}</strong></label>
          <span>{s.openingSource === 'AI' && <Badge tone="warning">AI 开头</Badge>} {s.wholeMail && <Badge>整封审核</Badge>} <Badge>{s.templateCode}</Badge></span>
        </div>
        <p className="bos-radar-meta">{[s.prospect.city, s.prospect.countryName].filter(Boolean).join(' · ')} · {s.toAddress}
          {s.prospect.website && <> · <a href={s.prospect.website.startsWith('http') ? s.prospect.website : `https://${s.prospect.website}`} target="_blank" rel="noreferrer noopener">官网 <ExternalLink size={11} aria-hidden="true" /></a></>}</p>
        {s.prospect.facts.length > 0 && <div className="bos-radar-facts"><span>官网原文</span>{s.prospect.facts.map((f, i) => <p key={i}>{f.fact}<small>“{f.quote}”</small></p>)}</div>}
        {s.step === 1 && <label className="bos-radar-field"><span>个性化开头（不需要时清空，信会用不带开头的版本）</span>
          <input className="bos-input" value={drafts[s.id] ?? s.opening} maxLength={500} onChange={e => setDrafts({ ...drafts, [s.id]: e.target.value })} /></label>}
        <p><strong>{s.subject}</strong></p>
        <pre className="bos-radar-mail">{s.body}</pre>
        <div className="bos-radar-actions">
          <Button variant="primary" disabled={busy} onClick={() => run(async () => { if (changed(s)) await save(s); await api(`radar/sends/${s.id}`, 'PATCH', { action: 'approve' }); return `${s.prospect.name} 已通过，进入发送队列`; })}>
            <Check size={15} aria-hidden="true" />{changed(s) ? '保存并通过' : '通过'}</Button>
          {changed(s) && <Button disabled={busy} onClick={() => run(async () => { await save(s); return '开头已保存，正文已按模板重新生成'; })}>只保存</Button>}
          <Button variant="ghost" disabled={busy} onClick={() => run(async () => { await api(`radar/sends/${s.id}`, 'PATCH', { action: 'cancel' }); return `已取消发给 ${s.prospect.name} 的信`; })}>不发了</Button>
        </div>
      </Card>)}</div>}
  </div>;
}

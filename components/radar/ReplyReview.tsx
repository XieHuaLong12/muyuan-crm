'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X } from 'lucide-react';
import { Badge, Button, Card, EmptyState } from '@/components/ui/bos';
import { api, dateTimeText } from '@/lib/client';
import { INTENTS, REPLY_CATEGORIES } from '@/lib/radar-reply';
import type { reviewReplies } from '@/services/radar-inbox-service';

type Jsonify<T> = T extends Date ? string : T extends (infer U)[] ? Jsonify<U>[] : T extends object ? { [K in keyof T]: Jsonify<T[K]> } : T;
type Reply = Jsonify<Awaited<ReturnType<typeof reviewReplies>>>[number];
const INVALID = ['NOT_INTERESTED', 'UNSUBSCRIBE', 'AUTO_REPLY', 'BOUNCE', 'UNRELATED'] as const;
const VALID = ['QUOTE', 'INTERESTED', 'QUESTION', 'REFERRAL'] as const;
const EXTRACTED: Record<string, string> = { contactName: '联系人', title: '职位', phone: '电话', whatsapp: 'WhatsApp', email: '新邮箱', products: '关注产品', quantity: '数量', targetPrice: '目标价', timeline: '时间要求' };

/**
 * 待复核 · 回复: replies the AI was unsure about (or, in the first two weeks, every valid one), next to what the AI made of
 * them. 有效 pushes the reply into the customer center; 无效 with a category is handled as that category.
 */
export function ReplyReview({ replies }: { replies: Reply[] }) {
  const router = useRouter();
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function decide(r: Reply, body: Record<string, string>, done: string) {
    setBusy(true); setError(''); setMessage('');
    try { await api(`radar/review/${r.id}`, 'POST', body); setMessage(done); router.refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (!replies.length) return <Card><EmptyState title="没有等待复核的回复" description="AI 拿不准的回复、上线后两周内判为有效的回复、推进 BOS 失败的回复会出现在这里。" /></Card>;
  return <div className="bos-radar-review">
    {message && <p className="bos-radar-message" role="status">{message}</p>}
    {error && <p className="bos-sales-error" role="alert">{error}</p>}
    {replies.map(r => {
      const valid = (VALID as readonly string[]).includes(r.category);
      const extracted = Object.entries(r.extracted ?? {}).filter(([, v]) => v);
      return <Card key={r.id} className="bos-radar-review-card">
        <div className="bos-radar-card-head"><strong>{r.prospect.name}</strong>
          <span>{r.pushStatus === 'FAILED' ? <Badge tone="warning">推进 BOS 失败</Badge> : r.category ? <Badge tone={valid ? 'green' : 'neutral'}>AI：{r.categoryLabel}{r.confidence !== null ? ` · ${Math.round(r.confidence * 100)}%` : ''}</Badge> : null}
            {r.intent && <> <Badge>意向{INTENTS[r.intent as keyof typeof INTENTS]}</Badge></>}</span></div>
        <p className="bos-radar-meta">{r.fromName ? `${r.fromName} ` : ''}&lt;{r.fromAddress}&gt; · {dateTimeText(r.receivedAt)}{r.send ? ` · 回复 ${r.send.templateCode} 第 ${r.send.step} 封` : ''}</p>
        {r.summary && <p className="bos-radar-fact">{r.summary}</p>}
        {extracted.length > 0 && <p className="bos-radar-meta">{extracted.map(([k, v]) => `${EXTRACTED[k] ?? k}：${v}`).join(' · ')}</p>}
        {r.analyzeError && <p className="bos-radar-error">AI 没有读出结果：{r.analyzeError}</p>}
        {r.pushError && <p className="bos-radar-error">{r.pushError}</p>}
        <p><strong>{r.subject}</strong></p>
        <pre className="bos-radar-mail">{r.text || '（正文为空）'}</pre>
        {r.pushStatus === 'FAILED' ? <div className="bos-radar-actions"><Button variant="primary" disabled={busy} onClick={() => decide(r, { verdict: 'RETRY_PUSH' }, '已重新推进 BOS')}>重新推进 BOS</Button></div>
          : <div className="bos-radar-actions">
            <Button variant="primary" disabled={busy} onClick={() => decide(r, { verdict: 'VALID', ...(valid ? {} : { category: 'INTERESTED' }) }, `${r.prospect.name} 的回复已判为有效，进入客户库`)}>
              <Check size={15} aria-hidden="true" />有效，推进 BOS</Button>
            <select className="bos-input bos-radar-status" aria-label="无效回复的分类" value={choice[r.id] ?? ''} onChange={e => setChoice({ ...choice, [r.id]: e.target.value })}>
              <option value="">无效，选分类…</option>{INVALID.map(c => <option key={c} value={c}>{REPLY_CATEGORIES[c]}</option>)}</select>
            <Button disabled={busy || !choice[r.id]} onClick={() => decide(r, { verdict: 'INVALID', category: choice[r.id] }, `已按「${REPLY_CATEGORIES[choice[r.id] as keyof typeof REPLY_CATEGORIES]}」处理`)}>
              <X size={15} aria-hidden="true" />按无效处理</Button>
          </div>}
      </Card>;
    })}
  </div>;
}

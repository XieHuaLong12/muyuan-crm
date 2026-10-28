'use client';
import { useCallback, useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Badge, Button } from '@/components/ui/bos';
import { api } from '@/lib/client';
import type { enqueueProspects, previewEnqueue } from '@/services/radar-queue-service';

type Jsonify<T> = T extends Date ? string : T extends (infer U)[] ? Jsonify<U>[] : T extends object ? { [K in keyof T]: Jsonify<T[K]> } : T;
type Preview = Jsonify<Awaited<ReturnType<typeof previewEnqueue>>>;
export type EnqueueResult = Jsonify<Awaited<ReturnType<typeof enqueueProspects>>>;
export type Selection = { ids: string[] } | { preset: 'TODAY_A' };

const when = (iso: string, tz: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: tz, month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

/**
 * 加入发送队列 确认框 (docs/CUSTOMER_RADAR_COLD_EMAIL.md §6): what will go, what is skipped and why, which language, and
 * when the queue would be done. Confirming is the human send of the sequence (PROJECT_RULES §0.5.4).
 */
export function EnqueueDialog({ selection, onClose, onDone }: { selection: Selection | null; onClose: () => void; onDone: (result: EnqueueResult) => void }) {
  const [language, setLanguage] = useState<'auto' | 'fr' | 'en'>('auto');
  const [review, setReview] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async (lang: 'auto' | 'fr' | 'en') => {
    if (!selection) return;
    setBusy(true); setError('');
    try { const p = await api<Preview>('radar/queue/preview', 'POST', { ...selection, language: lang }); setPreview(p); setReview(p.review.default); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, [selection]);
  useEffect(() => { setPreview(null); setLanguage('auto'); void load('auto'); }, [load]);

  async function confirm() {
    if (!selection) return;
    setBusy(true); setError('');
    try { onDone(await api<EnqueueResult>('radar/queue', 'POST', { ...selection, language, review })); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const p = preview;
  return <Dialog open={!!selection} onClose={onClose} title="加入发送队列" className="bos bos-radar-dialog">
    {!p ? <p className="bos-radar-hint">{error || '正在计算…'}</p> : <div className="bos-radar-confirm">
      <p className="bos-radar-confirm-lead">选中 {p.selected} 家，将发送 <strong>{p.ready}</strong> 封第 1 封信</p>
      {p.skipped.length > 0 && <p>跳过 {p.skipped.reduce((sum, s) => sum + s.count, 0)} 家：{p.skipped.map(s => `${s.label} ${s.count}`).join(' · ')}</p>}
      <fieldset><legend>模板组</legend>
        {(['auto', 'fr', 'en'] as const).map(value => <label key={value} className="bos-radar-inline"><input type="radio" name="radar-language" checked={language === value} disabled={busy}
          onChange={() => { setLanguage(value); void load(value); }} />{value === 'auto' ? `按国家自动（法语 ${p.languages.fr} · 英语 ${p.languages.en}）` : value === 'fr' ? '全部法语' : '全部英语'}</label>)}
      </fieldset>
      <p>{p.mailboxes === 0 ? <Badge tone="warning">还没有可用的发信邮箱，先到 设置 · 客户雷达 连接邮箱</Badge>
        : p.estimate ? <>共 {p.ready} 封，按当前每天 {p.dailyCapacity} 封的速度，预计 <strong>{when(p.estimate.finishAt, p.estimate.recipientTimezone)}</strong>（客户当地时间）前发完，即北京时间 {when(p.estimate.finishAt, p.estimate.companyTimezone)}。</>
          : p.ready ? <Badge tone="warning">按当前额度两周内发不完{p.unplanned ? `（${p.unplanned} 封排到两周以后）` : ''}</Badge> : null}</p>
      <label className="bos-radar-inline"><input type="checkbox" checked={review || p.review.forced} disabled={p.review.forced} onChange={e => setReview(e.target.checked)} />
        发送前人工审核整封信{p.review.forced ? '（上线后两周内必须审核）' : ''}</label>
      <p className="bos-radar-hint">AI 写的个性化开头始终要人工通过才会发出。信会按每个邮箱的额度、6–15 分钟的随机间隔，在客户当地工作日 9:00–16:30 慢慢发出。</p>
      {error && <p className="bos-sales-error" role="alert">{error}</p>}
      <div className="bos-radar-confirm-actions"><Button onClick={onClose}>取消</Button>
        <Button variant="primary" disabled={busy || p.ready === 0} onClick={confirm}>加入发送队列</Button></div>
    </div>}
  </Dialog>;
}

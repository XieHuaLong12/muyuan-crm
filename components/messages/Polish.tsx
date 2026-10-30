'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleAlert, Loader2, RefreshCw, X } from 'lucide-react';
import { api } from '@/lib/client';

export type Suggestion = { angle: string; text: string; zh: string; why: string; warnings: string[] };
type Answer = { suggestions: Suggestion[]; priceAsked: boolean };

/**
 * 优化话术 above the composer: three ways to say what is in the input box, in the customer's language, each with its
 * Chinese and what changed. 用这条 only fills the input; 换一批 asks for three different ones.
 */
export function PolishPanel({ customerId, text, onUse, onClose }: { customerId: string; text: string; onUse: (suggestion: Suggestion) => void; onClose: () => void }) {
  const [answer, setAnswer] = useState<Answer>();
  const [busy, setBusy] = useState(true), [error, setError] = useState('');
  // The line the suggestions were made for; editing the input afterwards does not reload them.
  const source = useRef(text), latest = useRef(0);
  const load = useCallback(async (avoid: string[] = []) => {
    // Only the newest request's answer is shown (换一批 clicked twice, or a slow first answer).
    const request = ++latest.current;
    setBusy(true); setError('');
    try { const r = await api<Answer>('inbox/polish', 'POST', { customerId, text: source.current, avoid }); if (request === latest.current) setAnswer(r); }
    catch (e) { if (request === latest.current) setError((e as Error).message); } finally { if (request === latest.current) setBusy(false); }
  }, [customerId]);
  useEffect(() => { void load(); }, [load]);

  return <div className="bos-chat-panel bos-chat-polish" role="dialog" aria-label="优化话术" aria-busy={busy}>
    <div className="bos-chat-panel-head">
      <strong>优化话术{answer ? ` · ${answer.suggestions.length} 条建议` : ''}</strong>
      <small>按客户的语言写，参考最近的聊天；点「用这条」才填进输入框</small>
      <span style={{ flex: 1 }} />
      <button type="button" className="bos-chat-polish-again" disabled={busy} onClick={() => load(answer?.suggestions.map(s => s.text) ?? [])}><RefreshCw size={13} aria-hidden="true" />换一批</button>
      <button type="button" className="bos-chat-icon-button" onClick={onClose} aria-label="关闭优化话术"><X size={16} /></button>
    </div>
    {answer?.priceAsked && <p className="bos-chat-panel-note"><b>客户在问价格。</b>建议里不会写具体价格；要报价请用「报价单」，价格从产品库来。</p>}
    {busy && <p className="bos-chat-polish-wait" role="status"><Loader2 size={15} aria-hidden="true" />正在想三种写法，大约 3–5 秒…</p>}
    {error && <p className="bos-chat-error" role="alert">{error}</p>}
    {!busy && answer && <div className="bos-chat-polish-list">
      {answer.suggestions.map((s, i) => <div key={i} className="bos-chat-polish-card">
        <span className={`bos-chat-polish-angle is-${i}`}>{s.angle}</span>
        <p className="bos-chat-polish-text">{s.text}</p>
        {s.zh && s.zh !== s.text && <p className="bos-chat-polish-zh">中文：{s.zh}</p>}
        {s.why && <p className="bos-chat-polish-why">改了什么：{s.why}</p>}
        {s.warnings.length > 0 && <p className="bos-chat-polish-warn"><CircleAlert size={13} aria-hidden="true" />发送前请核对：{s.warnings.join('；')}</p>}
        <button type="button" onClick={() => onUse(s)}>用这条</button>
      </div>)}
    </div>}
  </div>;
}

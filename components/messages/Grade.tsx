'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/client';
import { formatDateTime } from './types';

/**
 * Customer grade as the avatar (customers have no photo): A orange and B blue solid, C light green, D grey,
 * dashed 未评 when there is none. The same four grades as lib/lead-grade.ts.
 */
export const GRADE_INFO = {
  A: { word: '优质', follow: '重点跟进' },
  B: { word: '良好', follow: '优先跟进' },
  C: { word: '一般', follow: '正常跟进' },
  D: { word: '无效', follow: '不用跟进' },
} as const;
type Letter = keyof typeof GRADE_INFO;
const isLetter = (grade: string): grade is Letter => grade in GRADE_INFO;
const UNDO_MS = 6_000;

/** What the avatar's tooltip says: the grade, what it means and why. */
export function gradeTitle(grade: string, reason = '') {
  if (!isLetter(grade)) return '还没评级，点开客户可以定等级';
  return `${grade} 类 · ${GRADE_INFO[grade].word}，${GRADE_INFO[grade].follow}${reason ? `\n${reason}` : ''}`;
}

export function GradeAvatar({ grade, reason = '', size = '' }: { grade: string; reason?: string; size?: '' | 'large' | 'small' }) {
  const letter = isLetter(grade) ? grade : '';
  return <span className={`bos-chat-avatar bos-chat-grade is-${letter || 'none'}${size ? ` is-${size}` : ''}`} title={gradeTitle(grade, reason)}
    role="img" aria-label={letter ? `${letter} 类客户` : '未评级'}>{letter || '未评'}</span>;
}

/** The follow-up chip next to the name in the chat header: "B 类 · 优先跟进". */
export function GradeFollow({ grade }: { grade: string }) {
  if (!isLetter(grade)) return null;
  return <span className={`bos-chat-grade-follow is-${grade}`}>{grade} 类 · {GRADE_INFO[grade].follow}</span>;
}

export const GRADE_FILTERS = [{ key: 'A', label: 'A' }, { key: 'B', label: 'B' }, { key: 'C', label: 'C' }, { key: 'D', label: 'D' }, { key: 'none', label: '未评' }] as const;

/** A B C D 未评 above the list, several at once; works together with the other filters. */
export function GradeFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const on = value ? value.split(',') : [];
  const toggle = (key: string) => onChange(GRADE_FILTERS.map(f => f.key).filter(k => k === key ? !on.includes(k) : on.includes(k)).join(','));
  return <div className="bos-chat-grade-filter" role="group" aria-label="按客户等级筛选">
    <span>等级</span>
    {GRADE_FILTERS.map(f => <button key={f.key} type="button" className={`is-${f.key}`} aria-pressed={on.includes(f.key)} onClick={() => toggle(f.key)}
      title={f.key === 'none' ? '只看未评级（可以多选）' : `只看 ${f.key} 类（可以多选）`}>{f.label}</button>)}
    {on.length > 0 && <button type="button" className="bos-chat-link" onClick={() => onChange('')}>清除</button>}
  </div>;
}

type Suggestion = { id: string; gradeSuggestion: string; reason: string; receivedAt: string } | null;
type Undo = { grade: string; source: string; reason: string; gradedAt: string | null; setGrade: string; replyIds: string[] };
const SOURCE_LABELS: Record<string, string> = { AI: 'AI 判定', RULE: '规则判定', HUMAN: '人工调整' };

/**
 * The chat header's avatar: click it to see why the customer has this grade and who set it, change it with one
 * click (6 seconds to undo), or accept / dismiss DeepSeek's suggestion from the customer's latest reply.
 */
export function GradeControl({ customerId, grade, reason, source, gradedAt, suggestion, timezone, onChanged }: {
  customerId: string; grade: string; reason: string; source: string; gradedAt: string | null; suggestion: Suggestion; timezone: string; onChanged: () => void;
}) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [toast, setToast] = useState<{ text: string; undo: Undo | null } | null>(null);
  // A change shows at once, until the reloaded chat brings the saved grade.
  const [shown, setShown] = useState<{ over: string; to: string } | null>(null);
  const current = shown && shown.over === grade ? shown.to : grade;
  const box = useRef<HTMLDivElement>(null), timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape); };
  }, [open]);

  function show(text: string, undo: Undo | null) {
    clearTimeout(timer.current);
    setToast({ text, undo });
    timer.current = setTimeout(() => setToast(null), UNDO_MS);
  }
  async function decide(body: Record<string, unknown>, text: (to: string) => string, undoable: boolean) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const r = await api<{ grade: string | null; undo: Undo | null }>('outreach/grade', 'POST', { customerId, ...body });
      if (r.grade !== null) setShown({ over: grade, to: r.grade });
      setOpen(false);
      show(text(r.grade ?? current), undoable ? r.undo : null);
      onChanged();
    } catch (e) { setError((e as Error).message); setOpen(true); } finally { setBusy(false); }
  }
  const pick = (to: string) => { if (to !== current) void decide({ action: 'SET', grade: to }, g => `已改为 ${g} 类`, true); };
  const undo = () => { if (toast?.undo) void decide({ action: 'UNDO', undo: toast.undo }, g => `已撤销，回到${isLetter(g) ? ` ${g} 类` : '未评级'}`, false); };
  const letter = isLetter(current) ? current : '';
  const offered = suggestion && suggestion.gradeSuggestion !== current ? suggestion : null;

  return <div className="bos-chat-grade-control" ref={box}>
    <button type="button" className={`bos-chat-avatar bos-chat-grade is-${letter || 'none'}`} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(v => !v)}
      aria-label={`客户等级：${letter ? `${letter} 类 · ${GRADE_INFO[letter].word}` : '未评级'}，点开看依据或修改`}>{letter || '未评'}</button>
    {offered && <span className="bos-chat-grade-dot" aria-hidden="true" title={`AI 建议改为 ${offered.gradeSuggestion} 类`} />}
    {open && <div className="bos-chat-grade-pop" role="dialog" aria-label="客户等级">
      {offered && <div className="bos-chat-grade-suggest">
        <div><GradeAvatar grade={offered.gradeSuggestion} size="small" /><strong>AI 建议改为 {offered.gradeSuggestion} 类</strong></div>
        {offered.reason && <p>{offered.reason}（{formatDateTime(offered.receivedAt, timezone)} 的回复）</p>}
        <div className="bos-chat-actions">
          <button type="button" className="is-primary" disabled={busy} onClick={() => decide({ action: 'ACCEPT', replyId: offered.id }, g => `已接受 AI 建议，改为 ${g} 类`, true)}>接受，改为 {offered.gradeSuggestion}</button>
          <button type="button" disabled={busy} onClick={() => decide({ action: 'DISMISS', replyId: offered.id, reason: 'AI_WRONG' }, () => `保留${letter ? ` ${letter} 类` : '原等级'}，这条建议记为 AI 判错`, false)}>不改</button>
        </div>
      </div>}
      <dl className="bos-chat-grade-facts">
        <dt className="bos-chat-sr">现在</dt><dd><strong>{letter ? `现在是 ${letter} 类 · ${GRADE_INFO[letter].word}` : '还没评级'}</strong></dd>
        {reason && <><dt>依据</dt><dd>{reason}</dd></>}
        {source && <><dt>谁定的</dt><dd>{SOURCE_LABELS[source] ?? source}{gradedAt ? ` · ${formatDateTime(gradedAt, timezone)}` : ''}</dd></>}
      </dl>
      <p className="bos-chat-hint" style={{ display: 'block', margin: 0 }}>点一下就改（记为人工调整，自动评级不会再覆盖）</p>
      <div className="bos-chat-grade-choices" role="radiogroup" aria-label="改等级">
        {(Object.keys(GRADE_INFO) as Letter[]).map(key => <button key={key} type="button" role="radio" aria-checked={current === key} className={`is-${key}`} disabled={busy} onClick={() => pick(key)}>
          <strong>{key}</strong><small>{GRADE_INFO[key].word}</small></button>)}
      </div>
      {error && <p className="bos-chat-error" role="alert">{error}</p>}
    </div>}
    {toast && <div className="bos-chat-toast bos-chat-grade-toast" role="status"><span>{toast.text}</span>{toast.undo && <button type="button" onClick={undo} disabled={busy}>撤销</button>}</div>}
  </div>;
}

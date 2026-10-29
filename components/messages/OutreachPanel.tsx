'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, Copy, LayoutTemplate, MessageSquareQuote } from 'lucide-react';
import { api } from '@/lib/client';
import type { OutreachNextView } from '@/services/outreach-engine-service';

/** Server results after JSON: dates arrive as ISO strings. */
type Jsonify<T> = T extends Date ? string : T extends (infer U)[] ? Jsonify<U>[] : T extends object ? { [K in keyof T]: Jsonify<T[K]> } : T;
export type OutreachView = Jsonify<OutreachNextView>;

/**
 * The customer's outreach as the engine sees it: conversation state, the next touch and the script the rotation
 * assigned. Opening a chat is a POST because it may assign that script; `reload` runs after every send.
 */
export function useOutreach(customerId: string) {
  const [view, setView] = useState<OutreachView>();
  const reload = useCallback(async () => {
    try { setView(await api<OutreachView>('outreach/next', 'POST', { customerId })); }
    catch { setView(undefined); }
  }, [customerId]);
  useEffect(() => { setView(undefined); void reload(); }, [reload]);
  return { outreach: view, reloadOutreach: reload };
}

const dateTime = (iso: string, timezone: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: timezone, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

/** Above the composer: what to send next and which script, with the limits that apply right now. */
/** 旧客户 (lib/customer-group.ts) chat as usual; the tag says why no script is offered for them. */
export const LegacyTag = () => <span className="bos-chat-tag is-muted" title="2026 年 10 月 1 日前询盘，不参与话术测试">旧客户</span>;

export function OutreachBar({ view, timezone, canTemplate, onUseTemplate }: { view?: OutreachView; timezone: string; canTemplate: boolean; onUseTemplate: () => void }) {
  const [copied, setCopied] = useState(false);
  if (view?.legacy && view.state !== 'STOPPED') return <div className="bos-chat-notice bos-outreach-bar"><MessageSquareQuote size={16} aria-hidden="true" /><span><strong>旧客户（2026 年 10 月 1 日前询盘）不参与话术测试。</strong>系统不分配话术，发出的消息也不计入话术效果，可以照常沟通。</span></div>;
  if (!view || (!view.next && view.state !== 'STOPPED')) return null;
  async function copy() {
    if (!view?.script) return;
    try { await navigator.clipboard.writeText(view.script.rendered); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { setCopied(false); }
  }
  if (view.state === 'STOPPED') return <div className="bos-chat-notice bos-outreach-bar"><MessageSquareQuote size={16} aria-hidden="true" /><span><strong>客户已要求停止联系。</strong>会话状态为「停止联系」，BOS 不再发送主动消息。</span></div>;
  return <div className="bos-outreach-bar" role="status">
    <div className="bos-outreach-bar-head">
      <MessageSquareQuote size={16} aria-hidden="true" />
      <span>{view.stateLabel} · 下一条 <strong>{view.nextLabel}</strong>{view.nextTouchAt ? ` · 计划 ${dateTime(view.nextTouchAt, timezone)}` : ''}</span>
      {view.script ? <span className="bos-outreach-chip">系统分配 {view.script.code}（{view.script.statusLabel}）</span>
        : <span className="bos-outreach-chip is-muted">{view.noScript === 'GRADE_D' ? 'D 类线索不分配话术' : view.noScript === 'NO_LANGUAGE' ? `没有${view.language.label}话术` : '话术库还没有可用的话术'}</span>}
    </div>
    {view.script && <p className="bos-outreach-script">{view.script.rendered}</p>}
    {view.noScript === 'GRADE_D' && <p className="bos-outreach-missing">D 类是 Meta 测试线索或没有联系方式，不分配话术。判断有误的话，在右侧把客户等级改为 A / B / C，马上分配。</p>}
    {view.noScript === 'NO_LANGUAGE' && <p className="bos-outreach-missing">这位客户按{view.language.basis}用{view.language.label}，话术库里还没有{view.language.label}或英语的 {view.nextLabel} 话术。添加后打开聊天就会自动分配；语言不对的话，在客户档案里填写客户语言。<Link href="/outreach/library">去话术库</Link></p>}
    {view.noScript === 'LIBRARY_EMPTY' && <p className="bos-outreach-missing">话术库里还没有「测试中」或「胜出」的 {view.nextLabel} 话术。添加后，还没发过消息的客户打开聊天就会自动分配。<Link href="/outreach/library">去话术库</Link></p>}
    <div className="bos-outreach-bar-actions">
      {view.script?.templateName && canTemplate && <button type="button" className="is-primary" onClick={onUseTemplate}><LayoutTemplate size={14} aria-hidden="true" />用这条模板发送</button>}
      {view.script && <button type="button" onClick={copy}>{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{copied ? '已复制' : '复制话术（手机发送）'}</button>}
      {view.limits.waitUntil && <small className="is-warning">距上次主动触达不足 24 小时，{dateTime(view.limits.waitUntil, timezone)} 后可发模板</small>}
      {!view.limits.waitUntil && view.limits.templatesLeft === 0 && <small className="is-warning">已发 {view.limits.templateCap} 条模板未获回复，后续请用手机跟进</small>}
      {view.script && <small>业务员只负责发送，话术由系统轮流分配，便于比较效果。</small>}
    </div>
  </div>;
}

const QUALITY_TONE: Record<string, string> = { HIGH: 'is-green', ENGAGED: 'is-green', LOW: '', REJECT: 'is-warning' };

/** In the profile panel: state, the script the customer first answered, the best reply, and the grade. */
export function OutreachProfile({ view, customerId, onChanged }: { view?: OutreachView; customerId: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!view) return null;
  async function decide(body: Record<string, unknown>) {
    setBusy(true); setError('');
    try { await api('outreach/grade', 'POST', body); onChanged(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="bos-outreach-profile">
    <div className="bos-chat-section-title"><strong style={{ color: '#1c3226' }}>话术跟进</strong><Link className="bos-chat-link" href="/outreach">话术效果</Link></div>
    <dl className="bos-chat-facts">
      {view.legacy && <><dt>数据分组</dt><dd><LegacyTag /> 不参与话术测试</dd></>}
      <dt>会话状态</dt><dd>{view.stateLabel}{view.next && !view.legacy ? ` · 下一条 ${view.next}` : ''}</dd>
      <dt>回复话术</dt><dd>{view.replyScriptCode || '—'}</dd>
      <dt>最高回复</dt><dd>{view.bestReplyLabel ? <span className={`bos-chat-tag ${QUALITY_TONE[view.bestReplyQuality] ?? ''}`}>{view.bestReplyLabel}</span> : '—'}</dd>
      <dt>客户等级</dt><dd>
        <label className="bos-chat-sr" htmlFor={`grade-${customerId}`}>客户等级</label>
        <select id={`grade-${customerId}`} className="bos-outreach-grade" value={['A', 'B', 'C'].includes(view.grade) ? view.grade : ''} disabled={busy}
          onChange={e => e.target.value && decide({ action: 'SET', customerId, grade: e.target.value })}>
          {!['A', 'B', 'C'].includes(view.grade) && <option value="">{view.grade === 'D' ? 'D 无效' : '未评级'}</option>}
          <option value="A">A 类</option><option value="B">B 类</option><option value="C">C 类</option>
        </select>
        {view.gradeSource === 'HUMAN' && <small> 人工确认</small>}
      </dd>
    </dl>
    {view.gradeSuggestion && <div className="bos-outreach-suggestion">
      <p><strong>DeepSeek 建议改为 {view.gradeSuggestion.gradeSuggestion} 类</strong>{view.gradeSuggestion.reason ? `：${view.gradeSuggestion.reason}` : ''}</p>
      <div className="bos-chat-actions">
        <button type="button" className="is-primary" disabled={busy} onClick={() => decide({ action: 'ACCEPT', replyId: view.gradeSuggestion!.id })}>确认改为 {view.gradeSuggestion.gradeSuggestion} 类</button>
        <button type="button" disabled={busy} onClick={() => decide({ action: 'DISMISS', replyId: view.gradeSuggestion!.id, reason: 'AI_WRONG' })}>不采纳</button>
      </div>
    </div>}
    {view.nextStep && <p className="bos-chat-draft-next"><span>建议下一步</span>{view.nextStep}</p>}
    {error && <p className="bos-chat-error" role="alert">{error}</p>}
  </div>;
}

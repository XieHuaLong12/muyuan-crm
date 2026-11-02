'use client';
import { useState } from 'react';
import Link from 'next/link';
import { IdentityTimeline } from '@/components/bos/IdentityTimeline';
import { QuotationPanel } from './workspace/QuotationPanel';
import { inquiryDate } from '@/lib/customer-date';
import { isLegacyCustomer } from '@/lib/customer-group';
import { LeadHistory } from './lead-history';
import { Journey } from './insights/Journey';
import { Customer, Bootstrap, Deal } from '@/lib/types';
import { Badge, Due, GradeChip } from './customer-table';
import { api, money, dateText } from '@/lib/client';
import { stages, sources, followTypes, purchases } from '@/lib/constants';
import { Dialog } from './ui/dialog';
import { Field, Options, ReasonDialog } from './forms';

type FollowUp = NonNullable<Customer['followUps']>[number];
const ORDER_STATUS: Record<string, string> = { CANCELLED: '已取消' };

export function CustomerDetail({ customer: c, boot, backHref, onEdit, onFollow, onDeal, onEditDeal, onVoidDeal, onDelete, onAssign, onChanged, onAnalyze, analyzingAi }: {
  customer: Customer; boot: Bootstrap; backHref: string;
  onEdit: () => void; onFollow: () => void; onDeal: () => void; onEditDeal: (deal: Deal) => void; onVoidDeal: (deal: Deal) => void;
  onDelete: () => void; onAssign: () => void; onChanged: (message: string) => void;
  onAnalyze: () => void; analyzingAi: boolean;
}) {
  const tz = boot.settings.timezone;
  const admin = boot.user.role === 'ADMIN';
  const [editingFollow, setEditingFollow] = useState<FollowUp>();
  const [deletingFollow, setDeletingFollow] = useState<FollowUp>();
  const won = c.deals.length > 0 || c.stage === 'WON';
  return (
    <>
      <Link className="back" href={backHref}>← 返回客户列表</Link>
      <div className="detail-heading">
        <div className="customer-link">
          <span className="avatar large">{c.name[0]}</span>
          <div>
            <h1>{c.name} <GradeChip grade={c.leadGrade} reason={c.leadGradeReason} source={c.leadGradeSource} /><Badge stage={c.stage} />{c.pendingAssignment && <span className="badge">待分配</span>}{isLegacyCustomer(c) && <span className="badge" title="2026 年 10 月 1 日前询盘，不参与话术测试、不进今日工作">旧客户</span>}</h1>
            {c.leadGrade && c.leadGradeReason && <p className="muted grade-reason">表单评级 {c.leadGrade}：{c.leadGradeReason}{c.leadGradeSource === 'AI' ? '（AI）' : ''}</p>}
            <p className="muted">{c.companyName} · {c.country} · {c.pendingAssignment ? '待分配（暂由管理员保管）' : `负责人 ${c.owner.name}`}</p>
          </div>
        </div>
        <div className="actions">
          <button onClick={onAnalyze} disabled={!boot.deepseekConfigured || analyzingAi}>{analyzingAi ? 'AI分析中…' : boot.deepseekConfigured ? 'AI智能分析' : '未配置 DeepSeek'}</button>
          {admin && <button onClick={onAssign}>{c.pendingAssignment ? '分配客户' : '转交'}</button>}
          <button onClick={onEdit}>编辑资料</button>
          <button onClick={() => { window.location.href = `/messages?customer=${encodeURIComponent(c.id)}`; }}>WhatsApp 聊天</button>
          <button onClick={onFollow}>记录跟进</button>
          <button className="primary" onClick={onDeal}>新增成交订单</button>
        </div>
      </div>
      <div className="customer-workbench">
        <div className="customer-workbench-info">
          <div className="summary-grid detail-stats">
            <div className="card"><span className="muted">预计订单金额</span><h2>{money(c.estimatedOrderValue, c.currency)}</h2></div>
            <div className="card">
              <span className="muted">累计成交 · {c.deals.length} 笔</span>
              <h2>
                {Array.from(new Set(c.deals.map(d => d.currency))).map(currency => (
                  <span key={currency}>{money(c.deals.filter(d => d.currency === currency).reduce((s, d) => s + Number(d.dealAmount), 0), currency)} </span>
                ))}
                {!c.deals.length ? '暂无成交' : ''}
              </h2>
            </div>
            <div className="card"><span className="muted">下次跟进</span><h2><Due date={c.nextFollowUpAt} tz={tz} /></h2></div>
          </div>
          <section className="card">
            <div className="card-title"><h3>AI 客户智能</h3><span className="muted">{c.aiLastAnalyzedAt ? `DeepSeek · ${dateText(c.aiLastAnalyzedAt, tz)}` : '尚未分析'}</span></div>
            <dl>
              {[
                ['AI评分', c.aiLastAnalyzedAt ? `${c.aiScore ?? 0} / 100` : '—'],
                ['跟进优先级', c.aiPriority || '—'],
                ['采购意向', c.aiIntent || '—'],
                ['AI建议阶段', c.intelligence?.suggestedStage ? (stages[c.intelligence.suggestedStage as keyof typeof stages] ?? c.intelligence.suggestedStage) : '—'],
              ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
            </dl>
            <h3>客户摘要</h3>
            <p className="pre-wrap">{c.aiSummary || '点击“AI智能分析”，DeepSeek 会结合客户资料、WhatsApp聊天和跟进历史进行判断。'}</p>
            <h3>下一步建议</h3>
            <p className="pre-wrap">{c.aiNextAction || '—'}</p>
            {c.aiReason && <><h3>判断依据</h3><p className="pre-wrap">{c.aiReason}</p></>}
            {c.aiRisk && <><h3>风险</h3><p className="pre-wrap">{c.aiRisk}</p></>}
          </section>
          <div className="detail-grid">
            <div>
              <section className="card">
                <h3>客户资料</h3>
                <dl>
                  {[
                    ['公司', c.companyName],
                    ['国家 / 城市', [c.country, c.city].filter(Boolean).join(' / ')],
                    ['电话', c.phone], ['WhatsApp', c.whatsapp], ['邮箱', c.email],
                    ['来源', sources[c.source as keyof typeof sources]], ['来源详情', c.sourceDetail], ['沟通语言', c.language],
                    ['产品', c.productInterest], ['型号', c.productModel],
                    ['采购类型', purchases[c.purchaseType as keyof typeof purchases]], ['采购数量', c.quantity],
                    ['预算', money(c.budget, c.currency)], ['采购计划', c.purchaseTimeline],
                    ['收货地址', [c.shippingCountry, c.shippingCity, c.shippingPostalCode].join(' ')],
                    ['有效性', c.isQualified === null ? '待判断' : c.isQualified ? '有效' : `无效 · ${c.invalidReason}`],
                    ...(['PAUSED', 'LOST'].includes(c.stage) && c.invalidReason ? [[`${stages[c.stage as keyof typeof stages]}原因`, c.invalidReason]] : []),
                    ['报价金额', money(c.quotedAmount, c.currency)],
                    ['询盘日期', new Date(inquiryDate(c)).toLocaleDateString('zh-CN', { timeZone: tz })],
                    ['首次联系', dateText(c.contactedAt, tz)], ['首次回复', dateText(c.firstReplyAt, tz)], ['首次报价', dateText(c.quotedAt, tz)],
                  ].map(([label, value]) => <div key={String(label)}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}
                </dl>
                <h3>客户备注</h3>
                <p className="pre-wrap">{c.notes || '暂无备注'}</p>
              </section>
              <section className="card">
                <h3>从进线到现在</h3>
                <Journey customerId={c.id} revision={Date.parse(c.updatedAt ?? '') || 0} />
              </section>
              {admin && (won
                ? <p className="muted">已成交客户不能删除；如成交录入有误，请先在「成交订单」中作废。</p>
                : <button className="danger" onClick={onDelete}>删除客户</button>)}
            </div>
            <div>
              <section className="card"><QuotationPanel customer={c} /></section>
              {admin && <IdentityTimeline key={c.id} customerId={c.id} timezone={tz} />}
              <LeadHistory submissions={c.submissions ?? []} tz={tz} />
              <section className="card">
                <div className="card-title"><h3>跟进时间线</h3><button className="text-button" onClick={onFollow}>＋ 记录跟进</button></div>
                {c.followUps?.map(f => (
                  <div className="timeline" key={f.id}>
                    <div className="timeline-dot" />
                    <div>
                      <strong>{followTypes[f.type as keyof typeof followTypes]} <span className="muted">· {dateText(f.followUpAt, tz)}</span></strong>
                      <p className="pre-wrap">{f.content}</p>
                      <small className="muted">下次跟进：{dateText(f.nextFollowUpAt, tz)}</small>
                      {(admin || f.createdBy === boot.user.id) && (
                        <div className="actions">
                          <button className="text-button" onClick={() => setEditingFollow(f)}>更正内容</button>
                          {admin && <button className="text-button" onClick={() => setDeletingFollow(f)}>删除</button>}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {!c.followUps?.length && <div className="empty">暂无跟进记录</div>}
              </section>
              <section className="card">
                <div className="card-title"><h3>成交订单</h3><button className="text-button" onClick={onDeal}>＋ 新增订单</button></div>
                <div className="table-scroll">
                  <table>
                    <thead><tr><th>订单 / 日期</th><th>销售额</th><th>成本</th><th>毛利润</th><th>毛利率</th>{admin && <th>操作</th>}</tr></thead>
                    <tbody>
                      {c.deals.map(d => (
                        <tr key={d.id}>
                          <td>{d.orderNumber || '未填写订单号'}<small>{dateText(d.dealDate, tz)}{d.order ? ` · ${d.order.orderNo}${ORDER_STATUS[d.order.status] ? `（${ORDER_STATUS[d.order.status]}）` : ''}` : ''}</small></td>
                          <td>{money(d.dealAmount, d.currency)}</td>
                          <td>{money(d.productCost, d.currency)}</td>
                          <td>{money(d.grossProfit, d.currency)}</td>
                          <td>{(Number(d.grossMargin) * 100).toFixed(1)}%</td>
                          {admin && <td><button className="text-button" onClick={() => onEditDeal(d)}>修改</button> <button className="text-button" onClick={() => onVoidDeal(d)}>作废</button></td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!c.deals.length && <div className="empty">暂无成交订单</div>}
                </div>
              </section>
              <section className="card">
                <h3>阶段历史</h3>
                {c.stageHistory?.map(h => (
                  <div className="history" key={h.id}>
                    <span>{h.fromStage ? stages[h.fromStage as keyof typeof stages] : '创建客户'} → {stages[h.toStage as keyof typeof stages]}{h.note ? <small className="muted"> · {h.note}</small> : null}</span>
                    <small>{dateText(h.changedAt, tz)}</small>
                  </div>
                ))}
              </section>
            </div>
          </div>
        </div>
        {admin && (
          <section className="card">
            <h3>销售沟通监督</h3>
            <p>查看该客户已保存的销售沟通记录。</p>
            <Link href={`/communication?customer=${c.id}`}>查看沟通记录 →</Link>
          </section>
        )}
      </div>
      {editingFollow && <FollowCorrection customerId={c.id} follow={editingFollow} onClose={() => setEditingFollow(undefined)} onSaved={() => { setEditingFollow(undefined); onChanged('跟进内容已更正'); }} />}
      {deletingFollow && (
        <ReasonDialog title="删除跟进记录" danger confirmText="确认删除" label="删除原因"
          description={<p>{dateText(deletingFollow.followUpAt, tz)} 的跟进将被删除，删除前的内容会保留在修改记录中。</p>}
          onClose={() => setDeletingFollow(undefined)}
          onConfirm={async reason => {
            await api(`customers/${c.id}/followups/${deletingFollow.id}`, 'DELETE', { reason });
            setDeletingFollow(undefined); onChanged('跟进记录已删除');
          }} />
      )}
    </>
  );
}

function FollowCorrection({ customerId, follow, onClose, onSaved }: { customerId: string; follow: FollowUp; onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState(follow.type), [content, setContent] = useState(follow.content);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return (
    <Dialog open onClose={() => { if (!busy) onClose(); }} title="更正跟进内容">
      <form onSubmit={async e => {
        e.preventDefault(); setBusy(true); setError('');
        try { await api(`customers/${customerId}/followups/${follow.id}`, 'PATCH', { type, content }); onSaved(); }
        catch (err) { setError((err as Error).message); } finally { setBusy(false); }
      }}>
        <p className="muted">跟进时间是事实记录，不能修改；只更正方式和内容，原内容会保留在修改记录中。</p>
        <Field label="跟进方式"><select value={type} onChange={e => setType(e.target.value)}><Options items={followTypes} /></select></Field>
        <Field label="跟进内容 *"><textarea rows={5} value={content} onChange={e => setContent(e.target.value)} /></Field>
        {error && <p role="alert" className="error">{error}</p>}
        <div className="form-actions">
          <button type="button" disabled={busy} onClick={onClose}>取消</button>
          <button className="primary" disabled={busy || !content.trim()}>{busy ? '保存中…' : '保存更正'}</button>
        </div>
      </form>
    </Dialog>
  );
}

'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight,Check,Clock,Plus,Sparkles,Wallet,X,Zap } from 'lucide-react';
import { Card,EmptyState,Header,Table } from '@/components/ui/bos';

/**
 * AI 经营行动中心（AI Action Center）
 *
 * 不是待办清单：每个任务都带业务背景（客户 / 国家 / 阶段 / 订单 / 金额）
 * 并说明「为什么出现」。顶部 AI 今日建议由可核对的规则推导，不编造依据。
 */

export type TaskCard = {
  id: string;
  title: string;
  responsibleName?: string | null;
  assigneeId?: string | null;
  description: string;
  type: string;
  source: string;
  sourceLabel: string;
  priority: string;
  priorityLabel: string;
  priorityMark: string;
  status: string;
  statusLabel: string;
  dueDate: string;
  overdue: boolean;
  completedAt: string | null;
  customer: { id: string; name: string; companyName: string; country: string; stage: string; whatsapp: string } | null;
  order: { id: string; orderNo: string; amountRMB: string; status: string } | null;
  amount: string | null;
  aiReason: string;
};

export type Recommendation = {
  id: string;
  rank: number;
  kind: string;
  mark: string;
  title: string;
  reason: string;
  amount: string | null;
  customerId: string | null;
  customerName: string | null;
  country: string | null;
  orderId: string | null;
};

export type ActionCenterData = {
  query: { view: string; source: string; q: string };
  stats: { today: number; high: number; overdue: number; done: number };
  recommendations: Recommendation[];
  tasks: TaskCard[];
  performance: { doneThisWeek: number; avgResponseMs: number; dealRelated: number; aiAdoption: number; aiTotal: number; aiDone: number };
};

type Insight = {
  task: TaskCard;
  customer: { name: string; companyName: string; country: string; stage: string; whatsapp: string; email: string; phone: string; aiNextAction: string | null } | null;
  orders: { id: string; orderNo: string; amountRMB: string; status: string; paymentStatus: string; orderDate: string }[];
  timeline: { kind: string; at: string; text: string; channel: string }[];
  suggested: string;
};

const VIEWS = [['TODAY', '今日待处理'], ['HIGH', '高优先级'], ['OVERDUE', '逾期'], ['ALL', '全部'], ['DONE', '已完成']] as const;
const SOURCES = [['ALL', '全部来源'], ['CRM', 'CRM'], ['ORDER', '订单'], ['FINANCE', '财务'], ['ADS', '广告'], ['AI', 'AI'], ['MANUAL', '手动']] as const;

function rmb(value: string | number | null) {
  return value === null ? '—' : `¥${Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`;
}

function when(iso: string) {
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return sameDay ? `今天 ${time}` : `${date.getMonth() + 1}/${date.getDate()} ${time}`;
}

function responseTime(ms: number) {
  if (!ms) return '—';
  const hours = ms / 3_600_000;
  if (hours < 1) return `${Math.max(1, Math.round(ms / 60_000))} 分钟`;
  if (hours < 48) return `${hours.toFixed(1)} 小时`;
  return `${(hours / 24).toFixed(1)} 天`;
}

function qs(query: ActionCenterData['query'], patch: Partial<ActionCenterData['query']>) {
  const next = { ...query, ...patch };
  const params = new URLSearchParams();
  if (next.view !== 'TODAY') params.set('view', next.view);
  if (next.source !== 'ALL') params.set('source', next.source);
  if (next.q) params.set('q', next.q);
  const text = params.toString();
  return text ? `/tasks?${text}` : '/tasks';
}

/** people: active accounts an administrator can hand a standalone task to (empty for salespeople). */
export function ActionCenter({ data, name, people = [] }: { data: ActionCenterData; name: string; people?: { id: string; name: string }[] }) {
  const [insight, setInsight] = useState<Insight | null>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const stats = [
    ['今日待处理', data.stats.today, ''],
    ['高优先级', data.stats.high, 'is-high'],
    ['逾期任务', data.stats.overdue, 'is-overdue'],
    ['今日已完成', data.stats.done, 'is-done'],
  ] as const;

  async function openDrawer(taskId: string) {
    setBusy(taskId);
    setError('');
    try {
      const response = await fetch(`/api/action-center/${taskId}`);
      const body = await response.json();
      if (!body.success) throw new Error(body.error || '无法打开任务');
      setInsight(body.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function complete(taskId: string, outcome: string) {
    setBusy(taskId);
    setError('');
    try {
      const response = await fetch(`/api/action-center/${taskId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome }),
      });
      const body = await response.json();
      if (!body.success) throw new Error(body.error || '完成失败');
      setMessage(`已完成：${body.data.title}${outcome ? ` · 结果：${outcome}` : ''}（刷新后从列表移除）`);
      setInsight(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function postpone(taskId: string) {
    setBusy(taskId);
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dueDate: new Date(Date.now() + 3 * 86_400_000).toISOString() }),
      });
      const body = await response.json();
      if (!body.success) throw new Error(body.error || '延期失败');
      setMessage('已延期 3 天');
      setInsight(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  /** 把 AI 建议变成一条真正可执行的任务。 */
  async function adopt(rec: Recommendation) {
    setBusy(rec.id);
    setError('');
    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: rec.customerId,
          title: rec.title,
          description: `${rec.reason}${rec.amount ? `（涉及金额 ¥${rec.amount}）` : ''}`,
          type: rec.kind === 'PAYMENT' ? 'PAYMENT' : 'FOLLOW_UP',
          priority: 'HIGH',
          dueDate: new Date().toISOString(),
        }),
      });
      const body = await response.json();
      if (!body.success) throw new Error(body.error || '创建失败');
      setMessage(`已加入任务：${rec.title}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function runAnalysis() {
    setBusy('analysis');
    setError('');
    try {
      const response = await fetch('/api/action-center/auto', { method: 'POST' });
      const body = await response.json();
      if (!body.success) throw new Error(body.error || '生成失败');
      setMessage(body.data.created ? `AI 分析完成，新增 ${body.data.created} 条任务` : 'AI 分析完成，当前没有需要新增的任务');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function createTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy('create');
    setError('');
    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: String(form.get('title') ?? '').trim(),
          description: String(form.get('description') ?? '').trim(),
          priority: String(form.get('priority') ?? 'MEDIUM'),
          assigneeId: String(form.get('assigneeId') ?? '') || null,
          type: 'FOLLOW_UP',
          dueDate: new Date(String(form.get('dueDate') || Date.now())).toISOString(),
        }),
      });
      const body = await response.json();
      if (!body.success) throw new Error(body.error || '创建失败');
      setMessage('任务已创建');
      setShowCreate(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <Header
        eyebrow="TASKS · AI 行动中心"
        title={people.length ? '团队任务' : '我的任务'}
        description={people.length ? '全团队今天应该优先完成什么？客户任务由客户当前负责人执行。' : '今天应该优先完成什么？'}
        actions={
          <div className="bos-order-actions">
            <button type="button" className="bos-button" onClick={() => setShowCreate(v => !v)}><Plus size={15} />创建任务</button>
            <button type="button" className="bos-button bos-button-primary" onClick={runAnalysis} disabled={busy === 'analysis'}>
              <Sparkles size={15} />{busy === 'analysis' ? '分析中…' : 'AI 今日分析'}
            </button>
          </div>
        }
      />

      {message && <p className="bos-cost-message" role="status">{message}</p>}
      {error && <p className="bos-cost-error" role="alert">{error}</p>}

      {showCreate && (
        <Card className="motion-in">
          <form className="bos-task-create" onSubmit={createTask}>
            <input className="bos-input" name="title" required maxLength={180} placeholder="任务标题，例如：跟进 Richie 的报价" aria-label="任务标题" />
            <input className="bos-input" name="description" maxLength={2000} placeholder="说明（可选）" aria-label="任务说明" />
            <select name="priority" aria-label="优先级" defaultValue="MEDIUM">
              <option value="HIGH">🔥 高优先级</option>
              <option value="MEDIUM">⚡ 普通任务</option>
              <option value="LOW">○ 低优先级</option>
            </select>
            <input type="date" name="dueDate" aria-label="截止日期" defaultValue={new Date().toISOString().slice(0, 10)} />
            {people.length > 0 && (
              <select name="assigneeId" aria-label="执行人" defaultValue="">
                <option value="">执行人：我自己</option>
                {people.map(person => <option key={person.id} value={person.id}>执行人：{person.name}</option>)}
              </select>
            )}
            <button className="bos-button bos-button-primary" type="submit" disabled={busy === 'create'}>保存</button>
            <button className="bos-button" type="button" onClick={() => setShowCreate(false)}>取消</button>
          </form>
        </Card>
      )}

      <div className="bos-action-stats motion-in" style={{ '--motion-delay': '200ms' } as React.CSSProperties}>
        {stats.map(([label, value, tone]) => (
          <Card className={`bos-action-stat ${tone}`} key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </Card>
        ))}
      </div>

      <Card className="bos-ai-card motion-in" style={{ '--motion-delay': '300ms' } as React.CSSProperties}>
        <div className="bos-ai-card-head">
          <span className="bos-ai-orb" aria-hidden="true" />
          <div>
            <h2>AI Today Recommendation</h2>
            <p>早上好 {name}。根据当前客户、订单和财务数据，今天建议优先处理：</p>
          </div>
        </div>
        {data.recommendations.length ? (
          <ol className="bos-reco-list">
            {data.recommendations.map(rec => (
              <li key={rec.id}>
                <span className="bos-reco-mark" aria-hidden="true">{rec.mark}</span>
                <div className="bos-reco-body">
                  <strong>{rec.title}</strong>
                  <small>原因：{rec.reason}</small>
                  <small>
                    {rec.amount ? `预计金额 ${rmb(rec.amount)}` : '无金额关联'}
                    {rec.country ? ` · ${rec.country}` : ''}
                  </small>
                </div>
                <div className="bos-reco-actions">
                  {rec.customerId && <Link className="bos-button" href={`/customers/${rec.customerId}`}>查看客户</Link>}
                  {rec.customerId && <Link className="bos-button" href={`/sales?customer=${rec.customerId}`}>记录客户跟进</Link>}
                  <button className="bos-button bos-button-primary" type="button" disabled={busy === rec.id} onClick={() => adopt(rec)}>
                    {busy === rec.id ? '处理中…' : '加入任务'}
                  </button>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="bos-footnote">当前没有需要提醒的事项 —— 报价、订单与收款都在正常节奏上。</p>
        )}
      </Card>

      <div className="bos-action-tabs motion-in" style={{ '--motion-delay': '400ms' } as React.CSSProperties}>
        <nav aria-label="任务视图">
          {VIEWS.map(([key, label]) => (
            <Link key={key} href={qs(data.query, { view: key })} aria-current={data.query.view === key ? 'page' : undefined}>{label}</Link>
          ))}
        </nav>
        <nav aria-label="任务来源">
          {SOURCES.map(([key, label]) => (
            <Link key={key} href={qs(data.query, { source: key })} aria-current={data.query.source === key ? 'page' : undefined}>{label}</Link>
          ))}
        </nav>
      </div>

      <div className="bos-action-list motion-in" style={{ '--motion-delay': '500ms' } as React.CSSProperties} data-motion={data.tasks.length > 50 ? 'off' : 'on'}>
        {data.tasks.map(task => (
          <article
            key={task.id}
            className={`bos-task-card${task.priority === 'HIGH' && task.status !== 'DONE' ? ' is-high' : ''}${task.overdue ? ' is-overdue' : ''}`}
          >
            <div className="bos-task-main">
              <div className="bos-task-title">
                <button type="button" onClick={() => openDrawer(task.id)} disabled={busy === task.id}>{task.title}</button>
                <span className={`bos-task-priority priority-${task.priority.toLowerCase()}`}>{task.priorityMark} {task.priorityLabel}</span>
                <span className={`bos-source-tag source-${task.source.toLowerCase()}`}>{task.sourceLabel}</span>
              </div>
              <div className="bos-task-meta">
                {task.customer ? (
                  <span>{task.customer.name}{task.customer.country ? ` · ${task.customer.country}` : ''}</span>
                ) : (
                  <span>个人任务</span>
                )}
                {people.length > 0 && <span>执行人 {task.responsibleName ?? people.find(person => person.id === task.assigneeId)?.name ?? '—'}</span>}
                <span>预计价值 {rmb(task.amount ?? task.order?.amountRMB ?? null)}</span>
                <span className={task.overdue ? 'bos-overdue' : undefined}><Clock size={12} />{when(task.dueDate)}</span>
                <span>{task.statusLabel}</span>
              </div>
              {task.aiReason && <p className="bos-task-reason"><Zap size={12} />{task.aiReason}</p>}
            </div>
            <button className="bos-task-open" type="button" onClick={() => openDrawer(task.id)} disabled={busy === task.id}>
              详情<ArrowUpRight size={13} />
            </button>
          </article>
        ))}
        {!data.tasks.length && (
          <Card>
            <EmptyState
              title="这个视图下没有任务"
              description="换个视图或来源看看，或点右上角「AI 今日分析」让系统按客户与订单生成今天的任务。"
              action={<Link className="bos-button" href="/tasks">回到今日待处理</Link>}
            />
          </Card>
        )}
      </div>

      <Card className="bos-action-performance motion-in" style={{ '--motion-delay': '600ms' } as React.CSSProperties}>
        <div className="bos-section-title"><div><h2>执行效率</h2><p>本周（滚动 7 天）</p></div></div>
        <Table caption="执行效率" headings={['本周完成', '平均响应', '成交相关任务', 'AI 建议采纳']}>
          <tr>
            <td><strong>{data.performance.doneThisWeek}</strong> 个任务</td>
            <td><strong>{responseTime(data.performance.avgResponseMs)}</strong></td>
            <td><strong>{data.performance.dealRelated}</strong> 个</td>
            <td><strong>{data.performance.aiAdoption}%</strong><small>{data.performance.aiDone} / {data.performance.aiTotal} 条 AI 任务</small></td>
          </tr>
        </Table>
      </Card>

      {insight && (
        <>
          <button className="bos-drawer-scrim" aria-label="关闭详情" onClick={() => setInsight(null)} />
          <aside className="bos-drawer" role="dialog" aria-label={`任务详情：${insight.task.title}`}>
            <header>
              <div>
                <span className="bos-eyebrow">TASK DETAIL</span>
                <h2>{insight.task.title}</h2>
              </div>
              <button className="bos-icon-button" type="button" aria-label="关闭" onClick={() => setInsight(null)}><X size={17} /></button>
            </header>

            <div className="bos-drawer-body">
              {insight.task.aiReason && (
                <section className="bos-drawer-ai">
                  <Sparkles size={15} />
                  <div><strong>为什么出现这个任务</strong><p>{insight.task.aiReason}</p></div>
                </section>
              )}

              <section>
                <h3>客户信息</h3>
                <dl className="bos-detail-list">
                  <div><dt>客户</dt><dd>{insight.customer?.name ?? '—'}</dd></div>
                  <div><dt>公司</dt><dd>{insight.customer?.companyName || '—'}</dd></div>
                  <div><dt>国家</dt><dd>{insight.customer?.country || '—'}</dd></div>
                  <div><dt>阶段</dt><dd>{insight.customer?.stage || '—'}</dd></div>
                  <div><dt>WhatsApp</dt><dd>{insight.customer?.whatsapp || '—'}</dd></div>
                  <div><dt>邮箱</dt><dd>{insight.customer?.email || '—'}</dd></div>
                </dl>
              </section>

              {!!insight.orders.length && (
                <section>
                  <h3>订单金额</h3>
                  <ul className="bos-quote-list">
                    {insight.orders.map(order => (
                      <li key={order.id}>
                        <div><strong>{order.orderNo}</strong><small>{order.status} · {order.paymentStatus}</small></div>
                        <span>{rmb(order.amountRMB)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section>
                <h3>跟进记录</h3>
                {insight.timeline.length ? (
                  <ul className="bos-timeline-list">
                    {insight.timeline.map((item, index) => (
                      <li key={`${item.at}-${index}`}>
                        <span className="bos-timeline-list-dot" />
                        <div>
                          <small>{item.channel} · {new Date(item.at).toLocaleString('zh-CN')}</small>
                          <p>{item.text}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="bos-footnote">该客户暂无跟进记录。</p>
                )}
              </section>

              <section className="bos-drawer-ai">
                <Sparkles size={15} />
                <div><strong>AI 建议下一步动作</strong><p>{insight.suggested}</p></div>
              </section>
            </div>

            <footer>
              <form
                className="bos-drawer-complete"
                onSubmit={e => {
                  e.preventDefault();
                  const outcome = String(new FormData(e.currentTarget).get('outcome') ?? '').trim();
                  void complete(insight.task.id, outcome);
                }}
              >
                <input className="bos-input" name="outcome" placeholder="完成结果，例如：客户回复，需要修改报价" aria-label="完成结果" />
                <button className="bos-button bos-button-primary" type="submit" disabled={busy === insight.task.id}>
                  <Check size={15} />完成
                </button>
              </form>
              <div className="bos-drawer-actions">
                <button className="bos-button" type="button" disabled={busy === insight.task.id} onClick={() => postpone(insight.task.id)}>
                  <Clock size={14} />延期 3 天
                </button>
                {insight.customer && <Link className="bos-button" href={`/customers/${insight.customer ? insight.task.customer?.id : ''}`}><Wallet size={14} />打开客户</Link>}
                {insight.customer && <Link className="bos-button" href={`/sales?customer=${insight.task.customer?.id}`}>查看客户档案</Link>}
              </div>
            </footer>
          </aside>
        </>
      )}
    </>
  );
}

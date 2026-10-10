'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, GripVertical, Search } from 'lucide-react';
import { KANBAN_STAGES, KANBAN_REASON_STAGES, type KanbanStage } from '@/lib/bos-kanban';
import type { CrmBoard } from '@/services/bos-crm-service';
import { sources } from '@/lib/constants';
import { ReasonDialog } from '@/components/forms';

type Customer = CrmBoard['customers'][number];
const money = (amount: string, currency: string) =>
  Number(amount) > 0 ? new Intl.NumberFormat('zh-CN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(amount)) : '待评估';
const date = (value: string | null) => value ? new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(value)) : '未记录';
const label = (key: string) => KANBAN_STAGES.find(stage => stage.key === key)?.label ?? key;

export function CrmKanban({ data }: { data: CrmBoard }) {
  const router = useRouter();
  const pending = useRef(false);
  const [customers, setCustomers] = useState(data.customers);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [asking, setAsking] = useState<{ customer: Customer; toStage: KanbanStage }>();
  useEffect(() => setCustomers(data.customers), [data.customers]);

  async function move(customer: Customer, toStage: KanbanStage, reason = '') {
    if (customer.stage === toStage || pending.current) return;
    if (customer.stage === 'WON') { setMessage('成交客户需要在客户档案中管理订单。'); return; }
    if (KANBAN_REASON_STAGES.includes(toStage) && !reason) { setAsking({ customer, toStage }); return; }
    pending.current = true;
    setBusy(customer.id);
    setMessage('');
    const previous = customers;
    setCustomers(list => list.map(item => item.id === customer.id ? { ...item, stage: toStage } : item));
    try {
      const response = await fetch('/api/bos/crm-stage', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ customerId: customer.id, fromStage: customer.stage, toStage, reason }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '更新失败');
      setMessage(`${customer.name} 已移至${label(toStage)}`);
      router.refresh();
    } catch (error) {
      setCustomers(previous);
      setMessage((error as Error).message);
      router.refresh();
      throw error;
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }
  const tryMove = (customer: Customer, toStage: KanbanStage) => { move(customer, toStage).catch(() => undefined); };
  const visible = customers.filter(customer =>
    `${customer.name} ${customer.companyName} ${customer.country} ${customer.productInterest}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="bos-v2-page bos-v2-crm">
      <header className="bos-v2-hero">
        <div>
          <span className="bos-v2-kicker">CRM CENTER / 销售看板</span>
          <h1>每一位客户，都有下一步。</h1>
          <p>拖拽卡片或用「移动至」推进阶段。报价、成交与跟进在客户档案中完成。</p>
        </div>
      </header>
      <div className="bos-v2-board-toolbar">
        <div><strong>{data.total}</strong> 位客户 <small>· 每列显示最近需要跟进的 {data.limit} 位</small></div>
        <label>
          <Search size={16} />
          <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索当前看板" aria-label="搜索当前看板" />
        </label>
      </div>
      <p className="bos-v2-board-message" role="status" aria-live="polite">
        {message || '移入「暂不需要」「已流失」「无效客户」需要填写原因；成交通过新增成交单自动推进。'}
      </p>
      <div className="bos-v2-kanban" aria-label="客户销售看板">
        {KANBAN_STAGES.map(column => {
          const list = visible.filter(customer => customer.stage === column.key);
          const total = data.counts[column.key] ?? 0;
          return (
            <section key={column.key} className="bos-v2-kanban-column"
              onDragOver={event => { if (column.key !== 'WON') event.preventDefault(); }}
              onDrop={event => {
                event.preventDefault();
                const customer = customers.find(item => item.id === event.dataTransfer.getData('text/plain'));
                if (customer && column.key !== 'WON') tryMove(customer, column.key);
              }}>
              <div className="bos-v2-kanban-head"><h2>{column.label}</h2><span>{search ? list.length : total}</span></div>
              <div className="bos-v2-kanban-stack">
                {list.map(customer => (
                  <article className="bos-v2-customer-card" key={customer.id} draggable={customer.stage !== 'WON' && !busy}
                    onDragStart={event => event.dataTransfer.setData('text/plain', customer.id)}>
                    <div className="bos-v2-customer-top">
                      <span className="bos-v2-avatar">{customer.name.slice(0, 1)}</span>
                      <span>{customer.country || '国家待补充'}</span>
                      <GripVertical size={14} aria-hidden />
                    </div>
                    <Link href={`/customers/${customer.id}`} className="bos-v2-customer-name">{customer.name}<ArrowUpRight size={14} /></Link>
                    <small>{customer.companyName || sources[customer.source as keyof typeof sources] || customer.source}</small>
                    <p>{customer.productInterest || '产品兴趣待补充'}{customer.quantity ? ` · ${customer.quantity} 件` : ''}</p>
                    <div className="bos-v2-customer-money"><span>预计金额</span><strong>{money(customer.estimatedOrderValue, customer.currency)}</strong></div>
                    <div className="bos-v2-customer-next"><span>下一步</span><strong>{customer.aiNextAction || '查看客户并安排跟进'}</strong></div>
                    <div className="bos-v2-customer-bottom"><span>最近联系 {date(customer.lastContactAt)}</span><span>AI {customer.aiScore}</span></div>
                    <label className="bos-v2-stage-picker">
                      移动至{' '}
                      <select aria-label={`更改 ${customer.name} 的阶段`} disabled={Boolean(busy) || customer.stage === 'WON'} value={customer.stage}
                        onChange={event => tryMove(customer, event.target.value as KanbanStage)}>
                        {KANBAN_STAGES.map(stage => <option key={stage.key} value={stage.key} disabled={stage.key === 'WON'}>{stage.label}</option>)}
                      </select>
                    </label>
                  </article>
                ))}
                {!list.length && <div className="bos-v2-kanban-empty">暂无客户</div>}
                {!search && total > list.length && <Link className="bos-v2-kanban-empty" href={`/customers?stage=${column.key}`}>查看全部 {total} 位 →</Link>}
              </div>
            </section>
          );
        })}
      </div>
      {asking && (
        <ReasonDialog title={`移至「${label(asking.toStage)}」· ${asking.customer.name}`} confirmText="确认移动" label="原因"
          description={<p>原因会显示在客户档案和阶段历史中，管理员可在销售团队页查看每位销售本月标记的数量。</p>}
          onClose={() => setAsking(undefined)}
          onConfirm={async reason => { await move(asking.customer, asking.toStage, reason); setAsking(undefined); }} />
      )}
    </div>
  );
}

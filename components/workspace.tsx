'use client';
import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { WorkspaceShell } from './workspace/WorkspaceShell';
import { api } from '@/lib/client';
import { Bootstrap, Customer, Dashboard, Deal, Target as TargetType } from '@/lib/types';
import { CustomerForm, FollowForm, DealForm, AssignDialog, ReasonDialog } from './forms';
import { CustomerList, rememberedListUrl } from './customer-list';
import { CustomerDetail } from './customer-detail';
import { Targets, Settings, Integrations } from './management';
import { MetaLeadIntake } from './meta-lead-intake';
import { Dialog } from './ui/dialog';
import { SmartImport } from './smart-import';

type Page = 'customers' | 'targets' | 'settings' | 'integrations' | 'lead-intake';

/** Older-generation pages inside the BOS shell: customers, company targets, settings, integrations and lead intake. */
export function Workspace({ initialBoot, pageOverride, embedded }: { initialBoot?: Bootstrap; pageOverride?: Page; embedded?: boolean } = {}) {
  const pathname = usePathname(), router = useRouter();
  const page: Page = pageOverride || (pathname.split('/')[1] as Page) || 'customers';
  const customerId = page === 'customers' ? pathname.split('/')[2] : undefined;
  const [boot, setBoot] = useState<Bootstrap | undefined>(initialBoot);
  const [detail, setDetail] = useState<Customer>();
  const [targets, setTargets] = useState<TargetType[]>([]), [annual, setAnnual] = useState<Dashboard>();
  const [year, setYear] = useState(new Date().getFullYear());
  const [revision, setRevision] = useState(0), [error, setError] = useState(''), [loading, setLoading] = useState(true), [toast, setToast] = useState('');
  const [edit, setEdit] = useState<Customer | null | undefined>(), [follow, setFollow] = useState<Customer>();
  const [deal, setDeal] = useState<{ customer: Customer; deal?: Deal }>();
  const [dialog, setDialog] = useState<'remove' | 'assign' | 'import' | null>(null);
  const [voiding, setVoiding] = useState<Deal>();
  const [analyzingAi, setAnalyzingAi] = useState(false);
  const [backHref, setBackHref] = useState('/customers');

  useEffect(() => {
    if (initialBoot) return;
    api<Bootstrap>('bootstrap').then(setBoot).catch(e => setError(e.message));
  }, [initialBoot]);
  useEffect(() => { setBackHref(rememberedListUrl()); }, [customerId]);
  useEffect(() => {
    if (!boot || (page === 'customers' && !customerId) || page === 'settings' || page === 'integrations' || page === 'lead-intake') { setLoading(false); return; }
    let cancelled = false;
    setLoading(true); setError('');
    (async () => {
      try {
        if (page === 'customers' && customerId) {
          const d = await api<Customer>(`customers/${customerId}`);
          if (!cancelled) setDetail(d);
        } else if (page === 'targets') {
          const [t, a] = await Promise.all([
            api<TargetType[]>(`targets?year=${year}`),
            api<Dashboard>(`dashboard?period=YEAR&date=${year}-01-01&currency=${boot.settings.currency}`),
          ]);
          if (!cancelled) { setTargets(t); setAnnual(a); }
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [boot, page, customerId, year, revision]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  const saved = useCallback((message = '已保存，数据已更新') => {
    setEdit(undefined); setFollow(undefined); setDeal(undefined); setDialog(null); setVoiding(undefined);
    setRevision(v => v + 1);
    setToast(message);
  }, []);

  if (!boot) return <div className="loading">{error || '正在打开工作台…'}</div>;
  const admin = boot.user.role === 'ADMIN';
  const tz = boot.settings.timezone;
  const heading = page === 'customers'
    ? { title: admin ? '客户管理' : '我的客户', description: admin ? '集中管理询盘，分配客户并把握每一次成交机会。' : '维护你负责的客户资料、报价与成交。' }
    : page === 'targets' ? { title: '目标管理', description: '让年度计划，落到每个月和每一周。' }
      : page === 'lead-intake' ? { title: '线索接入', description: 'Meta 广告线索是否实时进入客户中心；读取失败时这里会列出原因和处理办法。' }
      : page === 'integrations' ? { title: '集成与接入', description: '表单询盘、Meta 广告与 WhatsApp 的接入状态和同步。' }
        : { title: '公司设置', description: '公司名称、默认货币与时区。' };

  return (
    <WorkspaceShell boot={boot} embedded={embedded}>
      <div className="v3-legacy">
        {!customerId && (
          <div className="page-heading">
            <div><h1>{heading.title}</h1><p className="muted">{heading.description}</p></div>
            {page === 'customers' && (
              <div className="actions">
                <button className="primary" onClick={() => setEdit(null)}><Plus size={17} />新建客户</button>
                {admin && <button onClick={() => setDialog('import')}>智能导入</button>}
              </div>
            )}
          </div>
        )}
        {error && <div role="alert" className="error-banner">{error}<button onClick={() => setRevision(v => v + 1)}>重试</button></div>}
        {page === 'customers' && !customerId && <CustomerList boot={boot} revision={revision} onFollow={setFollow} onChanged={saved} />}
        {loading && (customerId || page === 'targets') ? <div className="loading">正在加载数据…</div> : (
          <>
            {customerId && detail && (
              <CustomerDetail customer={detail} boot={boot} backHref={backHref}
                onEdit={() => setEdit(detail)} onFollow={() => setFollow(detail)} onDeal={() => setDeal({ customer: detail })}
                onEditDeal={d => setDeal({ customer: detail, deal: d })} onVoidDeal={setVoiding}
                onDelete={() => setDialog('remove')} onAssign={() => setDialog('assign')} onChanged={saved}
                analyzingAi={analyzingAi}
                onAnalyze={async () => {
                  try {
                    setAnalyzingAi(true); setError('');
                    await api(`customers/${detail.id}/analyze`, 'POST');
                    saved('DeepSeek 客户分析已更新');
                  } catch (e) { setError((e as Error).message); } finally { setAnalyzingAi(false); }
                }} />
            )}
            {page === 'targets' && <Targets targets={targets} boot={boot} year={year} onYear={setYear} onSaved={() => saved()} annual={annual} />}
            {page === 'integrations' && <Integrations boot={boot} />}
            {page === 'lead-intake' && <div className="settings-grid"><MetaLeadIntake timezone={tz} /></div>}
            {page === 'settings' && <Settings boot={boot} onSaved={async () => { setBoot(await api<Bootstrap>('bootstrap')); saved(); }} />}
          </>
        )}
      </div>
      {dialog === 'import' && <SmartImport boot={boot} onClose={() => setDialog(null)} onSaved={() => saved('导入完成')} />}
      {edit !== undefined && (
        <CustomerForm customer={edit ?? undefined} boot={boot} onClose={() => setEdit(undefined)}
          onSaved={id => { saved(); if (!edit) router.push(`/customers/${id}`); }} />
      )}
      {follow && <FollowForm customer={follow} timezone={tz} onClose={() => setFollow(undefined)} onSaved={() => saved('跟进已记录')} />}
      {deal && <DealForm customer={deal.customer} deal={deal.deal} timezone={tz} onClose={() => setDeal(undefined)} onSaved={() => saved(deal.deal ? '成交已更正' : '成交已登记')} />}
      {dialog === 'assign' && detail && (
        <AssignDialog boot={boot} customers={[detail]} onClose={() => setDialog(null)} onAssigned={message => saved(message)} />
      )}
      {voiding && detail && (
        <ReasonDialog title={`作废成交 · ${voiding.orderNumber || '未填写订单号'}`} danger confirmText="确认作废" label="作废原因"
          description={<p>成交将从业绩统计中移除，关联订单变为「已取消」，广告平台不会再回传这笔购买。{detail.deals.length === 1 ? '客户会回到成交前的阶段。' : ''}操作会留下记录。</p>}
          onClose={() => setVoiding(undefined)}
          onConfirm={async reason => { await api(`customers/${detail.id}/deals/${voiding.id}/void`, 'POST', { reason }); saved('成交已作废'); }} />
      )}
      {dialog === 'remove' && detail && (
        <Dialog open onClose={() => setDialog(null)} title="删除客户">
          <p>确定删除 {detail.name}？客户将移入回收站并退出日常列表、任务与统计，可以在回收站恢复。</p>
          <div className="form-actions">
            <button onClick={() => setDialog(null)}>取消</button>
            <button className="danger" onClick={async () => {
              try { await api(`customers/${detail.id}`, 'DELETE'); setDialog(null); router.push(backHref); saved('已移入回收站'); }
              catch (e) { setError((e as Error).message); setDialog(null); }
            }}>确认删除</button>
          </div>
        </Dialog>
      )}
      {toast && <div className="toast" role="status">✓ {toast}</div>}
    </WorkspaceShell>
  );
}

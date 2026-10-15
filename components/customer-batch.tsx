'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bootstrap, Customer } from '@/lib/types';
import { api } from '@/lib/client';
import type { CustomerColumnKey } from '@/lib/customer-columns';
import { CustomerTable } from './customer-table';
import { Dialog } from './ui/dialog';
import { AssignDialog } from './forms';

export function SelectionBox({ checked, mixed = false, onChange, label, disabled = false }: {
  checked: boolean; mixed?: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = mixed; }, [mixed]);
  return <input ref={ref} type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />;
}

const won = (c: Customer) => c.deals.length > 0 || c.stage === 'WON';

/**
 * Customer table with cross-page selection for administrators: assign / transfer, move to the recycle bin.
 * `tools` (the 「定制列」 button) sits at the end of the toolbar for everyone; sales get a toolbar with just that.
 */
export function BatchCustomerTable({ rows, tz, boot, columns, previewId, tools, onFollow, onSort, onChanged, onPreview }: {
  rows: Customer[]; tz: string; boot: Bootstrap; columns: readonly CustomerColumnKey[]; previewId?: string; tools?: ReactNode;
  onFollow: (c: Customer) => void; onSort: (key: string) => void; onChanged: (message: string) => void; onPreview: (c: Customer, fromKeyboard?: boolean) => void;
}) {
  const admin = boot.user.role === 'ADMIN';
  const [selected, setSelected] = useState<Customer[]>([]);
  const [dialog, setDialog] = useState<'assign' | 'delete' | 'trash' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selectedIds = new Set(selected.map(c => c.id));
  const protectedCount = selected.filter(won).length;
  const toggle = (c: Customer, value: boolean) => setSelected(prev => value ? [...prev.filter(x => x.id !== c.id), c] : prev.filter(x => x.id !== c.id));
  const selectPage = (value: boolean) => setSelected(prev => value
    ? [...prev.filter(c => !rows.some(x => x.id === c.id)), ...rows]
    : prev.filter(c => !rows.some(x => x.id === c.id)));
  const done = (message: string) => { setSelected([]); setDialog(null); onChanged(message); };
  return (
    <>
      {admin && (
        <div className="batch-toolbar">
          <span>已选择 <strong>{selected.length}</strong> 位客户（支持跨页）</span>
          <button className="primary" disabled={!selected.length || busy} onClick={() => setDialog('assign')}>分配 / 转交</button>
          <button className="danger" disabled={!selected.length || busy || protectedCount > 0} title={protectedCount ? '已成交客户需先作废成交才能删除' : undefined}
            onClick={() => { setError(''); setDialog('delete'); }}>移入回收站</button>
          <button disabled={!selected.length || busy} onClick={() => setSelected([])}>取消选择</button>
          <button onClick={() => setDialog('trash')}>回收站 / 恢复</button>
          <div className="batch-toolbar-note">
            <small className="muted">{protectedCount ? `已选中 ${protectedCount} 位已成交客户：可以分配，不能删除。` : '更换筛选条件会清空选择。'}</small>
            {tools}
          </div>
        </div>
      )}
      {!admin && tools && <div className="batch-toolbar table-tools">{tools}</div>}
      <CustomerTable rows={rows} tz={tz} columns={columns} previewId={previewId} onPreview={onPreview}
        onFollow={onFollow} onSort={onSort} onChanged={onChanged} selection={admin ? {
        header: <SelectionBox label="全选当前页客户" checked={rows.length > 0 && rows.every(c => selectedIds.has(c.id))}
          mixed={rows.some(c => selectedIds.has(c.id)) && !rows.every(c => selectedIds.has(c.id))} disabled={!rows.length} onChange={selectPage} />,
        cell: c => <SelectionBox label={`选择客户 ${c.name}`} checked={selectedIds.has(c.id)} onChange={value => toggle(c, value)} />,
      } : undefined} />
      {dialog === 'assign' && <AssignDialog boot={boot} customers={selected} onClose={() => setDialog(null)} onAssigned={done} />}
      {dialog === 'delete' && (
        <Dialog open onClose={() => { if (!busy) setDialog(null); }} title={`确认删除 ${selected.length} 位客户`}>
          <p>以下客户将移入回收站，并退出日常列表、跟进任务和统计。跟进记录仍保留，可以恢复。</p>
          <ul className="batch-names">{selected.map(c => <li key={c.id}>{c.name} · {c.companyName || c.country || '未填写公司'}</li>)}</ul>
          {error && <p role="alert" className="error">{error}</p>}
          <div className="form-actions">
            <button disabled={busy} onClick={() => setDialog(null)}>取消</button>
            <button className="danger" disabled={busy} onClick={async () => {
              setBusy(true);
              try { await api('customers/batch-delete', 'POST', { ids: selected.map(c => c.id) }); done(`已移入回收站：${selected.length} 位客户`); }
              catch (e) { setError((e as Error).message); } finally { setBusy(false); }
            }}>{busy ? '删除中…' : '确认移入回收站'}</button>
          </div>
        </Dialog>
      )}
      {dialog === 'trash' && <TrashDialog onClose={() => setDialog(null)} onChanged={() => onChanged('回收站已更新')} />}
    </>
  );
}

function TrashDialog({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [rows, setRows] = useState<(Customer & { deletedAt: string })[]>([]);
  const [ids, setIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [purgeConfirm, setPurgeConfirm] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api<(Customer & { deletedAt: string })[]>('customers/trash').then(setRows).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, []);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={() => { if (!busy) onClose(); }} title="客户回收站">
      <p>选择客户后可恢复或彻底删除。彻底删除后无法恢复，并可重新通过智能导入创建客户。有成交、订单、WhatsApp 沟通或已发报价的客户会保留在回收站。</p>
      {error && <p role="alert" className="error">{error}</p>}
      {loading ? <p>加载中…</p> : (
        <div className="table-scroll trash-list">
          <table>
            <thead><tr>
              <th><SelectionBox label="全选回收站客户" checked={rows.length > 0 && ids.length === rows.length} mixed={ids.length > 0 && ids.length < rows.length} onChange={v => setIds(v ? rows.map(c => c.id) : [])} /></th>
              <th>客户</th><th>公司</th><th>负责人</th>
            </tr></thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.id}>
                  <td><SelectionBox label={`选择回收站客户 ${c.name}`} checked={ids.includes(c.id)} onChange={v => setIds(prev => v ? [...prev, c.id] : prev.filter(id => id !== c.id))} /></td>
                  <td>{c.name}</td><td>{c.companyName || '—'}</td><td>{c.owner.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <div className="empty">回收站为空</div>}
        </div>
      )}
      {purgeConfirm && <p role="alert" className="error"><strong>此操作无法恢复。</strong> 将永久删除所选 {ids.length} 位客户及其留资历史、跟进记录和阶段历史。删除后可以重新智能导入。</p>}
      <div className="form-actions">
        <button disabled={busy} onClick={onClose}>关闭</button>
        {purgeConfirm ? (
          <>
            <button disabled={busy} onClick={() => setPurgeConfirm(false)}>取消彻底删除</button>
            <button className="danger" disabled={busy || !ids.length} onClick={() => run(async () => {
              await api('customers/batch-purge', 'POST', { ids });
              setRows(prev => prev.filter(c => !ids.includes(c.id))); setIds([]); setPurgeConfirm(false); onChanged();
            })}>{busy ? '正在彻底删除…' : `确认永久删除 ${ids.length} 位客户`}</button>
          </>
        ) : (
          <button className="danger" disabled={busy || !ids.length} onClick={() => setPurgeConfirm(true)}>{`彻底删除所选 ${ids.length} 位客户`}</button>
        )}
        <button className="primary" disabled={busy || !ids.length || purgeConfirm} onClick={() => run(async () => {
          await api('customers/batch-restore', 'POST', { ids }); onClose(); onChanged();
        })}>{busy ? '恢复中…' : `恢复所选 ${ids.length} 位客户`}</button>
      </div>
    </Dialog>
  );
}

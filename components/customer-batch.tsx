'use client';
import { useEffect, useRef, useState } from 'react';
import { Customer } from '@/lib/types';
import { api } from '@/lib/client';
import { CustomerTable } from './customer-table';
import { Dialog } from './ui/dialog';

export function SelectionBox({ checked, mixed = false, onChange, label, disabled = false }: { checked: boolean; mixed?: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = mixed; }, [mixed]);
  return <input ref={ref} type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />;
}

export function BatchCustomerTable({ rows, tz, onFollow, onSort, onChanged, admin }: { rows: Customer[]; tz: string; onFollow: (c: Customer) => void; onSort: (key: string) => void; onChanged: () => void; admin: boolean }) {
  const [selected, setSelected] = useState<Customer[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [trash, setTrash] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const eligible = rows.filter(c => !c.deals.length && c.stage !== 'WON');
  const selectedIds = new Set(selected.map(c => c.id));
  const toggle = (c: Customer, value: boolean) => setSelected(prev => value ? [...prev.filter(x => x.id !== c.id), c] : prev.filter(x => x.id !== c.id));
  const selectPage = (value: boolean) => setSelected(prev => value ? [...prev.filter(c => !eligible.some(x => x.id === c.id)), ...eligible] : prev.filter(c => !eligible.some(x => x.id === c.id)));
  return <>
    {admin && <div className="batch-toolbar"><span>已选择 <strong>{selected.length}</strong> 位客户（支持跨页）</span><button disabled={!selected.length || busy} className="danger" onClick={() => { setError(''); setConfirm(true); }}>批量删除</button><button disabled={!selected.length || busy} onClick={() => setSelected([])}>取消选择</button><button onClick={() => setTrash(true)}>回收站 / 恢复</button><small className="muted">已成交客户不可批量删除；更换筛选条件会清空选择。</small></div>}
    <CustomerTable rows={rows} tz={tz} onFollow={onFollow} onSort={onSort} selection={admin ? {
      header: <SelectionBox label="全选当前页可删除客户" checked={eligible.length > 0 && eligible.every(c => selectedIds.has(c.id))} mixed={eligible.some(c => selectedIds.has(c.id)) && !eligible.every(c => selectedIds.has(c.id))} disabled={!eligible.length} onChange={selectPage} />,
      cell: c => <SelectionBox label={`选择客户 ${c.name}${c.deals.length || c.stage === 'WON' ? '（已成交，受保护）' : ''}`} checked={selectedIds.has(c.id)} disabled={c.deals.length > 0 || c.stage === 'WON'} onChange={value => toggle(c, value)} />,
    } : undefined} />
    {confirm && <Dialog open onClose={() => { if (!busy) setConfirm(false); }} title={`确认删除 ${selected.length} 位客户`}><p>以下客户将移入回收站，并退出日常列表、跟进任务和统计。跟进记录仍保留，可以恢复。</p><ul className="batch-names">{selected.map(c => <li key={c.id}>{c.name} · {c.companyName || c.country || '未填写公司'}</li>)}</ul>{error && <p role="alert" className="error">{error}</p>}<div className="form-actions"><button disabled={busy} onClick={() => setConfirm(false)}>取消</button><button className="danger" disabled={busy} onClick={async () => { setBusy(true); try { await api('customers/batch-delete', 'POST', { ids: selected.map(c => c.id) }); setSelected([]); setConfirm(false); onChanged(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>{busy ? '删除中…' : '确认移入回收站'}</button></div></Dialog>}
    {trash && <TrashDialog onClose={() => setTrash(false)} onChanged={onChanged} />}
  </>;
}

function TrashDialog({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [rows, setRows] = useState<(Customer & { deletedAt: string })[]>([]);
  const [ids, setIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [purgeConfirm, setPurgeConfirm] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api<(Customer & { deletedAt: string })[]>('customers/trash').then(setRows).catch(e => setError(e.message)).finally(() => setLoading(false)); }, []);
  return <Dialog open onClose={() => { if (!busy) onClose(); }} title="客户回收站"><p>选择客户后恢复；原负责人、跟进记录和订单保持不变。</p>{error && <p role="alert" className="error">{error}</p>}{loading ? <p>加载中…</p> : <div className="table-scroll trash-list"><table><thead><tr><th><SelectionBox label="全选回收站客户" checked={rows.length > 0 && ids.length === rows.length} mixed={ids.length > 0 && ids.length < rows.length} onChange={v => setIds(v ? rows.map(c => c.id) : [])} /></th><th>客户</th><th>公司</th><th>负责人</th></tr></thead><tbody>{rows.map(c => <tr key={c.id}><td><SelectionBox label={`恢复客户 ${c.name}`} checked={ids.includes(c.id)} onChange={v => setIds(prev => v ? [...prev, c.id] : prev.filter(id => id !== c.id))} /></td><td>{c.name}</td><td>{c.companyName || '—'}</td><td>{c.owner.name}</td></tr>)}</tbody></table>{!rows.length && <div className="empty">回收站为空</div>}</div>}{purgeConfirm&&<p role="alert" className="error"><strong>此操作无法恢复。</strong> 将永久删除所选 {ids.length} 位客户及其留资历史、跟进记录和阶段历史。删除后可以重新智能导入。</p>}<div className="form-actions"><button disabled={busy} onClick={onClose}>关闭</button>{purgeConfirm?<><button disabled={busy} onClick={()=>setPurgeConfirm(false)}>取消彻底删除</button><button className="danger" disabled={busy||!ids.length} onClick={async()=>{setBusy(true);setError('');try{await api('customers/batch-purge','POST',{ids});setRows(prev=>prev.filter(c=>!ids.includes(c.id)));setIds([]);setPurgeConfirm(false);onChanged();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>{busy?'正在彻底删除…':`确认永久删除 ${ids.length} 位客户`}</button></>:<button className="danger" disabled={busy||!ids.length} onClick={()=>setPurgeConfirm(true)}>{`彻底删除所选 ${ids.length} 位客户`}</button>}<button className="primary" disabled={busy||!ids.length||purgeConfirm} onClick={async()=>{setBusy(true);try{await api('customers/batch-restore','POST',{ids});onClose();onChanged();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>{busy?'恢复中…':`恢复所选 ${ids.length} 位客户`}</button></div></Dialog>;
}

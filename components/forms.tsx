'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { formatInTimeZone } from 'date-fns-tz';
import { customerSchema, followSchema, dealSchema } from '@/lib/validation';
import { sources, stages, purchases, followTypes, invalidReasons } from '@/lib/constants';
import { api, ApiError, type ApiErrorDetails } from '@/lib/client';
import { Bootstrap, Customer, Deal } from '@/lib/types';
import { Dialog } from './ui/dialog';
import { inquiryDate } from '@/lib/customer-date';

type FieldProps = { label: string; children: React.ReactNode };
export function Field({ label, children }: FieldProps) {
  return <label className="field"><span>{label}</span>{children}</label>;
}
export function Options({ items }: { items: Record<string, string> }) {
  return <>{Object.entries(items).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</>;
}
const errorText = (error: string, errors: Record<string, { message?: string } | undefined>) => error || Object.values(errors).map(e => e?.message).join('；');

export function CustomerForm({ customer, boot, onClose, onSaved, inline = false }: {
  customer?: Customer; boot: Bootstrap; onClose: () => void; onSaved: (id: string) => void; inline?: boolean;
}) {
  const [error, setError] = useState(''), [dup, setDup] = useState<ApiErrorDetails | null>(null);
  const admin = boot.user.role === 'ADMIN';
  // Salespeople keep where and when a lead came from; administrators may correct it.
  const lockedOrigin = !!customer && !admin;
  const tz = boot.settings.timezone;
  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<z.input<typeof customerSchema>>({
    resolver: zodResolver(customerSchema),
    defaultValues: customer ? {
      ...customer,
      inquiryAt: formatInTimeZone(inquiryDate(customer), tz, 'yyyy-MM-dd'),
      currency: customer.currency as 'CNY' | 'USD' | 'EUR',
      estimatedOrderValue: Number(customer.estimatedOrderValue),
      budget: Number(customer.budget),
      quotedAmount: Number(customer.quotedAmount),
      nextFollowUpAt: customer.nextFollowUpAt ? formatInTimeZone(customer.nextFollowUpAt, tz, "yyyy-MM-dd'T'HH:mm") : '',
      expectedUpdatedAt: customer.updatedAt,
    } : {
      inquiryAt: formatInTimeZone(new Date(), tz, 'yyyy-MM-dd'), name: '', ownerId: boot.user.id, source: 'FACEBOOK', stage: 'NEW',
      currency: boot.settings.currency as 'CNY', isQualified: null,
    },
  });
  const submit = handleSubmit(async values => {
    setError('');
    try {
      const c = await api<Customer>(`customers${customer ? `/${customer.id}` : ''}`, customer ? 'PUT' : 'POST', values);
      onSaved(c.id);
    } catch (e) {
      setError((e as Error).message);
      setDup(e instanceof ApiError && e.details?.potentialDuplicate ? e.details : null);
    }
  });
  const text = (key: keyof z.input<typeof customerSchema>, label: string, type = 'text', disabled = false, placeholder?: string) => (
    <Field key={key} label={label}>
      <input type={type} disabled={disabled} placeholder={placeholder} step={type === 'number' ? (key === 'quantity' ? 1 : 0.01) : undefined} min={type === 'number' ? 0 : undefined} {...register(key)} />
    </Field>
  );
  const owners = boot.users.filter(u => u.isActive !== false || u.id === customer?.ownerId);
  return (
    <Dialog inline={inline} open onClose={onClose} title={customer ? '编辑客户' : '新建客户'}>
      <form onSubmit={submit}>
        <Field label="询盘日期 *">
          <input type="date" required={!lockedOrigin} disabled={lockedOrigin} max={formatInTimeZone(new Date(), tz, 'yyyy-MM-dd')} {...register('inquiryAt')} />
        </Field>
        <p className="muted">{lockedOrigin ? '询盘日期和客户来源影响广告归因与业绩统计，如需更正请联系管理员。' : '请选择客户实际产生询盘的日期，补录的历史客户将计入对应日期的询盘统计和来源分析。'}</p>
        <h3>基础资料</h3>
        <div className="form-grid">
          {text('name', '客户姓名 *')}{text('companyName', '公司')}{text('country', '国家 / 地区', 'text', false, '留空则按 WhatsApp 号码自动识别')}{text('countryCode', '国家代码（可选）')}
          {text('city', '城市')}{text('whatsapp', 'WhatsApp')}{text('phone', '电话')}{text('email', '邮箱', 'email')}
          <Field label="客户来源"><select disabled={lockedOrigin} {...register('source')}><Options items={{ '': '未填写', ...sources }} /></select></Field>
          {text('sourceDetail', '来源详情', 'text', lockedOrigin)}{text('language', '沟通语言')}
        </div>
        <h3>采购资料</h3>
        <div className="form-grid">
          {text('productInterest', '意向产品')}{text('productModel', '产品型号')}
          <Field label="采购类型"><select {...register('purchaseType')}><Options items={{ '': '未填写', ...purchases }} /></select></Field>
          {text('quantity', '数量', 'number')}{text('estimatedOrderValue', '预计订单金额', 'number')}{text('budget', '预算', 'number')}
          <Field label="货币"><select {...register('currency')}><Options items={{ CNY: '人民币 CNY', USD: '美元 USD', EUR: '欧元 EUR' }} /></select></Field>
          {text('purchaseTimeline', '采购时间计划')}{text('shippingCountry', '收货国家')}{text('shippingCity', '收货城市')}{text('shippingPostalCode', '邮编')}
        </div>
        <h3>销售资料</h3>
        <div className="form-grid">
          <Field label="客户阶段">
            <select {...register('stage')}><Options items={Object.fromEntries(Object.entries(stages).filter(([k]) => k !== 'WON' || customer?.deals.length))} /></select>
          </Field>
          <Field label={customer && admin ? '负责人（修改即转交）' : '负责人'}>
            <select {...register('ownerId')}>
              {owners.map(u => <option key={u.id} value={u.id}>{u.name}{u.role === 'ADMIN' ? '（管理员）' : ''}{u.isActive === false ? '（已停用）' : ''}</option>)}
            </select>
          </Field>
          <Field label="有效性">
            <select defaultValue={customer?.isQualified === true ? 'true' : customer?.isQualified === false ? 'false' : ''} onChange={e => setValue('isQualified', e.target.value === '' ? null : e.target.value === 'true')}>
              <Options items={{ '': '待判断', true: '有效', false: '无效' }} />
            </select>
          </Field>
          <Field label="原因（无效 / 暂不需要 / 已流失时必填）">
            <input list="invalid-reasons" {...register('invalidReason')} />
            <datalist id="invalid-reasons">{invalidReasons.map(r => <option key={r}>{r}</option>)}</datalist>
          </Field>
          {text('quotedAmount', '报价金额', 'number')}{text('nextFollowUpAt', '下次跟进时间', 'datetime-local')}
        </div>
        <Field label="客户备注"><textarea rows={3} {...register('notes')} /></Field>
        <p className="error" role={error ? 'alert' : undefined}>{errorText(error, errors)}</p>
        {dup?.customers?.length ? (
          <div className="notice">
            {dup.canForce ? '发现可能重复客户：' : '你负责的已有客户：'}
            {dup.customers.map(c => <a key={c.id} href={`/customers/${c.id}`}>{c.name}{c.ownerName && dup.canForce ? `（${c.ownerName}）` : ''} ↗ </a>)}
            {dup.canForce && <label><input type="checkbox" {...register('forceDuplicate')} /> 我已核对，仍然创建 / 保存</label>}
          </div>
        ) : null}
        <div className="form-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button className="primary" disabled={isSubmitting}>{isSubmitting ? '保存中…' : '保存客户'}</button>
        </div>
      </form>
    </Dialog>
  );
}

export function FollowForm({ customer, timezone, onClose, onSaved, inline = false }: {
  customer: Customer; timezone: string; onClose: () => void; onSaved: () => void; inline?: boolean;
}) {
  const [error, setError] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.input<typeof followSchema>>({
    resolver: zodResolver(followSchema),
    defaultValues: { type: 'WHATSAPP', followUpAt: formatInTimeZone(new Date(), timezone, "yyyy-MM-dd'T'HH:mm"), nextFollowUpAt: '' },
  });
  return (
    <Dialog inline={inline} open onClose={onClose} title={`记录跟进 · ${customer.name}`}>
      <form onSubmit={handleSubmit(async v => {
        try { await api(`customers/${customer.id}/followups`, 'POST', v); onSaved(); } catch (e) { setError((e as Error).message); }
      })}>
        <div className="form-grid">
          <Field label="跟进方式"><select {...register('type')}><Options items={followTypes} /></select></Field>
          <Field label="跟进时间"><input type="datetime-local" {...register('followUpAt')} /></Field>
        </div>
        <Field label="跟进内容 *"><textarea rows={5} {...register('content')} placeholder="记录客户反馈、采购需求和下一步行动…" /></Field>
        <Field label="下次跟进时间（留空则结束待办）"><input type="datetime-local" {...register('nextFollowUpAt')} /></Field>
        <p className="muted">在手机或其他工具里回复了客户，也请在这里登记：系统会把客户移出「待回复」。</p>
        <p className="error">{errorText(error, errors)}</p>
        <div className="form-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button className="primary" disabled={isSubmitting}>保存跟进</button>
        </div>
      </form>
    </Dialog>
  );
}

/** New deal, or (administrators) a correction of an existing one. */
export function DealForm({ customer, deal, timezone, onClose, onSaved, inline = false }: {
  customer: Customer; deal?: Deal; timezone: string; onClose: () => void; onSaved: () => void; inline?: boolean;
}) {
  const [error, setError] = useState('');
  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<z.input<typeof dealSchema>>({
    resolver: zodResolver(dealSchema),
    defaultValues: deal ? {
      dealAmount: Number(deal.dealAmount), productCost: Number(deal.productCost), dealDate: formatInTimeZone(deal.dealDate, timezone, 'yyyy-MM-dd'),
      currency: deal.currency as 'CNY', orderNumber: deal.orderNumber, product: deal.product ?? '', productModel: deal.productModel ?? '',
      quantity: deal.quantity ?? 0, notes: deal.notes ?? '',
    } : {
      dealDate: formatInTimeZone(new Date(), timezone, 'yyyy-MM-dd'), currency: customer.currency as 'CNY',
      product: customer.productInterest, productModel: customer.productModel, quantity: customer.quantity ?? undefined,
    },
  });
  const amount = Number(watch('dealAmount') || 0), cost = Number(watch('productCost') || 0);
  return (
    <Dialog inline={inline} open onClose={onClose} title={`${deal ? '修改成交' : '新增成交订单'} · ${customer.name}`}>
      <form onSubmit={handleSubmit(async v => {
        try {
          if (deal) await api(`customers/${customer.id}/deals/${deal.id}`, 'PATCH', { ...v, expectedUpdatedAt: deal.updatedAt });
          else await api(`customers/${customer.id}/deals`, 'POST', v);
          onSaved();
        } catch (e) { setError((e as Error).message); }
      })}>
        <div className="form-grid">
          <Field label="成交金额 *"><input type="number" min="0.01" step="0.01" {...register('dealAmount')} /></Field>
          <Field label="产品成本 *"><input type="number" min="0" step="0.01" {...register('productCost')} /></Field>
          <Field label="成交日期 *"><input type="date" {...register('dealDate')} /></Field>
          <Field label="货币"><select {...register('currency')}><Options items={{ CNY: '人民币', USD: '美元', EUR: '欧元' }} /></select></Field>
          <Field label="订单号"><input {...register('orderNumber')} /></Field>
          <Field label="产品"><input {...register('product')} /></Field>
          <Field label="型号"><input {...register('productModel')} /></Field>
          <Field label="数量"><input type="number" min="0" {...register('quantity')} /></Field>
        </div>
        <Field label="备注"><textarea {...register('notes')} /></Field>
        <div className="notice">毛利润 {(amount - cost).toLocaleString()} · 毛利率 {amount ? (((amount - cost) / amount) * 100).toFixed(1) : 0}%</div>
        {deal && <p className="muted">修改会同步订单金额并留下修改记录。</p>}
        <p className="error">{errorText(error, errors)}</p>
        <div className="form-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button className="primary" disabled={isSubmitting}>{deal ? '保存修改' : '确认成交'}</button>
        </div>
      </form>
    </Dialog>
  );
}

/** Asks for a reason before an action that needs one (void, cancel, pause…). */
export function ReasonDialog({ title, description, label = '原因', confirmText, danger = false, suggestions, onClose, onConfirm }: {
  title: string; description?: React.ReactNode; label?: string; confirmText: string; danger?: boolean;
  /** Common reasons offered as one-click choices above the text box. */
  suggestions?: readonly string[];
  onClose: () => void; onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  return (
    <Dialog open onClose={() => { if (!busy) onClose(); }} title={title}>
      <form onSubmit={async e => {
        e.preventDefault();
        if (reason.trim().length < 2) { setError('请填写原因（至少 2 个字）'); return; }
        setBusy(true); setError('');
        try { await onConfirm(reason.trim()); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
      }}>
        {description && <div className="muted">{description}</div>}
        {suggestions && (
          <div className="reason-suggestions" role="group" aria-label="常用原因">
            {suggestions.map(s => <button key={s} type="button" aria-pressed={reason === s} onClick={() => setReason(s)}>{s}</button>)}
          </div>
        )}
        <Field label={`${label} *`}><textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} maxLength={190} autoFocus /></Field>
        {error && <p role="alert" className="error">{error}</p>}
        <div className="form-actions">
          <button type="button" disabled={busy} onClick={onClose}>取消</button>
          <button className={danger ? 'danger' : 'primary'} disabled={busy}>{busy ? '处理中…' : confirmText}</button>
        </div>
      </form>
    </Dialog>
  );
}

/** Assign or transfer one or more customers. Only the owner changes. */
export function AssignDialog({ boot, customers, onClose, onAssigned }: {
  boot: Bootstrap; customers: { id: string; name: string; ownerId?: string }[]; onClose: () => void; onAssigned: (message: string) => void;
}) {
  const people = boot.users.filter(u => u.isActive !== false);
  const sales = people.filter(u => u.role !== 'ADMIN');
  const [ownerId, setOwnerId] = useState((sales[0] ?? people[0])?.id ?? ''), [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return (
    <Dialog open onClose={() => { if (!busy) onClose(); }} title={customers.length === 1 ? `分配 / 转交 · ${customers[0].name}` : `分配 / 转交 ${customers.length} 位客户`}>
      <form onSubmit={async e => {
        e.preventDefault();
        setBusy(true); setError('');
        try {
          const result = await api<{ assigned: number; unchanged: number; ownerName: string }>('customers/assign', 'POST', { ids: customers.map(c => c.id), ownerId, reason });
          onAssigned(`已分配给 ${result.ownerName}：${result.assigned} 位${result.unchanged ? `，${result.unchanged} 位原本就由其负责` : ''}`);
        } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
      }}>
        <p className="muted">新负责人会立即看到客户；尚未联系的客户从现在开始计算首联期限。客户资料不会被修改，分配记录会保留。</p>
        {customers.length > 1 && <ul className="batch-names">{customers.slice(0, 20).map(c => <li key={c.id}>{c.name}</li>)}{customers.length > 20 && <li>…等 {customers.length} 位</li>}</ul>}
        <Field label="新负责人 *">
          <select value={ownerId} onChange={e => setOwnerId(e.target.value)} required>
            {people.map(u => <option key={u.id} value={u.id}>{u.name}{u.role === 'ADMIN' ? '（管理员）' : ''}</option>)}
          </select>
        </Field>
        <Field label="原因（可选，会记录在分配历史）"><input value={reason} maxLength={200} onChange={e => setReason(e.target.value)} placeholder="例如：按国家分配、离职交接" /></Field>
        {error && <p role="alert" className="error">{error}</p>}
        <div className="form-actions">
          <button type="button" disabled={busy} onClick={onClose}>取消</button>
          <button className="primary" disabled={busy || !ownerId}>{busy ? '分配中…' : '确认分配'}</button>
        </div>
      </form>
    </Dialog>
  );
}

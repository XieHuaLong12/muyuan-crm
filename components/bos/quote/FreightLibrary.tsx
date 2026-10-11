'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Plus, PencilLine, Archive, ArchiveRestore } from 'lucide-react';
import { Header, Card, Table, Badge, Button, EmptyState, Typography } from '@/components/ui/bos';
import { api } from '@/lib/client';
import type { FreightRateView } from '@/services/freight-service';
import { FREIGHT_BASES, FREIGHT_MODES, QUOTE_CURRENCIES, QUOTE_INCOTERMS, computeFreight, type FreightBasis, type FxRates } from '@/lib/quote-math';
import { FREIGHT_BASIS_LABELS, FREIGHT_MODE_LABELS, formatAmount } from '@/lib/quote-i18n';
import { NumberField } from './NumberField';

type Form = {
  country: string; port: string; mode: string; incoterm: string; basis: string; rate: number | null; currency: string;
  volumetricKgPerCbm: number | null; minChargeQty: number | null; transitDays: string; note: string;
};

const EMPTY: Form = { country: '', port: '', mode: 'SEA', incoterm: 'DDP', basis: 'KG', rate: null, currency: 'CNY', volumetricKgPerCbm: null, minChargeQty: null, transitDays: '', note: '' };
const SAMPLE = { cbm: 1, grossWeightKg: 150 };

export function FreightLibrary({ initialRates, isAdmin, fx }: { initialRates: FreightRateView[]; isAdmin: boolean; fx: FxRates }) {
  const [rates, setRates] = useState(initialRates);
  const [filter, setFilter] = useState<'ACTIVE' | 'ARCHIVED'>('ACTIVE');
  const [editing, setEditing] = useState<FreightRateView | 'new' | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const shown = rates.filter(rate => rate.status === filter);

  function open(rate: FreightRateView | 'new') {
    setEditing(rate);
    setError('');
    setMessage('');
    setForm(rate === 'new' ? EMPTY : {
      country: rate.country, port: rate.port, mode: rate.mode, incoterm: rate.incoterm, basis: rate.basis, rate: rate.rate, currency: rate.currency,
      volumetricKgPerCbm: rate.volumetricKgPerCbm, minChargeQty: rate.minChargeQty, transitDays: rate.transitDays, note: rate.note,
    });
  }

  async function save(status?: 'ACTIVE' | 'ARCHIVED', target?: FreightRateView) {
    setSaving(true);
    setError('');
    try {
      const base = target ?? (editing === 'new' ? null : editing);
      const body = target
        ? { ...target, status, expectedUpdatedAt: target.updatedAt }
        : { ...form, ...(base ? { status: base.status, expectedUpdatedAt: base.updatedAt } : {}) };
      const saved = base
        ? await api<FreightRateView>(`freight-rates/${base.id}`, 'PUT', body)
        : await api<FreightRateView>('freight-rates', 'POST', body);
      setRates(current => (base ? current.map(rate => (rate.id === saved.id ? saved : rate)) : [...current, saved]).sort((a, b) => a.country.localeCompare(b.country)));
      setMessage(target ? (status === 'ARCHIVED' ? '已归档，报价时不再显示' : '已恢复') : '运价已保存，报价时会按它自动算运费');
      if (!target) setEditing(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const sample = form.rate
    ? computeFreight({ basis: form.basis as FreightBasis, rate: form.rate, currency: form.currency, volumetricKgPerCbm: form.basis === 'KG' ? form.volumetricKgPerCbm : null, minChargeQty: form.minChargeQty }, SAMPLE, form.currency, fx)
    : null;
  const unit = FREIGHT_BASIS_LABELS[form.basis]?.unit ?? '';

  return (
    <>
      <Header
        eyebrow="产品库 · 运费库"
        title="运费库"
        description="按目的国维护运价，例如 法国 22 元/kg、印度 550 美金/立方。报价时按产品总毛重或总体积自动算运费。"
        actions={isAdmin ? <Button variant="primary" onClick={() => open('new')}><Plus size={15} /> 新增运价</Button> : <Link href="/products/quotes/new" className="bos-button">新建报价</Link>}
      />

      {editing && isAdmin && (
        <Card className="bos-freight-form">
          <Typography as="h2" variant="heading">{editing === 'new' ? '新增运价' : `修改运价 · ${editing.country}`}</Typography>
          <div className="bos-quote-grid">
            <label className="bos-quote-field"><span>目的国 *</span><input className="bos-input" value={form.country} placeholder="例如 France / 法国" onChange={e => setForm({ ...form, country: e.target.value })} /></label>
            <label className="bos-quote-field"><span>目的港 / 城市</span><input className="bos-input" value={form.port} placeholder="可选，例如 Paris" onChange={e => setForm({ ...form, port: e.target.value })} /></label>
            <label className="bos-quote-field"><span>运输方式</span>
              <select className="bos-input" value={form.mode} onChange={e => setForm({ ...form, mode: e.target.value })}>
                {FREIGHT_MODES.map(mode => <option key={mode} value={mode}>{FREIGHT_MODE_LABELS[mode].zh}</option>)}
              </select>
            </label>
            <label className="bos-quote-field"><span>对应贸易条款</span>
              <select className="bos-input" value={form.incoterm} onChange={e => setForm({ ...form, incoterm: e.target.value })}>
                {QUOTE_INCOTERMS.map(code => <option key={code}>{code}</option>)}
              </select>
            </label>
            <label className="bos-quote-field"><span>计费方式</span>
              <select className="bos-input" value={form.basis} onChange={e => setForm({ ...form, basis: e.target.value })}>
                {FREIGHT_BASES.map(basis => <option key={basis} value={basis}>{FREIGHT_BASIS_LABELS[basis].label}</option>)}
              </select>
            </label>
            <div className="bos-quote-field"><span>运价 *</span>
              <div className="bos-freight-rate">
                <NumberField value={form.rate} placeholder="例如 22" aria-label="运价" onValue={v => setForm({ ...form, rate: v })} />
                <select className="bos-input" value={form.currency} aria-label="运价币种" onChange={e => setForm({ ...form, currency: e.target.value })}>
                  {QUOTE_CURRENCIES.map(code => <option key={code}>{code}</option>)}
                </select>
                <span>/ {unit}</span>
              </div>
            </div>
            {form.basis === 'KG' && (
              <label className="bos-quote-field"><span>计泡系数（kg / CBM）</span>
                <NumberField value={form.volumetricKgPerCbm} placeholder="例如 200；不计泡留空" onValue={v => setForm({ ...form, volumetricKgPerCbm: v === null ? null : Math.round(v) })} />
              </label>
            )}
            <label className="bos-quote-field"><span>最低计费量（{unit}）</span>
              <NumberField value={form.minChargeQty} placeholder="例如 21 kg 或 1 CBM，可留空" onValue={v => setForm({ ...form, minChargeQty: v })} />
            </label>
            <label className="bos-quote-field"><span>时效</span><input className="bos-input" value={form.transitDays} placeholder="例如 25-35 天" onChange={e => setForm({ ...form, transitDays: e.target.value })} /></label>
            <label className="bos-quote-field bos-quote-grow"><span>备注</span><input className="bos-input" value={form.note} placeholder="例如 双清包税，不含偏远派送" onChange={e => setForm({ ...form, note: e.target.value })} /></label>
          </div>
          {sample && (
            <p className="bos-quote-hint">
              试算：一票 {SAMPLE.cbm} CBM / {SAMPLE.grossWeightKg} kg 的货 → 计费 {sample.chargeableQty} {unit}
              {sample.volumetricKg !== null ? `（体积重 ${sample.volumetricKg} kg）` : ''} → 运费 {form.currency} {formatAmount(sample.amountInRateCurrency, 'zh')}
            </p>
          )}
          {error && <p className="bos-sales-error" role="alert">{error}</p>}
          <div className="bos-quote-action-row">
            <Button variant="primary" disabled={saving} onClick={() => void save()}>{saving ? '保存中…' : '保存运价'}</Button>
            <Button onClick={() => setEditing(null)}>取消</Button>
          </div>
        </Card>
      )}

      <Card>
        <div className="bos-tabs" role="tablist" aria-label="运价状态">
          <button type="button" role="tab" aria-selected={filter === 'ACTIVE'} onClick={() => setFilter('ACTIVE')}>使用中 <span>{rates.filter(r => r.status === 'ACTIVE').length}</span></button>
          <button type="button" role="tab" aria-selected={filter === 'ARCHIVED'} onClick={() => setFilter('ARCHIVED')}>已归档 <span>{rates.filter(r => r.status === 'ARCHIVED').length}</span></button>
        </div>
        {message && <p className="bos-quote-message" role="status">{message}</p>}
        {!editing && error && <p className="bos-sales-error" role="alert">{error}</p>}
        <Table caption="运费库" headings={['目的国', '方式 / 条款', '运价', '计费规则', '时效', '备注', ...(isAdmin ? ['操作'] : [])]}>
          {shown.map(rate => {
            const basis = FREIGHT_BASIS_LABELS[rate.basis];
            return (
              <tr key={rate.id}>
                <td><strong>{rate.country}</strong>{rate.port && <small>{rate.port}</small>}</td>
                <td>{FREIGHT_MODE_LABELS[rate.mode]?.zh ?? rate.mode}<small>{rate.incoterm}</small></td>
                <td><strong>{rate.currency} {formatAmount(rate.rate, 'zh')}</strong><small>/ {basis?.unit ?? rate.basis}</small></td>
                <td>
                  {basis?.label ?? rate.basis}
                  <small>
                    {[rate.volumetricKgPerCbm ? `计泡 1:${rate.volumetricKgPerCbm}` : '', rate.minChargeQty ? `最低 ${rate.minChargeQty} ${basis?.unit ?? ''}` : ''].filter(Boolean).join(' · ') || '—'}
                  </small>
                </td>
                <td>{rate.transitDays || '—'}</td>
                <td>{rate.note || '—'}</td>
                {isAdmin && (
                  <td>
                    <div className="bos-quote-action-row">
                      <button type="button" className="bos-quote-icon" aria-label={`修改 ${rate.country} 运价`} onClick={() => open(rate)}><PencilLine size={15} /></button>
                      {rate.status === 'ACTIVE'
                        ? <button type="button" className="bos-quote-icon" aria-label={`归档 ${rate.country} 运价`} disabled={saving} onClick={() => void save('ARCHIVED', rate)}><Archive size={15} /></button>
                        : <button type="button" className="bos-quote-icon" aria-label={`恢复 ${rate.country} 运价`} disabled={saving} onClick={() => void save('ACTIVE', rate)}><ArchiveRestore size={15} /></button>}
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </Table>
        {!shown.length && (filter === 'ACTIVE'
          ? <EmptyState title="还没有运价" description={isAdmin ? '点右上角「新增运价」，例如 法国 · 海运 DDP · 22 CNY/kg，或 印度 · 海运 DDP · 550 USD/CBM。' : '运费库由管理员维护，添加后报价时会自动出现。'} action={isAdmin ? <Button variant="primary" onClick={() => open('new')}><Plus size={15} /> 新增运价</Button> : undefined} />
          : <EmptyState title="没有归档的运价" description="归档的运价不会出现在报价里，可随时恢复。" />)}
        <p className="bos-footnote">
          <Badge>计泡</Badge> 按公斤计费时，取实际毛重与「体积 × 计泡系数」中较大的一个（例如 1:200 表示 1 立方按 200 kg 算）。
          整柜按 20GP 约 28 m³、40HQ 约 68 m³ 向上取整。修改运价不影响已保存的报价单。
        </p>
      </Card>
    </>
  );
}

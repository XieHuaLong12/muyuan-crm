'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { Header, Card, Button, Typography, Badge } from '@/components/ui/bos';
import { api } from '@/lib/client';
import type { QuoteTemplates } from '@/services/quote-template-service';
import { QUOTE_LANGUAGES, type FxRates, type QuoteLanguage } from '@/lib/quote-math';
import { DEFAULT_TEMPLATES, LANGUAGE_NAMES, type QuoteTemplateText } from '@/lib/quote-i18n';
import { NumberField } from './NumberField';

const FIELDS: { key: keyof QuoteTemplateText; label: string; long?: boolean }[] = [
  { key: 'title', label: '单据标题' },
  { key: 'companyLine', label: '公司抬头（公司名 | 品牌）' },
  { key: 'contactLine', label: '联系方式（网站 | 邮箱 | WhatsApp | 地址）' },
  { key: 'paymentTerms', label: '付款方式' },
  { key: 'leadTime', label: '生产周期' },
  { key: 'moq', label: '起订量' },
  { key: 'packing', label: '包装方式' },
  { key: 'warranty', label: '质保' },
  { key: 'priceBasis', label: '价格说明' },
  { key: 'notes', label: '报价说明（每行一条）', long: true },
  { key: 'preparedByRole', label: '制单人职务' },
  { key: 'footer', label: '页脚标语' },
  { key: 'unitLabel', label: '默认单位' },
];

export function QuoteSettingsView({ templates: initial, fx: initialFx }: { templates: QuoteTemplates; fx: FxRates }) {
  const [language, setLanguage] = useState<QuoteLanguage>('zh');
  const [templates, setTemplates] = useState(initial);
  const [fx, setFx] = useState<{ usdCny: number | null; eurCny: number | null }>(initialFx);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const current = templates[language];

  const set = (key: keyof QuoteTemplateText, value: string | number) => setTemplates({ ...templates, [language]: { ...current, [key]: value } });

  async function run(task: () => Promise<string>) {
    setBusy(true);
    setError('');
    setMessage('');
    try { setMessage(await task()); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <>
      <Header
        eyebrow="产品库 · 报价单"
        title="报价设置"
        description="报价单的抬头、交易条款和说明按语言分别维护；新报价按这里的内容生成，已保存的报价单不受影响。"
        actions={<Link href="/products/quotes" className="bos-button"><ArrowLeft size={15} /> 报价单列表</Link>}
      />

      <Card>
        <div className="bos-section-title">
          <div><Typography as="h2" variant="heading">报价汇率</Typography><p>用于外币单价折算与运费换算；美元汇率同时用于产品毛利</p></div>
        </div>
        <div className="bos-quote-row">
          <label className="bos-quote-field"><span>1 美元 = ? 人民币</span><NumberField value={fx.usdCny} onValue={v => setFx({ ...fx, usdCny: v })} /></label>
          <label className="bos-quote-field"><span>1 欧元 = ? 人民币（不填则欧元报价需手动填价）</span><NumberField value={fx.eurCny} placeholder="例如 7.80" onValue={v => setFx({ ...fx, eurCny: v })} /></label>
          <Button variant="primary" disabled={busy} onClick={() => void run(async () => {
            const saved = await api<FxRates>('quote-settings/rates', 'PUT', { usdCny: fx.usdCny, eurCny: fx.eurCny ?? '' });
            setFx(saved);
            return '汇率已保存';
          })}>保存汇率</Button>
        </div>
      </Card>

      <Card>
        <div className="bos-section-title">
          <div><Typography as="h2" variant="heading">单据模板</Typography><p>人民币报价默认用中文模板，外币报价默认用英文模板，法文可在报价时手动选择</p></div>
          {current.customized ? <Badge tone="green">已自定义</Badge> : <Badge>默认文案</Badge>}
        </div>
        <div className="bos-tabs" role="tablist" aria-label="模板语言">
          {QUOTE_LANGUAGES.map(code => (
            <button key={code} type="button" role="tab" aria-selected={language === code} onClick={() => setLanguage(code)}>{LANGUAGE_NAMES[code]}</button>
          ))}
        </div>
        <div className="bos-quote-grid">
          {FIELDS.map(field => (
            <label key={field.key} className={`bos-quote-field${field.long ? ' bos-quote-span' : ''}`}>
              <span>{field.label}</span>
              {field.long
                ? <textarea className="bos-input" rows={5} value={String(current[field.key])} onChange={e => set(field.key, e.target.value)} />
                : <input className="bos-input" value={String(current[field.key])} onChange={e => set(field.key, e.target.value)} />}
            </label>
          ))}
          <label className="bos-quote-field"><span>默认有效天数</span>
            <NumberField value={current.validDays} onValue={v => set('validDays', v === null ? 0 : Math.round(v))} />
          </label>
        </div>
        <div className="bos-quote-action-row">
          <Button variant="primary" disabled={busy} onClick={() => void run(async () => {
            const saved = await api<QuoteTemplates[QuoteLanguage]>('quote-settings', 'PUT', { ...current, language });
            setTemplates({ ...templates, [language]: saved });
            return `${LANGUAGE_NAMES[language]}模板已保存`;
          })}>保存{LANGUAGE_NAMES[language]}模板</Button>
          <Button variant="ghost" onClick={() => setTemplates({ ...templates, [language]: { ...DEFAULT_TEMPLATES[language], customized: current.customized } })}>
            <RotateCcw size={14} /> 填回默认文案
          </Button>
        </div>
        {message && <p className="bos-quote-message" role="status">{message}</p>}
        {error && <p className="bos-sales-error" role="alert">{error}</p>}
      </Card>
    </>
  );
}

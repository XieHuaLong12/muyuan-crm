'use client';
import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle,Save,Percent } from 'lucide-react';
import { Header,Card,Table,EmptyState,Typography } from '@/components/ui/bos';

/**
 * 成本与毛利录入（仅管理员）
 *
 * 工厂成本与采购成本是两种供货方式：没做的产品就是外购的，所以通常只填其中一个。
 * 成本不含国内运费与报关 —— 界面上必须如实标注这一点。
 */

type Scenario = { cost: string; profit: string; margin: number } | null;

export type MarginRow = {
  variantId: string;
  sku: string;
  label: string;
  size: string;
  cbm: string;
  productId: string;
  model: string;
  productName: string;
  categoryName: string;
  priceUsd: string | null;
  priceCny: string | null;
  priceCnyFromList: boolean;
  factoryCost: string | null;
  purchaseCost: string | null;
  note: string;
  factory: Scenario;
  purchase: Scenario;
  hasCost: boolean;
  worstMargin: number | null;
  isLowMargin: boolean;
};

export type MarginData = {
  query: { q: string; cost: string; lowOnly: string };
  rate: string;
  lowMarginThreshold: number;
  totals: { variants: number; filled: number; missing: number; lowMargin: number };
  rows: MarginRow[];
};

function buildUrl(query: MarginData['query'], patch: Partial<MarginData['query']>) {
  const next = { ...query, ...patch };
  const params = new URLSearchParams();
  if (next.q) params.set('q', next.q);
  if (next.cost !== 'ALL') params.set('cost', next.cost);
  if (next.lowOnly === 'LOW') params.set('lowOnly', 'LOW');
  const text = params.toString();
  return text ? `/products/margin?${text}` : '/products/margin';
}

function marginTone(margin: number, threshold: number) {
  if (margin < 0) return 'bos-margin-negative';
  if (margin < threshold) return 'bos-margin-low';
  return '';
}

export function ProductMargin({ data }: { data: MarginData }) {
  const [rows, setRows] = useState<MarginRow[]>(data.rows);
  const [rate, setRate] = useState(data.rate);
  const [rateDraft, setRateDraft] = useState(data.rate);
  const [pending, setPending] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function saveCost(event: React.FormEvent<HTMLFormElement>, variantId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const read = (name: string) => {
      const raw = String(form.get(name) ?? '').trim();
      return raw === '' ? null : Number(raw);
    };
    const factoryCost = read('factoryCost');
    const purchaseCost = read('purchaseCost');
    if (factoryCost === null && purchaseCost === null) {
      setError('工厂成本与采购成本至少填一项（或清空后点「清除」）');
      return;
    }
    setError('');
    setMessage('');
    setPending(prev => [...prev, variantId]);
    try {
      const response = await fetch(`/api/product-variants/${variantId}/cost`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ factoryCost, purchaseCost }),
      });
      const body = await response.json();
      if (!body.success) throw new Error(body.error || '保存失败');
      setRows(prev =>
        prev.map(row => {
          if (row.variantId !== variantId) return row;
          const priceCny = row.priceCny ? Number(row.priceCny) : null;
          const calc = (cost: number | null): Scenario => {
            if (priceCny === null || cost === null) return null;
            const profit = priceCny - cost;
            return { cost: cost.toFixed(2), profit: profit.toFixed(2), margin: priceCny === 0 ? 0 : Number(((profit / priceCny) * 100).toFixed(1)) };
          };
          const factory = calc(factoryCost);
          const purchase = calc(purchaseCost);
          const margins = [factory?.margin, purchase?.margin].filter((m): m is number => typeof m === 'number');
          return {
            ...row,
            factoryCost: factoryCost === null ? null : factoryCost.toFixed(2),
            purchaseCost: purchaseCost === null ? null : purchaseCost.toFixed(2),
            factory,
            purchase,
            hasCost: factoryCost !== null || purchaseCost !== null,
            worstMargin: margins.length ? Math.min(...margins) : null,
            isLowMargin: margins.length ? Math.min(...margins) < data.lowMarginThreshold : false,
          };
        }),
      );
      setMessage(`${skuOf(variantId)} 已保存`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(prev => prev.filter(id => id !== variantId));
    }
  }

  function skuOf(variantId: string) {
    return rows.find(r => r.variantId === variantId)?.sku ?? variantId;
  }

  async function saveRate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/settings/exchange-rate', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rate: Number(rateDraft) }),
      });
      const body = await response.json();
      if (!body.success) throw new Error(body.error || '保存失败');
      setRate(body.data.rate);
      setMessage(`汇率已更新为 1 USD = ${body.data.rate} CNY，刷新后毛利按新汇率重算`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <Header
        eyebrow="PRODUCT OS · 仅管理员"
        title="成本与毛利"
        description={`${data.totals.variants} 个尺寸变体 · 已填成本 ${data.totals.filled} · 未填 ${data.totals.missing} · 低毛利 ${data.totals.lowMargin}`}
        actions={
          <Link href="/products" className="bos-button">返回产品库</Link>
        }
      />

      <Card className="bos-cost-note">
        <Percent size={18} />
        <div>
          <strong>毛利率 = （人民币售价 − 成本）÷ 人民币售价</strong>
          <p>
            成本<strong>未含国内运费与报关</strong>，所以这里是<strong>生产毛利率</strong>，不是最终毛利。
            FOB 报价本身已包含送到港口与报关的费用，看数字时请留意这一点。
          </p>
        </div>
      </Card>

      <Card>
        <div className="bos-section-title">
          <div>
            <Typography as="h2" variant="heading">汇率与口径</Typography>
            <p>售价优先取中文报价表的人民币价；没有时用美元价 × 汇率</p>
          </div>
          <form className="bos-rate-form" onSubmit={saveRate}>
            <label>
              1 USD =
              <input
                type="number"
                step="0.0001"
                min="0.0001"
                max="100"
                value={rateDraft}
                onChange={e => setRateDraft(e.target.value)}
                aria-label="美元兑人民币汇率"
              />
              CNY
            </label>
            <button className="bos-button" type="submit" disabled={rateDraft === rate}>更新汇率</button>
          </form>
        </div>
        {message && <p className="bos-cost-message" role="status">{message}</p>}
        {error && <p className="bos-cost-error" role="alert">{error}</p>}
      </Card>

      <Card>
        <form className="bos-lead-filter" action="/products/margin">
          <input type="hidden" name="lowOnly" value={data.query.lowOnly === 'LOW' ? 'LOW' : ''} />
          <label className="bos-search">
            <input className="bos-input" type="search" name="q" aria-label="搜索型号" placeholder="搜索型号，例如 Y-601" defaultValue={data.query.q} />
          </label>
          <select name="cost" aria-label="成本填写情况" defaultValue={data.query.cost}>
            <option value="ALL">全部变体</option>
            <option value="MISSING">未填成本</option>
            <option value="FILLED">已填成本</option>
          </select>
          <button className="bos-button" type="submit">筛选</button>
          {data.totals.lowMargin > 0 && (
            <Link className="bos-button" href={buildUrl(data.query, { lowOnly: data.query.lowOnly === 'LOW' ? 'ALL' : 'LOW', cost: 'FILLED' })}>
              <AlertTriangle size={14} />
              {data.query.lowOnly === 'LOW' ? '显示全部' : `只看低毛利 ${data.totals.lowMargin}`}
            </Link>
          )}
          <Link className="bos-button" href={buildUrl(data.query, { cost: 'MISSING' })}>
            未填成本 {data.totals.missing}
          </Link>
        </form>

        <Table
          caption="成本与毛利"
          headings={['型号 / 尺寸', 'CBM', '售价', '成本录入（人民币）', `自产毛利（<${data.lowMarginThreshold}% 标红）`, '外购毛利']}
        >
          {rows.map(item => (
            <tr key={item.variantId} className={item.isLowMargin ? 'bos-row-review' : undefined}>
              <td>
                <Link href={`/products/${item.productId}`}><strong>{item.model}</strong></Link>
                <small>{item.size}{item.label ? ` · ${item.label}` : ''}</small>
                <small>{item.sku}</small>
              </td>
              <td>{item.cbm}</td>
              <td>
                {item.priceCny ? `¥${item.priceCny}` : '—'}
                {item.priceUsd && <small>US${item.priceUsd}</small>}
                <small>{item.priceCnyFromList ? '中文报价表' : `按 ${rate} 折算`}</small>
              </td>
              <td>
                <form className="bos-cost-form" onSubmit={e => saveCost(e, item.variantId)}>
                  <label>
                    工厂
                    <input name="factoryCost" type="number" step="0.01" min="0" defaultValue={item.factoryCost ?? ''} aria-label={`${item.sku} 工厂成本`} />
                  </label>
                  <label>
                    采购
                    <input name="purchaseCost" type="number" step="0.01" min="0" defaultValue={item.purchaseCost ?? ''} aria-label={`${item.sku} 采购成本`} />
                  </label>
                  <button type="submit" className="bos-button" disabled={pending.includes(item.variantId)} aria-label={`保存 ${item.sku} 的成本`}>
                    <Save size={13} />
                    {pending.includes(item.variantId) ? '保存中' : '保存'}
                  </button>
                </form>
              </td>
              <td className={item.factory ? marginTone(item.factory.margin, data.lowMarginThreshold) : ''}>
                {item.factory ? (
                  <>
                    <strong>{item.factory.margin}%</strong>
                    <small>成本 ¥{item.factory.cost} · 毛利 ¥{item.factory.profit}</small>
                  </>
                ) : (
                  <span className="bos-cost-empty">未填工厂成本</span>
                )}
              </td>
              <td className={item.purchase ? marginTone(item.purchase.margin, data.lowMarginThreshold) : ''}>
                {item.purchase ? (
                  <>
                    <strong>{item.purchase.margin}%</strong>
                    <small>成本 ¥{item.purchase.cost} · 毛利 ¥{item.purchase.profit}</small>
                  </>
                ) : (
                  <span className="bos-cost-empty">未填采购成本</span>
                )}
              </td>
            </tr>
          ))}
        </Table>

        {!rows.length && (
          <EmptyState
            title="没有匹配的变体"
            description="试试其他型号关键词，或切换「未填成本 / 已填成本」筛选。"
            action={<Link href="/products/margin" className="bos-button">清除筛选</Link>}
          />
        )}

        <p className="bos-footnote">
          共 {rows.length} 行（当前筛选）· 全库已填成本 {data.totals.filled} / {data.totals.variants}
          {data.totals.missing > 0 && ` · 还有 ${data.totals.missing} 个尺寸没填成本`}
          。没做的产品就是外购的，通常只需要填其中一列。
        </p>
      </Card>
    </>
  );
}

import { forwardRef } from 'react';
import type { QuoteDocumentData } from '@/services/itemized-quote-service';
import { FREIGHT_MODE_LABELS, QUOTE_LABELS, formatAmount, formatNumber } from '@/lib/quote-i18n';

/**
 * 报价单（对外单据）。构建器实时预览、已保存单据、导出图片 / PDF / 打印都用这一份渲染，保证所见即所发。
 * 版面沿用 LVANJU 报价单 Excel：抬头 → 买方 / 报价信息 → 交易条款 → 产品明细 → 合计 → 报价说明 → 制单人。
 * data-pdf-break 标记整行内容块的下边缘，导出 PDF 时只在这些位置分页。
 */

const LANG_ATTR = { zh: 'zh-CN', en: 'en', fr: 'fr' } as const;

export const QuoteDocument = forwardRef<HTMLElement, { data: QuoteDocumentData; placeholder?: string }>(function QuoteDocument({ data, placeholder }, ref) {
  const t = QUOTE_LABELS[data.language];
  const money = (value: number) => formatAmount(value, data.language);
  const incoterm = `${data.incoterm}${data.incotermPlace ? ` ${data.incotermPlace}` : ''}, Incoterms® 2020`;
  const freightDetail = data.freight
    ? [data.freight.incoterm, data.destination, FREIGHT_MODE_LABELS[data.freight.mode]?.[data.language]].filter(Boolean).join(' · ')
    : '';
  const hasCharges = data.totals.freight > 0 || data.totals.other > 0 || data.freight !== null;
  const terms: [string, string][] = [
    [t.payment, data.terms.paymentTerms],
    [t.leadTime, data.terms.leadTime],
    [t.moq, data.terms.moq],
    [t.packing, data.terms.packing],
    [t.warranty, data.terms.warranty],
    [t.priceBasis, data.terms.priceBasis],
  ].filter((row): row is [string, string] => Boolean(row[1]));

  return (
    <article ref={ref} className="quote-doc" lang={LANG_ATTR[data.language]}>
      <header className="quote-doc-head" data-pdf-break>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="quote-doc-logo" src="/brand/lvanju-logo.jpg" alt="LVANJU" width={208} height={84} />
        <div>
          <h1>{data.header.title}</h1>
          <p className="quote-doc-company">{data.header.companyLine}</p>
          <p className="quote-doc-contact">{data.header.contactLine}</p>
        </div>
      </header>

      <section className="quote-doc-info" data-pdf-break>
        <div>
          <h2>{t.buyerInfo}</h2>
          <dl>
            <div><dt>{t.buyerCompany}</dt><dd>{data.buyer.company || '—'}</dd></div>
            <div><dt>{t.attn}</dt><dd>{data.buyer.attn || '—'}</dd></div>
            <div><dt>{t.email}</dt><dd>{data.buyer.email || '—'}</dd></div>
            <div><dt>{t.phone}</dt><dd>{data.buyer.phone || '—'}</dd></div>
            <div><dt>{t.shipTo}</dt><dd>{data.buyer.address || '—'}</dd></div>
          </dl>
        </div>
        <div>
          <h2>{t.quoteInfo}</h2>
          <dl>
            <div><dt>{t.quoteNo}</dt><dd><strong>{data.quoteNumber}</strong></dd></div>
            <div><dt>{t.date}</dt><dd>{data.quoteDate}</dd></div>
            <div><dt>{t.validUntil}</dt><dd>{data.validUntil}</dd></div>
            <div><dt>{t.currency}</dt><dd>{data.currency}</dd></div>
            <div><dt>{t.incoterm}</dt><dd>{incoterm}</dd></div>
          </dl>
        </div>
      </section>

      {terms.length > 0 && (
        <section className="quote-doc-terms">
          <h2>{t.commercialTerms}</h2>
          <dl>
            {terms.map(([label, value]) => (
              <div key={label} data-pdf-break><dt>{label}</dt><dd>{value}</dd></div>
            ))}
          </dl>
        </section>
      )}

      <section className="quote-doc-items">
        <h2>{t.itemized}</h2>
        <table>
          <thead>
            <tr data-pdf-break>
              <th className="quote-doc-no">{t.colNo}</th>
              <th className="quote-doc-image">{t.colImage}</th>
              <th className="quote-doc-model">{t.colModel}</th>
              <th>{t.colSize}</th>
              <th className="quote-doc-material">{t.colMaterial}</th>
              <th>{t.colPacking}</th>
              <th>{t.colUnit}</th>
              <th className="quote-doc-num">{t.colQty}</th>
              <th className="quote-doc-num">{t.colCbm}</th>
              <th className="quote-doc-num">{t.colGw}</th>
              <th className="quote-doc-num">{t.colUnitPrice}<br />({data.currency})</th>
              <th className="quote-doc-num">{t.colAmount}<br />({data.currency})</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item, index) => (
              <tr key={index} data-pdf-break>
                <td className="quote-doc-no">{index + 1}</td>
                <td className="quote-doc-image">
                  {item.image
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={`/${item.image}`} alt={item.name} width={96} height={72} />
                    : <span className="quote-doc-noimage" aria-hidden>—</span>}
                </td>
                <td className="quote-doc-model">
                  <strong>{item.name}</strong>
                  {item.note && <small>{item.note}</small>}
                </td>
                <td>{item.dimensions || '—'}</td>
                <td className="quote-doc-material">{item.material || '—'}</td>
                <td>{item.packing || '—'}</td>
                <td>{item.unit || '—'}</td>
                <td className="quote-doc-num">{item.quantity}</td>
                <td className="quote-doc-num">{item.cbm ? formatNumber(item.cbm, data.language, 4) : '—'}</td>
                <td className="quote-doc-num">{item.grossWeightKg ? formatNumber(item.grossWeightKg, data.language) : '—'}</td>
                <td className="quote-doc-num">{money(item.unitPrice)}</td>
                <td className="quote-doc-num"><strong>{money(item.amount)}</strong></td>
              </tr>
            ))}
            {!data.items.length && (
              <tr data-pdf-break><td colSpan={12} className="quote-doc-empty">{placeholder ?? '—'}</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="quote-doc-totals" data-pdf-break>
        <h2>{t.totals}</h2>
        <div className="quote-doc-totals-grid">
          <dl className="quote-doc-measures">
            <div><dt>{t.totalQty}</dt><dd>{data.totals.totalQuantity}</dd></div>
            <div><dt>{t.totalCbm}</dt><dd>{data.totals.totalCbm ? formatNumber(data.totals.totalCbm, data.language, 4) : '—'}</dd></div>
            <div><dt>{t.totalGw}</dt><dd>{data.totals.totalGrossWeightKg ? formatNumber(data.totals.totalGrossWeightKg, data.language) : '—'}</dd></div>
          </dl>
          <dl className="quote-doc-money">
            <div><dt>{t.subtotal}</dt><dd>{data.currency} {money(data.totals.subtotal)}</dd></div>
            {hasCharges ? (
              <>
                {data.freight !== null || data.totals.freight > 0 ? (
                  <div><dt>{t.freight}{freightDetail && <small>{freightDetail}</small>}</dt><dd>{data.currency} {money(data.totals.freight)}</dd></div>
                ) : null}
                {data.totals.other > 0 && <div><dt>{t.other}</dt><dd>{data.currency} {money(data.totals.other)}</dd></div>}
              </>
            ) : (
              <div><dt>{t.noFreight}</dt><dd>{data.currency} {money(0)}</dd></div>
            )}
            <div className="quote-doc-grand"><dt>{t.grandTotal}</dt><dd>{data.currency} {money(data.totals.total)}</dd></div>
          </dl>
        </div>
      </section>

      {data.terms.notes && (
        <section className="quote-doc-notes" data-pdf-break>
          <h2>{t.notes}</h2>
          <p>{data.terms.notes}</p>
        </section>
      )}

      <footer className="quote-doc-foot" data-pdf-break>
        <p>{t.preparedBy}{data.language === 'zh' ? '：' : ': '}{data.preparedBy}{data.header.preparedByRole ? `  |  ${data.header.preparedByRole}` : ''}</p>
        <p className="quote-doc-slogan">{data.header.footer}</p>
      </footer>
    </article>
  );
});

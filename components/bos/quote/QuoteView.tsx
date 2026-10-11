'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, Copy, Download, FileDown, Image as ImageIcon, PencilLine, Printer, Share2, CopyPlus } from 'lucide-react';
import { Header, Card, Badge, Button, Typography } from '@/components/ui/bos';
import { api } from '@/lib/client';
import type { QuoteDetail } from '@/services/itemized-quote-service';
import { FREIGHT_BASIS_LABELS, FREIGHT_MODE_LABELS, LANGUAGE_NAMES, formatAmount } from '@/lib/quote-i18n';
import { canCopyImage, canShareFiles, copyImage, downloadBlob, quotePdf, quotePng, shareFile } from '@/lib/quote-export';
import { QuoteDocument } from './QuoteDocument';
import { ScaledPreview } from './ScaledPreview';

const SOURCE_LABEL: Record<string, string> = { LIST: '价格表', LAST_QUOTE: '沿用上次报价', MANUAL: '手动' };

export function QuoteView({ detail, justSaved }: { detail: QuoteDetail; justSaved: boolean }) {
  const router = useRouter();
  const docRef = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(justSaved ? '报价单已保存。下载图片或 PDF 发给客户；发出后点「登记已发送」，系统会安排 3 天后的跟进提醒。' : '');
  const [error, setError] = useState('');
  const [abilities, setAbilities] = useState({ copy: false, share: false });
  const doc = detail.document;
  const fileBase = `${doc.quoteNumber}${detail.customer.companyName ? `-${detail.customer.companyName}` : ''}`.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 80);
  const money = (value: number) => `${doc.currency} ${formatAmount(value, 'zh')}`;

  useEffect(() => { setAbilities({ copy: canCopyImage(), share: canShareFiles() }); }, []);

  async function run(label: string, task: (node: HTMLElement) => Promise<string | void>) {
    const node = docRef.current;
    if (!node || busy) return;
    setBusy(label);
    setError('');
    try {
      const done = await task(node);
      if (done) setMessage(done);
    } catch (e) {
      setError(`${label}失败：${(e as Error).message || '请重试'}`);
    } finally {
      setBusy('');
    }
  }

  function print() {
    document.documentElement.classList.add('quote-printing');
    const done = () => { document.documentElement.classList.remove('quote-printing'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
  }

  async function markSent() {
    setBusy('登记');
    setError('');
    try {
      await api(`quotations/${detail.id}`, 'PATCH');
      setMessage('已登记发送：客户阶段更新为「已报价」，3 天后会提醒跟进。');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  const sent = detail.status === 'SENT';
  const freight = detail.freightDetail;
  const basisUnit = freight ? FREIGHT_BASIS_LABELS[freight.basis]?.unit ?? '' : '';

  return (
    <>
      <Header
        eyebrow="产品库 · 报价单"
        title={doc.quoteNumber}
        description={`${detail.customer.name}${detail.customer.companyName ? ` · ${detail.customer.companyName}` : ''} · ${money(doc.totals.total)} · ${LANGUAGE_NAMES[doc.language]}单据`}
        actions={<Link href="/products/quotes" className="bos-button"><ArrowLeft size={15} /> 报价单列表</Link>}
      />

      <Card className="bos-quote-actions">
        <div className="bos-quote-action-row">
          <Button variant="primary" disabled={Boolean(busy)} onClick={() => void run('生成图片', async node => { downloadBlob(await quotePng(node), `${fileBase}.png`); return '图片已下载，可以直接发到 WhatsApp。'; })}>
            <ImageIcon size={15} /> {busy === '生成图片' ? '生成中…' : '下载图片'}
          </Button>
          <Button variant="primary" disabled={Boolean(busy)} onClick={() => void run('生成 PDF', async node => { downloadBlob(await quotePdf(node, doc.quoteNumber), `${fileBase}.pdf`); return 'PDF 已下载。'; })}>
            <FileDown size={15} /> {busy === '生成 PDF' ? '生成中…' : '下载 PDF'}
          </Button>
          {abilities.copy && (
            <Button disabled={Boolean(busy)} onClick={() => void run('复制图片', async node => { await copyImage(quotePng(node)); return '图片已复制，可以直接粘贴到 WhatsApp / 微信对话框。'; })}>
              <Copy size={15} /> 复制图片
            </Button>
          )}
          {abilities.share && (
            <>
              <Button disabled={Boolean(busy)} onClick={() => void run('分享图片', async node => { await shareFile(await quotePng(node), `${fileBase}.png`, doc.quoteNumber); })}>
                <Share2 size={15} /> 分享图片
              </Button>
              <Button disabled={Boolean(busy)} onClick={() => void run('分享 PDF', async node => { await shareFile(await quotePdf(node, doc.quoteNumber), `${fileBase}.pdf`, doc.quoteNumber); })}>
                <Download size={15} /> 分享 PDF
              </Button>
            </>
          )}
          <Button disabled={Boolean(busy)} onClick={print}><Printer size={15} /> 打印</Button>
        </div>
        <div className="bos-quote-action-row">
          {sent
            ? <Badge tone="green"><Check size={12} /> 已登记发送</Badge>
            : <Button disabled={Boolean(busy)} onClick={() => void markSent()}><Check size={15} /> 登记已发送</Button>}
          {!sent && detail.itemized && <Link className="bos-button" href={`/products/quotes/new?edit=${detail.id}`}><PencilLine size={15} /> 修改</Link>}
          <Link className="bos-button" href={`/products/quotes/new?from=${detail.id}`}><CopyPlus size={15} /> 复制为新报价</Link>
          <Link className="bos-text-link" href={`/customers/${detail.customer.id}`}>查看客户档案 →</Link>
        </div>
        {message && <p className="bos-quote-message" role="status">{message}</p>}
        {error && <p className="bos-sales-error bos-quote-error" role="alert">{error}</p>}
      </Card>

      <div className="bos-quote-view">
        <div className="bos-quote-print-root">
          <ScaledPreview label="报价单">
            <QuoteDocument ref={docRef} data={doc} />
          </ScaledPreview>
        </div>

        <aside className="bos-quote-side">
          <Card>
            <Typography as="h2" variant="heading">内部信息</Typography>
            <p className="bos-footnote bos-quote-tight">以下内容只在系统里显示，不会出现在发给客户的单据上。</p>
            <dl className="bos-quote-facts">
              <div><dt>状态</dt><dd>{sent ? `已发送 · ${detail.sentAt?.slice(0, 10)}` : '草稿'}</dd></div>
              <div><dt>客户</dt><dd><Link href={`/customers/${detail.customer.id}`}>{detail.customer.name}</Link>{detail.customer.country ? ` · ${detail.customer.country}` : ''}</dd></div>
              <div><dt>制单</dt><dd>{detail.creatorName || '—'} · {detail.createdAt.slice(0, 10)}</dd></div>
              {freight && (
                <div>
                  <dt>运费计算</dt>
                  <dd>
                    {freight.manual
                      ? `手动填写 ${money(doc.totals.freight)}`
                      : `${FREIGHT_MODE_LABELS[freight.mode]?.zh ?? freight.mode} ${freight.incoterm}：${freight.rateCurrency} ${formatAmount(freight.rate, 'zh')}/${basisUnit} × ${freight.chargeableQty} ${basisUnit}`}
                    {freight.volumetricKg !== null && !freight.manual ? `（体积重 ${freight.volumetricKg} kg）` : ''}
                    {freight.manual && freight.computedAmount !== null ? `（运费库算出 ${money(freight.computedAmount)}）` : ''}
                  </dd>
                </div>
              )}
              {detail.remark && <div><dt>内部备注</dt><dd className="bos-quote-pre">{detail.remark}</dd></div>}
            </dl>
          </Card>
          {detail.itemized && (
            <Card>
              <Typography as="h2" variant="heading">单价来源</Typography>
              <ul className="bos-quote-sources">
                {doc.items.map((item, index) => {
                  const source = detail.priceSources[index];
                  return (
                    <li key={index}>
                      <span><strong>{item.name}</strong><small>{item.quantity} × {money(item.unitPrice)}</small></span>
                      <span>
                        <Badge tone={source.priceSource === 'MANUAL' ? 'warning' : source.priceSource === 'LAST_QUOTE' ? 'green' : 'neutral'}>{SOURCE_LABEL[source.priceSource] ?? '手动'}</Badge>
                        {source.listPrice !== null && <small>价格表 {formatAmount(source.listPrice, 'zh')}</small>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}

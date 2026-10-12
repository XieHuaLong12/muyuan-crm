import Link from 'next/link';
import { FilePlus2, Settings2, Truck } from 'lucide-react';
import { Header, Card, Table, Badge, EmptyState } from '@/components/ui/bos';
import type { QuoteList } from '@/services/itemized-quote-service';
import { LANGUAGE_NAMES, formatAmount } from '@/lib/quote-i18n';
import type { QuoteLanguage } from '@/lib/quote-math';

const STATUS_TABS = [['ALL', '全部'], ['DRAFT', '草稿'], ['SENT', '已发送']] as const;

function href(query: QuoteList['query'], patch: Partial<QuoteList['query']>) {
  const next = { ...query, ...patch, page: patch.page ?? 1 };
  const params = new URLSearchParams();
  if (next.q) params.set('q', next.q);
  if (next.status !== 'ALL') params.set('status', next.status);
  if (next.page > 1) params.set('page', String(next.page));
  const text = params.toString();
  return text ? `/products/quotes?${text}` : '/products/quotes';
}

export function QuoteListView({ data, isAdmin, timezone }: { data: QuoteList; isAdmin: boolean; timezone: string }) {
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const day = (iso: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  return (
    <>
      <Header
        title="报价单"
        description="从产品库选型号、自动带价、按运费库算运费，一键生成中英文报价图片与 PDF。每份报价都挂在客户档案下。"
        actions={
          <>
            <Link href="/products/freight" className="bos-button"><Truck size={15} /> 运费库</Link>
            {isAdmin && <Link href="/products/quotes/settings" className="bos-button"><Settings2 size={15} /> 报价设置</Link>}
            <Link href="/products/quotes/new" className="bos-button bos-button-primary"><FilePlus2 size={15} /> 新建报价</Link>
          </>
        }
      />
      <Card>
        <nav className="bos-tabs" aria-label="报价状态">
          {STATUS_TABS.map(([key, label]) => (
            <Link key={key} href={href(data.query, { status: key })} aria-current={data.query.status === key ? 'page' : undefined}>{label}</Link>
          ))}
        </nav>
        <form className="bos-lead-filter" action="/products/quotes">
          {data.query.status !== 'ALL' && <input type="hidden" name="status" value={data.query.status} />}
          <label className="bos-search">
            <input className="bos-input" type="search" name="q" aria-label="搜索报价" placeholder="搜索报价编号、客户或型号" defaultValue={data.query.q} />
          </label>
          <button className="bos-button" type="submit">搜索</button>
        </form>
        <Table caption="报价单" headings={['报价编号', '客户', '产品', '报价总额', '条款', '日期', '状态']}>
          {data.rows.map(row => (
            <tr key={row.id}>
              <td>
                <Link href={`/products/quotes/${row.id}`}><strong>{row.quoteNumber}</strong></Link>
                <small>{row.itemized ? `${LANGUAGE_NAMES[row.language as QuoteLanguage] ?? row.language} · ${row.creatorName}` : '旧版单行报价'}</small>
              </td>
              <td>
                <Link href={`/customers/${row.customer.id}`}>{row.customer.name}</Link>
                <small>{[row.customer.companyName, row.customer.country].filter(Boolean).join(' · ') || '—'}</small>
              </td>
              <td>{row.product}<small>{row.quantity} 件{row.itemized ? ` · ${row.itemCount} 个规格` : ''}</small></td>
              <td><strong>{row.currency} {formatAmount(Number(row.amount), 'zh')}</strong></td>
              <td>{row.incoterm}{row.destination && <small>{row.destination}</small>}</td>
              <td>{day(row.createdAt)}{row.sentAt && <small>发送 {day(row.sentAt)}</small>}</td>
              <td><Badge tone={row.status === 'SENT' ? 'green' : 'neutral'}>{row.status === 'SENT' ? '已发送' : '草稿'}</Badge></td>
            </tr>
          ))}
        </Table>
        {!data.rows.length && (data.query.q || data.query.status !== 'ALL'
          ? <EmptyState title="没有匹配的报价" description="换个关键词，或清除筛选。" action={<Link href="/products/quotes" className="bos-button">清除筛选</Link>} />
          : <EmptyState title="还没有报价单" description="选客户、加产品、选运费，一分钟做好一份中英文报价单。" action={<Link href="/products/quotes/new" className="bos-button bos-button-primary">新建报价</Link>} />)}
        <div className="bos-pagination">
          <span>第 {data.query.page} 页 · 共 {pages} 页 · {data.total} 份报价</span>
          <div>
            {data.query.page > 1 && <Link className="bos-button" href={href(data.query, { page: data.query.page - 1 })}>上一页</Link>}
            {data.query.page < pages && <Link className="bos-button" href={href(data.query, { page: data.query.page + 1 })}>下一页</Link>}
          </div>
        </div>
      </Card>
    </>
  );
}

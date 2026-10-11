import { BOSShell } from '@/components/bos/BOSShell';
import { Card, EmptyState, Header, Table } from '@/components/ui/bos';
import { PeriodPicker } from '@/components/period-picker';
import { adminWorkspacePage } from '@/services/workspace-page';
import { sourcesAndCountries, type SourcesAndCountries } from '@/services/source-analysis-service';
import { METRIC_NOTES } from '@/lib/metric-notes';

export const dynamic = 'force-dynamic';

const money = (list: { currency: string; amount: string }[]) => list.length
  ? list.map(item => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: item.currency, maximumFractionDigits: 0 }).format(Number(item.amount))).join(' · ')
  : '—';

function Breakdown({ title, rows }: { title: string; rows: SourcesAndCountries['sources'] }) {
  return (
    <Card>
      <h2>{title}</h2>
      {rows.length ? (
        <Table caption={title} headings={[title.replace('按', ''), '新增询盘', '有效客户', '有效率', '成交客户', '成交额']}>
          {rows.map(row => (
            <tr key={row.key || 'none'}>
              <td>{row.label}</td><td>{row.inquiries}</td><td>{row.qualified}</td>
              <td>{row.qualifiedRate === null ? '—' : `${row.qualifiedRate}%`}</td><td>{row.wonCustomers}</td><td>{money(row.revenue)}</td>
            </tr>
          ))}
        </Table>
      ) : <EmptyState title="这段时间没有询盘和成交" description="换一个时间段看看。" />}
    </Card>
  );
}

/** Source and country breakdown. Trends, the funnel and targets are on the cockpit; this page only adds the split. */
export default async function Page({ searchParams }: { searchParams: Promise<{ range?: string; startDate?: string; endDate?: string }> }) {
  const { user, boot } = await adminWorkspacePage();
  const data = await sourcesAndCountries(user, await searchParams);
  const { totals } = data;
  return (
    <BOSShell boot={boot}>
      <div className="bos-source-analysis">
        <Header title="来源与国家" description={`${data.selected.startKey} — ${data.selected.endKey} · 新增询盘 ${totals.inquiries} 位 · 有效客户 ${totals.qualified} 位 · 成交客户 ${totals.wonCustomers} 位 · 成交额 ${money(totals.revenue)}`}
          actions={<PeriodPicker basePath="/command-center/analysis" selected={data.selected} />} />
        <div className="bos-source-grid">
          <Breakdown title="按来源" rows={data.sources} />
          <Breakdown title="按国家" rows={data.countries} />
        </div>
        <p className="bos-footnote">{METRIC_NOTES.newInquiries}{METRIC_NOTES.qualified}成交客户与成交额按成交日期统计，客户按其来源和国家归类。{METRIC_NOTES.revenue}</p>
      </div>
    </BOSShell>
  );
}

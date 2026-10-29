import { BOSShell } from '@/components/bos/BOSShell';
import { CustomerAnalytics } from '@/components/bos-v2/CustomerAnalytics';
import { adminWorkspacePage } from '@/services/workspace-page';
import { customerAnalytics } from '@/services/customer-analytics-service';

export const dynamic = 'force-dynamic';

/** 客户分析: the period's new leads by grade, the funnel per grade, and where the good ones come from. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user, boot } = await adminWorkspacePage();
  const data = await customerAnalytics(user, await searchParams);
  return <BOSShell boot={boot}><CustomerAnalytics data={data} /></BOSShell>;
}

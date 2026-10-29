import { BOSShell } from '@/components/bos/BOSShell';
import { MessageAnalytics } from '@/components/bos-v2/MessageAnalytics';
import { adminWorkspacePage } from '@/services/workspace-page';
import { messageAnalytics } from '@/services/message-analytics-service';

export const dynamic = 'force-dynamic';

/** 消息分析: how much we and our customers write, how fast we answer, and how the conversations stand. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user, boot } = await adminWorkspacePage();
  const data = await messageAnalytics(user, await searchParams);
  return <BOSShell boot={boot}><MessageAnalytics data={data} /></BOSShell>;
}

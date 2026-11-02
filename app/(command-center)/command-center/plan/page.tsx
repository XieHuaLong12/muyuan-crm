import { BOSShell } from '@/components/bos/BOSShell';
import { AIPlan } from '@/components/bos-v2/AIPlan';
import { adminWorkspacePage } from '@/services/workspace-page';
import { aiPlan } from '@/services/ai-plan-service';

export const dynamic = 'force-dynamic';

/** AI 计划: today's work laid out by when customers are online, last week's report, and ad suggestions to adopt or ignore. */
export default async function Page() {
  const { user, boot } = await adminWorkspacePage();
  const data = await aiPlan(user);
  return <BOSShell boot={boot}><AIPlan data={JSON.parse(JSON.stringify(data))} /></BOSShell>;
}

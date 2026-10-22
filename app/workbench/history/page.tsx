import { BOSShell } from '@/components/bos/BOSShell';
import { ReviewHistory } from '@/components/workbench/ReviewHistory';
import { adminWorkspacePage, jsonForClient } from '@/services/workspace-page';
import { historyQuery, reviewHistory } from '@/services/daily-review-service';
export const dynamic='force-dynamic';

/** 复盘记录: the month at a glance and every day's review, plan and changes (?month=yyyy-MM, ?q= to search). */
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
  const {user,boot}=await adminWorkspacePage();
  const query=historyQuery.safeParse(await searchParams);
  return <BOSShell boot={boot}><ReviewHistory data={jsonForClient(await reviewHistory(user,query.success?query.data:{}))}/></BOSShell>;
}

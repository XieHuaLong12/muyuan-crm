import { BOSShell } from '@/components/bos/BOSShell';
import { DailyReview } from '@/components/workbench/DailyReview';
import { adminWorkspacePage, jsonForClient } from '@/services/workspace-page';
import { reviewDay, reviewQuery } from '@/services/daily-review-service';
export const dynamic='force-dynamic';

/** 每日复盘: today's review (or ?date= for a day in the last 30 not reviewed yet). */
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
  const {user,boot}=await adminWorkspacePage();
  const query=reviewQuery.safeParse(await searchParams);
  const data=await reviewDay(user,query.success?query.data:{});
  return <BOSShell boot={boot}><DailyReview key={data.date} initial={jsonForClient(data)}/></BOSShell>;
}

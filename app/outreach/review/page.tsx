import { BOSShell } from '@/components/bos/BOSShell';
import { ReviewQueue } from '@/components/outreach/ReviewQueue';
import { jsonForClient, workspacePage } from '@/services/workspace-page';
import { reviewList, reviewQuery } from '@/services/outreach-review-service';
export const dynamic='force-dynamic';

/** 人工复核: salespeople see their own customers, administrators everyone's. */
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
  const {user,boot}=await workspacePage();
  const query=reviewQuery.safeParse(await searchParams);
  const data=await reviewList(user,query.success?query.data:{});
  return <BOSShell boot={boot}><ReviewQueue data={jsonForClient(data)}/></BOSShell>;
}

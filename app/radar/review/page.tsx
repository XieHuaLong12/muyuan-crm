import Link from 'next/link';
import { BOSShell } from '@/components/bos/BOSShell';
import { ReviewBoard } from '@/components/radar/ReviewBoard';
import { ReplyReview } from '@/components/radar/ReplyReview';
import { adminWorkspacePage, jsonForClient } from '@/services/workspace-page';
import { reviewSends } from '@/services/radar-queue-service';
import { reviewReplies } from '@/services/radar-inbox-service';
export const dynamic='force-dynamic';

/** 待复核: mails waiting for a person before they go, and replies waiting for a person after they came. */
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const {user,boot}=await adminWorkspacePage();
  const tab=(await searchParams).tab==='replies'?'replies':'sends';
  const [sends,replies]=await Promise.all([reviewSends(user),reviewReplies(user)]);
  const tabs=<nav className="bos-radar-tabs" aria-label="复核分类">
    <Link href="/radar/review" aria-current={tab==='sends'?'page':undefined}>待审核的信{sends.length?` ${sends.length}`:''}</Link>
    <Link href="/radar/review?tab=replies" aria-current={tab==='replies'?'page':undefined}>待复核的回复{replies.length?` ${replies.length}`:''}</Link>
  </nav>;
  return <BOSShell boot={boot}><ReviewBoard sends={tab==='sends'?jsonForClient(sends):[]} tabs={tabs} replies={tab==='replies'?<ReplyReview replies={jsonForClient(replies)}/>:undefined}/></BOSShell>;
}

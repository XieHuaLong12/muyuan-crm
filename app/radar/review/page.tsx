import { BOSShell } from '@/components/bos/BOSShell';
import { ReviewBoard } from '@/components/radar/ReviewBoard';
import { adminWorkspacePage, jsonForClient } from '@/services/workspace-page';
import { reviewSends } from '@/services/radar-queue-service';
export const dynamic='force-dynamic';

/** 待复核: mails waiting for a person before they go. */
export default async function Page(){
  const {user,boot}=await adminWorkspacePage();
  return <BOSShell boot={boot}><ReviewBoard sends={jsonForClient(await reviewSends(user))}/></BOSShell>;
}

import { BOSShell } from '@/components/bos/BOSShell';
import { ReplyManager, type ReplyRow } from '@/components/messages/ReplyManager';
import { jsonForClient, workspacePage } from '@/services/workspace-page';
import { quickReplyList } from '@/services/quick-reply-service';
import { Reveal, MOTION_DELAY } from '@/components/ui/motion';

export const dynamic = 'force-dynamic';

/** 常用回复: the company's and one's own ready replies, filled into the chat input with a click or "/". */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user, boot } = await workspacePage();
  const [list, query] = await Promise.all([quickReplyList(user), searchParams]);
  return <BOSShell boot={boot}><Reveal delay={MOTION_DELAY.main}>
    <ReplyManager initial={jsonForClient<ReplyRow[]>(list.replies)} canShare={list.canShare} startNew={query.new === '1'} />
  </Reveal></BOSShell>;
}

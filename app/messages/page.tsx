import { BOSShell } from '@/components/bos/BOSShell';
import { MessageCenter } from '@/components/messages/MessageCenter';
import type { InboxList } from '@/components/messages/types';
import { inboxConversations } from '@/services/inbox-service';
import { jsonForClient, workspacePage } from '@/services/workspace-page';

export const dynamic = 'force-dynamic';

/** WhatsApp message center: salespeople chat with their own customers, administrators with everyone's. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user, boot } = await workspacePage();
  const query = await searchParams;
  const initialList = jsonForClient<InboxList>(await inboxConversations(user, { filter: 'all' }));
  const customer = typeof query.customer === 'string' && query.customer.length <= 191 ? query.customer : null;
  return <BOSShell boot={boot}>
    <MessageCenter initialList={initialList} initialCustomerId={customer} timezone={boot.settings.timezone} admin={user.role === 'ADMIN'} />
  </BOSShell>;
}

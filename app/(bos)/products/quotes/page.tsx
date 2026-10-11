import { BOSShell } from '@/components/bos/BOSShell';
import { QuoteListView } from '@/components/bos/quote/QuoteListView';
import { workspacePage } from '@/services/workspace-page';
import { quoteList } from '@/services/itemized-quote-service';
import { Reveal,MOTION_DELAY } from '@/components/ui/motion';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){const {user,boot}=await workspacePage();return <BOSShell boot={boot}><Reveal delay={MOTION_DELAY.main}><QuoteListView data={await quoteList(user,await searchParams)} isAdmin={user.role==='ADMIN'} timezone={boot.settings.timezone}/></Reveal></BOSShell>;}

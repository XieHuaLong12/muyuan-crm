import { BOSShell } from '@/components/bos/BOSShell';
import { QuoteSettingsView } from '@/components/bos/quote/QuoteSettingsView';
import { adminWorkspacePage } from '@/services/workspace-page';
import { quoteSettings } from '@/services/quote-template-service';
export const dynamic='force-dynamic';
export default async function Page(){const {user,boot}=await adminWorkspacePage();const {templates,fx}=await quoteSettings(user);return <BOSShell boot={boot}><QuoteSettingsView templates={templates} fx={fx}/></BOSShell>;}

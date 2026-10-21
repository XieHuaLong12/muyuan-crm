import { BOSShell } from '@/components/bos/BOSShell';
import { ScriptLibrary } from '@/components/outreach/ScriptLibrary';
import { jsonForClient, workspacePage } from '@/services/workspace-page';
import { listScripts, outreachSettings } from '@/services/outreach-script-service';
import { approvedTemplates, templatesConfigured } from '@/services/whatsapp-template-service';
export const dynamic='force-dynamic';

/** 话术库: everyone reads it; administrators add scripts, versions and statuses. */
export default async function Page(){
  const {user,boot}=await workspacePage();
  const admin=user.role==='ADMIN';
  // Approved template names to bind scripts to; the library still works when Gupshup is not reachable.
  const templateNames=admin&&templatesConfigured()?await approvedTemplates().then(list=>list.map(t=>t.name)).catch(()=>[]):[];
  const [scripts,settings]=await Promise.all([listScripts(user),outreachSettings(user)]);
  return <BOSShell boot={boot}><ScriptLibrary scripts={jsonForClient(scripts)} config={settings.config} admin={admin} templateNames={templateNames}/></BOSShell>;
}

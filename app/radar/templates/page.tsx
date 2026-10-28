import { BOSShell } from '@/components/bos/BOSShell';
import { TemplateLibrary } from '@/components/radar/TemplateLibrary';
import { adminWorkspacePage, jsonForClient } from '@/services/workspace-page';
import { listTemplates } from '@/services/radar-template-service';
import { radarSettings } from '@/services/radar-config-service';
export const dynamic='force-dynamic';

/** 模板: the cold e-mail templates, versioned and locked once sent. */
export default async function Page(){
  const {user,boot}=await adminWorkspacePage();
  const [templates,settings]=await Promise.all([listTemplates(user),radarSettings(user)]);
  return <BOSShell boot={boot}><TemplateLibrary templates={jsonForClient(templates)} catalogUrls={settings.config.catalogUrls}/></BOSShell>;
}

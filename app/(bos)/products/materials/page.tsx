import { BOSShell } from '@/components/bos/BOSShell';
import { MaterialLibrary, type MaterialRow } from '@/components/bos/MaterialLibrary';
import { jsonForClient, workspacePage } from '@/services/workspace-page';
import { listMaterials } from '@/services/sales-material-service';
import { Reveal, MOTION_DELAY } from '@/components/ui/motion';
export const dynamic = 'force-dynamic';
/** 资料文件: the catalogs and spec sheets salespeople send from the chat's 产品资料. */
export default async function Page() {
  const { user, boot } = await workspacePage();
  const rows = jsonForClient<MaterialRow[]>(await listMaterials());
  return <BOSShell boot={boot}><Reveal delay={MOTION_DELAY.main}><MaterialLibrary initial={rows} isAdmin={user.role === 'ADMIN'} /></Reveal></BOSShell>;
}

import { BOSShell } from '@/components/bos/BOSShell';
import { ProductEditor } from '@/components/bos/ProductEditor';
import { adminWorkspacePage } from '@/services/workspace-page';
import { productEditor } from '@/services/product-admin-service';
export const dynamic='force-dynamic';
export default async function Page(){const {user,boot}=await adminWorkspacePage();return <BOSShell boot={boot}><ProductEditor data={await productEditor(user,null)}/></BOSShell>;}

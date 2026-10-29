import { BOSShell } from '@/components/bos/BOSShell';
import { ProductEditor } from '@/components/bos/ProductEditor';
import { adminWorkspacePage } from '@/services/workspace-page';
import { productEditor } from '@/services/product-admin-service';
export const dynamic='force-dynamic';
export default async function Page({params}:{params:Promise<{id:string}>}){const {user,boot}=await adminWorkspacePage();const {id}=await params;return <BOSShell boot={boot}><ProductEditor key={id} data={await productEditor(user,id)}/></BOSShell>;}

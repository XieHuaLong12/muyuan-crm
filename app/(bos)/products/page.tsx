import { BOSShell } from '@/components/bos/BOSShell';
import { ProductCatalog } from '@/components/bos/ProductCatalog';
import { workspacePage } from '@/services/workspace-page';
import { productList } from '@/services/product-service';
import { Reveal,MOTION_DELAY } from '@/components/ui/motion';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){const {user,boot}=await workspacePage();return <BOSShell boot={boot}><Reveal delay={MOTION_DELAY.main}><ProductCatalog data={await productList(user,await searchParams)}/></Reveal></BOSShell>;}

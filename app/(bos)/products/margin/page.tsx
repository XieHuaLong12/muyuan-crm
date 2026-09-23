import { redirect } from 'next/navigation';
import { BOSShell } from '@/components/bos/BOSShell';
import { ProductMargin } from '@/components/bos/ProductMargin';
import { workspacePage } from '@/services/workspace-page';
import { marginOverview } from '@/services/product-cost-service';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){const {user,boot}=await workspacePage();if(user.role!=='ADMIN')redirect('/products');return <BOSShell boot={boot}><ProductMargin data={await marginOverview(user,await searchParams)}/></BOSShell>;}

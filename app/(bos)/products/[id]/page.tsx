import { BOSShell } from '@/components/bos/BOSShell';
import { ProductDetail } from '@/components/bos/ProductDetail';
import { workspacePage } from '@/services/workspace-page';
import { productDetail } from '@/services/product-service';
import { listingSummary } from '@/services/product-admin-service';
export const dynamic='force-dynamic';
export default async function Page({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<Record<string,string|undefined>>}){const {user,boot}=await workspacePage();const {id}=await params;const data=await productDetail(user,id,await searchParams);const listing=user.role==='ADMIN'?await listingSummary(id):null;return <BOSShell boot={boot}><ProductDetail data={data} listing={listing}/></BOSShell>;}

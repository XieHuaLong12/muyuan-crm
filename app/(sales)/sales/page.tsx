import { notFound,redirect } from 'next/navigation';
import { BOSShell } from '@/components/bos/BOSShell';
import { SalesOS } from '@/components/bos/SalesOS';
import { workspacePage } from '@/services/workspace-page';
import { salesQueue,salesQuery } from '@/services/bos-sales-service';
import { customerDetail } from '@/services/sales-workspace-service';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
 const {user,boot}=await workspacePage(),params=await searchParams;
 if(params.customer){if(!await customerDetail(params.customer,user))notFound();redirect(`/customers/${encodeURIComponent(params.customer)}`);}
 const parsed=salesQuery.safeParse(params),data=await salesQueue(user,parsed.success?parsed.data:{});
 return <BOSShell boot={boot}><SalesOS data={data} boot={boot}/></BOSShell>;
}

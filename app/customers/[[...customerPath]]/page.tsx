import { notFound } from 'next/navigation';
import { WorkspaceShell } from '@/components/workspace/WorkspaceShell';
import { CustomerWorkbench } from '@/components/workspace/CustomerWorkbench';
import { workspacePage,jsonForClient } from '@/services/workspace-page';
import { priorityCustomers,customerDetail } from '@/services/sales-workspace-service';
import type { Customer } from '@/lib/types';
export const dynamic='force-dynamic';
export default async function Page({params,searchParams}:{params:Promise<{customerPath?:string[]}>;searchParams:Promise<Record<string,string|undefined>>}){
 const {user,boot}=await workspacePage();const [{customerPath},query,customers]=await Promise.all([params,searchParams,priorityCustomers(user)]);
 if(customerPath&&customerPath.length>1)notFound();const id=customerPath?.[0]||customers[0]?.id;const selected=id?await customerDetail(id,user):null;if(customerPath?.[0]&&!selected)notFound();
 return <WorkspaceShell boot={boot}><CustomerWorkbench boot={boot} customers={customers} initialCustomer={jsonForClient<Customer|null>(selected)} initialSearch={query.q} initialFilter={query.filter} startNew={query.new==='1'}/></WorkspaceShell>;
}

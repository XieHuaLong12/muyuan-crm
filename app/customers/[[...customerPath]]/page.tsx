import { notFound } from 'next/navigation';
import { BOSShell } from '@/components/bos/BOSShell';
import { CustomerWorkbench } from '@/components/workspace/CustomerWorkbench';
import { Workspace } from '@/components/workspace';
import { workspacePage,jsonForClient } from '@/services/workspace-page';
import { priorityCustomers,customerDetail } from '@/services/sales-workspace-service';
import type { Customer } from '@/lib/types';
export const dynamic='force-dynamic';
export default async function Page({params,searchParams}:{params:Promise<{customerPath?:string[]}>;searchParams:Promise<Record<string,string|undefined>>}){
 const {user,boot}=await workspacePage();const [{customerPath},query,customers]=await Promise.all([params,searchParams,priorityCustomers(user)]);
 if(customerPath&&customerPath.length>1)notFound();
 // 表格视图：原来的「客户批量管理」独立页面，现在只是客户页的一个视图
 if(query.view==='table')return <BOSShell boot={boot}><Workspace initialBoot={boot} pageOverride="customers" embedded/></BOSShell>;
 const id=customerPath?.[0]||customers[0]?.id;const selected=id?await customerDetail(id,user):null;if(customerPath?.[0]&&!selected)notFound();
 return <BOSShell boot={boot}><div className="v3-shell bos-embed"><CustomerWorkbench boot={boot} customers={customers} initialCustomer={jsonForClient<Customer|null>(selected)} initialSearch={query.q} initialFilter={query.filter} startNew={query.new==='1'}/></div></BOSShell>;
}

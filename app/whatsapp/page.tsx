import { WorkspaceShell } from '@/components/workspace/WorkspaceShell';
import { CustomerWorkbench } from '@/components/workspace/CustomerWorkbench';
import { workspacePage,jsonForClient } from '@/services/workspace-page';
import { priorityCustomers,customerDetail } from '@/services/sales-workspace-service';
import type { Customer } from '@/lib/types';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){const {user,boot}=await workspacePage();const [customers,query]=await Promise.all([priorityCustomers(user),searchParams]);const list=customers.filter(c=>c.whatsapp||c.lastInboundAt);const selected=list[0]?await customerDetail(list[0].id,user):null;return <WorkspaceShell boot={boot}><CustomerWorkbench whatsappOnly boot={boot} customers={list} initialCustomer={jsonForClient<Customer|null>(selected)} initialFilter={query.filter}/></WorkspaceShell>;}

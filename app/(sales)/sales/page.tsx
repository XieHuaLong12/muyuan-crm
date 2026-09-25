import { notFound } from 'next/navigation';
import { BOSShell } from '@/components/bos/BOSShell';
import { SalesOS } from '@/components/bos/SalesOS';
import { workspacePage,jsonForClient } from '@/services/workspace-page';
import { salesQueue,salesQuery } from '@/services/bos-sales-service';
import { customerDetail } from '@/services/sales-workspace-service';
import type { Customer } from '@/lib/types';
import { Reveal,MOTION_DELAY } from '@/components/ui/motion';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){const {user,boot}=await workspacePage();const params=await searchParams,parsed=salesQuery.safeParse(params),data=await salesQueue(user,parsed.success?parsed.data:{});const id=params.customer||data.customers[0]?.id;const customer=id?await customerDetail(id,user):null;if(params.customer&&!customer)notFound();return <BOSShell boot={boot}><Reveal delay={MOTION_DELAY.main}><SalesOS key={`${data.query.queue}-${data.query.q}-${data.query.page}-${id||''}`} data={data} initialCustomer={jsonForClient<Customer|null>(customer)} boot={boot}/></Reveal></BOSShell>;}

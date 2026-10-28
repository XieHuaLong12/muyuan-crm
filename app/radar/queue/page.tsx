import { BOSShell } from '@/components/bos/BOSShell';
import { QueueBoard } from '@/components/radar/QueueBoard';
import { adminWorkspacePage, jsonForClient } from '@/services/workspace-page';
import { queueView } from '@/services/radar-queue-service';
export const dynamic='force-dynamic';

/** 发送队列: today's plan, each mailbox's progress, every mail with its status and planned time. */
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const {user,boot}=await adminWorkspacePage();
  const query=Object.fromEntries(Object.entries(await searchParams).map(([key,value])=>[key,Array.isArray(value)?value[0]:value]));
  return <BOSShell boot={boot}><QueueBoard data={jsonForClient(await queueView(user,query))}/></BOSShell>;
}

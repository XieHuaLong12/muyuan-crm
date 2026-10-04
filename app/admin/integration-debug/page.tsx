import Link from 'next/link';
import { BOSShell } from '@/components/bos/BOSShell';
import { Header,Card,Table,Badge,Input,Button,EmptyState } from '@/components/ui/bos';
import { IdentityTimeline } from '@/components/bos/IdentityTimeline';
import { workspacePage } from '@/services/workspace-page';
import { integrationDebug } from '@/services/gupshup-integration-service';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{q?:string}>}){
  const {user,boot}=await workspacePage();const {q}=await searchParams;
  if(user.role!=='ADMIN')return <BOSShell boot={boot}><Card><p>需要管理员权限。</p></Card></BOSShell>;
  const result=q?await integrationDebug({q},user):null;
  return <BOSShell boot={boot}><Header eyebrow="INTEGRATION DEBUG" title="接入链路检查" description="按国际号码、客户 ID 或消息 ID 核对真实身份链。"/>
    <Card><form className="bos-actions"><Input aria-label="号码、客户或消息 ID" name="q" defaultValue={q} required maxLength={191}/><Button type="submit">检查</Button></form>
      {result?<Table caption="链路验证结果" headings={['链路','结果']}>{result.checks.map(c=><tr key={c.name}><td>{c.name}</td><td><Badge tone={c.status==='PASS'?'green':'warning'}>{c.status}</Badge></td></tr>)}</Table>:<EmptyState title="等待查询" description="输入完整国际号码或已有记录编号。未获取的数据显示 NOT_FOUND。"/>}
      {result?.customerId&&<><p>窗口 {result.window?.conversationWindowStatus} · {result.window?.providerAccountId}</p><Link href={`/sales?customer=${encodeURIComponent(result.customerId)}`}>打开客户会话 ↗</Link></>}
    </Card>{result?.customerId&&<IdentityTimeline customerId={result.customerId} timezone={boot.settings.timezone}/>}</BOSShell>;
}

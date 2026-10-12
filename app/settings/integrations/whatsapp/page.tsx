import Link from 'next/link';
import { BOSShell } from '@/components/bos/BOSShell';
import { Header,Card,Table,Badge } from '@/components/ui/bos';
import { adminWorkspacePage } from '@/services/workspace-page';
import { gupshupIntegrationStatus } from '@/services/gupshup-integration-service';
export const dynamic='force-dynamic';
export default async function Page(){
  const {user,boot}=await adminWorkspacePage();
  const state=await gupshupIntegrationStatus({},user);
  const date=(d:Date|null)=>d?new Intl.DateTimeFormat('zh-CN',{timeZone:boot.settings.timezone,dateStyle:'medium',timeStyle:'short'}).format(d):'—';
  return <BOSShell boot={boot}><Header eyebrow="集成与接入" title="WhatsApp 接入" description="Gupshup 实时收发、Meta Cloud 和本地历史同步共同关联现有 CRM 客户。"/>
    <Card><Badge tone={state.status==='LIVE_INBOUND_VERIFIED'?'green':'warning'}>{state.status}</Badge>
      <Table caption="Gupshup 真实接入状态" headings={['检查项','状态或时间']}>
        {Object.entries({Provider:state.provider,App:state.appName,'业务号码':state.sourceNumber,'Webhook':state.webhookStatus,
          '最后入站':date(state.lastIncoming),'最后出站':date(state.lastOutgoing),'最后出站状态':state.lastOutgoingStatus,
          '最后 Webhook':date(state.lastWebhook),'最后错误':state.lastError,'失败消息':state.failedMessages,'待匹配消息':state.unmatchedMessages,
          '营销同意未知客户':state.unknownConsentCustomers,'模板同步':state.templateStatus}).map(([name,value])=><tr key={name}><td>{name}</td><td>{value??'—'}</td></tr>)}
      </Table><p>已填写配置只证明配置存在。收到通过验证的真实入站消息后，才会显示 LIVE_INBOUND_VERIFIED。</p>
      <p>普通回复窗口按发送业务号码的真实客户消息计算；本地历史导入不会打开实时窗口。营销同意未知时不得召回。</p>
      <nav className="bos-actions"><Link href="/communication">销售沟通监督 ↗</Link><Link href="/admin/integration-debug">接入链路检查 ↗</Link><Link href="/communication/whatsapp-sync">历史同步 ↗</Link></nav>
    </Card></BOSShell>;
}

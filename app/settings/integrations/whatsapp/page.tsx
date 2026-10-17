import Link from 'next/link';
import { BOSShell } from '@/components/bos/BOSShell';
import { Header,Card,Table,Badge } from '@/components/ui/bos';
import { adminWorkspacePage } from '@/services/workspace-page';
import { gupshupIntegrationStatus,inboundDiagnostics } from '@/services/gupshup-integration-service';
export const dynamic='force-dynamic';
const TYPES:Record<string,string>={text:'文字',image:'图片',video:'视频',audio:'语音',voice:'语音',document:'文件',file:'文件',sticker:'贴纸',location:'位置',contacts:'联系人',button:'按钮回复',interactive:'按钮回复',reaction:'表情回应'};
const MEDIA=new Set(['image','video','audio','voice','document','file','sticker']);
const REASONS:Record<string,string>={AMBIGUOUS:'号码对应多位客户',INVALID_PHONE:'号码无效',NO_MATCH:'没找到客户',MESSAGE_ID_CONFLICT:'消息编号冲突'};
export default async function Page(){
  const {user,boot}=await adminWorkspacePage();
  const [state,recent]=await Promise.all([gupshupIntegrationStatus({},user),inboundDiagnostics({},user)]);
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
    </Card>
    <Card><h2>最近收到的客户消息</h2>
      <p>逐条显示 Gupshup 推送过来的客户消息走到了哪一步：收到 → 进入会话 → 文件保存。只显示类型和域名，不显示内容、链接或密钥。</p>
      {recent.rows.length?<Table caption="最近收到的客户消息诊断" headings={['时间','格式','类型','Gupshup 给的文件信息','处理结果','文件']}>
        {recent.rows.map((row,i)=><tr key={i}><td>{date(row.at)}</td><td>{row.format==='V3'?'V3（Meta 格式）':'V2'}</td><td>{TYPES[row.type.toLowerCase()]??row.type}</td>
          <td>{MEDIA.has(row.type.toLowerCase())?<>{row.link?`下载链接：${row.link}`:'没有下载链接'}{row.mediaId?' · 有文件编号':''}</>:'—'}</td>
          <td>{row.result==='IN_CHAT'?'已进会话':row.result.startsWith('WAITING:')?`待关联（${REASONS[row.result.slice(8)]??row.result.slice(8)}）`:row.result==='NOT_SAVED'?`没保存：处理失败${row.receiptError?`（${row.receiptError}）`:''}`:row.result==='NOT_FOUND'?'没找到这条消息':'处理中'}</td>
          <td>{row.file==='SAVED'?'已保存':row.file==='FAILED'?<>下载失败：{row.fileError}{row.attempts&&<><br/><small>{row.attempts}</small></>}</>:row.file==='NOT_YET'?'还没下载（打开聊天时下载）':'—'}</td></tr>)}
      </Table>:<p>最近 {recent.receiptsScanned} 次推送里没有客户消息。</p>}
    </Card></BOSShell>;
}

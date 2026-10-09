import Link from 'next/link';
import {BOSShell} from '@/components/bos/BOSShell';
import {Header,Card,EmptyState,Badge} from '@/components/ui/bos';
import {adminWorkspacePage} from '@/services/workspace-page';
import {adIdentityChain} from '@/services/identity-chain-service';
export const dynamic='force-dynamic';
export default async function Page({params,searchParams}:{params:Promise<{adId:string}>;searchParams:Promise<{page?:string}>}){
  const {user,boot}=await adminWorkspacePage();const {adId}=await params;const search=await searchParams;
  const page=Number(search.page)||1;const r=await adIdentityChain({adId,page:Math.max(1,Math.min(10000,Math.floor(page)))},user);
  return <BOSShell boot={boot}><div className="identity-analytics"><Header eyebrow="AD IDENTITY CHAIN" title={r.leads[0]?.adName||adId} description={`${r.total} 条可追溯留资 · ${adId}`} actions={<Link className="bos-button" href={`/analytics/ads?adId=${encodeURIComponent(adId)}`}>查看广告指标</Link>}/><Card><p>{r.definition}。每页 25 条留资，报价和订单各显示最近 50 条。</p></Card>
    {!r.leads.length?<EmptyState title="暂无可访问的留资" description="检查广告 ID 或客户权限；不生成模拟客户。"/>:r.leads.map(l=><Card key={l.id}><h2><Link href={`/customers/${l.customer!.id}`}>{l.customer!.name}</Link> <Badge>{l.customer!.stage}</Badge></h2><p>{l.leadKey} · {l.occurredAt?new Intl.DateTimeFormat('zh-CN',{timeZone:boot.settings.timezone,dateStyle:'medium',timeStyle:'short'}).format(l.occurredAt):'原始留资时间未知'} · {l.customer!.phoneE164||'手机号待核对'}</p><p>Campaign {l.campaignName||l.campaignId||'—'} → Ad Set {l.adsetName||l.adsetId||'—'} → Ad {l.adName||l.adId||'—'} → Creative {l.creativeName||l.creativeId||'—'}</p><p>消息 {l.customer!._count.whatsappMessages} 条；{l.customer!.whatsappContacts.map(c=>`${c.provider} / ${c.status} / ${c._count.conversations} 个会话`).join(' · ')||'暂无绑定会话'}</p><p>客户报价：{l.customer!.quotations.map(q=>`${q.quoteNumber} (${q.status})`).join(' · ')||'暂无'}</p><p>本广告固定归因订单：{l.customer!.orders.length?l.customer!.orders.map(o=><span key={o.id}><Link href={`/orders/detail/${o.id}`}>{o.orderNo}</Link> {o.deal?`${o.deal.currency} 销售额 ${o.deal.dealAmount} / 毛利 ${o.deal.grossProfit}`:'财务数据未登记'}；</span>):'暂无'}</p><Link className="bos-text-link" href={`/sales?customer=${l.customer!.id}`}>查看完整客户身份链与会话 ↗</Link></Card>)}
    <nav className="bos-actions" aria-label="广告留资分页">{r.query.page>1&&<Link href={`?page=${r.query.page-1}`}>上一页</Link>}<span>第 {r.query.page} 页</span>{r.query.page*25<r.total&&<Link href={`?page=${r.query.page+1}`}>下一页</Link>}</nav>
  </div></BOSShell>;
}

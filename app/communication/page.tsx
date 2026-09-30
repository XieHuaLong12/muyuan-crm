import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BOSShell } from '@/components/bos/BOSShell';
import { CommunicationHistory } from '@/components/bos-v2/CommunicationHistory';
import { workspacePage } from '@/services/workspace-page';
import { communicationHistory } from '@/services/communication-history-service';

export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user, boot } = await workspacePage();
  const query = await searchParams;
  const channel = ['whatsapp', 'messenger', 'email'].includes(query.channel || '') ? query.channel : 'whatsapp';
  let content: React.ReactNode;

  if (channel === 'whatsapp') {
    const data = await communicationHistory(user, query);
    if (query.customer && !data.selected) notFound();
    content = <CommunicationHistory data={data} timezone={boot.settings.timezone} />;
  } else {
    content = <section className="bos-v2-surface bos-v2-channel-empty">
      <strong>{channel === 'messenger' ? 'Facebook Messenger' : 'Email'}</strong>
      <h2>渠道接入准备中</h2>
      <p>此渠道尚未连接。现有 WhatsApp 聊天记录可切换查看。</p>
      <Link href="/communication" className="bos-v2-primary">查看 WhatsApp 档案</Link>
    </section>;
  }

  return <BOSShell boot={boot}><div className="bos-v2-page">
    <header className="bos-v2-hero"><div><span className="bos-v2-kicker">COMMUNICATION CENTER / 沟通中心</span><h1>每一次沟通，都有迹可循。</h1><p>按客户查阅 WhatsApp 历史消息，保留完整的沟通上下文。</p></div><Link href="/communication/whatsapp-sync" className="bos-v2-secondary">本地同步助手</Link></header>
    <nav className="bos-v2-channel-tabs" aria-label="沟通渠道">{[['whatsapp', 'WhatsApp'], ['messenger', 'Messenger'], ['email', 'Email']].map(([key, label]) => <Link key={key} href={`/communication?channel=${key}`} aria-current={channel === key ? 'page' : undefined}>{label}{key !== 'whatsapp' && <small>待接入</small>}</Link>)}</nav>
    {content}
  </div></BOSShell>;
}

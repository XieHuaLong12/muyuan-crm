import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BOSShell } from '@/components/bos/BOSShell';
import { Header } from '@/components/ui/bos';
import { CommunicationHistory } from '@/components/bos-v2/CommunicationHistory';
import { adminWorkspacePage } from '@/services/workspace-page';
import { communicationHistory } from '@/services/communication-history-service';

export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user, boot } = await adminWorkspacePage();
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
    <Header title="沟通监督" description="按销售和客户查阅已保存的 WhatsApp 沟通记录，用于检查回复、话术与跟进质量。" actions={<Link href="/communication/whatsapp-sync" className="bos-v2-secondary">本地同步助手</Link>}/>
    <nav className="bos-v2-channel-tabs" aria-label="沟通渠道">{[['whatsapp', 'WhatsApp'], ['messenger', 'Messenger'], ['email', 'Email']].map(([key, label]) => <Link key={key} href={`/communication?channel=${key}`} aria-current={channel === key ? 'page' : undefined}>{label}{key !== 'whatsapp' && <small>待接入</small>}</Link>)}</nav>
    {content}
  </div></BOSShell>;
}

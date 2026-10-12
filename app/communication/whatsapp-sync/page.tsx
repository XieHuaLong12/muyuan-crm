import Link from 'next/link';
import { BOSShell } from '@/components/bos/BOSShell';
import { Header } from '@/components/ui/bos';
import { adminWorkspacePage } from '@/services/workspace-page';
import { WhatsAppWebSync } from '@/components/whatsapp-web-sync';
export const dynamic='force-dynamic';
export default async function Page(){
  const {boot}=await adminWorkspacePage();
  return <BOSShell boot={boot}><div className="bos-v2-page"><Header eyebrow="沟通监督" title="WhatsApp 本地同步" description="在浏览器扩展中手动预览、同步已加载的聊天；这里管理授权、待认领消息和同步记录。" actions={<Link href="/communication" className="bos-v2-secondary">返回沟通监督</Link>}/><WhatsAppWebSync/></div></BOSShell>;
}

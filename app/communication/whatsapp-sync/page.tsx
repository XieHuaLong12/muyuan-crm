import Link from 'next/link';
import { BOSShell } from '@/components/bos/BOSShell';
import { adminWorkspacePage } from '@/services/workspace-page';
import { WhatsAppWebSync } from '@/components/whatsapp-web-sync';
export const dynamic='force-dynamic';
export default async function Page(){
  const {boot}=await adminWorkspacePage();
  return <BOSShell boot={boot}><div className="bos-v2-page"><header className="bos-v2-hero"><div><span className="bos-v2-kicker">WHATSAPP WEB / 本地同步</span><h1>把已加载的聊天整理到客户档案</h1><p>在浏览器扩展中手动预览、同步；这里管理授权、待认领消息和同步记录。</p></div><Link href="/communication" className="bos-v2-secondary">返回销售沟通监督</Link></header><WhatsAppWebSync/></div></BOSShell>;
}

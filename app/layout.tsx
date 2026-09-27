import type { Metadata } from 'next';
import './globals.css';
import './workspace-v3.css';
import './bos.css';
import './bos-v2.css';
import './business-cockpit.css';
import './motion.css';
export const metadata:Metadata={title:'木远 CRM · 家具外贸销售管理',description:'家具外贸客户、跟进、销售与目标管理'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>;}

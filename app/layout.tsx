import type { Metadata, Viewport } from 'next';
import { PwaSetup } from '@/components/pwa';
import './globals.css';
import './workspace-v3.css';
import './bos.css';
import './bos-v2.css';
import './business-cockpit.css';
import './analytics.css';
import './insights.css';
import './motion.css';
import './messages.css';
import './workbench.css';
import './ideas.css';
// Last, so the phone layout wins over the page styles above at the same specificity.
import './mobile-shell.css';
import './mobile-lists.css';
// app/manifest.ts, app/icon.png and app/apple-icon.png make the CRM installable as a phone app; older iPhones also need the apple tag.
export const metadata:Metadata={title:'木远 CRM · 家具外贸销售管理',description:'家具外贸客户、跟进、销售与目标管理',applicationName:'木远 CRM',appleWebApp:{capable:true,title:'木远 CRM',statusBarStyle:'default'},other:{'apple-mobile-web-app-capable':'yes'}};
// viewport-fit=cover lets the phone's bottom bar reach the screen edge and pad itself by the home-indicator inset (app/mobile-shell.css).
export const viewport:Viewport={width:'device-width',initialScale:1,viewportFit:'cover'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}<PwaSetup/></body></html>;}

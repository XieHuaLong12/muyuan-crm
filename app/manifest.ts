import type { MetadataRoute } from 'next';

// Lets phones install the CRM to the home screen and open it full screen like an app (see docs/MOBILE_APP.md).
// The colors follow the mobile header (v2 sidebar) and the BOS page background.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: '木远 CRM · LVANJU',
    short_name: '木远 CRM',
    description: '家具外贸客户、跟进、销售与目标管理',
    lang: 'zh-CN',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f7f7f2',
    theme_color: '#17382f',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    // Long-press the app icon: pages both roles have.
    shortcuts: [
      { name: '今日跟进', url: '/sales' },
      { name: '客户', url: '/customers' },
      { name: '待办', url: '/tasks' },
    ],
  };
}

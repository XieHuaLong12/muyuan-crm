import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';

// Old addresses that moved into a merged page. Bookmarks keep working and query strings are passed through.
const moved: [string, string][] = [
  ['/command-center/legacy', '/command-center/analysis'],
  ['/analytics', '/command-center/analysis'],
  ['/funnel', '/command-center/analysis'],
  ['/orders/list', '/orders'],
  ['/customer-directory', '/customers'],
  ['/whatsapp', '/communication'],
  ['/whatsapp/inbox', '/communication'],
  ['/today', '/'],
];

const config = (phase: string): NextConfig => ({
  devIndicators: false,
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next',
  async redirects() {
    return moved.map(([source, destination]) => ({ source, destination, permanent: false }));
  },
});
export default config;

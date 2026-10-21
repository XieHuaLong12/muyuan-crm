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
  ['/growth', '/analytics/ads'],
];

// Hostinger's build container caps processes and threads per user. By default Next starts one build worker per CPU
// the host reports, and each worker's native SWC binding starts a Tokio runtime with one thread per CPU, so on a
// many-core host "Collecting page data" dies with "OS can't spawn worker thread … (os error 11)". Two workers with two
// Tokio threads each stay far below the cap; NEXT_BUILD_CPUS and TOKIO_WORKER_THREADS raise them where allowed.
process.env.TOKIO_WORKER_THREADS ??= '2';
const buildWorkers = Math.max(1, Math.floor(Number(process.env.NEXT_BUILD_CPUS)) || 2);

const config = (phase: string): NextConfig => ({
  devIndicators: false,
  experimental: { cpus: buildWorkers },
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next',
  async redirects() {
    return moved.map(([source, destination]) => ({ source, destination, permanent: false }));
  },
  // Phones must pick up a new service worker on the next visit, even behind a caching proxy or CDN.
  // Product photos keep their file names when they are replaced, so they are revalidated the same way.
  async headers() {
    return [
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
      { source: '/products/:file(.+\\.jpg)', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
    ];
  },
});
export default config;

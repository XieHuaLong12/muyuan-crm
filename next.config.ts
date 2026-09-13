import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';
const config = (phase: string): NextConfig => ({ devIndicators: false, distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next' });
export default config;

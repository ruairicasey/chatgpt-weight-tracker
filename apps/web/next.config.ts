import type { NextConfig } from 'next';

const config: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
    ] }, { source: '/(login|oauth)/:path*', headers: [
      { key: 'Cache-Control', value: 'private, no-store' },
    ] }];
  },
  transpilePackages: ['@weight-tracker/contracts', '@weight-tracker/auth', '@weight-tracker/config', '@weight-tracker/mcp'],
};
export default config;

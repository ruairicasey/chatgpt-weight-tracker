import type { NextConfig } from 'next';

const config: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ['@weight-tracker/contracts', '@weight-tracker/auth', '@weight-tracker/config', '@weight-tracker/mcp'],
};
export default config;

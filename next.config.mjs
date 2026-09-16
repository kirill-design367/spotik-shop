/** @type {import('next').NextConfig} */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';
const repo = '/spotik-shop';

const nextConfig = {
  output: 'export',
  images: { unoptimized: true },
  basePath: isProd ? repo : '',
  assetPrefix: isProd ? repo : '',
  // Тот же префикс уезжает в клиентский код: объявления @font-face
  // собираются строкой и должны знать его (см. lib/fontface.ts).
  env: { NEXT_PUBLIC_BASE_PATH: isProd ? repo : '' },
  trailingSlash: true,
  reactStrictMode: true,
  productionBrowserSourceMaps: false,
  compiler: { removeConsole: isProd ? { exclude: ['error', 'warn'] } : false },
  // Алиас задан явно: полагаться только на paths из tsconfig оказалось ненадёжно.
  webpack: (config) => {
    config.resolve.alias['@'] = __dirname;
    return config;
  },
};

export default nextConfig;

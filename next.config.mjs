/** @type {import('next').NextConfig} */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';

// ⚠️ САЙТ ЖИВЁТ В КОРНЕ ДОМЕНА, И ПРЕФИКСА БОЛЬШЕ НЕТ.
// До переезда на свой сервер стояли `basePath` и `assetPrefix`,
// равные `/spotik-shop`: на GitHub Pages проект отдавался подпапкой
// пользовательского домена, и без префикса все ассеты уходили в 404.
// На spotik.shop сайт лежит в корне, и префикс теперь ЛОМАЛ БЫ ровно
// то, что раньше чинил.
//
// Величина одна и она здесь. Клиентский код берёт её из
// NEXT_PUBLIC_BASE_PATH (объявления @font-face собираются строкой
// и подставляют префикс сами, см. lib/fontface.ts), проверки —
// из PREFIX в scripts/serve-out.mjs. Если сайт когда-нибудь снова
// поедет в подпапку, менять надо ОБА места.
const BASE = '';

const nextConfig = {
  output: 'export',
  images: { unoptimized: true },
  basePath: BASE,
  assetPrefix: BASE,
  env: { NEXT_PUBLIC_BASE_PATH: BASE },
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

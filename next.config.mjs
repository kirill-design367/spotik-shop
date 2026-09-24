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
  // ⚠️ СТАТИЧЕСКОГО ЭКСПОРТА БОЛЬШЕ НЕТ: двадцать седьмая итерация
  // принесла кабинет, оформление заказа, оплату и админку, а им нужен
  // сервер. Лендинг при этом остаётся СТАТИЧЕСКИМ — он собирается
  // на сборке и отдаётся готовым HTML из кэша (см. `revalidate`
  // в app/page.tsx), поэтому его скорость не меняется.
  //
  // `standalone` вместо обычной сборки: на сервер уезжает один
  // самодостаточный каталог с вшитыми зависимостями, и `npm ci`
  // на боевой машине не нужен вовсе.
  output: 'standalone',

  /* ⚠️ `X-Powered-By: Next.js` НЕ ОТДАЁМ. Сама по себе строка
     не дыра — версии в ней нет, — но это готовая подсказка тому,
     кто перебирает цели: имя фреймворка сужает список известных
     уязвимостей до одного списка. Версию nginx мы по той же причине
     прячем с двадцать седьмой итерации, а этот заголовок приходил
     от приложения и до тридцать первой оставался незамеченным:
     сторож смотрел только на `Server`. */
  poweredByHeader: false,
  // ⚠️ NODEMAILER НЕ БАНДЛИТЬ. Он подтягивает транспорты обычным
  // `require` по вычисляемому имени, и упакованный webpack'ом
  // находит не всё. Внешним пакетом он и трассируется в standalone
  // как есть — целым каталогом.
  serverExternalPackages: ['nodemailer'],
  images: { unoptimized: true },
  basePath: BASE,
  assetPrefix: BASE,
  env: { NEXT_PUBLIC_BASE_PATH: BASE },
  trailingSlash: true,
  // ⚠️ СТАРЫЙ АДРЕС ОСТАЁТСЯ ЖИВЫМ. `/privacy/` был заглушкой
  // политики конфиденциальности; её место занял текст оферты,
  // и живёт он теперь по своему имени — `/oferta/`. Ссылки
  // на прежний адрес уже могли уехать наружу, поэтому он
  // не исчезает, а ведёт туда же.
  async redirects() {
    return [{ source: '/privacy', destination: '/oferta/', permanent: true }];
  },
  reactStrictMode: true,
  productionBrowserSourceMaps: false,
  // ⚠️ ТОЛЬКО КЛИЕНТ. `removeConsole` вырезает вызовы и в серверных
  // модулях тоже, а журнал сервера — единственное место, куда до
  // настройки SMTP уходят коды входа и письма. Серверный журнал
  // поэтому пишется через process.stdout (lib/server/log.ts),
  // и вырезать его нечем.
  compiler: { removeConsole: isProd ? { exclude: ['error', 'warn'] } : false },
  // Алиас задан явно: полагаться только на paths из tsconfig оказалось ненадёжно.
  webpack: (config) => {
    config.resolve.alias['@'] = __dirname;
    return config;
  },
};

export default nextConfig;

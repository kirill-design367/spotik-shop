import type { Metadata, Viewport } from 'next';
import './globals.css';
import './components.css';
import ScrollProvider from '@/components/ScrollProvider';
import { siteFontFaces, BASE_PATH as BASE } from '@/lib/fontface';

export const metadata: Metadata = {
  title: 'Spotik Shop — доступ к Spotify Premium из России',
  description:
    'Оформление доступа к Spotify Premium из России. Без VPN, оплата русской картой или через СБП. Тарифы на 1, 3, 6 и 12 месяцев.',
  applicationName: 'Spotik Shop',
  authors: [{ name: 'Spotik Shop' }],
  robots: { index: true, follow: true },
  openGraph: {
    title: 'Spotik Shop — доступ к Spotify Premium из России',
    description: 'Без VPN. Оплата русской картой или через СБП.',
    locale: 'ru_RU',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#121212',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <head>
        {/* Объявления шрифтов идут инлайном: в CSS нельзя записать путь,
            который переживёт basePath. Подробности в lib/fontface.ts. */}
        <style dangerouslySetInnerHTML={{ __html: siteFontFaces(BASE) }} />
        {/* ПОЯВЛЕНИЕ СТРОК включается атрибутом на <html>, и ставится он
            здесь, до первой отрисовки: поставь его из эффекта — середина
            страницы успела бы показаться и мигнуть обратно. Без скрипта
            атрибута нет и не прячется ничего; при «уменьшить движение»
            он не ставится вовсе, и страница сразу в конечном состоянии. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(!matchMedia('(prefers-reduced-motion: reduce)').matches)" +
              "document.documentElement.setAttribute('data-rv','')}catch(e){}",
          }}
        />
        {/* Шрифтового файла для вордмарка больше нет: слово запечено
            в контуры и рисуется с первого кадра, не дожидаясь сети. */}
        {/* Два сабсета, а не один: первый экранный абзац смешанный —
            «СЕРВИС №1 … SPOTIFY PREMIUM ИЗ РОССИИ». Без латинского сабсета
            он дорисовывается вторым заходом, и Lighthouse засчитывает
            сдвиг макета на подстановке шрифта. */}
        <link
          rel="preload"
          href={`${BASE}/fonts/golos-cyrillic.woff2`}
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href={`${BASE}/fonts/golos-latin.woff2`}
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body>
        {/* Цель скип-ссылки — сам <main>, а не секция: секции есть только
            на главной, а layout общий и для 404. */}
        <a href="#main" className="skip-link">
          Перейти к содержимому
        </a>
        {children}
        <ScrollProvider />
      </body>
    </html>
  );
}

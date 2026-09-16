import type { Metadata, Viewport } from 'next';
import './globals.css';
import './components.css';
import ScrollProvider from '@/components/ScrollProvider';

const BASE = process.env.NODE_ENV === 'production' ? '/spotik-shop' : '';

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
        {/* Вордмарк — критический ресурс первого экрана: 13 КБ, все 13 осей */}
        <link
          rel="preload"
          href={`${BASE}/fonts/spotik-wordmark.woff2`}
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href={`${BASE}/fonts/golos-cyrillic.woff2`}
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body>
        <a href="#pricing" className="skip-link">
          Перейти к тарифам
        </a>
        {children}
        <ScrollProvider />
      </body>
    </html>
  );
}

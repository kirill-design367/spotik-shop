import Hero from '@/components/sections/Hero';
import Pricing from '@/components/sections/Pricing';
import HowItWorks from '@/components/sections/HowItWorks';
import Faq from '@/components/sections/Faq';
import Footer from '@/components/sections/Footer';
import RevealRoot from '@/components/chrome/RevealRoot';

/**
 * СЕРЕДИНА СТРАНИЦЫ — ТРИ БЛОКА, А НЕ ПЯТЬ (восемнадцатая итерация).
 *
 * «Преимущества» и «Сертификат» отдельными секциями исчезли, но тексты
 * не выброшены: пять преимуществ идут бегущей строкой поверх рядов
 * тарифа, сертификат стал четвёртым тарифом. Дорожка теперь такая:
 * 01 хиро · 02 тарифы · 03 как это работает · 04 вопросы · 05 футер.
 */
export default function Page() {
  return (
    <>
      <main id="main" tabIndex={-1}>
        <Hero />
        <Pricing />
        <HowItWorks />
        <Faq />
      </main>
      <Footer />
      {/* Один наблюдатель на всю страницу: появление строк в кадре. */}
      <RevealRoot />
    </>
  );
}

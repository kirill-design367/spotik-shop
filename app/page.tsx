import Hero from '@/components/sections/Hero';
import Pricing from '@/components/sections/Pricing';
import Marquee from '@/components/mid/Marquee';
import HowItWorks from '@/components/sections/HowItWorks';
import Faq from '@/components/sections/Faq';
import Footer from '@/components/sections/Footer';
import RevealRoot from '@/components/chrome/RevealRoot';
import { PERKS } from '@/lib/plans';

/**
 * ХИРО · ТАРИФЫ · БЕГУЩАЯ СТРОКА · КАК ЭТО РАБОТАЕТ · ВОПРОСЫ · ФУТЕР.
 *
 * Надзаголовков и номеров у блоков больше нет (девятнадцатая итерация):
 * блок понятен по своему заголовку. Бегущая строка — не часть тарифов,
 * а самостоятельная полоса во всю ширину между двумя блоками.
 */
export default function Page() {
  return (
    <>
      <main id="main" tabIndex={-1}>
        <Hero />
        <Pricing />
        <Marquee items={PERKS} />
        <HowItWorks />
        <Faq />
      </main>
      <Footer />
      {/* Один наблюдатель на всю страницу: появление строк в кадре. */}
      <RevealRoot />
    </>
  );
}

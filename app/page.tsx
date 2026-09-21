import Hero from '@/components/sections/Hero';
import Pricing, { type CenyTarifov } from '@/components/sections/Pricing';
import Marquee from '@/components/mid/Marquee';
import HowItWorks from '@/components/sections/HowItWorks';
import Faq from '@/components/sections/Faq';
import Footer from '@/components/sections/Footer';
import RevealRoot from '@/components/chrome/RevealRoot';
import { PERKS, type PeriodKey } from '@/lib/plans';
import { katalog } from '@/lib/server/catalog';

/**
 * ХИРО · ТАРИФЫ · БЕГУЩАЯ СТРОКА · КАК ЭТО РАБОТАЕТ · ВОПРОСЫ · ФУТЕР.
 *
 * Надзаголовков и номеров у блоков больше нет (девятнадцатая итерация):
 * блок понятен по своему заголовку. Бегущая строка — не часть тарифов,
 * а самостоятельная полоса во всю ширину между двумя блоками.
 *
 * ⚠️ СТРАНИЦА ОСТАЁТСЯ СТАТИЧЕСКОЙ, ХОТЯ ЦЕНЫ ТЕПЕРЬ ИЗ БАЗЫ.
 * `revalidate` собирает её на сборке и отдаёт готовым HTML из кэша,
 * пересобирая в фоне не чаще раза в пять минут: PageSpeed и CLS
 * от этого не меняются вовсе, а правка цены в админке доезжает сразу —
 * действие администратора зовёт `revalidatePath('/')`.
 *
 * ⚠️ БАЗЫ МОЖЕТ НЕ БЫТЬ, И ЭТО НОРМАЛЬНО. На раннере GitHub, где идёт
 * сборка, PostgreSQL нет: `katalog()` тихо отдаёт умолчания
 * из `lib/plans.ts`, и лендинг собирается ровно как раньше.
 */
export const revalidate = 300;

export default async function Page() {
  const spisok = await katalog();
  const ceny: CenyTarifov = {};
  for (const t of spisok) {
    const m: Partial<Record<PeriodKey, number>> = {};
    for (const c of t.ceny) m[c.period] = c.kop / 100;
    ceny[t.id] = m;
  }

  return (
    <>
      <main id="main" tabIndex={-1}>
        <Hero />
        <Pricing ceny={ceny} />
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

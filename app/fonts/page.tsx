import type { Metadata } from 'next';
import { CANDIDATES, SITE, specimenFontFaces, BASE_PATH as BASE } from '@/lib/fontface';

export const metadata: Metadata = {
  title: 'Гарнитуры — Spotik Shop',
  description: 'Служебная витрина кандидатов в наборную гарнитуру сайта.',
  robots: { index: false, follow: false },
};

/**
 * СЛУЖЕБНАЯ ВИТРИНА ГАРНИТУР.
 *
 * Страница существует ради одного решения: какой гротеск несёт весь
 * наборный текст сайта. Вордмарк здесь ни при чём — слово SPOTIK
 * запечено в контуры и от выбора не зависит вовсе.
 *
 * Роли набора взяты с боевой страницы, а не придуманы: заголовок
 * прописными — это шапка блока, крупный набор — вопрос из блока «Ваши
 * вопросы», корпус — абзац оттуда же, мелкие подписи — то, чем набраны
 * цены и служебные строки. Сравнивать гарнитуры на «съешь ещё этих
 * булок» бессмысленно: решает то, как они держат НАШ текст.
 *
 * Объявления кандидатов уходят инлайном ТОЛЬКО здесь: в боевой
 * критический путь попадает ровно одна гарнитура (lib/fontface.ts).
 *
 * Страница из карты сайта исключена и закрыта от индексации.
 */

/** Стили витрины живут ЗДЕСЬ, а не в components.css: иначе служебная
 *  страница тащила бы свои шесть десятков правил в критический путь
 *  боевой страницы, где им делать нечего. */
const SPEC_CSS = `
.spec{padding:calc(var(--nav-h) + 40px) 0 120px}
.spec__head{max-width:62ch;margin-bottom:clamp(48px,7vw,96px)}
.spec__title{font-size:clamp(2rem,6vw,3.5rem);line-height:1.05;letter-spacing:-0.03em;
  font-variation-settings:'wght' 700;margin:0 0 20px}
.spec__lead{margin:0 0 12px;font-size:15px;line-height:1.6;color:var(--dim)}
.spec__lead--note{color:var(--dim-2);font-size:13px}
.spec__lead code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--white)}
.spec__item{padding:clamp(28px,4vw,48px) 0;border-top:1px solid var(--hair);
  display:grid;gap:clamp(20px,3vw,40px)}
@media (min-width:1080px){.spec__item{grid-template-columns:minmax(0,22ch) minmax(0,1fr)}}
.spec__meta{align-self:start}
.spec__name{margin:0 0 6px;font-size:22px;line-height:1.2;letter-spacing:-0.02em;
  font-variation-settings:'wght' 700;display:flex;flex-wrap:wrap;align-items:baseline;gap:10px}
.spec__flag{font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:var(--green)}
.spec__facts{margin:0 0 10px;font-size:12px;color:var(--dim-2)}
.spec__note{margin:0;font-size:13px;line-height:1.55;color:var(--dim)}
.spec__rows{display:grid;gap:6px;min-width:0}
.spec__role{margin:18px 0 0;font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:var(--dim-2)}
.spec__rows > p:nth-child(2){margin-top:0}
.spec__caps,.spec__big,.spec__body,.spec__small,.spec__ladder{font-family:var(--spec);margin:0;color:var(--white)}
.spec__caps{font-size:clamp(1.75rem,5.4vw,3.25rem);line-height:1.02;letter-spacing:-0.01em;
  text-transform:uppercase;font-variation-settings:'wght' 700}
.spec__big{font-size:clamp(1.375rem,3.4vw,2.5rem);line-height:1.12;letter-spacing:-0.025em;
  font-variation-settings:'wght' 600}
.spec__body{max-width:56ch;font-size:clamp(1rem,1.1vw,1.0625rem);line-height:1.62;color:var(--dim)}
.spec__small{font-size:12px;letter-spacing:0.02em;color:var(--dim)}
.spec__ladder{display:flex;flex-wrap:wrap;gap:4px 18px;font-size:22px;line-height:1.3}
.spec__ladder span{color:var(--white)}
`;

const SAMPLES = {
  caps: 'Выберите срок и тариф',
  big: 'Что если аккаунт перестанет работать?',
  body:
    'Доступ к Spotify Premium оформляется без VPN: оплата российской картой ' +
    'или через СБП, а сам доступ приходит в личный кабинет. Цена фиксируется ' +
    'в момент оформления — чем длиннее срок, тем дешевле месяц.',
  small: 'На двоих · 12 месяцев · 5 280 ₽ · 220 ₽ на человека',
};

const LADDER = [200, 300, 400, 500, 600, 700, 800] as const;

export default function FontsPage() {
  return (
    <main id="main" className="spec">
      <style dangerouslySetInnerHTML={{ __html: specimenFontFaces(BASE) + SPEC_CSS }} />

      <div className="shell">
        <header className="spec__head">
          <h1 className="spec__title">Гарнитуры</h1>
          <p className="spec__lead">
            Кандидаты в наборную гарнитуру сайта. Вордмарк сюда не входит: слово SPOTIK
            запечено в контуры и от выбора не зависит. Каждый кандидат показан в четырёх
            ролях боевой страницы — заголовок прописными, крупный набор, корпус и мелкие
            подписи, — и лесенкой весов.
          </p>
          <p className="spec__lead spec__lead--note">
            Кириллица у всех четырёх проверена ЧТЕНИЕМ ТАБЛИЦЫ cmap из бинарника, а не
            по описанию на сайте шрифта: 64 знака из 64 в диапазоне А–я, Ё и ё на месте,
            Ж Ф Щ Ъ Ы Ь Э Ю Я есть. Диапазон веса прочитан из fvar. Проверка
            повторяется командой <code>npm run audit:fonts</code>.
          </p>
        </header>

        {CANDIDATES.map((c) => (
          <section
            key={c.slug}
            className="spec__item"
            style={{ ['--spec' as string]: `'Spec ${c.name}', system-ui, sans-serif` }}
          >
            <div className="spec__meta">
              <h2 className="spec__name">
                {c.name}
                {c.slug === SITE ? <span className="spec__flag">стоит сейчас</span> : null}
              </h2>
              <p className="spec__facts">
                {c.author} · ось wght {c.wght[0]}–{c.wght[1]}
              </p>
              <p className="spec__note">{c.note}</p>
            </div>

            <div className="spec__rows">
              <p className="spec__role">Заголовок прописными</p>
              <p className="spec__caps">{SAMPLES.caps}</p>

              <p className="spec__role">Крупный набор</p>
              <p className="spec__big">{SAMPLES.big}</p>

              <p className="spec__role">Корпус</p>
              <p className="spec__body">{SAMPLES.body}</p>

              <p className="spec__role">Мелкие подписи</p>
              <p className="spec__small tnum">{SAMPLES.small}</p>

              <p className="spec__role">Веса</p>
              <p className="spec__ladder">
                {LADDER.filter((w) => w >= c.wght[0] && w <= c.wght[1]).map((w) => (
                  <span key={w} style={{ fontVariationSettings: `'wght' ${w}` }}>
                    Ж{w}
                  </span>
                ))}
              </p>
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}

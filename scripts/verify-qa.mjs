/**
 * ВОПРОС И ОТВЕТ НЕ ПЕРЕСЕКАЮТСЯ — СПЛОШНОЙ ПЕРЕБОР.
 *
 * Постановка двадцатой итерации: «строго одно или другое, между ними
 * ни одного кадра, где читаются оба». Проверять это выборочными
 * положениями нельзя ровно по той же причине, по которой нельзя было
 * проверять инверсию шапки (Р-47): наложение живёт в узкой зоне
 * перехода, и любая выбранная точка проскочит мимо неё по построению.
 *
 * Поэтому здесь ПЕРЕБИРАЕТСЯ ВСЯ ПРОКРУТКА блока с мелким шагом, и на
 * каждом положении у каждого из шести вопросов берутся обе фактические
 * прозрачности. Провал — любое положение, где обе разом выше порога
 * читаемости.
 *
 * ПОРОГ. Белый на #121212 при 8 % прозрачности даёт 1.25:1 — это
 * заведомо ниже всякой читаемости. Берём его: он ловит настоящее
 * наложение и не придирается к хвостам.
 *
 * ЧИТАТЬ НАДО ЧЕРЕЗ ДВА КАДРА ПОСЛЕ ЗАПИСИ `scrollTop`, а не сразу.
 * На точном указателе позицию ведёт Lenis: он сверяется с фактическим
 * значением и доводит её сам, поэтому мгновенное чтение возвращает
 * то предыдущее положение, то промежуточное. Без этой паузы сторож
 * ловил собственный артефакт — «вопрос не доходит до полной яркости»,
 * причём через раз.
 *
 * СТОРОЖ ОБЯЗАН ПАДАТЬ И КОГДА НЕ РИСУЕТСЯ НИЧЕГО. Отдельной строкой
 * проверяется, что за проход хотя бы один ответ ДОХОДИЛ до полной
 * яркости: иначе «пересечений нет» проходило бы и на сломанной сборке,
 * где ответы не появляются вовсе.
 */
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';

const PORT = 4262;
const BOTH = 0.08; // выше этого обе половины считаются видимыми разом
const server = await serveOut(PORT);
const browser = await launch();
let failed = false;

console.log('ВОПРОС И ОТВЕТ: сплошной перебор прокрутки блока.\n');

for (const [w, h, mob] of [
  [390, 844, true],
  [1920, 1080, false],
  [2560, 1440, false],
]) {
  const page = await browser.newPage({
    viewport: { width: w, height: h },
    isMobile: mob,
    hasTouch: mob,
    deviceScaleFactor: 1,
  });
  await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);

  const range = await page.evaluate(() => {
    const el = document.getElementById('faq');
    const sc = document.getElementById('scroller');
    const base = sc.getBoundingClientRect().top - sc.scrollTop;
    const r = el.getBoundingClientRect();
    return { from: r.top - base - sc.clientHeight, to: r.bottom - base, step: 8 };
  });

  let worst = 0;
  let worstAt = 0;
  let bad = 0;
  let spots = 0;
  let maxA = 0;
  let maxQ = 0;

  for (let y = range.from; y <= range.to; y += range.step) {
    const row = await page.evaluate(async (top) => {
      const sc = document.getElementById('scroller');
      sc.scrollTop = Math.max(0, top);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return [...document.querySelectorAll('.qa__item')].map((it) => [
        +getComputedStyle(it.querySelector('.qa__q')).opacity,
        +getComputedStyle(it.querySelector('.qa__a')).opacity,
      ]);
    }, y);
    spots += 1;
    for (const [oq, oa] of row) {
      maxQ = Math.max(maxQ, oq);
      maxA = Math.max(maxA, oa);
      const both = Math.min(oq, oa);
      if (both > worst) {
        worst = both;
        worstAt = y;
      }
      if (both > BOTH) bad += 1;
    }
  }

  const okDraw = maxA > 0.98 && maxQ > 0.98;
  if (bad || !okDraw) failed = true;
  console.log(
    `  ${String(w).padStart(4)}×${h}  положений ${String(spots).padStart(3)}  ` +
      `наибольшее наложение ${worst.toFixed(3)} (на ${Math.round(worstAt)} px)  ` +
      `провалов ${bad}  ` +
      `ярче 0.98 доходят: вопрос ${maxQ.toFixed(2)}, ответ ${maxA.toFixed(2)}` +
      (okDraw ? '' : '   !!! ПОЛОВИНА НЕ РИСУЕТСЯ'),
  );
  await page.close();
}

await browser.close();
server.close();
console.log(
  failed
    ? '\nПРОВАЛ: есть положения, где видны обе половины разом'
    : '\nНа всей прокрутке видно строго одно: либо вопрос, либо ответ',
);
process.exit(failed ? 1 : 0);

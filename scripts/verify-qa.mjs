/**
 * ВОПРОС И ОТВЕТ: СТРОГО ОДНО ИЛИ ДРУГОЕ — СПЛОШНОЙ ПЕРЕБОР.
 *
 * Постановка двадцать первой итерации жёстче прошлой и с обеих сторон:
 * ни одного положения, где видно ОБЕ половины, и ни одного, где
 * не видно НИ ОДНОЙ. Пустую паузу между фазами арт-директор разрешил
 * в прошлой итерации сам и здесь же отменил: на медленной прокрутке
 * она читается как пустой кадр.
 *
 * Проверять это выборочными положениями нельзя ровно по той же
 * причине, по которой нельзя было проверять инверсию шапки (Р-47):
 * и наложение, и пустота живут в узкой зоне перехода, и любая
 * выбранная точка проскочит мимо неё по построению.
 *
 * Поэтому здесь ПЕРЕБИРАЕТСЯ ВСЯ ПРОКРУТКА блока с мелким шагом, и на
 * каждом положении у каждого из шести вопросов берутся обе фактические
 * прозрачности. Провал — любое положение, где обе разом выше порога
 * читаемости ИЛИ обе ниже его.
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
/* Ниже этого половина считается невидимой. Белый на #121212 при 45 %
   даёт 4.6:1 — это ещё читаемо, а всё, что ниже, уже нет. */
const SEEN = 0.45;
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
  let empty = 0;
  let emptyAt = 0;
  let spots = 0;
  let maxA = 0;
  let maxQ = 0;
  /* Разгон и доводка: сколько ПИКСЕЛЕЙ ПРОКРУТКИ они занимают.
     Подмена мгновенная по построению, и без этой строки сторож прошёл бы
     и на сборке, где движения нет вовсе, — а именно оно и есть приём. */
  let nLead = 0;
  let nTrail = 0;
  let turns = 0;
  const wasBefore = [];

  for (let y = range.from; y <= range.to; y += range.step) {
    const row = await page.evaluate(async (top) => {
      const sc = document.getElementById('scroller');
      sc.scrollTop = Math.max(0, top);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return [...document.querySelectorAll('.qa__item')].map((it) => [
        +getComputedStyle(it.querySelector('.qa__q')).opacity,
        +getComputedStyle(it.querySelector('.qa__a')).opacity,
        +it.style.getPropertyValue('--qy'),
        +it.style.getPropertyValue('--ay'),
      ]);
    }, y);
    spots += 1;
    for (let i = 0; i < row.length; i += 1) {
      const [oq, oa, qy, ay] = row[i];
      if (qy < -0.001 && qy > -0.999) nLead += 1;
      if (ay > 0.001) nTrail += 1;
      const before = oa < 0.5;
      if (wasBefore[i] !== undefined && wasBefore[i] !== before) turns += 1;
      wasBefore[i] = before;
      maxQ = Math.max(maxQ, oq);
      maxA = Math.max(maxA, oa);
      const both = Math.min(oq, oa);
      if (both > worst) {
        worst = both;
        worstAt = y;
      }
      if (both > BOTH) bad += 1;
      /* Пустота: не видно НИ ОДНОЙ половины. */
      if (Math.max(oq, oa) < SEEN) {
        empty += 1;
        if (!emptyAt) emptyAt = y;
      }
    }
  }

  const okDraw = maxA > 0.98 && maxQ > 0.98;
  if (bad || empty || !okDraw) failed = true;
  console.log(
    `  ${String(w).padStart(4)}×${h}  положений ${String(spots).padStart(3)}  ` +
      `наибольшее наложение ${worst.toFixed(3)} (на ${Math.round(worstAt)} px)  ` +
      `наложений ${bad}  пустых ${empty}${empty ? ` (первое на ${Math.round(emptyAt)} px)` : ''}  ` +
      `ярче 0.98 доходят: вопрос ${maxQ.toFixed(2)}, ответ ${maxA.toFixed(2)}` +
      (okDraw ? '' : '   !!! ПОЛОВИНА НЕ РИСУЕТСЯ'),
  );
  const per = turns || 1;
  const okMove = nLead > 0 && nTrail > 0;
  if (!okMove) failed = true;
  console.log(
    `            движение на переход: разгон ${((nLead * range.step) / per).toFixed(0)} px ` +
      `прокрутки, доводка ${((nTrail * range.step) / per).toFixed(0)} px` +
      (okMove ? '' : '   !!! ДВИЖЕНИЯ НЕТ ВОВСЕ'),
  );
  await page.close();
}

await browser.close();
server.close();
console.log(
  failed
    ? '\nПРОВАЛ: есть положения, где видны обе половины разом или не видно ни одной'
    : '\nНа всей прокрутке видно строго одно: либо вопрос, либо ответ',
);
process.exit(failed ? 1 : 0);

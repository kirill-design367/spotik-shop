/**
 * ВОПРОС И ОТВЕТ: ЖЁСТКОЕ ПЕРЕКЛЮЧЕНИЕ — СПЛОШНОЙ ПЕРЕБОР.
 *
 * Постановка двадцать третьей итерации сняла шторку и поставила
 * четыре условия. Все четыре проверяются здесь перебором ВСЕЙ
 * прокрутки блока, а не выбранными положениями:
 *
 *   1. НИ ОДНОГО ПОЛОЖЕНИЯ, ГДЕ ВИДНО ДВА ОТВЕТА;
 *   2. НИ ОДНОГО НАЛОЖЕНИЯ и НИ ОДНОГО ПУСТОГО положения: в каждой
 *      ячейке в каждый момент видна ровно одна половина;
 *   3. ПЕРЕХОД ЗАНИМАЕТ ОДИН КАДР. Промежуточных состояний не бывает
 *      ни в пространстве прокрутки (мелкий проход шагом 1 px), ни
 *      во времени (прыжок через точку переключения и чтение
 *      на СЛЕДУЮЩЕМ кадре);
 *   4. НАЗАД РАБОТАЕТ СИММЕТРИЧНО: тот же проход снизу вверх даёт
 *      те же состояния на тех же положениях.
 *
 * ⚠️ ПРОВЕРЯТЬ ВОПРОСЫ ПООДИНОЧКЕ НЕЛЬЗЯ. Дефект «два ответа разом»
 * у каждого вопроса по отдельности выглядит правильным — сторож
 * двадцать первой итерации ровно на этом и промолчал. Здесь на каждом
 * положении считаются ВСЕ шесть сразу.
 *
 * ЧИТАТЬ НАДО ЧЕРЕЗ ДВА КАДРА ПОСЛЕ ЗАПИСИ `scrollTop`, а не сразу.
 * На точном указателе позицию ведёт Lenis: он сверяется с фактическим
 * значением и доводит её сам, поэтому мгновенное чтение возвращает
 * то предыдущее положение, то промежуточное (Р-61).
 *
 * И ОТДЕЛЬНОЙ СТРОКОЙ — РАСТР. Вся арифметика выше сойдётся и на сборке,
 * где текст не рисуется вовсе: состояния правильные, а показывать
 * нечего. Поэтому на двух положениях — «виден вопрос» и «виден ответ» —
 * считаются живые пиксели в ячейке.
 */
import { PNG } from 'pngjs';
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';

const PORT = 4262;
/**
 * Ниже этого половина считается СКРЫТОЙ.
 *
 * ⚠️ «ВИДИМА» — ЭТО НЕ «РОВНО ЕДИНИЦА». Неактивный вопрос приглушён,
 * и его видимое состояние — доля, а не единица. Поэтому сторож НЕ
 * ЗНАЕТ эту долю заранее: он собирает все значения за проход и
 * требует, чтобы их оказалось ровно ДВА на половину. Промежуточное
 * значение — это третье значение, и оно ловится само.
 */
const OFF = 0.02;
/** Допуск на совпадение с одним из двух законных значений. */
const EPS = 0.005;

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

  /* Отдаём фактическую прозрачность обеих половин: она и есть
     состояние, которое видит человек. */
  const look = (top, frames = 2) =>
    page.evaluate(
      async ([t, f]) => {
        const sc = document.getElementById('scroller');
        sc.scrollTop = Math.max(0, t);
        for (let i = 0; i < f; i += 1) await new Promise((r) => requestAnimationFrame(r));
        return [...document.querySelectorAll('.qa__item')].map((it) => [
          +getComputedStyle(it.querySelector('.qa__half--a')).opacity,
          +getComputedStyle(it.querySelector('.qa__half--q')).opacity,
        ]);
      },
      [top, frames],
    );

  let spots = 0;
  let twoAnswers = 0;
  let both = 0;
  let neither = 0;
  const aVals = new Set();
  const qVals = new Set();
  const seen = [[], []]; // сколько раз каждый вопрос побывал открытым и закрытым
  const trace = new Map();
  let switchAt = null;
  let prevOpen = null;

  for (let y = range.from; y <= range.to; y += range.step) {
    const row = await look(y);
    spots += 1;
    let open = 0;
    let cur = -1;
    for (let i = 0; i < row.length; i += 1) {
      const [a, q] = row[i];
      aVals.add(a.toFixed(3));
      qVals.add(q.toFixed(3));
      const aOn = a > OFF;
      const qOn = q > OFF;
      if (aOn && qOn) both += 1;
      if (!aOn && !qOn) neither += 1;
      if (aOn) {
        open += 1;
        cur = i;
        seen[0][i] = (seen[0][i] || 0) + 1;
      } else {
        seen[1][i] = (seen[1][i] || 0) + 1;
      }
    }
    if (open > 1) twoAnswers += 1;
    trace.set(y, cur);
    if (prevOpen !== null && prevOpen !== cur && switchAt === null && cur >= 0 && prevOpen >= 0) {
      switchAt = y;
    }
    prevOpen = cur;
  }

  /* Законных значений ровно два на половину — «видно» и «скрыто».
     Всё остальное и есть промежуточное состояние. */
  const levels = (set) => [...set].map(Number).sort((x, y2) => x - y2);
  const aLv = levels(aVals);
  const qLv = levels(qVals);
  const outside = (v, lv) => Math.abs(v - lv[0]) > EPS && Math.abs(v - lv[lv.length - 1]) > EPS;
  const middle = aLv.length - 2 + (qLv.length - 2);

  /* ── обратный проход: назад обязано работать симметрично ─────────── */
  let asym = 0;
  for (let y = range.to; y >= range.from; y -= range.step) {
    const key = range.from + Math.round((y - range.from) / range.step) * range.step;
    if (!trace.has(key)) continue;
    const row = await look(key);
    let cur = -1;
    for (let i = 0; i < row.length; i += 1) if (row[i][0] > OFF) cur = i;
    if (cur !== trace.get(key)) asym += 1;
  }

  /* ── переход в ПРОСТРАНСТВЕ: мелкий проход шагом 1 px ────────────── */
  let band = -1;
  if (switchAt !== null) {
    let first = null;
    let last = null;
    for (let y = switchAt - range.step - 2; y <= switchAt + 2; y += 1) {
      const row = await look(y);
      const mid = row.some(([a, q]) => outside(a, aLv) || outside(q, qLv));
      if (mid) {
        if (first === null) first = y;
        last = y;
      }
    }
    band = first === null ? 0 : last - first + 1;
  }

  /* ── переход ВО ВРЕМЕНИ: прыжок через точку и чтение на след. кадре ─ */
  let settle = -1;
  if (switchAt !== null) {
    await look(switchAt - range.step - 4);
    const row = await look(switchAt + 4, 1);
    settle = row.some(([a, q]) => outside(a, aLv) || outside(q, qLv)) ? 1 : 0;
  }

  /* ── растр: состояния могут быть верными, а рисовать нечего ──────── */
  const ink = async (wantOpen) => {
    for (let y = range.from; y <= range.to; y += 12) {
      const row = await look(y);
      const a = row[1][0];
      if (wantOpen ? a < 1 - EPS : a > OFF) continue;
      const box = await page.evaluate(() => {
        const r = document.querySelectorAll('.qa__item')[1].getBoundingClientRect();
        return {
          x: Math.max(0, Math.round(r.x)),
          y: Math.max(0, Math.round(r.y)),
          width: Math.round(r.width),
          height: Math.round(r.height),
        };
      });
      if (box.y < 0 || box.height < 8 || box.y + box.height > h) continue;
      const png = PNG.sync.read(await page.screenshot({ clip: box }));
      let n = 0;
      for (let i = 0; i < png.data.length; i += 4) if (png.data[i] > 90) n += 1;
      return n;
    }
    return -1;
  };
  const inkOpen = await ink(true);
  const inkShut = await ink(false);

  const stuck = seen[0].filter((v) => v > 0).length !== 6 || seen[1].filter((v) => v > 0).length !== 6;
  const okOne = twoAnswers === 0;
  const okFit = both === 0 && neither === 0;
  const okHard = middle === 0 && band === 0 && settle === 0 && aLv[0] <= OFF && qLv[0] <= OFF;
  const okBack = asym === 0;
  const okInk = inkOpen > 200 && inkShut > 200;
  if (!okOne || !okFit || !okHard || !okBack || !okInk || stuck) failed = true;

  console.log(
    `  ${String(w).padStart(4)}×${h}  положений ${String(spots).padStart(3)}  ` +
      `два ответа ${twoAnswers}  наложений ${both}  пустых ${neither}  ` +
      `уровней прозрачности: ответ ${aLv.length}, вопрос ${qLv.length}` +
      (okOne ? '' : '   !!! ДВА ОТВЕТА РАЗОМ') +
      (okFit ? '' : '   !!! НАЛОЖЕНИЕ ИЛИ ПУСТОТА') +
      (stuck ? '   !!! ВОПРОС ЗАСТРЯЛ В ОДНОМ СОСТОЯНИИ' : ''),
  );
  console.log(
    `            переход: ${band} px прокрутки и ${settle ? 'НЕ ' : ''}укладывается в один кадр; ` +
      `обратный проход расходится в ${asym} положениях; ` +
      `живых пикселей: ответ ${inkOpen}, вопрос ${inkShut}` +
      (okHard ? '' : '   !!! ПЕРЕХОД НЕ МГНОВЕННЫЙ') +
      (okBack ? '' : '   !!! НАЗАД РАБОТАЕТ ИНАЧЕ') +
      (okInk ? '' : '   !!! В ЯЧЕЙКЕ НИЧЕГО НЕ НАРИСОВАНО'),
  );
  await page.close();
}

await browser.close();
server.close();
console.log(
  failed
    ? '\nПРОВАЛ: переключение вопроса на ответ ведёт себя не так, как задумано'
    : '\nНа всей прокрутке виден ровно один ответ, и смена занимает один кадр',
);
process.exit(failed ? 1 : 0);

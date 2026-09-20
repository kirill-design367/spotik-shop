/**
 * ВОПРОС И ОТВЕТ: ШТОРКА, И ОТВЕТ НА ЭКРАНЕ ОДИН — СПЛОШНОЙ ПЕРЕБОР.
 *
 * Постановка двадцать второй итерации ставит три условия сразу, и все
 * три проверяются здесь перебором ВСЕЙ прокрутки блока:
 *
 *   1. НИ ОДНОГО ПОЛОЖЕНИЯ, ГДЕ ВИДНО ДВА ОТВЕТА. Этот дефект и был
 *      в прошлой сборке: зона веса расширилась до 0.92 шага, два
 *      соседних вопроса стали активными разом, а прежний сторож
 *      смотрел каждый вопрос ПООДИНОЧКЕ и потому ничего не заметил.
 *   2. НИ ОДНОГО НАЛОЖЕНИЯ вопроса с ответом внутри своей ячейки.
 *   3. НИ ОДНОГО ПУСТОГО положения.
 *
 * ── ГРАНИЦЫ СРАВНИВАЮТСЯ В ПИКСЕЛЯХ, А НЕ В ПРОЦЕНТАХ ────────────────────
 * ⚠️ И ЭТО НЕ ПРИДИРКА. Проценты в `clip-path` считаются от бокса САМОГО
 * элемента. Пока обрезались сами тексты — разной высоты, — одна и та же
 * ордината попадала у них в разные пиксели: в процентах всё сходилось
 * до нуля, а на экране половины расходились на десятки пикселей. Сторож,
 * читавший проценты, молчал ровно по той же причине, по которой молчал
 * цветовой сторож шапки (Р-47): он пользовался моделью предмета.
 *
 * Теперь берётся ВЫЧИСЛЕННЫЙ `clip-path` обеих половин и ФАКТИЧЕСКИЕ
 * прямоугольники, и границы переводятся в пиксели ячейки:
 *
 *   наложение — граница ответа ниже границы вопроса (области налезли);
 *   пустота   — выше (между областями щель);
 *   два ответа — у двух разных вопросов открыто больше 2 % ячейки.
 *
 * ЧИТАТЬ НАДО ЧЕРЕЗ ДВА КАДРА ПОСЛЕ ЗАПИСИ `scrollTop`, а не сразу.
 * На точном указателе позицию ведёт Lenis: он сверяется с фактическим
 * значением и доводит её сам, поэтому мгновенное чтение возвращает
 * то предыдущее положение, то промежуточное (Р-61).
 *
 * И ОТДЕЛЬНОЙ СТРОКОЙ — РАСТР. Вся геометрия выше сойдётся и на сборке,
 * где текст не рисуется вовсе: обрезка правильная, а обрезать нечего.
 * Поэтому на двух положениях — «шторка закрыта» и «шторка открыта» —
 * считаются живые пиксели в ячейке.
 *
 * ХОД ШТОРКИ меряется ОТДЕЛЬНЫМ мелким проходом (шаг 2 px) по одному
 * переходу: на общем шаге 8 px он квантуется на четверть своей длины.
 */
import { PNG } from 'pngjs';
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';

const PORT = 4262;
/** Выше этого доля открытой шторки считается видимой. */
const SEEN = 0.02;
/** Допуск на совпадение границ, пиксели. */
const EPS = 0.6;

const server = await serveOut(PORT);
const browser = await launch();
let failed = false;

/** «polygon(0% -2%, 100% -2%, 100% 34.5%, 0% 20.5%)» → [-2,-2,34.5,20.5] */
function ys(clip) {
  const m = /polygon\(([^)]*)\)/.exec(clip || '');
  if (!m) return null;
  const pts = m[1].split(',').map((p) => p.trim().split(/\s+/));
  if (pts.length !== 4) return null;
  return pts.map((p) => parseFloat(p[1]));
}

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

  /* Отдаём сырьё: обрезку каждой половины и её фактический бокс.
     Перевод в пиксели ячейки делается здесь же, чтобы не тащить
     наружу четыре числа на половину. */
  const look = (top) =>
    page.evaluate(async (t) => {
      const sc = document.getElementById('scroller');
      sc.scrollTop = Math.max(0, t);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return [...document.querySelectorAll('.qa__item')].map((it) => {
        const cell = it.querySelector('.qa__swap').getBoundingClientRect();
        const one = (sel) => {
          const el = it.querySelector(sel);
          const r = el.getBoundingClientRect();
          return { clip: getComputedStyle(el).clipPath, top: r.top - cell.top, h: r.height };
        };
        return {
          cell: cell.height,
          q: one('.qa__half--q'),
          a: one('.qa__half--a'),
          oq: +getComputedStyle(it.querySelector('.qa__q')).opacity,
        };
      });
    }, top);

  /** Ординаты обрезки в пикселях ячейки. */
  const px = (half) => {
    const v = ys(half.clip);
    return v && v.map((p) => half.top + (p / 100) * half.h);
  };

  let spots = 0;
  let twoAnswers = 0;
  let overlap = 0;
  let gap = 0;
  let worstEdge = 0;
  let maxOpen = 0;
  let minOpen = 1;
  let moving = 0;
  const wasOpen = [];
  const marks = []; // где у второго вопроса случился переход — для мелкого прохода

  for (let y = range.from; y <= range.to; y += range.step) {
    const row = await look(y);
    spots += 1;
    let open = 0;
    for (let i = 0; i < row.length; i += 1) {
      const ay = px(row[i].a);
      const qy = px(row[i].q);
      if (!ay || !qy) {
        overlap += 1; // обрезки нет вовсе — считаем это провалом геометрии
        continue;
      }
      /* Граница ответа — его нижние две ординаты, граница вопроса —
         его верхние две. Совпадают — области ровно дополняют друг друга. */
      const d1 = qy[0] - ay[3];
      const d2 = qy[1] - ay[2];
      worstEdge = Math.max(worstEdge, Math.abs(d1), Math.abs(d2));
      if (d1 < -EPS || d2 < -EPS) overlap += 1;
      else if (d1 > EPS || d2 > EPS) gap += 1;

      const frac = Math.max(0, Math.min(1, (ay[3] + ay[2]) / 2 / row[i].cell));
      maxOpen = Math.max(maxOpen, frac);
      minOpen = Math.min(minOpen, frac);
      if (frac > SEEN) open += 1;
      if (frac > SEEN && frac < 0.98) moving += 1;
      const isOpen = frac > 0.5;
      if (i === 1 && wasOpen[i] !== undefined && wasOpen[i] !== isOpen) marks.push(y);
      wasOpen[i] = isOpen;
    }
    if (open > 1) twoAnswers += 1;
  }

  /* ── ход шторки: мелкий проход по одному переходу ─────────────────── */
  let travel = 0;
  if (marks.length) {
    let first = null;
    let last = null;
    for (let y = marks[0] - 120; y <= marks[0] + 120; y += 2) {
      const row = await look(y);
      const ay = px(row[1].a);
      if (!ay) continue;
      const frac = Math.max(0, Math.min(1, (ay[3] + ay[2]) / 2 / row[1].cell));
      if (frac > SEEN && frac < 0.98) {
        if (first === null) first = y;
        last = y;
      }
    }
    if (first !== null) travel = last - first + 2;
  }

  /* ── растр: обрезка может быть идеальной, а рисовать нечего ───────── */
  const ink = async (openWanted) => {
    for (let y = range.from; y <= range.to; y += 12) {
      const row = await look(y);
      const a = px(row[1].a);
      if (!a) continue;
      const frac = Math.max(0, Math.min(1, (a[3] + a[2]) / 2 / row[1].cell));
      if (openWanted ? frac < 0.99 : frac > 0.01) continue;
      const box = await page.evaluate(() => {
        const r = document.querySelectorAll('.qa__item')[1].getBoundingClientRect();
        return { x: Math.max(0, Math.round(r.x)), y: Math.max(0, Math.round(r.y)),
          width: Math.round(r.width), height: Math.round(r.height) };
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

  const okOne = twoAnswers === 0;
  const okFit = overlap === 0 && gap === 0;
  const okEnds = maxOpen > 0.99 && minOpen < 0.01;
  const okInk = inkOpen > 200 && inkShut > 200;
  const okMove = moving > 0 && travel >= 40;
  if (!okOne || !okFit || !okEnds || !okInk || !okMove) failed = true;

  console.log(
    `  ${String(w).padStart(4)}×${h}  положений ${String(spots).padStart(3)}  ` +
      `два ответа ${twoAnswers}  наложений ${overlap}  щелей ${gap}  ` +
      `наибольший разрыв границ ${worstEdge.toFixed(2)} px  ` +
      `шторка доходит до ${minOpen.toFixed(2)}…${maxOpen.toFixed(2)}` +
      (okOne ? '' : '   !!! ДВА ОТВЕТА РАЗОМ') +
      (okFit ? '' : '   !!! ГРАНИЦЫ РАЗОШЛИСЬ') +
      (okEnds ? '' : '   !!! ШТОРКА НЕ ДОХОДИТ ДО КОНЦА'),
  );
  console.log(
    `            ход шторки ${travel} px прокрутки на переход; ` +
      `живых пикселей в ячейке: шторка открыта ${inkOpen}, закрыта ${inkShut}` +
      (okInk ? '' : '   !!! В ЯЧЕЙКЕ НИЧЕГО НЕ НАРИСОВАНО') +
      (okMove ? '' : '   !!! ШТОРКА НЕ ЕДЕТ'),
  );
  await page.close();
}

await browser.close();
server.close();
console.log(
  failed
    ? '\nПРОВАЛ: шторка ведёт себя не так, как задумано'
    : '\nНа всей прокрутке виден ровно один ответ, и границы половин совпадают',
);
process.exit(failed ? 1 : 0);

/**
 * БУРГЕР И МЕНЮ: ПЛАВНОСТЬ, STAGGER И ПОРЯДОК ЗАКРЫТИЯ.
 *
 * Постановка двадцать второй итерации ставит четыре условия, и три
 * из них — временны́е, то есть на глаз не проверяются вовсе:
 *
 *   1. полосы поворачиваются 0.45…0.6 с, а не щёлкают;
 *   2. пункты меню приезжают СО СДВИГОМ и с задержкой друг от друга;
 *   3. закрытие идёт в обратную сторону: последний пункт уходит первым;
 *   4. накладка гаснет ПОСЛЕ того, как крестик стал бургером, — иначе
 *      знак подменяется на полпути (Р-66).
 *
 * ── ЧТО ЧИТАЕТСЯ ──────────────────────────────────────────────────────────
 * Не таблица длительностей из CSS, а ФАКТИЧЕСКОЕ состояние: угол полосы
 * берётся из вычисленной матрицы трансформа, положение пункта — оттуда же,
 * прозрачность накладки — из вычисленного стиля. Опрос идёт по кадрам,
 * поэтому это результат, а не модель (правило Р-47).
 *
 * Отдельной строкой — СКРУГЛЕНИЕ КОНЦОВ ПОЛОС: оно обязано совпадать
 * с числом, по которому собирается фигура выворотки шапки (`BURGER_R`
 * в Nav.tsx). Разойдись они — шапка нарисовала бы чернила рядом
 * с настоящими, и цветовой сторож этого не увидел бы.
 */
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';

const PORT = 4271;
/** Окно на поворот полос, миллисекунды. */
const MORPH_MIN = 450;
const MORPH_MAX = 640;
/** Скругление концов полос: то же число, что `BURGER_R` в Nav.tsx. */
const BURGER_R = 2;

const server = await serveOut(PORT);
const browser = await launch();
let failed = false;

console.log('БУРГЕР И МЕНЮ: покадровый опрос состояния.\n');

const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 1,
});
await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(600);

/**
 * Опрос по кадрам: угол первой полосы бургера, сдвиг каждого пункта
 * и прозрачность накладки. Возвращает дорожку [t, angle, y0, y1, y2, op].
 */
const track = (ms) =>
  page.evaluate(async (ms) => {
    const bars = document.querySelector('.nav__burger .nav__burger-bars');
    const bar = bars.firstElementChild;
    const items = [...document.querySelectorAll('.menu__item')];
    const menu = document.querySelector('.menu');
    const rows = [];
    const t0 = performance.now();
    return await new Promise((done) => {
      const step = (now) => {
        const m = new DOMMatrixReadOnly(getComputedStyle(bar).transform);
        const ang = Math.abs((Math.atan2(m.b, m.a) * 180) / Math.PI);
        const ys = items.map((el) => {
          const mm = new DOMMatrixReadOnly(getComputedStyle(el).transform);
          return { y: mm.f, o: +getComputedStyle(el).opacity };
        });
        rows.push([now - t0, ang, ys, +getComputedStyle(menu).opacity]);
        if (now - t0 < ms) requestAnimationFrame(step);
        else done(rows);
      };
      requestAnimationFrame(step);
    });
  }, ms);

/**
 * Момент, когда величина УСПОКОИЛАСЬ на цели.
 *
 * ⚠️ НЕ «впервые коснулась». У поворота полос премиальный easing
 * с перелётом: 45° она проходит насквозь и возвращается, и первое
 * касание давало 424 мс там, где движение идёт 520. Берём последний
 * кадр, где величина ещё отличалась от цели.
 */
const reach = (rows, pick, target, eps) => {
  let last = -1;
  for (let i = 0; i < rows.length; i += 1) {
    if (Math.abs(pick(rows[i]) - target) > eps) last = i;
  }
  if (last < 0) return 0;
  return last + 1 < rows.length ? rows[last + 1][0] : -1;
};
/** Момент, когда величина ВПЕРВЫЕ сдвинулась с места. */
const leave = (rows, pick, eps) => {
  const a = pick(rows[0]);
  for (const r of rows) if (Math.abs(pick(r) - a) > eps) return r[0];
  return -1;
};

// ── ОТКРЫТИЕ ──────────────────────────────────────────────────────────────
const openPromise = track(1100);
await page.waitForTimeout(30);
await page.click('.nav__burger');
const up = await openPromise;

/* Отсчёт ведём ОТ ПЕРВОГО ДВИЖЕНИЯ ЗНАКА, а не от начала опроса:
   между стартом опроса и нажатием лежит время самого нажатия. */
const t0 = leave(up, (r) => r[1], 0.2);
const morphOpen = reach(up, (r) => r[1], 45, 0.4) - t0;
const starts = [0, 1, 2].map((i) => leave(up, (r) => r[2][i].y, 0.6) - t0);
const staggerIn = starts[2] - starts[0];
const shift = Math.max(...up.map((r) => Math.max(...r[2].map((v) => Math.abs(v.y)))));
const menuUp = reach(up, (r) => r[3], 1, 0.01) - t0;

// ── ЗАКРЫТИЕ ──────────────────────────────────────────────────────────────
await page.waitForTimeout(400);
const closePromise = track(1400);
await page.waitForTimeout(30);
await page.click('.menu__close');
const dn = await closePromise;

const t0c = leave(dn, (r) => r[1], 0.2);
const morphBack = reach(dn, (r) => r[1], 0, 0.4) - t0c;
/* ⚠️ ОТСЧЁТ ЗДЕСЬ МОЖЕТ УЙТИ В МИНУС, И ЭТО НЕ ОШИБКА. Ноль взят
   по первому ЗАМЕТНОМУ повороту полосы (0.2°), а последний пункт
   трогается без задержки — то есть на кадр-другой раньше, чем угол
   успевает выйти за порог. Значит судить надо по ПОРЯДКУ, а не
   по знаку. */
const outsRaw = [0, 1, 2].map((i) => leave(dn, (r) => r[2][i].o, 0.02));
const outs = outsRaw.map((v) => v - t0c);
const menuGone = reach(dn, (r) => r[3], 0, 0.01) - t0c;

const okMorph = morphOpen >= MORPH_MIN && morphOpen <= MORPH_MAX;
const okStagger = staggerIn > 90 && starts[0] >= 0 && starts[2] > starts[1] && starts[1] > starts[0];
const okShift = shift >= 12;
const okReverse = outsRaw.every((v) => v >= 0) && outs[0] > outs[1] && outs[1] > outs[2];
const okWait = menuGone > morphBack && morphBack > 0;
if (!okMorph || !okStagger || !okShift || !okReverse || !okWait) failed = true;

console.log(
  `  открытие: полосы дошли до 45° за ${morphOpen.toFixed(0)} мс ` +
    `(окно ${MORPH_MIN}…${MORPH_MAX}), накладка проявилась за ${menuUp.toFixed(0)} мс` +
    (okMorph ? '' : '   !!! ПОВОРОТ ВНЕ ОКНА'),
);
console.log(
  `            пункты тронулись на ${starts.map((v) => v.toFixed(0)).join(' / ')} мс ` +
    `(разбег ${staggerIn.toFixed(0)} мс), наибольший сдвиг ${shift.toFixed(1)} px` +
    (okStagger ? '' : '   !!! НЕТ STAGGER') +
    (okShift ? '' : '   !!! НЕТ СДВИГА'),
);
console.log(
  `  закрытие: пункты гаснут на ${outs.map((v) => v.toFixed(0)).join(' / ')} мс — ` +
    `${okReverse ? 'в обратном порядке' : 'В ТОМ ЖЕ ПОРЯДКЕ'}` +
    (okReverse ? '' : '   !!! ЗАКРЫТИЕ НЕ ЗЕРКАЛЬНО'),
);
console.log(
  `            полосы вернулись за ${morphBack.toFixed(0)} мс, накладка погасла за ` +
    `${menuGone.toFixed(0)} мс` +
    (okWait ? '' : '   !!! НАКЛАДКА ГАСНЕТ РАНЬШЕ ЗНАКА'),
);

// ── скругление концов ─────────────────────────────────────────────────────
const radius = await page.evaluate(
  () => parseFloat(getComputedStyle(document.querySelector('.nav__burger-bars > span')).borderRadius),
);
const okR = Math.abs(radius - BURGER_R) < 0.01;
if (!okR) failed = true;
console.log(
  `  концы полос скруглены на ${radius} px (в фигуре выворотки ${BURGER_R})` +
    (okR ? '' : '   !!! ЗНАК И ФИГУРА РАЗОШЛИСЬ'),
);

await page.close();
await browser.close();
server.close();
console.log(
  failed ? '\nПРОВАЛ: меню ведёт себя не так, как задумано' : '\nЗнак и меню идут плавно и зеркально',
);
process.exit(failed ? 1 : 0);

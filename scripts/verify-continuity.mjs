/**
 * ПРОВЕРКА НЕПРЕРЫВНОСТИ МОРФА И ПОИСК РАССИНХРОНА СО СКРОЛЛОМ.
 *
 * В прошлой итерации слово дёргалось. Гипотез было две: квантование
 * вариативной оси при растеризации и рассинхрон между нативным скроллом
 * и сглаженным Lenis. Обе проверяются здесь замером, а не рассуждением.
 *
 * Каждый кадр записывается:
 *   - window.scrollY — источник прогресса;
 *   - lenis.scroll и lenis.animatedScroll, если Lenis доступен, — чтобы
 *     увидеть, не расходится ли сглаженная позиция с нативной;
 *   - атрибут d пути вордмарка целиком.
 *
 * Потом в node из каждой строки d извлекается высота прописной (литера I —
 * прямоугольник) и считается, сколько было РАЗНЫХ значений на число кадров
 * и какова самая длинная площадка одинаковых. Скролл гонится настоящими
 * событиями колеса: window.scrollTo обошёл бы и Lenis, и всю обработку ввода.
 *
 * Оговорка про края: сглаживание прогресса (smoothstep) имеет нулевую
 * производную в 0 и 1, поэтому у самых краёв одинаковые кадры законны.
 * Площадки поэтому считаются только в середине хода, 0.1…0.9.
 */
import { writeFileSync } from 'node:fs';
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';

const PORT = 4184;

const PROBE = `
window.__rec = { rows: [], on: false };
(() => {
  const tick = () => {
    if (window.__rec.on) {
      const p = document.querySelector('.wm--hero path');
      const l = window.__lenis;
      window.__rec.rows.push({
        t: performance.now(),
        y: window.scrollY,
        ls: l ? l.scroll : null,
        la: l ? l.animatedScroll : null,
        d: p ? p.getAttribute('d') : '',
      });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();
`;

/** Высота литеры I: пятая по счёту группа контуров, прямоугольник. */
function capFromD(d) {
  const parts = d.split('M').slice(1);
  const boxes = parts.map((p) => {
    const n = p.match(/-?\d[\d.]*/g).map(Number);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < n.length; i += 2) {
      if (n[i] < x0) x0 = n[i];
      if (n[i] > x1) x1 = n[i];
      if (n[i + 1] < y0) y0 = n[i + 1];
      if (n[i + 1] > y1) y1 = n[i + 1];
    }
    return { x0, x1, y0, y1 };
  });
  boxes.sort((a, b) => a.x0 - b.x0);
  const g = [];
  for (const b of boxes) {
    const last = g[g.length - 1];
    if (last && b.x0 <= last.x1) {
      last.x1 = Math.max(last.x1, b.x1);
      last.y0 = Math.min(last.y0, b.y0);
      last.y1 = Math.max(last.y1, b.y1);
    } else g.push({ ...b });
  }
  return g.length === 6 ? g[4].y1 - g[4].y0 : NaN;
}

function plateaus(v) {
  let max = 1;
  let run = 1;
  for (let i = 1; i < v.length; i += 1) {
    if (v[i] === v[i - 1]) run += 1;
    else { max = Math.max(max, run); run = 1; }
  }
  return Math.max(max, run);
}

const server = await serveOut(PORT);
const browser = await launch();

for (const dev of [
  { name: 'ДЕСКТОП 1920×1080', width: 1920, height: 1080, mobile: false },
  { name: 'МОБИЛЬНАЯ 390×844', width: 390, height: 844, mobile: true },
]) {
  const page = await browser.newPage({
    viewport: { width: dev.width, height: dev.height },
    isMobile: dev.mobile,
    hasTouch: dev.mobile,
    deviceScaleFactor: dev.mobile ? 2 : 1,
  });
  await page.addInitScript(PROBE);
  await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);

  await page.evaluate(() => { window.__rec.rows.length = 0; window.__rec.on = true; });
  // Крутим, пока нативная позиция не пройдёт весь ход хиро. Шаг мелкий,
  // чтобы кадров в середине хода набралось достаточно для оценки площадок.
  // Эмуляция мобильного гасит часть дельты колеса, поэтому не фиксированное
  // число шагов, а условие по фактическому scrollY.
  const need = dev.height * 1.08;
  for (let i = 0; i < 600; i += 1) {
    const y = await page.evaluate(() => window.scrollY);
    if (y >= need) break;
    await page.mouse.wheel(0, dev.height / 120);
    await page.waitForTimeout(24);
  }
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.__rec.on = false; });
  const rows = await page.evaluate(() => window.__rec.rows.slice());
  const geo = await page.evaluate(() => {
    const el = document.getElementById('hero');
    return { h: el.offsetHeight, vh: window.innerHeight };
  });
  await page.close();

  const caps = rows.map((r) => capFromD(r.d));
  const ys = rows.map((r) => r.y);
  const moving = rows
    .map((r, i) => ({ i, cap: caps[i], y: r.y }))
    .filter((r) => Number.isFinite(r.cap));
  const capMin = Math.min(...moving.map((r) => r.cap));
  const capMax = Math.max(...moving.map((r) => r.cap));
  const span = capMax - capMin;
  // середина хода: там производная сглаживания далека от нуля
  const mid = moving.filter((r) => r.cap > capMin + span * 0.1 && r.cap < capMax - span * 0.1);
  const midCaps = mid.map((r) => r.cap);
  const uniqCap = new Set(caps.filter(Number.isFinite).map((v) => v.toFixed(4))).size;
  const uniqMid = new Set(midCaps.map((v) => v.toFixed(4))).size;
  const uniqY = new Set(ys).size;
  const lenisSeen = rows.some((r) => r.ls !== null);
  const desync = rows.filter((r) => r.ls !== null).map((r) => Math.abs(r.ls - r.y));

  // Шаг считается по кадрам, где слово реально сдвинулось: кадры без нового
  // события колеса законно повторяют предыдущий и к квантованию отношения
  // не имеют.
  const deltas = [];
  for (let i = 1; i < midCaps.length; i += 1) {
    const dv = Math.abs(midCaps[i] - midCaps[i - 1]);
    if (dv > 0) deltas.push(dv);
  }
  deltas.sort((a, b) => a - b);

  console.log(`\n${dev.name}`);
  console.log(`  кадров записано ${rows.length}, из них с движущимся словом ${mid.length}`);
  console.log(`  высота прописной прошла ${capMin.toFixed(2)} … ${capMax.toFixed(2)} ед.`);
  console.log(`  разных значений высоты: ${uniqCap} на ${caps.filter(Number.isFinite).length} кадров`);
  console.log(`  в середине хода: ${uniqMid} разных на ${midCaps.length} кадров, ` +
    `самая длинная площадка ${plateaus(midCaps.map((v) => v.toFixed(4)))} кадр(а)`);
  console.log(`  шаг на кадрах, где слово двигалось (${deltas.length} шт.): ` +
    `медиана ${(deltas[Math.floor(deltas.length / 2)] ?? 0).toFixed(4)} ед., ` +
    `минимум ${(deltas[0] ?? 0).toFixed(4)}, максимум ${(deltas[deltas.length - 1] ?? 0).toFixed(4)} ед.`);
  console.log(`  window.scrollY: ${uniqY} разных значений на ${ys.length} кадров`);

  /**
   * Прямая проверка на рассинхрон. Если бы прогресс считался от одной позиции,
   * а Lenis сглаживал другую, форма отставала бы от scrollY в движении
   * и догоняла после остановки. Считаем ожидаемую высоту прописной прямо
   * из window.scrollY и сравниваем с нарисованной в том же кадре.
   */
  const span2 = Math.max(1, geo.h - geo.vh);
  const smooth = (t) => t * t * (3 - 2 * t);
  const expect = (y) => {
    const t = Math.min(1, Math.max(0, y / span2));
    return 209.25 + (122.22 - 209.25) * smooth(t);
  };
  const err = moving.map((r) => Math.abs(r.cap - expect(r.y))).sort((a, b) => a - b);
  console.log(`  ход хиро ${span2} px; расхождение «нарисовано против ожидаемого из scrollY»:`);
  console.log(`    медиана ${err[Math.floor(err.length / 2)].toFixed(4)} ед., ` +
    `95-й процентиль ${err[Math.floor(err.length * 0.95)].toFixed(4)}, ` +
    `максимум ${err[err.length - 1].toFixed(4)} ед. ` +
    `(это ${((err[err.length - 1] / 209.25) * 100).toFixed(3)} % высоты прописной)`);
  if (lenisSeen) {
    const mx = Math.max(...desync);
    console.log(`  Lenis виден: |lenis.scroll − window.scrollY| максимум ${mx.toFixed(3)} px`);
  } else {
    console.log('  экземпляр Lenis в window не выставлен — сравнить напрямую нечем;');
    console.log('  косвенно: Lenis пишет позицию в НАТИВНЫЙ скролл, поэтому window.scrollY');
    console.log('  и есть сглаженное значение, и второго источника прогресса нет.');
  }
  writeFileSync(`.shots/continuity-${dev.width}.json`, JSON.stringify({ caps, ys }, null, 0));
}

await browser.close();
server.close();

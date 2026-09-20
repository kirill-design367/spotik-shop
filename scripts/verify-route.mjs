/**
 * МАРШРУТ: ПОДСВЕТКА ИДЁТ ОТ НАЧАЛА К КОНЦУ И ВОЗВРАЩАЕТСЯ.
 *
 * Постановка: «подсветка привязана к скроллу, идёт строго от начала
 * к концу; прокрутил назад — гаснет обратно. Номер шага появляется,
 * когда подсветка дошла до его точки, не раньше. Движение непрерывное,
 * без ступенек».
 *
 * Проверяется это ДВУМЯ РАЗНЫМИ ПРОХОДАМИ, и смешивать их нельзя.
 *
 *   ПЕРЕБОР ПОЛОЖЕНИЙ (телепорт + выдержка) отвечает на вопросы
 *   «монотонно ли», «в том ли порядке загораются номера» и «доходит ли
 *   ход до концов». Выдержка обязательна: на касаниях подсветку ведёт
 *   демпфер, и мгновенное чтение после записи `scrollTop` возвращает
 *   ещё вчерашнее значение.
 *
 *   ЖИВОЙ ПРОХОД КОЛЕСОМ отвечает на вопрос «нет ли ступенек». Здесь
 *   выдержка, наоборот, запрещена: она бы и сгладила ровно то, что
 *   ищем. Метрика та же, что у морфа вордмарка (Р-18): кадров, где
 *   скролл ехал, а подсветка стояла.
 *
 * И отдельной строкой — РАСТР: сторож обязан падать, когда линии нет
 * вовсе. Без этой строки все инварианты выше проходили бы и на сборке,
 * где маска сломана и не рисуется ничего (Р-47).
 */
import { PNG } from 'pngjs';
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';

const PORT = 4263;
const SETTLE = 260; // выдержка на схождение демпфера, мс
const server = await serveOut(PORT);
const browser = await launch();
let failed = false;

/** Сколько зелёных пикселей на кадре — грубо, по превышению зелёного канала. */
function greens(buf) {
  const img = PNG.sync.read(buf);
  let n = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i];
    const g = img.data[i + 1];
    const b = img.data[i + 2];
    if (g > 70 && g > r * 1.8 && g > b * 1.8) n += 1;
  }
  return n;
}

const PROBE = `
window.__rt = { rows: [], on: false };
(() => {
  const tick = () => {
    if (window.__rt.on) {
      const lit = document.querySelector('.route__lit');
      const sc = document.getElementById('scroller');
      if (lit && sc) window.__rt.rows.push([sc.scrollTop, 1 - Number(lit.getAttribute('stroke-dashoffset'))]);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();
`;

console.log('МАРШРУТ: перебор положений плюс живой проход колесом.\n');

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
  await page.addInitScript(PROBE);
  await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);

  const range = await page.evaluate(() => {
    const el = document.querySelector('.route');
    const sc = document.getElementById('scroller');
    const base = sc.getBoundingClientRect().top - sc.scrollTop;
    const r = el.getBoundingClientRect();
    return { from: r.top - base - sc.clientHeight, to: r.bottom - base };
  });

  const park = async (top) => {
    await page.evaluate((t) => {
      document.getElementById('scroller').scrollTop = Math.max(0, t);
    }, top);
    await page.waitForTimeout(SETTLE);
  };
  const state = () =>
    page.evaluate(() => ({
      p: 1 - Number(document.querySelector('.route__lit').getAttribute('stroke-dashoffset')),
      n: [...document.querySelectorAll('.rstep')].map((e) =>
        Number(getComputedStyle(e).getPropertyValue('--n')),
      ),
    }));

  const ys = [];
  for (let y = range.from; y <= range.to; y += 26) ys.push(y);

  // ── проход вниз: монотонность и порядок ──────────────────────────────
  let backSlip = 0;
  let orderBad = 0;
  let prev = -1;
  let last = null;
  for (const y of ys) {
    await park(y);
    const r = await state();
    if (prev >= 0 && r.p < prev - 1e-6) backSlip += 1;
    prev = r.p;
    for (let i = 1; i < r.n.length; i += 1) {
      if (r.n[i] > 0.001 && r.n[i - 1] < 0.999) orderBad += 1;
    }
    last = r;
  }

  // ── проход вверх: гаснет обратно ─────────────────────────────────────
  let fwdSlip = 0;
  prev = 2;
  for (let i = ys.length - 1; i >= 0; i -= 1) {
    await park(ys[i]);
    const r = await state();
    if (r.p > prev + 1e-6) fwdSlip += 1;
    prev = r.p;
  }
  await park(range.from);
  const first = await state();

  // ── живой проход колесом: ступенек быть не должно ────────────────────
  await park(range.from + 20);
  await page.evaluate(() => {
    window.__rt.rows.length = 0;
    window.__rt.on = true;
  });
  const total = range.to - range.from;
  for (let i = 0; i < 40; i += 1) {
    await page.mouse.wheel(0, total / 40);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    window.__rt.on = false;
  });
  const rows = await page.evaluate(() => window.__rt.rows);
  let dead = 0;
  let moved = 0;
  let maxStep = 0;
  for (let i = 1; i < rows.length; i += 1) {
    const dy = rows[i][0] - rows[i - 1][0];
    const dp = Math.abs(rows[i][1] - rows[i - 1][1]);
    if (Math.abs(dy) > 0.5 && rows[i - 1][1] > 0 && rows[i - 1][1] < 1) {
      moved += 1;
      if (dp < 1e-6) dead += 1;
    }
    maxStep = Math.max(maxStep, dp);
  }

  // ── растр: линия обязана появиться ───────────────────────────────────
  const vis = () =>
    page.evaluate(() => {
      const r = document.querySelector('.route').getBoundingClientRect();
      const x = Math.max(0, Math.round(r.left));
      const y = Math.max(0, Math.round(r.top));
      return {
        x,
        y,
        width: Math.max(1, Math.round(Math.min(r.right, window.innerWidth) - x)),
        height: Math.max(1, Math.round(Math.min(r.bottom, window.innerHeight) - y)),
      };
    });
  await park(range.from + total * 0.02);
  const dark = greens(await page.screenshot({ clip: await vis() }));
  await park(range.from + total * 0.6);
  const lit = greens(await page.screenshot({ clip: await vis() }));

  const okEnds = last.p > 0.999 && last.n.every((v) => v > 0.999) && first.p < 0.001;
  const okDraw = lit > dark + 200;
  const okLive = moved > 10 && dead === 0;
  if (backSlip || fwdSlip || orderBad || !okEnds || !okDraw || !okLive) failed = true;

  console.log(
    `  ${String(w).padStart(4)}×${h}  положений ${String(ys.length).padStart(3)}  ` +
      `откатов вниз ${backSlip}  вверх ${fwdSlip}  порядок нарушен ${orderBad}  ` +
      `концы ${first.p.toFixed(3)}…${last.p.toFixed(3)}  ` +
      `на колесе: подсветка стояла ${dead} из ${moved} подвижных кадров, ` +
      `наибольший шаг ${maxStep.toFixed(3)}  зелёных ${dark} → ${lit}` +
      (okEnds ? '' : '   !!! КОНЦЫ ХОДА') +
      (okDraw ? '' : '   !!! ЛИНИЯ НЕ РИСУЕТСЯ') +
      (okLive ? '' : '   !!! СТУПЕНЬКИ'),
  );
  await page.close();
}

await browser.close();
server.close();
console.log(
  failed
    ? '\nПРОВАЛ: подсветка маршрута ведёт себя не так, как задумано'
    : '\nПодсветка идёт от начала к концу, возвращается и не ступает',
);
process.exit(failed ? 1 : 0);

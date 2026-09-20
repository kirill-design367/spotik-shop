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
 *
 * ── ДВАДЦАТЬ ПЕРВАЯ ИТЕРАЦИЯ ДОБАВИЛА ДВЕ ПРОВЕРКИ ────────────────────────
 * КОГДА ЗАГОРАЕТСЯ ШАГ. Постановка: «шаг должен загораться, пока он ещё
 * в НИЖНЕЙ половине экрана, а не когда доехал до середины; к моменту,
 * когда блок уходит вверх, маршрут обязан быть пройден целиком».
 * Меряется положение точки шага на экране в тот момент, когда её номер
 * загорелся, — в долях высоты экрана, где 0.5 это середина.
 *
 * ЛИНИЯ НЕ РЕЖЕТ ТЕКСТ. Шаги стоят рельефом, текст занимает всю ширину,
 * и петля, поставленная по долям перегона, проходила прямо по абзацу.
 * Проверяется по растру и по фактическим строчным боксам: зелёных
 * пикселей внутри строки быть не должно. Это ровно тот класс дефекта,
 * который видно глазом и не видно ни одному инварианту выше.
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

  /* Точки шагов на странице — по ним считается, где был шаг в тот
     момент, когда загорелся его номер. */
  const dots = await page.evaluate(() => {
    const el = document.querySelector('.route');
    const sc = document.getElementById('scroller');
    const base = sc.getBoundingClientRect().top - sc.scrollTop;
    const top = el.getBoundingClientRect().top - base;
    return {
      vh: sc.clientHeight,
      bottom: el.getBoundingClientRect().bottom - base,
      y: [...document.querySelectorAll('.rstep')].map(
        (e) => top + parseFloat(e.style.getPropertyValue('--dot-y') || '0'),
      ),
    };
  });
  const litAt = new Array(dots.y.length).fill(null);

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
    /* Где был шаг на экране в тот момент, когда его номер загорелся. */
    for (let i = 0; i < r.n.length; i += 1) {
      if (litAt[i] === null && r.n[i] >= 0.5) litAt[i] = (dots.y[i] - y) / dots.vh;
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

  /* Маршрут обязан быть пройден ДО ТОГО, как блок уйдёт вверх:
     ставим его низ на 70 % высоты экрана — блок ещё виден. */
  await park(dots.bottom - dots.vh * 0.7);
  /* Демпфер на касаниях доводит подсветку за 120 мс, а прыжок сюда
     идёт с другого конца страницы: одной выдержки мало. */
  await page.waitForTimeout(SETTLE * 2);
  const early = await state();

  const lowest = Math.min(...litAt.map((v) => (v === null ? -1 : v)));
  const okWhen = litAt.every((v) => v !== null && v > 0.5);
  const okAhead = early.p > 0.999;

  const okEnds = last.p > 0.999 && last.n.every((v) => v > 0.999) && first.p < 0.001;
  const okDraw = lit > dark + 200;
  const okLive = moved > 10 && dead === 0;
  /* ── линия не режет текст: растр против строчных боксов ───────────── */
  await park(range.from + total * 0.6);
  const geo = await page.evaluate(() => {
    const r = document.querySelector('.route').getBoundingClientRect();
    const rects = [];
    for (const el of document.querySelectorAll('.rstep__t, .rstep__d')) {
      const range2 = document.createRange();
      range2.selectNodeContents(el);
      for (const b of range2.getClientRects()) {
        if (b.width < 2 || b.height < 2) continue;
        rects.push({ x: b.x - r.x, y: b.y - r.y, w: b.width, h: b.height });
      }
    }
    return { box: { x: r.x, y: r.y, width: r.width, height: r.height }, rects };
  });
  let crossed = 0;
  if (geo.box.height > 0 && geo.box.width > 0) {
    const shot = PNG.sync.read(
      await page.screenshot({
        clip: {
          x: Math.max(0, geo.box.x),
          y: Math.max(0, geo.box.y),
          width: geo.box.width,
          height: geo.box.height,
        },
        // блок выше экрана — снимок всё равно нужен целиком
        scale: 'css',
      }),
    );
    const dy = geo.box.y < 0 ? geo.box.y : 0;
    for (const b of geo.rects) {
      let hit = 0;
      const x0 = Math.max(0, Math.floor(b.x));
      const x1 = Math.min(shot.width, Math.ceil(b.x + b.w));
      const y0 = Math.max(0, Math.floor(b.y + dy));
      const y1 = Math.min(shot.height, Math.ceil(b.y + b.h + dy));
      for (let yy = y0; yy < y1; yy += 1) {
        for (let xx = x0; xx < x1; xx += 1) {
          const i = (yy * shot.width + xx) * 4;
          const rr = shot.data[i];
          const gg = shot.data[i + 1];
          const bb = shot.data[i + 2];
          if (gg > 70 && gg > rr + 40 && gg > bb + 40) hit += 1;
        }
      }
      if (hit > 6) crossed += 1;
    }
  }

  /* ── ЛИНИЯ ОБЯЗАНА ВЫХОДИТЬ ЗА ОБА КРАЯ ЭКРАНА ─────────────────────
     Постановка двадцать второй итерации: «петли должны уходить
     за левый и правый край вьюпорта и возвращаться». Проверяется
     РАСТРОМ готового кадра, а не координатами пути: координаты — это
     модель предмета, а нужен результат. Перебираем блок сверху донизу
     и смотрим, коснулась ли зелень крайнего столбца пикселей слева
     и справа. */
  let touchL = 0;
  let touchR = 0;
  for (let t = 0; t <= 1.0001; t += 0.05) {
    await park(range.from + total * t);
    const band = await page.evaluate(() => {
      const r = document.querySelector('.route').getBoundingClientRect();
      const y = Math.max(0, Math.round(r.top));
      const hh = Math.round(Math.min(r.bottom, window.innerHeight) - y);
      return hh > 8 ? { x: 0, y, width: window.innerWidth, height: hh } : null;
    });
    if (!band) continue;
    const png = PNG.sync.read(await page.screenshot({ clip: band }));
    for (let yy = 0; yy < png.height; yy += 1) {
      for (const [xx, side] of [[0, 'L'], [png.width - 1, 'R']]) {
        const i = (yy * png.width + xx) * 4;
        const rr = png.data[i];
        const gg = png.data[i + 1];
        const bb = png.data[i + 2];
        if (gg > 40 && gg > rr + 14 && gg > bb + 14) {
          if (side === 'L') touchL += 1;
          else touchR += 1;
        }
      }
    }
  }
  const okOut = touchL > 0 && touchR > 0;

  if (
    backSlip || fwdSlip || orderBad || !okEnds || !okDraw || !okLive || !okWhen || !okAhead ||
    crossed || !okOut
  )
    failed = true;

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
  console.log(
    `            шаг загорается на ${litAt
      .map((v) => (v === null ? '—' : v.toFixed(2)))
      .join(' / ')} высоты экрана (самый поздний ${lowest.toFixed(2)}, порог 0.50)  ` +
      `маршрут при низе блока на 0.7 экрана: ${early.p.toFixed(3)}  ` +
      `строк перерезано линией ${crossed} из ${geo.rects.length}  ` +
      `за край экрана: слева ${touchL} px, справа ${touchR} px` +
      (okOut ? '' : '   !!! ЛИНИЯ НЕ ВЫХОДИТ ЗА КРАЙ') +
      (okWhen ? '' : '   !!! ЗАГОРАЕТСЯ ПОЗДНО') +
      (okAhead ? '' : '   !!! МАРШРУТ НЕ ДОЙДЁН') +
      (crossed ? '   !!! ЛИНИЯ РЕЖЕТ ТЕКСТ' : ''),
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

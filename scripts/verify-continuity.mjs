/**
 * ПЛАВНОСТЬ: ЗАМЕР, А НЕ ДЕКЛАРАЦИЯ.
 *
 * Скролл рвёт — надо назвать причину. Рвать может в трёх разных местах,
 * и они различаются только замером:
 *
 *   1) сама форма идёт ступеньками (квантование морфа);
 *   2) позиция скролла идёт ступеньками (сглаживание Lenis, события ввода);
 *   3) кадры просто не успевают (длинные задачи, дорогой кадр).
 *
 * Поэтому каждый кадр записывается разом: момент времени, позиция скролла
 * и атрибут d вордмарка целиком. Потом из каждой строки d достаётся высота
 * чернил — состояние формы одним числом. Дальше считается, сколько было
 * РАЗНЫХ значений на число кадров, какова самая длинная площадка и какой
 * шаг между кадрами. Отдельно снимаются длинные задачи и интервалы кадров.
 *
 * Скролл гонится НАСТОЯЩИМИ событиями колеса: window.scrollTo обошёл бы
 * и Lenis, и всю обработку ввода, и замер получился бы про другое.
 */
import { writeFileSync } from 'node:fs';
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';

const PORT = 4184;

const PROBE = `
window.__rec = { rows: [], long: [], on: false, prev: 0, gaps: [] };
(() => {
  const tick = (now) => {
    if (window.__rec.on) {
      const ps = document.querySelectorAll('.wm--hero .wm__letter path');
      if (window.__rec.prev) window.__rec.gaps.push(now - window.__rec.prev);
      window.__rec.prev = now;
      window.__rec.rows.push({
        t: now,
        y: window.scrollY,
        d: ps.length ? [...ps].map((e) => e.getAttribute('d')).join('') : '',
      });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (window.__rec.on) window.__rec.long.push(Math.round(e.duration));
      }
    }).observe({ entryTypes: ['longtask'] });
  } catch {}
})();
`;

/** Высота чернил из строки d: верх зафиксирован на нуле, значит это низ. */
function inkHeight(d) {
  const n = d.match(/-?\d[\d.]*/g);
  let max = -Infinity;
  for (let i = 1; i < n.length; i += 2) {
    const v = +n[i];
    if (v > max) max = v;
  }
  return max;
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
const q = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];

const server = await serveOut(PORT);
const browser = await launch();
const report = [];

for (const dev of [
  { name: 'ДЕСКТОП 1920×1080', width: 1920, height: 1080, mobile: false, cpu: 1 },
  { name: 'МОБИЛЬНАЯ 390×844 (процессор ×4)', width: 390, height: 844, mobile: true, cpu: 4 },
]) {
  const page = await browser.newPage({
    viewport: { width: dev.width, height: dev.height },
    isMobile: dev.mobile,
    hasTouch: dev.mobile,
    deviceScaleFactor: dev.mobile ? 2 : 1,
  });
  const cdp = await page.context().newCDPSession(page);
  if (dev.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: dev.cpu });

  await page.addInitScript(PROBE);
  await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('.hero__stage[data-entered]');
  await page.waitForTimeout(400);

  await page.evaluate(() => { window.__rec.rows.length = 0; window.__rec.long.length = 0; window.__rec.gaps.length = 0; window.__rec.on = true; });
  const need = dev.height * 1.08;
  for (let i = 0; i < 700; i += 1) {
    const y = await page.evaluate(() => window.scrollY);
    if (y >= need) break;
    await page.mouse.wheel(0, dev.height / 120);
    await page.waitForTimeout(22);
  }
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.__rec.on = false; });
  const rec = await page.evaluate(() => ({
    rows: window.__rec.rows.map((r) => ({ t: r.t, y: r.y, h: r.d })),
    long: window.__rec.long.slice(),
    gaps: window.__rec.gaps.slice(),
  }));
  const span = await page.evaluate(() => {
    const el = document.getElementById('hero');
    return el.offsetHeight - window.innerHeight;
  });
  await page.close();

  const H = rec.rows.map((r) => inkHeight(r.h));
  const Y = rec.rows.map((r) => r.y);
  const hMin = Math.min(...H);
  const hMax = Math.max(...H);
  const range = hMax - hMin;
  // середина хода: у сглаживания прогресса производная у краёв ноль,
  // поэтому одинаковые кадры там законны и площадки считаются не по ним
  const mid = [];
  for (let i = 0; i < H.length; i += 1)
    if (H[i] > hMin + range * 0.1 && H[i] < hMax - range * 0.1) mid.push(H[i]);
  const key = mid.map((v) => v.toFixed(4));
  const steps = [];
  for (let i = 1; i < mid.length; i += 1) {
    const d = Math.abs(mid[i] - mid[i - 1]);
    if (d > 0) steps.push(d);
  }
  steps.sort((a, b) => a - b);

  // рывок позиции скролла: вторая разность, в пикселях за кадр в квадрате
  const dy = [];
  for (let i = 1; i < Y.length; i += 1) dy.push(Y[i] - Y[i - 1]);
  const jerk = [];
  for (let i = 1; i < dy.length; i += 1) jerk.push(Math.abs(dy[i] - dy[i - 1]));
  jerk.sort((a, b) => a - b);

  const gaps = [...rec.gaps].filter((x) => x > 0.2 && x < 400).sort((a, b) => a - b);
  const over = gaps.filter((x) => x > 16.9).length;

  console.log(`\n${dev.name}   ход хиро ${span} px`);
  console.log(`  кадров ${rec.rows.length}, из них с движущейся формой ${mid.length}`);
  console.log(`  ФОРМА:  высота чернил прошла ${hMin.toFixed(2)} … ${hMax.toFixed(2)} ед.`);
  console.log(`          разных значений в середине хода ${new Set(key).size} на ${mid.length} кадров,`);
  console.log(`          самая длинная площадка ${plateaus(key)} кадр(а)`);
  console.log(`          шаг на кадрах с движением (${steps.length} шт.): ` +
    `мин ${(steps[0] ?? 0).toFixed(4)}, медиана ${(q(steps, 0.5) ?? 0).toFixed(4)}, ` +
    `макс ${(steps[steps.length - 1] ?? 0).toFixed(4)} ед.`);
  /* ГЛАВНОЕ ЧИСЛО ПОСЛЕ СНЯТИЯ ПЛАВНОГО СКРОЛЛА. Площадки формы сами
     по себе больше ничего не говорят: плавный скролл двигал позицию
     КАЖДЫЙ кадр по своей кривой, а нативный стоит между событиями ввода
     и едет рывками. Спрашивать надо не «менялась ли форма», а «менялась
     ли она там, где ехал скролл». */
  let still = 0;
  let moved = 0;
  for (let i = 1; i < H.length; i += 1) {
    if (Math.abs(Y[i] - Y[i - 1]) < 1) continue;
    if (H[i] > hMin + range * 0.02 && H[i] < hMax - range * 0.02) {
      moved += 1;
      if (Math.abs(H[i] - H[i - 1]) < 1e-6) still += 1;
    }
  }
  console.log(`          кадров, где скролл ехал, а форма стояла: ${still} из ${moved}`);
  console.log(`  СКРОЛЛ: ${new Set(Y).size} разных значений scrollY на ${Y.length} кадров`);
  console.log(`          рывок |Δ²y|: медиана ${q(jerk, 0.5).toFixed(3)}, ` +
    `95-й ${q(jerk, 0.95).toFixed(3)}, макс ${jerk[jerk.length - 1].toFixed(3)} px/кадр²`);
  console.log(`  КАДРЫ:  медиана ${(1000 / q(gaps, 0.5)).toFixed(1)} fps, ` +
    `худшие 5 % ${(1000 / q(gaps, 0.95)).toFixed(1)} fps, свыше 16.9 мс ${((over / gaps.length) * 100).toFixed(1)} %`);
  console.log(`          длинных задач ${rec.long.length}` +
    (rec.long.length ? ` на ${rec.long.reduce((a, b) => a + b, 0)} мс` : ''));

  report.push({
    size: dev.name,
    frames: rec.rows.length,
    moving: mid.length,
    distinct: new Set(key).size,
    plateau: plateaus(key),
    stepMin: steps[0] ?? 0,
    stepMed: q(steps, 0.5) ?? 0,
    stepMax: steps[steps.length - 1] ?? 0,
    scrollDistinct: new Set(Y).size,
    jerkMed: q(jerk, 0.5),
    jerkMax: jerk[jerk.length - 1],
    fpsMed: 1000 / q(gaps, 0.5),
    overPct: (over / gaps.length) * 100,
    longTasks: rec.long.length,
  });
}

await browser.close();
server.close();
writeFileSync('.shots/continuity.json', JSON.stringify(report, null, 2));

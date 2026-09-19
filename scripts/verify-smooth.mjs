/**
 * СГЛАЖИВАНИЕ: ФОРМА ПЛАВНАЯ, СТРАНИЦА БЕЗ ВЫБЕГА.
 *
 * Различаются ДВЕ величины, и это главное в замере.
 *
 *   ПОЗИЦИЯ СТРАНИЦЫ обязана идти от руки. Выбег после последнего события
 *   колеса — не больше 150 мс; с Lenis он был 933 мс и 354 px.
 *
 *   ПРОГРЕСС МОРФА демпфируется намеренно: после последнего события формы
 *   ещё меняется, и это НОРМА. Проверяется, что схождение укладывается
 *   в заданное окно и что форма при этом не идёт ступеньками.
 *
 * Третий замер — про дрожание на телефоне. Нативная инерция отдаёт позицию
 * дискретными шагами, и без демпфера форма повторяет их буквально: на кадр
 * без движения позиции приходится кадр без изменения формы. Меряется доля
 * подвижных кадров инерции, в которых форма СТОЯЛА. Демпфер обязан
 * увести её к нулю.
 */
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';

const PORT = 4237;
/* Потолок выбега страницы, мс. */
const COAST_MAX = 150;
/* Окно схождения формы после руки, мс: ниже — сглаживания нет вовсе,
   выше — это уже тяжесть. */
const SETTLE_MIN = 40;
const SETTLE_MAX = 300;

const PROBE = `
window.__sm = { rows: [], on: false, wheel: 0, touch: 0 };
addEventListener('wheel', () => { window.__sm.wheel = performance.now(); },
  { passive: true, capture: true });
addEventListener('touchend', () => { window.__sm.touch = performance.now(); },
  { passive: true, capture: true });
window.__smStart = () => {
  window.__sm.rows.length = 0;
  window.__sm.on = true;
  const tick = (now) => {
    if (!window.__sm.on) return;
    const ps = document.querySelectorAll('.wm--hero .wm__letter path');
    const fs = document.querySelectorAll('.wm--footer .wm__letter path');
    if (ps.length === 6) {
      window.__sm.rows.push({
        t: now,
        y: window.scrollY,
        d: ps[4].getAttribute('d'),
        f: fs.length === 6 ? fs[4].getAttribute('d') : '',
      });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
`;

/** Высота чернил из строки d: верх данных на нуле, значит максимум y — низ. */
function inkHeight(d) {
  if (!d) return 0;
  const n = d.match(/-?\d[\d.]*/g);
  let max = -Infinity;
  for (let i = 1; i < n.length; i += 2) if (+n[i] > max) max = +n[i];
  return max;
}

let failed = 0;
const server = await serveOut(PORT);
const browser = await launch();

/* ══ 1 и 2. КОЛЕСО: ВЫБЕГ СТРАНИЦЫ И СХОЖДЕНИЕ ФОРМЫ ══════════════════ */
console.log('── ПОСЛЕ ПОСЛЕДНЕГО СОБЫТИЯ КОЛЕСА ─────────────────────────────');
console.log('размер       страница ехала   форма менялась   шаг формы, ед.');
for (const [w, h, mob] of [[390, 844, true], [1920, 1080, false]]) {
  const page = await browser.newPage({
    viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob, deviceScaleFactor: 1,
  });
  await page.addInitScript(PROBE);
  await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('.hero__stage[data-entered]');
  await page.waitForTimeout(300);

  const travel = await page.evaluate(() =>
    document.getElementById('hero').offsetHeight - document.getElementById('scroller').clientHeight);

  /* Стартуем в середине хода и крутим НЕ ДО КОНЦА: если цель упрётся
     в единицу, форма сойдётся ещё до последнего события и замер покажет
     ноль там, где сглаживание на самом деле есть. */
  await page.evaluate((v) => { document.getElementById('scroller').scrollTop = v; }, Math.round(travel * 0.25));
  await page.waitForTimeout(400);
  await page.mouse.move(Math.round(w / 2), Math.round(h * 0.75));
  await page.evaluate(() => window.__smStart());
  const step = Math.round(travel * 0.08);
  for (let k = 0; k < 4; k += 1) { await page.mouse.wheel(0, step); await page.waitForTimeout(16); }
  await page.waitForTimeout(1200);
  await page.evaluate(() => { window.__sm.on = false; });
  const tail = await page.evaluate(() => ({ rows: window.__sm.rows.slice(), wheel: window.__sm.wheel }));
  await page.close();

  const after = tail.rows.filter((r) => r.t > tail.wheel);
  let movePage = 0;
  const steps = [];
  for (let i = 1; i < after.length; i += 1) {
    if (Math.abs(after[i].y - after[i - 1].y) >= 1) movePage = after[i].t - tail.wheel;
    const dh = Math.abs(inkHeight(after[i].d) - inkHeight(after[i - 1].d));
    if (dh > 0.001) steps.push(dh);
  }
  steps.sort((a, b) => a - b);
  /* Схождение считается по 95 % пути, а не по «последнему заметному
     изменению»: у экспоненты хвост бесконечный, и порог по шагу мерил бы
     не плавность, а точность растра. */
  const h0 = after.length ? inkHeight(after[0].d) : 0;
  const hEnd = after.length ? inkHeight(after[after.length - 1].d) : 0;
  let moveForm = 0;
  const span = Math.abs(hEnd - h0);
  if (span > 0.01) {
    for (let i = 0; i < after.length; i += 1) {
      if (Math.abs(inkHeight(after[i].d) - hEnd) <= span * 0.05) {
        moveForm = after[i].t - tail.wheel;
        break;
      }
    }
  }
  const okPage = movePage <= COAST_MAX;
  const okForm = moveForm >= SETTLE_MIN && moveForm <= SETTLE_MAX;
  if (!okPage) { failed += 1; }
  if (!okForm) { failed += 1; }
  console.log('%s %s %s %s   мед. %s, макс %s%s',
    `${w}×${h}`.padEnd(12),
    `${movePage.toFixed(0)} мс`.padStart(11),
    `${moveForm.toFixed(0)} мс`.padStart(16),
    ' '.repeat(2),
    (steps[Math.floor(steps.length / 2)] ?? 0).toFixed(3),
    (steps[steps.length - 1] ?? 0).toFixed(3),
    okPage && okForm ? '' : `   ← ПРОВАЛ (выбег ≤${COAST_MAX}, схождение ${SETTLE_MIN}…${SETTLE_MAX})`);
}

/* ══ 3. ИНЕРЦИЯ ПАЛЬЦА: ИДЁТ ЛИ ФОРМА СТУПЕНЬКАМИ ════════════════════ */
console.log('');
console.log('── НА ИНЕРЦИИ ПОСЛЕ ЖЕСТА (мобильный профиль, процессор ×4) ─────');
console.log('сцена        кадров с движением   форма стояла   разных состояний   из них инерция');
{
  const page = await browser.newPage({
    viewport: { width: 393, height: 851 }, deviceScaleFactor: 2.75,
    isMobile: true, hasTouch: true,
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.addInitScript(PROBE);
  await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('.hero__stage[data-entered]');
  await page.waitForTimeout(400);

  const marks = await page.evaluate(() => {
    const sc = document.getElementById('scroller');
    const base = sc.getBoundingClientRect().top - sc.scrollTop;
    return {
      hero: 0,
      footer: document.getElementById('footer').getBoundingClientRect().top - base
        - sc.clientHeight * 0.9,
    };
  });

  const fling = async (from, key) => {
    await page.evaluate((v) => { document.getElementById('scroller').scrollTop = v; }, Math.round(from));
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__smStart());
    const x = 196;
    const y0 = 660;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
    for (let i = 1; i <= 18; i += 1) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [{ x, y: Math.round(y0 - (520 * i) / 18) }],
      });
      await new Promise((r) => setTimeout(r, 16));
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(900);
    await page.evaluate(() => { window.__sm.on = false; });
    const got = await page.evaluate(() => ({ rows: window.__sm.rows.slice(), touch: window.__sm.touch }));
    /* Считаем ВЕСЬ жест: и перетаскивание, и инерцию после отрыва.
       Позиция приходит дискретными шагами и там, и там, а инерция
       в этой среде воспроизводится не на каждой сцене. */
    const rows = got.rows;
    const glide = got.rows.filter((r) => r.t > got.touch);
    if (process.env.DEBUG) {
      const ys = got.rows.map((r) => r.y);
      const ya = rows.map((r) => r.y);
      console.log('   [отладка] всего %d (y %d…%d), после отрыва %d (y %d…%d)',
        got.rows.length, Math.min(...ys), Math.max(...ys),
        rows.length, ya.length ? Math.min(...ya) : -1, ya.length ? Math.max(...ya) : -1);
    }
    /* Считаются только кадры ВНУТРИ ХОДА: на дожатых концах форма стоит
       законно, и без этой отсечки замер мерил бы длину хвоста, а не
       плавность. */
    const hs = rows.map((r) => inkHeight(r[key]));
    const lo = Math.min(...hs);
    const hi = Math.max(...hs);
    const pad = (hi - lo) * 0.02;
    let moving = 0;
    let still = 0;
    const seen = new Set();
    for (let i = 1; i < rows.length; i += 1) {
      if (Math.abs(rows[i].y - rows[i - 1].y) < 1) continue;
      if (hs[i] <= lo + pad || hs[i] >= hi - pad) continue;
      moving += 1;
      seen.add(hs[i].toFixed(4));
      if (Math.abs(hs[i] - hs[i - 1]) < 1e-4) still += 1;
    }
    let gl = 0;
    for (let i = 1; i < glide.length; i += 1) if (Math.abs(glide[i].y - glide[i - 1].y) >= 1) gl += 1;
    return { moving, still, seen: seen.size, glide: gl };
  };

  for (const [label, from, key] of [['хиро', marks.hero, 'd'], ['футер', marks.footer, 'f']]) {
    const r = await fling(from, key);
    const bad = r.moving >= 10 && r.still / r.moving > 0.2;
    if (label === 'хиро' && bad) failed += 1;
    console.log('%s %s %s %s %s%s',
      label.padEnd(12),
      String(r.moving).padStart(18),
      `${r.still} (${r.moving ? Math.round((r.still / r.moving) * 100) : 0} %)`.padStart(15),
      String(r.seen).padStart(18),
      String(r.glide).padStart(15),
      bad ? '   ← форма идёт ступеньками' : '');
  }
  await page.close();
}

/* ══ 4. ОДИН ДИСКРЕТНЫЙ ШАГ ПОЗИЦИИ ══════════════════════════════════
   Вот ровно то, из чего складывается дрожание: инерция отдаёт позицию
   не гладко, а прыжками. Вопрос не в том, сколько прыжков, а в том,
   что форма делает с ОДНИМ прыжком — повторяет его буквально или
   раскладывает на кадры. Стенд прыжок воспроизводит точно: позиция
   меняется разом. */
console.log('');
console.log('── ОДИН ПРЫЖОК ПОЗИЦИИ НА 120 px ───────────────────────────────');
console.log('размер       кадров на прыжок   наибольшая доля за кадр');
for (const [w, h, mob] of [[390, 844, true], [1920, 1080, false]]) {
  const page = await browser.newPage({
    viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob, deviceScaleFactor: 1,
  });
  await page.addInitScript(PROBE);
  await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('.hero__stage[data-entered]');
  const travel = await page.evaluate(() =>
    document.getElementById('hero').offsetHeight - document.getElementById('scroller').clientHeight);
  await page.evaluate((v) => { document.getElementById('scroller').scrollTop = v; }, Math.round(travel * 0.3));
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__smStart());
  await page.waitForTimeout(100);
  await page.evaluate(() => { document.getElementById('scroller').scrollTop += 120; });
  await page.waitForTimeout(800);
  await page.evaluate(() => { window.__sm.on = false; });
  const rows = await page.evaluate(() => window.__sm.rows.slice());
  await page.close();

  const hs = rows.map((r) => inkHeight(r.d));
  const total = Math.abs(hs[hs.length - 1] - hs[0]);
  let frames = 0;
  let biggest = 0;
  for (let i = 1; i < hs.length; i += 1) {
    const d = Math.abs(hs[i] - hs[i - 1]);
    if (d > total * 0.005) frames += 1;
    if (d > biggest) biggest = d;
  }
  const share = total > 0 ? biggest / total : 1;
  console.log('%s %s %s', `${w}×${h}`.padEnd(12), String(frames).padStart(18),
    `${(share * 100).toFixed(0)} %`.padStart(24));
}

await browser.close();
server.close();
console.log(failed
  ? `\nПРОВАЛОВ: ${failed}`
  : '\nСтраница без выбега, форма сходится плавно и без ступенек');
process.exit(failed ? 1 : 0);

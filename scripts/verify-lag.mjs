/**
 * ОТСТАВАНИЕ МОРФА ОТ ПРОКРУТКИ — НА БЫСТРОМ ДВИЖЕНИИ, А НЕ НА ПЛАВНОМ.
 *
 * На плавной прокрутке отставание не видно: соседние кадры почти
 * одинаковы, и кадр задержки стоит долю единицы формы. Видно его ровно
 * тогда, когда рука дёргает страницу вверх-вниз: там соседние положения
 * расходятся на сотни пикселей, и форма, взятая от ПРОШЛОГО кадра,
 * читается как «слово подвисает и догоняет».
 *
 * Методика. Сначала снимается СТАТИЧЕСКАЯ таблица «положение → форма»:
 * страница ставится в 41 положение и на каждом ждёт успокоения. Это
 * эталон — какой обязана быть форма при данном y.
 *
 * Потом идёт быстрое движение настоящими событиями колеса, туда-обратно,
 * и каждый кадр записывает ПАРУ (y, форма). Для каждого кадра считается
 * два отклонения:
 *
 *     err0 = |форма кадра − эталон(y этого кадра)|
 *     err1 = |форма кадра − эталон(y прошлого кадра)|
 *
 * Если err1 заметно меньше err0 — форма отстала ровно на кадр. Именно
 * это и давал ScrollTrigger: он слушает scroll, но применяет обновление
 * СВОИМ тикером, то есть в rAF, а событие scroll браузер рассылает
 * в том же кадре ДО rAF-колбэков.
 *
 * Форма берётся из атрибута d, а не из габаритов на экране: вход букв
 * двигает литеры трансформом, и габариты скачут при стоящей форме.
 */
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';

const PORT = 4237;
const SIZES = [[390, 844, true], [1920, 1080, false]];
/* Порог значимости: ниже него расхождение неотличимо от квантования
   целочисленного window.scrollY и округления координат в d. */
const EPS = 0.05;

const PROBE = `
window.__lag = { rows: [], on: false, wheel: 0 };
addEventListener('wheel', () => { window.__lag.wheel = performance.now(); },
  { passive: true, capture: true });
window.__lagStart = () => {
  window.__lag.rows.length = 0;
  window.__lag.on = true;
  const tick = (now) => {
    if (!window.__lag.on) return;
    const ps = document.querySelectorAll('.wm--hero .wm__letter path');
    if (ps.length === 6) {
      window.__lag.rows.push({ t: now, y: window.scrollY, d: ps[4].getAttribute('d') });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
`;

/** Высота чернил из строки d: верх данных на нуле, значит максимум y — это низ. */
function inkHeight(d) {
  const n = d.match(/-?\d[\d.]*/g);
  let max = -Infinity;
  for (let i = 1; i < n.length; i += 2) if (+n[i] > max) max = +n[i];
  return max;
}

/** Эталон по таблице: линейная интерполяция между соседними узлами. */
function expected(table, y) {
  if (y <= table[0].y) return table[0].h;
  const last = table[table.length - 1];
  if (y >= last.y) return last.h;
  let i = 1;
  while (i < table.length && table[i].y < y) i += 1;
  const a = table[i - 1];
  const b = table[i];
  const k = b.y === a.y ? 0 : (y - a.y) / (b.y - a.y);
  return a.h + (b.h - a.h) * k;
}

let failed = 0;
const server = await serveOut(PORT);
const browser = await launch();

for (const [w, h, mob] of SIZES) {
  const page = await browser.newPage({
    viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob, deviceScaleFactor: 1,
  });
  await page.addInitScript(PROBE);
  await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('.hero__stage[data-entered]');
  await page.waitForTimeout(300);

  const travel = await page.evaluate(() => {
    const hero = document.getElementById('hero');
    return hero.offsetHeight - document.getElementById('scroller').clientHeight;
  });

  /* ── ЭТАЛОН ─────────────────────────────────────────────────────────── */
  const table = [];
  for (let i = 0; i <= 40; i += 1) {
    const y = Math.round((travel * i) / 40);
    await page.evaluate((v) => { document.getElementById('scroller').scrollTop = v; }, y);
    await page.waitForTimeout(60);
    const row = await page.evaluate(() => {
      const ps = document.querySelectorAll('.wm--hero .wm__letter path');
      return { y: window.scrollY, d: ps[4].getAttribute('d') };
    });
    table.push({ y: row.y, h: inkHeight(row.d) });
  }
  table.sort((a, b) => a.y - b.y);

  /* ── БЫСТРОЕ ДВИЖЕНИЕ ВВЕРХ-ВНИЗ ────────────────────────────────────── */
  await page.evaluate((v) => { document.getElementById('scroller').scrollTop = v; }, Math.round(travel / 2));
  await page.waitForTimeout(250);
  await page.mouse.move(Math.round(w / 2), Math.round(h * 0.75));
  await page.evaluate(() => window.__lagStart());
  const step = Math.round(travel / 4);
  for (let burst = 0; burst < 16; burst += 1) {
    const dir = burst % 2 === 0 ? 1 : -1;
    for (let k = 0; k < 4; k += 1) {
      await page.mouse.wheel(0, dir * step);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(32);
  }
  await page.waitForTimeout(200);
  await page.evaluate(() => { window.__lag.on = false; });
  const rows = await page.evaluate(() => window.__lag.rows.slice());

  /* ── ИНЕРЦИЯ ПОСЛЕ РУКИ ──────────────────────────────────────────────
     Сколько страница и слово ещё едут, когда колесо уже остановилось.
     Плавный скролл ДВИГАЕТ ПОЗИЦИЮ сам, по своей кривой, — значит после
     последнего события колеса форма продолжает меняться ещё полсекунды
     и больше. Это и есть «слово подвисает и догоняет». На нативной
     прокрутке движение кончается вместе с рукой. */
  await page.evaluate((v) => { document.getElementById('scroller').scrollTop = v; }, Math.round(travel / 3));
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__lagStart());
  for (let k = 0; k < 4; k += 1) { await page.mouse.wheel(0, 120); await page.waitForTimeout(16); }
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.__lag.on = false; });
  const tail = await page.evaluate(() => ({ rows: window.__lag.rows.slice(), wheel: window.__lag.wheel }));
  await page.close();

  const after = tail.rows.filter((r) => r.t > tail.wheel);
  let lastMove = 0;
  for (let i = 1; i < after.length; i += 1) {
    if (Math.abs(inkHeight(after[i].d) - inkHeight(after[i - 1].d)) > 0.001
        || Math.abs(after[i].y - after[i - 1].y) >= 1) lastMove = after[i].t - tail.wheel;
  }
  const movedAfter = after.length > 1
    ? Math.abs(after[after.length - 1].y - after[0].y) : 0;

  /* ── РАЗБОР ─────────────────────────────────────────────────────────── */
  let moving = 0;
  let lagged = 0;
  let worst = 0;
  let sum = 0;
  for (let i = 1; i < rows.length; i += 1) {
    const dy = rows[i].y - rows[i - 1].y;
    if (Math.abs(dy) < 1) continue;
    const got = inkHeight(rows[i].d);
    const e0 = Math.abs(got - expected(table, rows[i].y));
    const e1 = Math.abs(got - expected(table, rows[i - 1].y));
    moving += 1;
    sum += e0;
    if (e0 > worst) worst = e0;
    if (e1 + EPS < e0) lagged += 1;
  }
  const span = Math.abs(table[table.length - 1].h - table[0].h);
  console.log('\n%s×%s   ход %s px, размах формы %s ед.', w, h, travel, span.toFixed(1));
  console.log('  подвижных кадров %d, шаг прокрутки до %d px за кадр', moving, step);
  console.log('  кадров, где форма отстала на кадр: %d', lagged);
  console.log('  расхождение с эталоном: среднее %s ед., худшее %s ед. (%s %% размаха)',
    (sum / Math.max(1, moving)).toFixed(3), worst.toFixed(3), (worst / span * 100).toFixed(2));
  console.log('  после последнего колеса страница ехала ещё %s мс и %s px',
    lastMove.toFixed(0), movedAfter.toFixed(0));
  if (lagged > 0) { failed += 1; console.log('  ПРОВАЛ: морф отстаёт от прокрутки'); }
  if (moving < 20) { failed += 1; console.log('  ПРОВАЛ: движения почти не было, замер бессмысленный'); }
  if (lastMove > 120) { failed += 1; console.log('  ПРОВАЛ: движение продолжается после руки — прокрутку двигает не рука'); }
}

await browser.close();
server.close();
console.log(failed ? `\nПРОВАЛОВ: ${failed}` : '\nОтставания нет: форма каждого кадра отвечает положению ЭТОГО кадра');
process.exit(failed ? 1 : 0);

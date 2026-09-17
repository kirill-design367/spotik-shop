/**
 * ФУТЕР: ПОРЯДОК ХОДА И МЁРТВЫЙ СКРОЛЛ — ПОКАДРОВО.
 *
 * Слово в футере обязано вести себя так:
 *   1) зелёная секция выезжает снизу обычным скроллом, слово едет с ней;
 *   2) низ чернил доходит до своей линии и ПРИБИВАЕТСЯ;
 *   3) с этого же кадра, без паузы, скролл растягивает слово вверх;
 *   4) слово раскрылось — растяжение кончилось;
 *   5) ниже идёт мелкий текст.
 *
 * Между 2 и 3 не должно быть НИ ОДНОГО кадра, где страница едет, а форма
 * стоит. Здесь это меряется покадрово: каждый кадр пишутся позиция скролла,
 * высота чернил (из атрибута d) и положение чернил на экране.
 *
 * Скролл гонится НАСТОЯЩИМИ событиями колеса: window.scrollTo обошёл бы
 * и Lenis, и обработку ввода, и замер получился бы про другое.
 */
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';

const PORT = 4197;
const SIZES = [
  { w: 390, h: 844, mobile: true },
  { w: 1920, h: 1080, mobile: false },
  { w: 2560, h: 1440, mobile: false },
];

/*
 * Цикл записи заводится НЕ при инициализации, а в момент начала замера.
 * Причина в порядке обработчиков кадра: rAF выполняются в порядке заказа,
 * а вордмарк рисуется из тикера GSAP, который заводится при монтировании.
 * Пробник, заказанный раньше тикера, читал бы DOM ДО отрисовки и отставал
 * ровно на кадр — и этот артефакт замера читался бы как пауза в приёме.
 */
const PROBE = `
window.__ff = { rows: [], on: false };
window.__ffStart = () => {
  window.__ff.rows.length = 0;
  window.__ff.on = true;
  const tick = () => {
    if (window.__ff.on) {
      const ps = [...document.querySelectorAll('.wm--footer .wm__letter path')];
      if (ps.length === 6) {
        const r = ps.map((p) => p.getBoundingClientRect());
        const st = document.querySelector('.footer__stage').getBoundingClientRect();
        window.__ff.rows.push({
          y: window.scrollY,
          d: ps.map((p) => p.getAttribute('d')).join(''),
          top: Math.min(...r.map((b) => b.top)),
          bottom: Math.max(...r.map((b) => b.bottom)),
          stage: st.top,
        });
      }
      requestAnimationFrame(tick);
    }
  };
  requestAnimationFrame(tick);
};
`;

/** Высота чернил из строки d. Верх данных всегда на нуле, значит это низ. */
function inkHeight(d) {
  const n = d.match(/-?\d[\d.]*/g);
  let max = -Infinity;
  for (let i = 1; i < n.length; i += 2) if (+n[i] > max) max = +n[i];
  return max;
}

const server = await serveOut(PORT);
const browser = await launch();
let failed = 0;
const out = [];

for (const dev of SIZES) {
  const page = await browser.newPage({
    viewport: { width: dev.w, height: dev.h },
    isMobile: dev.mobile, hasTouch: dev.mobile, deviceScaleFactor: 1,
  });
  await page.addInitScript(PROBE);
  await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('.hero__stage[data-entered]');

  // встать на 1.6 экрана ДО верха футера: ловим и подход, и весь ход
  const start = await page.evaluate(() => {
    const f = document.getElementById('footer');
    const top = f.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, Math.max(0, Math.round(top - window.innerHeight * 1.6)));
    return top;
  });
  await page.waitForTimeout(500);

  await page.evaluate(() => window.__ffStart());
  // прокрутить 2.8 экрана настоящим колесом, медленно — чтобы кадров хватило
  const total = Math.round(dev.h * 2.8);
  const steps = 56;
  for (let i = 0; i < steps; i += 1) {
    await page.mouse.wheel(0, total / steps);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.__ff.on = false; });

  const rows = await page.evaluate(() => window.__ff.rows);
  await page.close();

  const H = rows.map((r) => ({ ...r, h: inkHeight(r.d) }));
  const hOpen = Math.max(...H.map((r) => r.h));
  const hTight = Math.min(...H.map((r) => r.h));

  /* Фазы определяются ФОРМОЙ, а не положением: так метрика одинаково
     читается и для «слово растёт вниз», и для «растёт вверх».
       подход   — форма ещё сжата, секция просто едет (шаг 1 задания);
       РОСТ     — форма меняется, от первого изменения до полного раскрытия;
       выдержка — форма раскрыта, скролл ещё идёт.                       */
  const dead = { подход: 0, рост: 0, выдержка: 0 };
  const moved = { подход: 0, рост: 0, выдержка: 0 };
  const firstGrow = H.findIndex((r) => r.h > hTight + 1e-9);
  const fullOpen = H.findIndex((r) => r.h > hOpen - 1e-9);
  for (let i = 1; i < H.length; i += 1) {
    const dy = Math.abs(H[i].y - H[i - 1].y);
    const dh = Math.abs(H[i].h - H[i - 1].h);
    const phase = i < firstGrow ? 'подход' : i > fullOpen ? 'выдержка' : 'рост';
    if (dy > 0) { moved[phase] += 1; if (dh < 1e-9) dead[phase] += 1; }
  }

  /* Низ чернил меряется там, где сцена ПРИЛИПЛА: до этого вся секция едет
     вместе со страницей, и двигается не кромка, а страница. */
  // Прилипшая сцена — это top ровно 0; всё, что больше, ещё едет со страницей
  const stuck = H.filter((r) => r.stage <= 0.01);
  const bs = stuck.map((r) => r.bottom);
  const spread = bs.length ? Math.max(...bs) - Math.min(...bs) : NaN;
  const line = bs.length ? bs[0] : NaN;

  /* Зазор между прибиванием низа и началом роста — главное число пункта 2.
     Кадры, где низ уже стоит на своей линии, а форма ещё не двинулась. */
  let gap = 0;
  for (let i = 1; i < H.length; i += 1) {
    if (i >= firstGrow) break;
    if (Math.abs(H[i].bottom - line) < 0.75 && H[i].y !== H[i - 1].y) gap += 1;
  }

  /* Сколько на подходе кадров, где слово УЖЕ ЦЕЛИКОМ на экране, но ещё
     не растягивается. Это шаг 1 задания (секция выезжает), но именно эти
     кадры глаз и читает как «слово встало и стоит», поэтому число нужно
     знать и держать маленьким. */
  let visibleIdle = 0;
  for (let i = 1; i < firstGrow; i += 1)
    if (H[i].bottom <= dev.h && H[i].y !== H[i - 1].y) visibleIdle += 1;

  out.push({ dev, rows: H.length, hOpen, hTight, line, dead, moved, spread,
    stuck: stuck.length, gap, visibleIdle });
  // 0.02 px — это ОДНА единица раскладки Chrome (1/64 px). Ниже неё
  // getBoundingClientRect ничего сказать не может: там пол измерения,
  // а не движение кромки. Целочисленную проверку делает растр
  // в verify-footer.mjs.
  if (spread > 0.02) { failed += 1; console.log(`  ПРОВАЛ: ${dev.w}: низ чернил гуляет на ${spread.toFixed(2)} px на прилипшей сцене`); }
  if (dead['рост'] > 0) { failed += 1; console.log(`  ПРОВАЛ: ${dev.w}: ${dead['рост']} мёртвых кадров ВНУТРИ роста`); }
  if (gap > 0) { failed += 1; console.log(`  ПРОВАЛ: ${dev.w}: ${gap} кадров между прибиванием низа и началом роста`); }
}

console.log('── НИЗ ЧЕРНИЛ НА ПРИЛИПШЕЙ СЦЕНЕ ───────────────────────────────');
console.log('размер        линия низа   разброс   кадров');
for (const r of out)
  console.log('  %s %s px %s px %s',
    String(r.dev.w + '×' + r.dev.h).padEnd(11),
    r.line.toFixed(1).padStart(9), r.spread.toFixed(2).padStart(8),
    String(r.stuck).padStart(7));

console.log('');
console.log('── МЁРТВЫЕ КАДРЫ: СКРОЛЛ ЕДЕТ, ВЫСОТА ЧЕРНИЛ СТОИТ ──────────────');
console.log('размер       подход (секция едет)   РОСТ (2→4)      выдержка (после)');
for (const r of out)
  console.log('  %s %s %s %s',
    String(r.dev.w + '×' + r.dev.h).padEnd(11),
    `${r.dead['подход']} из ${r.moved['подход']}`.padStart(20),
    `${r.dead['рост']} из ${r.moved['рост']}`.padStart(15),
    `${r.dead['выдержка']} из ${r.moved['выдержка']}`.padStart(18));
console.log('«подход» — шаг 1 задания: секция выезжает, слово едет с ней и не растягивается.');
console.log('«РОСТ» — от первого изменения формы до полного раскрытия: тут ноль обязателен.');
console.log('');
console.log('── ПАУЗА МЕЖДУ ШАГАМИ 2 И 3 ────────────────────────────────────');
console.log('кадров, где низ уже на своей линии, а форма ещё стоит:');
for (const r of out)
  console.log('  %s %s', String(r.dev.w + '×' + r.dev.h).padEnd(11), r.gap);
console.log('');
console.log('── НА ПОДХОДЕ: СЛОВО ЦЕЛИКОМ ВИДНО, НО ЕЩЁ НЕ РАСТЁТ ───────────');
console.log('это шаг 1 задания, но именно эти кадры читаются как «стоит»:');
for (const r of out)
  console.log('  %s %s кадров из %s на подходе',
    String(r.dev.w + '×' + r.dev.h).padEnd(11),
    String(r.visibleIdle).padStart(3), r.moved['подход']);

await browser.close();
server.close();
console.log('');
console.log(failed ? `ПРОВАЛОВ: ${failed}` : 'ХОД ФУТЕРА: ПРОВЕРКИ ПРОЙДЕНЫ');
process.exit(failed ? 1 : 0);

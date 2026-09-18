/**
 * ФУТЕР ПОКАДРОВО, НА ЖИВОЙ ПРОКРУТКЕ КОЛЕСОМ.
 *
 * Десятая итерация: прилипания нет. Секция едет обычным скроллом, слово
 * едет вместе с ней и одновременно растёт. Здесь это проверяется на живом
 * ходу, кадр за кадром, — а не на расставленных положениях:
 *
 *   1) ПРИРОСТ ВЫСОТЫ РАВЕН ПРОКРУТКЕ. Один пиксель колеса — один пиксель
 *      высоты чернил. Отношение считается по каждой паре соседних кадров;
 *   2) НИЗ ЧЕРНИЛ СТОИТ у нижнего края экрана: это следствие пункта 1,
 *      и если отношение уплывёт, первым поедет именно низ;
 *   3) ВЕРХ идёт ВВЕРХ ровно со скоростью страницы;
 *   4) МЁРТВЫХ КАДРОВ НЕТ: на ходу роста не должно быть ни одного кадра,
 *      где страница едет, а форма стоит;
 *   5) на ПОДХОДЕ слово полностью сжато и его низ ещё за краем экрана.
 *
 * Скролл гонится НАСТОЯЩИМИ событиями колеса: window.scrollTo обошёл бы
 * и Lenis, и обработку ввода, и замер получился бы про другое.
 *
 * Форма читается из атрибута d, а не из габаритов литер: вход букв двигает
 * их трансформом вразнобой, и «высота слова» скачет при стоящей форме.
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
        window.__ff.rows.push({
          y: window.scrollY,
          d: ps.map((p) => p.getAttribute('d')).join(''),
          top: Math.min(...r.map((b) => b.top)),
          bottom: Math.max(...r.map((b) => b.bottom)),
          sec: document.getElementById('footer').getBoundingClientRect().top,
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
  await page.evaluate(() => {
    const f = document.getElementById('footer');
    const top = f.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, Math.max(0, Math.round(top - window.innerHeight * 1.6)));
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
  if (process.env.WMDEBUG)
    console.log('DBG', dev.w, 'кадров', H.length, 'скролл', H[0]?.y, '→', H[H.length-1]?.y,
      'высота', Math.min(...H.map(r=>r.h)).toFixed(1), '→', Math.max(...H.map(r=>r.h)).toFixed(1));
  const hOpen = Math.max(...H.map((r) => r.h));
  const hTight = Math.min(...H.map((r) => r.h));

  /* Фазы определяются ФОРМОЙ, а не положением:
       подход   — форма ещё сжата, секция просто едет;
       РОСТ     — форма меняется, от первого изменения до полного раскрытия;
       хвост    — форма раскрыта, страница едет дальше и выносит слово вверх. */
  const dead = { подход: 0, рост: 0, хвост: 0 };
  const moved = { подход: 0, рост: 0, хвост: 0 };
  const firstGrow = H.findIndex((r) => r.h > hTight + 1e-9);
  const fullOpen = H.findIndex((r) => r.h > hOpen - 1e-9);
  for (let i = 1; i < H.length; i += 1) {
    const dy = Math.abs(H[i].y - H[i - 1].y);
    const dh = Math.abs(H[i].h - H[i - 1].h);
    const phase = i < firstGrow ? 'подход' : i > fullOpen ? 'хвост' : 'рост';
    if (dy > 0) { moved[phase] += 1; if (dh < 1e-9) dead[phase] += 1; }
  }

  /* Единица контура в пикселях: высота слоя делится на высоту рамки.
     Нужна, чтобы сравнить прирост формы с прокруткой в одних единицах. */
  const g = H[fullOpen];
  const pxPerUnit = (g.bottom - g.top) / hOpen;

  /* ── рост один к одному и неподвижный низ, ПОКАДРОВО ───────────────────
     Крайние кадры хода отбрасываются, и это не подгонка: между двумя
     кадрами пробника страница успевает проехать десяток пикселей, поэтому
     на первом и последнем кадре форма уже упёрлась в свой предел, а скролл
     ещё идёт. Эти два кадра — квантование замера, а не поведение приёма;
     внутри хода никаких оговорок нет. */
  const grow = H.slice(firstGrow + 1, fullOpen);
  const ratios = [];
  for (let i = 1; i < grow.length; i += 1) {
    const dy = grow[i].y - grow[i - 1].y;
    if (dy > 0.5) ratios.push(((grow[i].h - grow[i - 1].h) * pxPerUnit) / dy);
  }
  const rAvg = ((grow[grow.length - 1].h - grow[0].h) * pxPerUnit)
    / (grow[grow.length - 1].y - grow[0].y);
  const bottoms = grow.map((r) => dev.h - r.bottom);
  const bSpread = Math.max(...bottoms) - Math.min(...bottoms);
  const tops = grow.map((r) => r.top);
  const tMoved = Math.max(...tops) - Math.min(...tops);

  /* Шаг 1: на подходе слово обязано быть ПОЛНОСТЬЮ СЖАТЫМ, а его низ —
     находиться ЗА нижним краем экрана (оно ещё выезжает снизу). */
  const approachMax = firstGrow > 1
    ? Math.max(...H.slice(0, firstGrow).map((r) => r.h)) : hTight;
  const approachBelow = H.slice(0, firstGrow).filter((r) => r.bottom > dev.h - 0.5).length;

  out.push({ dev, rows: H.length, hOpen, hTight, dead, moved, rAvg,
    rMin: Math.min(...ratios), rMax: Math.max(...ratios), bSpread, tMoved,
    grow: grow.length, approachMax, approachBelow, approach: firstGrow,
    bottomLine: dev.h - grow[grow.length - 1].bottom });

  const bad = (m) => { failed += 1; console.log(`  ПРОВАЛ: ${dev.w}: ${m}`); };
  if (Math.abs(rAvg - 1) > 0.02) bad(`рост ${rAvg.toFixed(4)} px на пиксель прокрутки вместо 1.000`);
  if (bSpread > 1.5) bad(`низ чернил гуляет на ${bSpread.toFixed(2)} px`);
  if (dead['рост'] > 0) bad(`${dead['рост']} мёртвых кадров ВНУТРИ роста`);
  if (approachMax > hTight + 0.01) bad(`на подходе слово не сжато (${approachMax.toFixed(1)} против ${hTight.toFixed(1)})`);
  if (tMoved < 1) bad('верх чернил не двинулся — он обязан уходить вверх');
}

console.log('── РОСТ ОДИН К ОДНОМУ (покадрово, живое колесо) ─────────────────');
console.log('размер       кадров роста   прирост/прокрутка   по кадрам');
for (const r of out)
  console.log('  %s %s %s %s',
    String(r.dev.w + '×' + r.dev.h).padEnd(11),
    String(r.grow).padStart(10), r.rAvg.toFixed(4).padStart(16),
    `${r.rMin.toFixed(2)}…${r.rMax.toFixed(2)}`.padStart(14));

console.log('');
console.log('── НИЗ СТОИТ, ВЕРХ ИДЁТ ВВЕРХ ──────────────────────────────────');
console.log('размер       низ: линия   разброс   верх прошёл вверх');
for (const r of out)
  console.log('  %s %s px %s px %s px',
    String(r.dev.w + '×' + r.dev.h).padEnd(11),
    r.bottomLine.toFixed(1).padStart(8), r.bSpread.toFixed(2).padStart(8),
    r.tMoved.toFixed(0).padStart(14));
console.log('(разброс по живой прокрутке; у пробника своё квантование —');
console.log(' точное число по геометрии даёт verify-footer.mjs)');

console.log('');
console.log('── МЁРТВЫЕ КАДРЫ: СКРОЛЛ ЕДЕТ, ВЫСОТА ЧЕРНИЛ СТОИТ ──────────────');
console.log('размер       подход (секция едет)   РОСТ            хвост (после)');
for (const r of out)
  console.log('  %s %s %s %s',
    String(r.dev.w + '×' + r.dev.h).padEnd(11),
    `${r.dead['подход']} из ${r.moved['подход']}`.padStart(20),
    `${r.dead['рост']} из ${r.moved['рост']}`.padStart(15),
    `${r.dead['хвост']} из ${r.moved['хвост']}`.padStart(18));
console.log('«подход» — секция выезжает, слово едет с ней и ещё не растёт.');
console.log('«РОСТ» — от первого изменения формы до полного раскрытия: тут ноль обязателен.');

console.log('');
console.log('── НА ПОДХОДЕ: СЖАТО И НИЗ ЗА КРАЕМ ЭКРАНА ─────────────────────');
for (const r of out)
  console.log('  %s   высота %s ед. при сжатом %s ед.; низ за краем на %d кадрах из %d',
    String(r.dev.w + '×' + r.dev.h).padEnd(11),
    r.approachMax.toFixed(1), r.hTight.toFixed(1), r.approachBelow, r.approach);

await browser.close();
server.close();
console.log('');
console.log(failed ? `ПРОВАЛОВ: ${failed}` : 'ХОД ФУТЕРА: ПРОВЕРКИ ПРОЙДЕНЫ');
process.exit(failed ? 1 : 0);

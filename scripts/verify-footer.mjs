/**
 * ПРОВЕРКА ФУТЕРА — ПО РАСТРУ И ГЕОМЕТРИИ ЖИВОЙ СТРАНИЦЫ.
 *
 * Десятая итерация переписала механику целиком: ПРИЛИПАНИЯ НЕТ. Секция
 * едет обычным скроллом, слово едет вместе с ней и одновременно растёт.
 * Отсюда четыре вещи, которые надо держать, и все меряются тем, что
 * реально нарисовано, а не тем, что написано в коде.
 *
 * 1. РОСТ ОДИН К ОДНОМУ. Прирост высоты чернил в пикселях равен пройденной
 *    прокрутке в пикселях. Это не украшение: именно из равенства скоростей
 *    следует неподвижный низ.
 *
 * 2. НИЗ ЧЕРНИЛ СТОИТ у нижнего края экрана на всём ходу роста. Верх при
 *    этом уходит вверх вместе со страницей — и обязан уходить.
 *
 * 3. СРЕЗ ВЕРХУШЕК делает верхний край СЕКЦИИ, и он постоянен: слой поднят
 *    над краем ровно на величину среза и едет вместе с ним.
 *
 * 4. ПОД СЛОВОМ НИЧЕГО НЕТ. Полоса от кромки чернил до низа экрана — это
 *    воздух FOOTER_BOTTOM_GAP и только он: ни текста, ни пустого поля.
 *    Реквизиты лежат НИЖЕ края экрана и выезжают после конца роста.
 *
 * Плюс сторожа планки: высота слова совпадает с хиро на одиннадцати
 * ширинах, нет горизонтального скролла, ничего не вылезает за нижний край.
 */
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';

/* Величины живут в одном месте — lib/wordmark.ts. Скрипт на чистом node
   и .ts не читает, поэтому числа вынимаются из исходника, а не дублируются
   здесь: расходиться нечему. */
const SRC = readFileSync('lib/wordmark.ts', 'utf8');
const DATA = readFileSync('lib/wordmark.data.ts', 'utf8');
const num = (re, src) => Number(re.exec(src)[1]);
const FOOTER_CUT_RATIO = num(/FOOTER_CUT_RATIO = ([\d.]+)/, SRC);
const GAP = num(/FOOTER_BOTTOM_GAP = ([\d.]+)/, SRC);
const WM_BOX_HEIGHT = num(/WM_BOX_HEIGHT = ([\d.]+)/, DATA);
const WM_BOTTOM_TIGHT = num(/WM_BOTTOM_TIGHT = ([\d.]+)/, DATA);
const WM_CAP_OPEN = num(/WM_CAP_OPEN = ([\d.]+)/, DATA);
const INK_TIGHT = WM_BOTTOM_TIGHT / WM_BOX_HEIGHT;

const PORT = 4187;
const SIZES = [
  { w: 390, h: 844, mobile: true },
  { w: 1920, h: 1080, mobile: false },
  { w: 2560, h: 1440, mobile: false },
];

let failed = 0;
const fail = (m) => { failed += 1; console.log(`  ПРОВАЛ: ${m}`); };

const GREEN = (d, k) => d[k] > 20 && d[k] < 60 && d[k + 1] > 160 && d[k + 1] < 200 && d[k + 2] > 65 && d[k + 2] < 105;
const INK = (d, k) => d[k] < 40 && d[k + 1] < 40 && d[k + 2] < 40;

/** Первая строка сверху, где на зелёном уже есть чернила: это линия среза. */
function inkOnGreenRow(png) {
  for (let y = 0; y < png.height; y += 1) {
    let g = 0, i = 0;
    for (let x = 0; x < png.width; x += 1) {
      const k = (png.width * y + x) * 4;
      if (GREEN(png.data, k)) g += 1;
      else if (INK(png.data, k)) i += 1;
      if (g > 2 && i > 2) return y;
    }
  }
  return -1;
}

/** Первая строка, где вообще появилось зелёное поле. */
function greenTop(png) {
  for (let y = 0; y < png.height; y += 1) {
    let g = 0;
    for (let x = 0; x < png.width; x += 1) {
      if (GREEN(png.data, (png.width * y + x) * 4)) { g += 1; if (g > 8) return y; }
    }
  }
  return -1;
}

/** Сколько пикселей в полосе НЕ зелёные: полоса под словом обязана быть чистой. */
function foreignInBand(png, y0, y1) {
  let n = 0;
  for (let y = Math.max(0, y0); y < Math.min(png.height, y1); y += 1)
    for (let x = 0; x < png.width; x += 1)
      if (!GREEN(png.data, (png.width * y + x) * 4)) n += 1;
  return n;
}

const server = await serveOut(PORT);
const browser = await launch();
const report = [];

for (const dev of SIZES) {
  const page = await browser.newPage({
    viewport: { width: dev.w, height: dev.h },
    isMobile: dev.mobile, hasTouch: dev.mobile, deviceScaleFactor: 1,
  });
  await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('.hero__stage[data-entered]');

  /* Эталон высоты берётся из ХИРО, на той же странице и в том же прогоне:
     сравнивать надо с живым состоянием, а не с записанным числом. */
  const heroInk = await page.evaluate(() => {
    const r = [...document.querySelectorAll('.wm--hero .wm__letter path')]
      .map((el) => el.getBoundingClientRect());
    return Math.max(...r.map((b) => b.bottom)) - Math.min(...r.map((b) => b.top));
  });

  const g = await page.evaluate(() => {
    const l = document.querySelector('.wm--footer').getBoundingClientRect();
    return {
      layerBottomDoc: l.bottom + window.scrollY,
      layerH: l.height,
      vh: window.innerHeight,
      doc: document.documentElement.scrollHeight,
    };
  });
  /* Ход роста ВЫВОДИТСЯ, а не задаётся: это разница раскрытой и сжатой
     высоты чернил. Конец хода — там, где низ слоя пришёл на линию низа. */
  const travel = Math.round(g.layerH * (1 - INK_TIGHT));
  const end = Math.round(g.layerBottomDoc - g.vh + GAP);
  const start = end - travel;

  const stops = [];
  stops.push(start - Math.round(travel * 0.6));      // подход: слово ещё сжато
  for (let i = 0; i <= 12; i += 1) stops.push(start + (travel * i) / 12);
  stops.push(Math.min(g.doc - g.vh, end + Math.round(travel * 0.6))); // хвост

  const rows = [];
  for (const y of stops) {
    await page.evaluate((v) => window.scrollTo(0, v), Math.round(y));
    await page.waitForTimeout(200);
    const png = PNG.sync.read(await page.screenshot());
    const m = await page.evaluate(() => {
      const r = [...document.querySelectorAll('.wm--footer .wm__letter path')]
        .map((p) => p.getBoundingClientRect());
      const body = document.querySelector('.footer__body').getBoundingClientRect();
      const sec = document.getElementById('footer').getBoundingClientRect();
      return {
        inkTop: Math.min(...r.map((b) => b.top)),
        inkBottom: Math.max(...r.map((b) => b.bottom)),
        letterTops: r.map((b) => b.top),
        secTop: sec.top,
        bodyTop: body.top,
        textTop: document.querySelector('.footer__col').getBoundingClientRect().top,
        layerH: document.querySelector('.wm--footer').getBoundingClientRect().height,
        scrollY: Math.round(window.scrollY),
        hscroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        below: Math.round(document.documentElement.scrollHeight - (window.scrollY + window.innerHeight)),
      };
    });
    rows.push({ ...m, ink: m.inkBottom - m.inkTop, png, rasterCut: inkOnGreenRow(png), rasterGreen: greenTop(png) });
  }

  const inGrowth = rows.filter((r) => r.scrollY >= start - 1 && r.scrollY <= end + 1);

  // ── 1. рост один к одному ─────────────────────────────────────────────
  const ratios = [];
  for (let i = 1; i < inGrowth.length; i += 1) {
    const ds = inGrowth[i].scrollY - inGrowth[i - 1].scrollY;
    const dh = inGrowth[i].ink - inGrowth[i - 1].ink;
    if (ds > 0) ratios.push(dh / ds);
  }
  const rMin = Math.min(...ratios);
  const rMax = Math.max(...ratios);
  const rAvg = (inGrowth[inGrowth.length - 1].ink - inGrowth[0].ink)
    / (inGrowth[inGrowth.length - 1].scrollY - inGrowth[0].scrollY);

  // ── 2. низ чернил неподвижен относительно нижнего края экрана ─────────
  const bottoms = inGrowth.map((r) => dev.h - r.inkBottom);
  const bSpread = Math.max(...bottoms) - Math.min(...bottoms);
  const tops = inGrowth.map((r) => r.inkTop);
  const tMoved = Math.max(...tops) - Math.min(...tops);

  // ── 3. срез ────────────────────────────────────────────────────────────
  const cutsFrames = inGrowth.map((r) => r.secTop - r.inkTop);
  const cutSpread = Math.max(...cutsFrames) - Math.min(...cutsFrames);
  /* Доли считаются на РАСКРЫТОМ кадре: срез постоянен в пикселях, а высота
     прописной по ходу растёт, поэтому в долях прописной он совпадает
     с заданным только там, где слово раскрыто. */
  const open = inGrowth[inGrowth.length - 1];
  const capPx = (open.layerH * WM_CAP_OPEN) / WM_BOX_HEIGHT;
  const cuts = open.letterTops.map((t) => (open.secTop - t) / capPx);
  const cutMin = Math.min(...cuts);

  // ── 4. под словом ничего нет ──────────────────────────────────────────
  let dirty = 0;
  let shown = 0;
  let bandMax = 0;
  for (const r of inGrowth) {
    bandMax = Math.max(bandMax, dev.h - r.inkBottom);
    if (r.textTop < dev.h - 0.5) shown += 1;
    dirty += foreignInBand(r.png, Math.ceil(r.inkBottom) + 2, dev.h - 1);
  }

  const hs = Math.max(...rows.map((r) => r.hscroll));
  /* «за нижним краем» имеет смысл только в самом низу документа — это
     меряется ниже, на прокрутке до конца страницы. */
  const below = 0;

  if (Math.abs(rAvg - 1) > 0.01) fail(`${dev.w}: рост ${rAvg.toFixed(4)} px на пиксель прокрутки вместо 1.000`);
  if (rMin < 0.97 || rMax > 1.03) fail(`${dev.w}: отношение гуляет ${rMin.toFixed(3)}…${rMax.toFixed(3)}`);
  if (bSpread > 0.6) fail(`${dev.w}: низ чернил гуляет на ${bSpread.toFixed(2)} px`);
  if (tMoved < travel * 0.9) fail(`${dev.w}: верх чернил прошёл ${tMoved.toFixed(0)} px вместо ${travel}`);
  if (cutSpread > 0.6) fail(`${dev.w}: срез гуляет по кадрам на ${cutSpread.toFixed(2)} px`);
  if (cutMin <= 0) fail(`${dev.w}: не срезана хотя бы одна литера (минимум ${cutMin.toFixed(4)})`);
  if (shown) fail(`${dev.w}: реквизиты видны на ${shown} положениях до конца роста`);
  if (dirty !== 0) fail(`${dev.w}: под словом ${dirty} не-зелёных пикселей`);
  if (hs !== 0) fail(`${dev.w}: горизонтальный скролл ${hs} px`);
  if (below !== 0) fail(`${dev.w}: за нижним краем экрана осталось ${below} px документа`);

  report.push({ dev, rows, inGrowth, travel, start, end, rMin, rMax, rAvg,
    bSpread, tMoved, cuts, cutMin, cutSpread, capPx, bandMax, dirty, shown,
    heroInk, footerInk: Math.max(...rows.map((r) => r.ink)), hs, below });
  await page.close();
}

/* ── печать ──────────────────────────────────────────────────────────────── */
const LETTERS = ['S', 'P', 'O', 'T', 'I', 'K'];
console.log('── ХОД РОСТА: ВЕРХ, НИЗ, ВЫСОТА ────────────────────────────────');
for (const r of report) {
  console.log('\n%s   ход роста %d px (= раскрытая минус сжатая высота)',
    r.dev.w + '×' + r.dev.h, r.travel);
  console.log('   скролл    верх чернил   низ чернил   высота   Δскролл  Δвысота');
  let prev = null;
  for (const q of r.inGrowth) {
    const ds = prev ? q.scrollY - prev.scrollY : 0;
    const dh = prev ? q.ink - prev.ink : 0;
    console.log('  %s %s %s %s %s %s',
      String(q.scrollY).padStart(8), q.inkTop.toFixed(1).padStart(12),
      q.inkBottom.toFixed(1).padStart(12), q.ink.toFixed(1).padStart(8),
      (prev ? String(ds) : '—').padStart(8), (prev ? dh.toFixed(1) : '—').padStart(8));
    prev = q;
  }
  console.log('  прирост высоты на пиксель прокрутки: %s (по кадрам %s…%s)',
    r.rAvg.toFixed(4), r.rMin.toFixed(3), r.rMax.toFixed(3));
}

console.log('');
console.log('── НИЗ ЧЕРНИЛ ОТНОСИТЕЛЬНО НИЖНЕГО КРАЯ ЭКРАНА ─────────────────');
console.log('размер       воздух под словом   РАЗБРОС   верх прошёл вверх');
for (const r of report) {
  console.log('  %s %s px %s px %s px',
    String(r.dev.w + '×' + r.dev.h).padEnd(11),
    r.bandMax.toFixed(1).padStart(14),
    r.bSpread.toFixed(2).padStart(8),
    r.tMoved.toFixed(0).padStart(14));
}

console.log('');
console.log('── СРЕЗ ВЕРХУШЕК ЛИТЕР ─────────────────────────────────────────');
console.log('задано %s %% высоты прописной, отсчёт от ЛИНИИ ПРОПИСНЫХ',
  (FOOTER_CUT_RATIO * 100).toFixed(2));
console.log('размер      прописная   ' + LETTERS.map((l) => l.padStart(5)).join(' ') + '   разброс по кадрам');
for (const r of report) {
  console.log('  %s %s px  %s %s px',
    String(r.dev.w + '×' + r.dev.h).padEnd(11), r.capPx.toFixed(1).padStart(7),
    r.cuts.map((c) => (c * 100).toFixed(2).padStart(5)).join(' '),
    r.cutSpread.toFixed(2).padStart(6));
}
console.log('(в процентах высоты прописной; у круглых S и O больше ровно');
console.log(' на овершут рисунка — 1.93 %, это и есть прямой срез)');

console.log('');
console.log('── ПОД СЛОВОМ НА ХОДУ РОСТА ────────────────────────────────────');
for (const r of report) {
  console.log('  %s   полоса до низа экрана %s px, чужих пикселей %d, реквизиты видны на %d положениях',
    String(r.dev.w + '×' + r.dev.h).padEnd(11), r.bandMax.toFixed(1), r.dirty, r.shown);
}

/* ── ВМЕЩАЕМОСТЬ: слово и реквизиты, одиннадцать ширин ─────────────────── */
const FIT = [[320, 568], [360, 640], [390, 844], [414, 896], [768, 1024],
  [1024, 768], [1280, 800], [1440, 900], [1920, 1080], [2560, 1440], [3440, 1440]];
const fit = [];
for (const [w, h] of FIT) {
  const page = await browser.newPage({
    viewport: { width: w, height: h }, isMobile: w < 700, hasTouch: w < 700,
    deviceScaleFactor: 1,
  });
  await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('.hero__stage[data-entered]');
  const hero = await page.evaluate(() => {
    const r = [...document.querySelectorAll('.wm--hero .wm__letter path')]
      .map((el) => el.getBoundingClientRect());
    return Math.max(...r.map((b) => b.bottom)) - Math.min(...r.map((b) => b.top));
  });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(500);
  const m = await page.evaluate(() => {
    const b = document.querySelector('.footer__body').getBoundingClientRect();
    const sec = document.getElementById('footer').getBoundingClientRect();
    const r = [...document.querySelectorAll('.wm--footer .wm__letter path')]
      .map((p) => p.getBoundingClientRect());
    let side = 0;
    document.querySelectorAll('.footer__body *').forEach((el) => {
      side = Math.max(side, el.getBoundingClientRect().right - b.right);
    });
    return {
      down: Math.max(0, b.bottom - sec.bottom), side: Math.max(0, side),
      word: Math.max(...r.map((q) => q.bottom)) - Math.min(...r.map((q) => q.top)),
      text: b.height,
      clear: b.top - Math.max(...r.map((q) => q.bottom)),
      hs: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      below: Math.round(document.documentElement.scrollHeight - (window.scrollY + window.innerHeight)),
    };
  });
  if (m.down > 0.5) fail(`${w}×${h}: реквизиты вылезают за низ секции на ${m.down.toFixed(1)} px`);
  if (m.clear < 0) fail(`${w}×${h}: реквизиты наехали на слово на ${(-m.clear).toFixed(1)} px`);
  if (m.side > 0.5) fail(`${w}×${h}: строка вылезает за колонку на ${m.side.toFixed(1)} px`);
  if (m.hs !== 0) fail(`${w}×${h}: горизонтальный скролл ${m.hs} px`);
  if (m.below !== 0) fail(`${w}×${h}: за нижним краем осталось ${m.below} px документа`);
  if (Math.abs(m.word - hero) > 0.6)
    fail(`${w}×${h}: слово в футере ${m.word.toFixed(1)} против ${hero.toFixed(1)} в хиро`);
  fit.push({ w, h, hero, ...m });
  await page.close();
}

console.log('');
console.log('── ВЫСОТА СЛОВА: ФУТЕР ПРОТИВ ХИРО, И ВМЕЩАЕМОСТЬ ──────────────');
console.log('размер       хиро    футер   разница   реквизиты   просвет   вылет');
for (const f of fit) {
  console.log('  %s %s %s %s px %s px %s px %s px',
    String(f.w + '×' + f.h).padEnd(11),
    f.hero.toFixed(1).padStart(7),
    f.word.toFixed(1).padStart(8),
    (f.word - f.hero).toFixed(1).padStart(7),
    Math.round(f.text).toString().padStart(8),
    f.clear.toFixed(1).padStart(7),
    f.down.toFixed(1).padStart(5));
}

await browser.close();
server.close();
console.log('');
console.log(failed ? `ПРОВАЛОВ: ${failed}` : 'ФУТЕР: ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ');
process.exit(failed ? 1 : 0);

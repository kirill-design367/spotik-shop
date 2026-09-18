/**
 * ПРОВЕРКА ФУТЕРА — ПО РАСТРУ ЖИВОЙ СТРАНИЦЫ.
 *
 * Три вещи, которые шестая итерация обязана держать, и все три меряются
 * тем, что реально нарисовано пикселями, а не тем, что написано в коде.
 *
 * 1. ВЕРХНЯЯ КРОМКА НЕПОДВИЖНА — то же условие 1 из шести, что и в хиро.
 *    Слово растёт ВНИЗ от линии, которая проходит сразу под нижней
 *    границей шапки. Мерится по геометрии (верх бокса шести путей):
 *    разброс обязан быть нулевым на всех положениях скролла и на всех
 *    трёх размерах.
 *
 *    Растровый верх здесь ничего не доказывает: верх чернил лежит ВЫШЕ
 *    границы зелёного поля на величину среза, поэтому первая видимая
 *    строка чернил — это край поля, и он неподвижен тривиально.
 *
 *    Требование седьмой итерации «неподвижен низ» ОТМЕНЕНО арт-директором
 *    в восьмой: постановка была его и оказалась неверной.
 *
 * 1а. ЛИНИЯ СЛОВА совпадает с низом шапки плюс минимальный воздух,
 *    а ВЫСОТА раскрытого слова — с высотой раскрытого слова в хиро.
 *
 * 2. ЗЕЛЁНОЕ ПОЛЕ НАЧИНАЕТСЯ У СЛОВА И РЕЖЕТ ВЕРХУШКИ ЛИТЕР. Над полем
 *    остаётся полоса фона страницы ровно в величину среза, и она же
 *    делает срез видимым. Проверяется, что срез одинаков (в долях высоты
 *    прописной) на всех трёх размерах и что режется КАЖДАЯ из шести литер.
 *
 * 3. ПОД СЛОВОМ ДО КОНЦА ХОДА НЕТ НИЧЕГО. Доказательство растровое:
 *    полоса от кромки чернил до низа экрана обязана быть чистым фоном
 *    страницы. Это разом ловит и мелкий текст, выехавший раньше времени,
 *    и пустое зелёное поле, оставшееся под неразросшимся словом.
 *
 * Плюс сторожа планки: нет горизонтального скролла, ничего не вылезает
 * за нижний край страницы.
 */
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';

// Величина среза живёт в одном месте — lib/wordmark.ts. Скрипт на чистом
// node и .ts не читает, поэтому число вынимается из исходника, а не
// дублируется здесь: расходиться нечему.
const FOOTER_CUT_RATIO = Number(
  /FOOTER_CUT_RATIO = ([\d.]+)/.exec(readFileSync('lib/wordmark.ts', 'utf8'))[1]);

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

/** Строка с чернилами на зелёном: первая сверху (dir=1) или снизу (dir=-1). */
function inkOnGreenRow(png, dir) {
  const from = dir > 0 ? 0 : png.height - 1;
  const to = dir > 0 ? png.height : -1;
  for (let y = from; y !== to; y += dir) {
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

/**
 * Последняя строка, в которой на зелёном ещё есть хоть что-то не зелёное.
 *
 * Порог по «черноте» здесь не годится: самый низ слова — это кончик
 * круглой литеры, сглаженный край. Сколько там почти чёрных пикселей,
 * зависит от кривизны, а кривизна по ходу морфа меняется — и порог
 * прыгает на пиксель, хотя кромка стоит. Признак «пиксель НЕ зелёный»
 * ловит и слабую подмешку тоже, поэтому строка получается ровно floor
 * от истинной кромки и не зависит ни от кривизны, ни от насыщенности.
 */
function inkBottomRow(png, fromY) {
  let last = -1;
  let clean = 0;
  for (let y = Math.max(0, fromY); y < png.height; y += 1) {
    let dirty = false;
    for (let x = 0; x < png.width && !dirty; x += 1)
      if (!GREEN(png.data, (png.width * y + x) * 4)) dirty = true;
    // счётчик чистых строк считаем только ПОСЛЕ того, как слово найдено:
    // до этого под верхней границей поля идёт чистая зелёная пустота
    if (dirty) { last = y; clean = 0; } else if (last >= 0 && ++clean > 40) break;
  }
  return last;
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

/**
 * Сколько пикселей в полосе под словом НЕ фон страницы.
 *
 * С девятой итерации под словом не должно быть вообще ничего: зелёное поле
 * кончается на кромке чернил, а ниже идёт фон страницы — та же чернота,
 * что и в полосе НАД словом. Поэтому проверка одна на два требования сразу:
 * найденный не-фоновый пиксель — это либо выехавший раньше времени текст,
 * либо оставшееся под словом пустое зелёное поле.
 */
const PAGE = (d, k) => Math.abs(d[k] - 18) < 8 && Math.abs(d[k + 1] - 18) < 8 && Math.abs(d[k + 2] - 18) < 8;
function foreignInBand(png, y0, y1) {
  let n = 0;
  for (let y = Math.max(0, y0); y < Math.min(png.height, y1); y += 1)
    for (let x = 0; x < png.width; x += 1) {
      const k = (png.width * y + x) * 4;
      if (!PAGE(png.data, k)) n += 1;
    }
  return n;
}

const server = await serveOut(PORT);
const browser = await launch();
const report = [];

for (const dev of SIZES) {
  const page = await browser.newPage({
    viewport: { width: dev.w, height: dev.h },
    isMobile: dev.mobile,
    hasTouch: dev.mobile,
    deviceScaleFactor: 1,
  });
  await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('.hero__stage[data-entered]');

  /* Эталон для пунктов 1а: линия слова и его высота берутся из ХИРО,
     на той же странице и в том же прогоне — сравнивать надо с живым
     состоянием, а не с записанным числом. */
  const hero = await page.evaluate(() => {
    const st = document.querySelector('.hero__stage').getBoundingClientRect();
    const nav = document.querySelector('.nav').getBoundingClientRect();
    const r = [...document.querySelectorAll('.wm--hero .wm__letter path')]
      .map((el) => el.getBoundingClientRect());
    return {
      navBottom: nav.bottom - st.top,
      ink: Math.max(...r.map((b) => b.bottom)) - Math.min(...r.map((b) => b.top)),
    };
  });
  const navBottom = hero.navBottom;
  const heroInk = hero.ink;

  const geom = await page.evaluate(() => {
    const f = document.getElementById('footer');
    return {
      // именно getBoundingClientRect, а не offsetTop: offsetTop округлён
      // до целого, и промах в доли пикселя означает, что сцена ЕЩЁ
      // не прилипла — тогда слой стоит ниже на этот остаток, и замер
      // ловит не движение кромки, а собственную ошибку
      top: f.getBoundingClientRect().top + window.scrollY,
      height: f.offsetHeight,
      doc: document.documentElement.scrollHeight,
      vh: window.innerHeight,
    };
  });
  // ход морфа = 0.55 экрана от момента, когда верх футера пришёл к верху
  // экрана; дальше выдержка до конца документа
  const travel = Math.round(geom.vh * 0.55);
  const maxScroll = geom.doc - geom.vh;
  // сцена прилипает, когда верх футера дошёл до верха экрана; замер идёт
  // по прилипшей сцене, поэтому старт округляем вверх
  const start = Math.ceil(geom.top);
  const stops = [];
  for (let i = 0; i <= 10; i += 1) stops.push(start + (travel * i) / 10);
  for (let i = 1; i <= 4; i += 1) stops.push(start + travel + ((maxScroll - start - travel) * i) / 4);

  const rows = [];
  for (const y of stops) {
    await page.evaluate((v) => window.scrollTo(0, v), Math.round(y));
    await page.waitForTimeout(220);
    const png = PNG.sync.read(await page.screenshot());
    const m = await page.evaluate(() => {
      const paths = [...document.querySelectorAll('.wm--footer .wm__letter path')];
      const r = paths.map((p) => p.getBoundingClientRect());
      const field = document.querySelector('.footer__field').getBoundingClientRect();
      const layer = document.querySelector('.wm--footer').getBoundingClientRect();
      const body = document.querySelector('.footer__body');
      const cs = getComputedStyle(body);
      return {
        inkTop: Math.min(...r.map((b) => b.top)),
        inkBottom: Math.max(...r.map((b) => b.bottom)),
        letterTops: r.map((b) => b.top),
        stageTop: document.querySelector('.footer__stage').getBoundingClientRect().top,
        fieldTop: field.top,
        layerH: layer.height,
        bodyTop: body.getBoundingClientRect().top,
        vis: cs.visibility,
        op: Number(cs.opacity),
        open: document.getElementById('footer').dataset.open ?? '',
        scrollY: Math.round(window.scrollY),
        hscroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        below: Math.round(document.documentElement.scrollHeight - (window.scrollY + window.innerHeight)),
      };
    });
    const gTop = greenTop(png);
    rows.push({ ...m, rasterTop: inkOnGreenRow(png, 1),
      rasterBottom: inkBottomRow(png, gTop + 4), rasterGreen: gTop, png });
  }

  // ── условие 1 в футере: стоит ВЕРХ ───────────────────────────────────
  const rb = rows.map((r) => r.rasterTop);
  const gb = rows.map((r) => r.inkTop);
  const spreadR = Math.max(...rb) - Math.min(...rb);
  const spreadG = Math.max(...gb) - Math.min(...gb);

  // ── срез ──────────────────────────────────────────────────────────────
  const last = rows[rows.length - 1];
  const capPx = (last.layerH * 235.0) / 244.074;
  const cuts = last.letterTops.map((t) => (last.fieldTop - t) / capPx);
  const cutMin = Math.min(...cuts);
  const cutMax = Math.max(...cuts);

  /* Верх неподвижен, значит срез постоянен на всём ходу: он не событие,
     а отбивка слова от края поля. Разброс по кадрам обязан быть нулевым. */
  const cutPx = last.fieldTop - last.inkTop;
  const cuts2 = rows.map((r) => r.fieldTop - r.inkTop);
  const cutSpread = Math.max(...cuts2) - Math.min(...cuts2);
  const footerInk = last.inkBottom - last.inkTop;

  // ── текст до раскрытия ────────────────────────────────────────────────
  const openH = last.inkBottom - last.inkTop;
  let dirty = 0;
  let checked = 0;
  for (const r of rows) {
    const h = r.inkBottom - r.inkTop;
    if (h > openH - 1) continue; // слово уже раскрыто — текст имеет право быть
    checked += 1;
    if (r.vis !== 'hidden' || r.op > 0.001) fail(`${dev.w}: текст не скрыт при высоте чернил ${h.toFixed(1)}`);
    // растр: полоса от низа чернил до низа экрана обязана быть чистым
    // фоном страницы — ни текста, ни остатка зелёного поля
    dirty += foreignInBand(r.png, Math.ceil(r.inkBottom) + 2, dev.h - 1);
  }

  const hs = Math.max(...rows.map((r) => r.hscroll));
  // «за нижним краем» имеет смысл только в самом низу документа
  const below = rows[rows.length - 1].below;

  if (process.env.WMDEBUG) {
    console.log('    растр низ:', rows.map((r) => r.rasterBottom).join(' '));
    console.log('    геом низ :', rows.map((r) => r.inkBottom.toFixed(2)).join(' '));
    console.log('    высота   :', rows.map((r) => (r.inkBottom - r.inkTop).toFixed(1)).join(' '));
    for (const r of rows)
      console.log('    y=%s  inkTop=%s  fieldTop=%s  растр=%s  below=%s',
        String(r.scrollY).padStart(6), r.inkTop.toFixed(3).padStart(8),
        r.fieldTop.toFixed(3).padStart(8), String(r.rasterTop).padStart(4), r.below);
  }
  /* По растру кромка не может быть точнее пикселя: истинный низ лежит
     на дробной позиции (358.79 на 390), и строка, в которую попадает край,
     то попадает под порог, то нет — это сглаживание, а не движение.
     Целочисленная проверка поэтому с допуском в 1 px, а настоящий ноль
     даёт геометрия. */
  if (spreadR > 1) fail(`${dev.w}: верхняя кромка по растру гуляет на ${spreadR} px`);
  // 0.02 px — одна единица раскладки Chrome (1/64 px), пол измерения
  if (spreadG > 0.02) fail(`${dev.w}: верхняя кромка по геометрии гуляет на ${spreadG.toFixed(3)} px`);
  if (Math.abs(last.inkTop - (navBottom + 12)) > 0.6)
    fail(`${dev.w}: линия слова ${last.inkTop.toFixed(1)} вместо ${(navBottom + 12).toFixed(1)} (низ шапки + воздух)`);
  if (Math.abs(heroInk - footerInk) > 0.6)
    fail(`${dev.w}: слово в футере ${footerInk.toFixed(1)} против ${heroInk.toFixed(1)} в хиро`);
  if (cutMin <= 0) fail(`${dev.w}: не срезана хотя бы одна литера (минимум ${cutMin.toFixed(4)})`);
  if (dirty !== 0) fail(`${dev.w}: до раскрытия под словом ${dirty} не-зелёных пикселей`);
  if (hs !== 0) fail(`${dev.w}: горизонтальный скролл ${hs} px`);
  if (below !== 0) fail(`${dev.w}: за нижним краем экрана осталось ${below} px документа`);

  report.push({ dev, rows, spreadR, spreadG, cuts, cutMin, cutMax, capPx,
    checked, dirty, hs, below, cutPx, cutSpread, heroInk, footerInk, navBottom,
    line: last.inkTop, rasterGreen: last.rasterGreen });
  await page.close();
}

/* ── печать ──────────────────────────────────────────────────────────────── */
const LETTERS = ['S', 'P', 'O', 'T', 'I', 'K'];
console.log('── УСЛОВИЕ 1 В ФУТЕРЕ: ВЕРХ ЧЕРНИЛ НЕПОДВИЖЕН ──────────────────');
console.log('размер   положений   разброс по растру   разброс по геометрии');
console.log('(растр целочислен и видит сглаживание края; ноль даёт геометрия)');
for (const r of report) {
  console.log('  %s   %s   %s px   %s px',
    String(r.dev.w + '×' + r.dev.h).padEnd(10),
    String(r.rows.length).padStart(6),
    r.spreadR.toFixed(2).padStart(12),
    r.spreadG.toFixed(2).padStart(14));
}

console.log('');
console.log('── СРЕЗ ВЕРХУШЕК ГРАНИЦЕЙ ЗЕЛЁНОГО ─────────────────────────────');
console.log('задано %s высоты прописной, отсчёт от ЛИНИИ ПРОПИСНЫХ',
  (FOOTER_CUT_RATIO * 100).toFixed(2) + ' %');
console.log('размер      прописная   %s', LETTERS.map((c) => c.padStart(6)).join(''));
for (const r of report) {
  console.log('  %s %s px   %s',
    String(r.dev.w + '×' + r.dev.h).padEnd(11),
    r.capPx.toFixed(1).padStart(7),
    r.cuts.map((c) => (c * 100).toFixed(2).padStart(6)).join(''));
}
console.log('(в процентах высоты прописной; у круглых S и O больше ровно');
console.log(' на овершут рисунка — 1.93 %, это и есть прямой горизонтальный срез)');
console.log('');
console.log('Верх неподвижен, поэтому срез постоянен на всём ходу:');
console.log('размер        величина среза   разброс по кадрам');
for (const r of report)
  console.log('  %s %s px %s px',
    String(r.dev.w + '×' + r.dev.h).padEnd(11),
    r.cutPx.toFixed(1).padStart(12), r.cutSpread.toFixed(2).padStart(14));

console.log('');
console.log('── ЛИНИЯ СЛОВА И ВЫСОТА: ФУТЕР ПРОТИВ ХИРО ─────────────────────');
console.log('размер       низ шапки   линия слова   слово хиро   слово футер');
for (const r of report)
  console.log('  %s %s %s %s %s',
    String(r.dev.w + '×' + r.dev.h).padEnd(11),
    r.navBottom.toFixed(1).padStart(9), r.line.toFixed(1).padStart(13),
    r.heroInk.toFixed(1).padStart(12), r.footerInk.toFixed(1).padStart(13));

console.log('');
console.log('── ТЕКСТ ДО РАСКРЫТИЯ ──────────────────────────────────────────');
for (const r of report) {
  console.log('  %s   положений с несомкнутым словом %d, чужих пикселей под словом %d',
    String(r.dev.w + '×' + r.dev.h).padEnd(11), r.checked, r.dirty);
}

/* ── ВМЕЩАЕМОСТЬ: слово и реквизиты в один экран ─────────────────────────
   Слово стоит вверху, реквизиты под ним, и вылезти за нижний край сцены
   не имеет права ничего. На мобильных это не даётся само: в одну колонку
   реквизиты занимают 551 px и под слово не помещаются ни на одной узкой
   ширине. Поэтому колонок две с самых узких экранов, а высота слова
   ограничена местом под текст. Здесь это проверяется замером. */
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
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(500);
  const m = await page.evaluate(() => {
    const st = document.querySelector('.footer__stage').getBoundingClientRect();
    const b = document.querySelector('.footer__body').getBoundingClientRect();
    const wm = document.querySelector('.wm--footer').getBoundingClientRect();
    const ink = [...document.querySelectorAll('.wm--footer .wm__letter path')]
      .map((el) => el.getBoundingClientRect());
    let side = 0;
    document.querySelectorAll('.footer__body *').forEach((el) => {
      side = Math.max(side, el.getBoundingClientRect().right - b.right);
    });
    return {
      down: Math.max(0, b.bottom - st.bottom), side: Math.max(0, side),
      word: wm.height, text: b.height,
      // просвет между низом раскрытых чернил и верхом реквизитов:
      // реквизиты больше не делят место со словом во флексбоксе, значит
      // наехать на литеры им мешает только потолок --footer-text
      clear: b.top - Math.max(...ink.map((r) => r.bottom)),
      hs: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  if (m.down > 0.5) fail(`${w}×${h}: реквизиты вылезают за низ сцены на ${m.down.toFixed(1)} px`);
  if (m.clear < 0) fail(`${w}×${h}: реквизиты наехали на слово на ${(-m.clear).toFixed(1)} px`);
  if (m.side > 0.5) fail(`${w}×${h}: строка вылезает за колонку на ${m.side.toFixed(1)} px`);
  if (m.hs !== 0) fail(`${w}×${h}: горизонтальный скролл ${m.hs} px`);
  fit.push({ w, h, ...m });
  await page.close();
}

console.log('');
console.log('── ВМЕЩАЕМОСТЬ ФУТЕРА ──────────────────────────────────────────');
console.log('размер       слово   реквизиты   просвет   вылет вниз   вылет вбок');
for (const f of fit) {
  console.log('  %s %s px %s px %s px %s px %s px',
    String(f.w + '×' + f.h).padEnd(11),
    Math.round(f.word).toString().padStart(5),
    Math.round(f.text).toString().padStart(8),
    f.clear.toFixed(1).padStart(6),
    f.down.toFixed(1).padStart(9),
    f.side.toFixed(1).padStart(9));
}

console.log('');
console.log('── СТОРОЖА ─────────────────────────────────────────────────────');
for (const r of report) {
  console.log('  %s   горизонтальный скролл %d px, за нижним краем %d px',
    String(r.dev.w + '×' + r.dev.h).padEnd(11), r.hs, r.below);
}

await browser.close();
server.close();
console.log('');
console.log(failed ? `ПРОВАЛОВ: ${failed}` : 'ФУТЕР: ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ');
process.exit(failed ? 1 : 0);

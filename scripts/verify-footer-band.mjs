/**
 * ФУТЕР: ЧТО ПОД СЛОВОМ НА ХОДУ РОСТА.
 *
 * Прилипания нет, слово растёт один к одному с прокруткой, и низ чернил
 * поэтому стоит у нижнего края экрана. Значит под словом не может быть
 * ничего, кроме воздуха FOOTER_BOTTOM_GAP: ни пустого зелёного поля,
 * ни выехавшего раньше времени текста.
 *
 * Мерится двумя способами разом.
 *
 *   ПО ГЕОМЕТРИИ — расстояние от низа чернил до низа экрана. Оно обязано
 *   равняться воздуху и не меняться по ходу.
 *
 *   ПО РАСТРУ — сколько строк НИЖЕ последней строки с чернилами ещё залиты
 *   зелёным. Здесь есть свой пол: кромка лежит на дробной позиции,
 *   а сглаженный кончик круглой литеры гаснет на строку раньше настоящего
 *   низа. Растр тут подтверждает геометрию, а не заменяет её.
 */
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';

const PORT = 4207;
/* Воздух под словом живёт в lib/wordmark.ts: полоса под чернилами обязана
   быть равна ему и только ему. */
const SRC = readFileSync('lib/wordmark.ts', 'utf8');
const DATA = readFileSync('lib/wordmark.data.ts', 'utf8');
const GAP = Number(/FOOTER_BOTTOM_GAP = ([\d.]+)/.exec(SRC)[1]);
const INK_TIGHT = Number(/WM_BOTTOM_TIGHT = ([\d.]+)/.exec(DATA)[1])
  / Number(/WM_BOX_HEIGHT = ([\d.]+)/.exec(DATA)[1]);
const SIZES = [
  { w: 390, h: 844, mobile: true },
  { w: 1920, h: 1080, mobile: false },
  { w: 2560, h: 1440, mobile: false },
];

const GREEN = (d, k) => d[k] > 20 && d[k] < 60 && d[k + 1] > 160 && d[k + 1] < 200 && d[k + 2] > 65 && d[k + 2] < 105;

/** Доля зелёного в строке. */
function greenShare(png, y) {
  let g = 0;
  for (let x = 0; x < png.width; x += 1) if (GREEN(png.data, (png.width * y + x) * 4)) g += 1;
  return g / png.width;
}

/**
 * Последняя строка сверху вниз, где на зелёном есть НЕ зелёное (кромка чернил).
 *
 * Скан начинается от ВЕРХНЕЙ ГРАНИЦЫ ПОЛЯ, взятой из DOM, а не от верха
 * экрана. Иначе сканер цепляется за зелёную кнопку в шапке: она тоже
 * «зелёная строка», после неё идут сорок чистых строк, и поиск обрывается
 * в самом верху экрана, далеко от слова.
 */
function inkBottomRow(png, fromY) {
  let last = -1;
  let clean = 0;
  for (let y = Math.max(0, Math.floor(fromY)); y < png.height; y += 1) {
    const share = greenShare(png, y);
    let dirty = false;
    for (let x = 0; x < png.width && !dirty; x += 1)
      if (!GREEN(png.data, (png.width * y + x) * 4)) dirty = true;
    if (dirty && share > 0.02) { last = y; clean = 0; }
    else if (last >= 0 && ++clean > 40) break;
  }
  return last;
}

/** Сколько строк ниже кромки чернил ещё зелёные (полоса пустоты). */
function emptyGreenBelow(png, from) {
  let n = 0;
  for (let y = from + 1; y < png.height; y += 1) if (greenShare(png, y) > 0.5) n += 1;
  return n;
}

const server = await serveOut(PORT);
const browser = await launch();
let failed = 0;
const out = [];
const fail = (m) => { failed += 1; out.push(`  ПРОВАЛ: ${m}`); console.log(`  ПРОВАЛ: ${m}`); };

for (const dev of SIZES) {
  const page = await browser.newPage({
    viewport: { width: dev.w, height: dev.h },
    isMobile: dev.mobile, hasTouch: dev.mobile, deviceScaleFactor: 1,
  });
  await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('.hero__stage[data-entered]');

  const geom = await page.evaluate(() => {
    const l = document.querySelector('.wm--footer').getBoundingClientRect();
    return {
      layerBottomDoc: l.bottom + window.scrollY,
      layerH: l.height,
      vh: window.innerHeight,
      doc: document.documentElement.scrollHeight,
    };
  });
  /* Ход роста выводится из самой формы: это разница раскрытой и сжатой
     высоты чернил. Конец хода — там, где низ слоя пришёл на линию низа. */
  const travel = geom.layerH * (1 - INK_TIGHT);
  const end = Math.round(geom.layerBottomDoc - geom.vh + GAP);
  const start = end - travel;

  // подход (слово ещё сжато, низ за краем) + весь ход роста
  const stops = [];
  for (let i = 4; i >= 1; i -= 1) stops.push(start - (travel * i) / 4);
  for (let i = 0; i <= 16; i += 1) stops.push(start + (travel * i) / 16);

  const rows = [];
  for (const y of stops) {
    await page.evaluate((v) => window.scrollTo(0, v), Math.round(y));
    await page.waitForTimeout(340);
    const png = PNG.sync.read(await page.screenshot());
    const m = await page.evaluate(() => {
      const r = [...document.querySelectorAll('.wm--footer .wm__letter path')]
        .map((p) => p.getBoundingClientRect());
      const sec = document.getElementById('footer').getBoundingClientRect();
      const text = document.querySelector('.footer__col').getBoundingClientRect();
      const body = document.querySelector('.footer__body');
      const bs = body.getBoundingClientRect();
      const cs = getComputedStyle(body);
      return {
        inkBottom: Math.max(...r.map((b) => b.bottom)),
        inkTop: Math.min(...r.map((b) => b.top)),
        secTop: sec.top,
        textTop: text.top,
        bodyTop: bs.top,
        bodyVisible: cs.visibility !== 'hidden' && Number(cs.opacity) > 0,
        textShown: text.top < window.innerHeight - 0.5,
        scrollY: Math.round(window.scrollY),
      };
    });
    const bottom = inkBottomRow(png, m.secTop);
    rows.push({
      y: m.scrollY,
      phase: m.scrollY < start - 1 ? 'подход' : 'рост',
      open: m.textShown ? '1' : '0',
      inkBottom: m.inkBottom,
      geom: dev.h - m.inkBottom,
      band: bottom < 0 ? 0 : emptyGreenBelow(png, bottom),
      gap: dev.h - m.inkBottom,
      bodyVisible: m.textShown,
      bodyTop: m.textTop,
    });
  }
  await page.close();

  // на кадре полного раскрытия реквизиты уже выезжают — там полоса
  // перестаёт быть «пустой» по определению; считаем только шаги 1…3
  const live = rows.filter((r) => r.open !== '1');
  const maxGeom = Math.max(...live.map((r) => r.geom));
  const maxBand = Math.max(...live.map((r) => r.band));
  const maxGap = Math.max(...live.map((r) => r.gap));
  const shown = live.filter((r) => r.bodyVisible);

  out.push(`\n${dev.w}×${dev.h}`);
  out.push('  скролл   фаза     низ чернил  низ поля  полоса-геом  полоса-растр  зазор');
  for (const r of rows)
    out.push(
      `  ${String(r.y).padStart(7)}  ${r.phase.padEnd(7)}  ${r.inkBottom.toFixed(1).padStart(9)}` +
      `  ${(r.inkBottom + r.geom).toFixed(1).padStart(8)}  ${r.geom.toFixed(2).padStart(11)}` +
      `  ${String(r.band).padStart(12)}  ${r.gap.toFixed(1).padStart(5)}${r.open === '1' ? '  (раскрыто)' : ''}`);
  out.push(`  ПОЛОСА ПОД СЛОВОМ, максимум за ход:   ${maxGeom.toFixed(2)} px по геометрии, ${maxBand} px по растру`);
  out.push(`  задан воздух ${GAP} px — и это всё, что там есть`);
  out.push(`  реквизиты видны до раскрытия:           ${shown.length} кадров из ${live.length}`);
  if (maxGeom > GAP + 0.6) fail(`${dev.w}: под словом ${maxGeom.toFixed(2)} px вместо воздуха ${GAP} px`);
  if (maxBand > GAP + 1) fail(`${dev.w}: по растру под словом ${maxBand} px зелёного`);
  if (shown.length) fail(`${dev.w}: реквизиты видны до полного раскрытия`);
}

console.log(out.join('\n'));
await browser.close();
server.close();
console.log(failed ? `\nПРОВАЛОВ: ${failed}` : '\nПОД СЛОВОМ ТОЛЬКО ВОЗДУХ ДО КРАЯ ЭКРАНА, НИ НА ОДНОМ КАДРЕ БОЛЬШЕ.');
process.exit(failed ? 1 : 0);

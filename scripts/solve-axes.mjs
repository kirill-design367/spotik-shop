/**
 * РЕШЕНИЕ ОСЕЙ ПО ФАКТИЧЕСКИМ ПИКСЕЛЯМ.
 *
 * Вывод из замеров референса даёт оси в первом приближении, но связь
 * «значение оси → толщина штриха в пикселях» у Roboto Flex нелинейна:
 * XOPQ и wdth подмешиваются в горизонтали, YOPQ — в вертикали, а кегль
 * пересчитывается под постоянную ширину слова. Поэтому конечные значения
 * не выводятся формулой, а НАХОДЯТСЯ ИТЕРАЦИЯМИ по растру.
 *
 * Цель (замеры арт-директора на 1920×1080):
 *   высота прописной падает в 1.711 раза
 *   горизонтальный штрих худеет в 2.860 раза
 *   вертикальный штрих не меняется вовсе
 *
 * Скрипт печатает значения, которые надо положить в lib/wordmark.ts.
 */
import { launch } from './browser.mjs';
import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';

const font = readFileSync('public/fonts/spotik-wordmark.woff2').toString('base64');
const VW = 1920;
const OVERSCAN = 1.16;
const TARGET_W = VW * OVERSCAN;

const REF = { cap: 770 / 450, horiz: 123 / 43, vert: 1 };
const SIZE_RATIO = REF.cap / (760 / 528);

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 4000, height: 1800 } });

const css = (a) =>
  Object.entries(a).map(([k, v]) => `"${k}" ${v}`).join(',');

async function setup() {
  await page.setContent(`<!doctype html><meta charset=utf-8><style>
@font-face{font-family:WM;src:url(data:font/woff2;base64,${font}) format('woff2-variations');
 font-weight:100 1000;font-stretch:25% 151%;font-display:block}
html,body{margin:0;background:#000}
#w{position:absolute;left:40px;top:40px;white-space:pre;font-family:WM;line-height:1;
   color:#fff;font-synthesis:none;display:inline-block;letter-spacing:0}
</style><span id="w">SPOTIK</span>`);
  await page.evaluate(() => document.fonts.ready);
}

const emWidth = (axes) =>
  page.evaluate((a) => {
    const el = document.getElementById('w');
    el.style.fontSize = '400px';
    el.style.fontVariationSettings = a;
    return el.getBoundingClientRect().width / 400;
  }, css(axes));

/** Бинарный поиск wdth, при котором ширина слова равна целевой em-ширине. */
async function solveWidth(axes, targetEm) {
  let lo = 25, hi = 151, best = 100;
  for (let i = 0; i < 26; i += 1) {
    const mid = (lo + hi) / 2;
    const em = await emWidth({ ...axes, wdth: mid });
    best = mid;
    if (em < targetEm) lo = mid; else hi = mid;
  }
  return best;
}

async function pixels(axes, fontSize) {
  await page.evaluate(
    ([a, fs]) => {
      const el = document.getElementById('w');
      el.style.fontSize = fs + 'px';
      el.style.fontVariationSettings = a;
    },
    [css(axes), fontSize],
  );
  const box = await page.evaluate(() => {
    const r = document.getElementById('w').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const buf = await page.screenshot({
    clip: {
      x: 0, y: 0,
      width: Math.min(4000, Math.ceil(box.x + box.w + 40)),
      height: Math.min(1800, Math.ceil(box.y + box.h + 40)),
    },
  });
  const { width, height, data } = PNG.sync.read(buf);
  const ink = (x, y) => data[(y * width + x) * 4] > 128;
  const cols = new Uint8Array(width);
  for (let x = 0; x < width; x += 1)
    for (let y = 0; y < height; y += 1) if (ink(x, y)) { cols[x] = 1; break; }
  const letters = [];
  let s = -1;
  for (let x = 0; x <= width; x += 1) {
    if (x < width && cols[x] && s < 0) s = x;
    if ((x === width || !cols[x]) && s >= 0) { letters.push([s, x - 1]); s = -1; }
  }
  if (letters.length !== 6) throw new Error('литер ' + letters.length);
  const colInk = (x) => {
    let top = -1, bot = -1;
    for (let y = 0; y < height; y += 1) if (ink(x, y)) { if (top < 0) top = y; bot = y; }
    return top < 0 ? 0 : bot - top + 1;
  };
  const [ia, ib] = letters[4];
  const [ta, tb] = letters[3];
  return {
    cap: colInk(Math.round((ia + ib) / 2)),
    vert: ib - ia + 1,
    horiz: colInk(Math.round(ta + (tb - ta) * 0.08)),
    width: box.w,
  };
}

await setup();

// раскрытое состояние: wdth решается под доступную высоту (на 1920×1080 это ~63)
const OPEN = { wght: 700, wdth: 63.14, opsz: 144, YTUC: 760, YOPQ: 132, XOPQ: 92, XTRA: 468, GRAD: 0 };
const openEm = await emWidth(OPEN);
const openSize = TARGET_W / openEm;
const openPx = await pixels(OPEN, openSize);
console.log(
  `раскрыт: кегль ${openSize.toFixed(1)}  высота ${openPx.cap}  горизонталь ${openPx.horiz}  вертикаль ${openPx.vert}`,
);

// Ось YOPQ упирается в минимум 25 и в одиночку даёт только ×2.656.
// Недостающее утоньшение горизонталей добирает GRAD — ось «начертательной
// насыщенности», которая меняет толщину штрихов, НЕ трогая метрики.
// Она худит и вертикали тоже, поэтому XOPQ компенсирует их обратно.
let YOPQ = (OPEN.YOPQ * SIZE_RATIO) / REF.horiz;
let XOPQ = OPEN.XOPQ * SIZE_RATIO;
let GRAD = 0;
const targetEm = openEm * SIZE_RATIO;

console.log('\nитерации:');
for (let i = 0; i < 24; i += 1) {
  const seed = { ...OPEN, YTUC: 528, YOPQ, XOPQ, GRAD };
  const wdth = await solveWidth(seed, targetEm);
  const tight = { ...seed, wdth };
  const size = TARGET_W / (await emWidth(tight));
  const px = await pixels(tight, size);

  const rCap = openPx.cap / px.cap;
  const rH = openPx.horiz / px.horiz;
  const rV = openPx.vert / px.vert;
  console.log(
    `  ${i}: YOPQ ${YOPQ.toFixed(2).padStart(6)} XOPQ ${XOPQ.toFixed(2).padStart(6)} wdth ${wdth.toFixed(2).padStart(6)}  →  ` +
      `GRAD ${GRAD.toFixed(1).padStart(7)}  →  высота ×${rCap.toFixed(3)}  горизонталь ×${rH.toFixed(3)}  вертикаль ×${rV.toFixed(3)}`,
  );
  if (Math.abs(rH - REF.horiz) < 0.015 && Math.abs(rV - 1) < 0.008) {
    console.log('\n── СОШЛОСЬ ─────────────────────────────────────────────');
    console.log(`  YOPQ сжатого : ${YOPQ.toFixed(3)}`);
    console.log(`  XOPQ сжатого : ${XOPQ.toFixed(3)}`);
    console.log(`  GRAD сжатого : ${GRAD.toFixed(3)}`);
    console.log(`  wdth сжатого : ${wdth.toFixed(3)}  (решается в рантайме под ширину экрана)`);
    console.log(`  множитель YOPQ относительно вывода формулы: ${(YOPQ / ((OPEN.YOPQ * SIZE_RATIO) / REF.horiz)).toFixed(4)}`);
    console.log(`  множитель XOPQ относительно вывода формулы: ${(XOPQ / (OPEN.XOPQ * SIZE_RATIO)).toFixed(4)}`);
    console.log(`  абсолюты: высота ${openPx.cap}→${px.cap}  горизонталь ${openPx.horiz}→${px.horiz}  вертикаль ${openPx.vert}→${px.vert}`);
    break;
  }
  // сперва выбираем весь ход YOPQ, потом добираем GRAD
  const yNext = YOPQ * Math.pow(rH / REF.horiz, 0.85);
  if (yNext > 25.5) {
    YOPQ = Math.min(135, yNext);
  } else {
    YOPQ = 25;
    GRAD = Math.max(-200, Math.min(150, GRAD + (rH / REF.horiz - 1) * 260));
  }
  XOPQ = Math.max(27, Math.min(175, XOPQ * Math.pow(rV / 1, 0.9)));
}
await browser.close();

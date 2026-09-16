/**
 * ПРОВЕРКА ШЕСТИ УСЛОВИЙ ГЕОМЕТРИИ ВОРДМАРКА — ПО РАСТРУ.
 *
 * Аналитический расчёт в шрифтовых единицах — ещё не доказательство: между
 * ним и экраном лежит растеризатор. Здесь измеряется то, что реально
 * нарисовано пикселями, и в двух разных режимах.
 *
 * ЧАСТЬ А — НА ЖИВОЙ СТРАНИЦЕ, ВДОЛЬ ВСЕГО СКРОЛЛА.
 * Условия 1 и 2 — про поведение во времени, их нельзя проверить на двух
 * кадрах. Страница реально прокручивается, и на каждом шаге снимается
 * растр: верхняя строка чернил, левый и правый столбцы. Верх обязан стоять
 * на одном месте, края — тоже, и слово не должно касаться границ экрана.
 *
 * ЧАСТЬ Б — СТЕНД ВЫСОКОГО РАЗРЕШЕНИЯ.
 * Условия 3…6 — про отношения размеров, и им нужна точность. Обе строки
 * контуров снимаются с ЖИВОЙ страницы (атрибут d при прогрессе 0 и 1),
 * затем рисуются в одном окне с одним масштабом. Толщина считается не
 * порогом, а суммой покрытия: сглаженный край даёт дробную альфу, и сумма
 * альфы вдоль столбца — длина штриха с субпиксельной точностью.
 *
 * Допуск по заданию: условия 4 и 5 — ±1 %, условие 6 — целевое.
 */
import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';

const PORT = 4183;
const R_CAP = 1.712;
const R_HOR = 2.833;
const R_VER = 1.0;
const INSET = 0.0065;
const TOL = 0.01;

let failed = 0;
const fail = (m) => { failed += 1; console.log(`  ВНЕ ДОПУСКА: ${m}`); };

/* ── растровые примитивы ─────────────────────────────────────────────────── */

const colInk = (png, x) => {
  let s = 0;
  for (let y = 0; y < png.height; y += 1) s += png.data[(png.width * y + x) * 4] / 255;
  return s;
};
const rowRuns = (png, y, from, to) => {
  const runs = [];
  let start = -1;
  for (let x = from; x <= to; x += 1) {
    const on = png.data[(png.width * y + x) * 4] > 127;
    if (on && start < 0) start = x;
    if (!on && start >= 0) { runs.push([start, x - 1]); start = -1; }
  }
  if (start >= 0) runs.push([start, to]);
  return runs;
};
const median = (a) => {
  const s = [...a].sort((p, q) => p - q);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Группы столбцов с чернилами — литеры разделены просветами. */
function letterGroups(cov, peak) {
  const on = cov.map((v) => v > peak * 0.004);
  const g = [];
  let s = -1;
  for (let i = 0; i < on.length; i += 1) {
    if (on[i] && s < 0) s = i;
    if (!on[i] && s >= 0) { g.push([s, i - 1]); s = -1; }
  }
  if (s >= 0) g.push([s, on.length - 1]);
  return g;
}

/* ── прогон ──────────────────────────────────────────────────────────────── */

const server = await serveOut(PORT);
const browser = await launch();

/* ЧАСТЬ А ─────────────────────────────────────────────────────────────────── */

console.log('ЧАСТЬ А. Живая страница, замер вдоль всего хода скролла.');
console.log('Условие 1 (верх неподвижен) и условие 2 (отступ от краёв, нет обрезки).\n');

const partA = [];
for (const dev of [
  { w: 390, h: 844, mobile: true },
  { w: 1920, h: 1080, mobile: false },
  { w: 2560, h: 1440, mobile: false },
]) {
  const page = await browser.newPage({
    viewport: { width: dev.w, height: dev.h },
    isMobile: dev.mobile,
    hasTouch: dev.mobile,
    deviceScaleFactor: 1,
  });
  await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  // вход двигает литеры трансформом — замерять положение можно только
  // после него, иначе поймаем кадр полёта
  await page.waitForSelector('.hero__stage[data-entered]');
  await page.waitForTimeout(400);

  const steps = 11;
  const tops = [];
  const lefts = [];
  const rights = [];
  for (let i = 0; i < steps; i += 1) {
    await page.evaluate((f) => {
      const el = document.getElementById('hero');
      window.scrollTo(0, (el.offsetHeight - window.innerHeight) * f);
    }, i / (steps - 1));
    await page.waitForTimeout(240);
    const png = PNG.sync.read(await page.screenshot());
    // зелёные чернила вордмарка на тёмном фоне; кнопку и логотип отсекаем
    // по вертикали — слой вордмарка начинается ниже навигации
    const y0 = Math.round(dev.h * 0.09);
    const isInk = (x, y) => {
      const k = (png.width * y + x) * 4;
      const r = png.data[k], g = png.data[k + 1], b = png.data[k + 2];
      return g > 90 && g - r > 40 && g - b > 40;
    };
    let top = -1, left = -1, right = -1;
    for (let y = y0; y < png.height && top < 0; y += 1)
      for (let x = 0; x < png.width; x += 1) if (isInk(x, y)) { top = y; break; }
    for (let x = 0; x < png.width && left < 0; x += 1)
      for (let y = y0; y < png.height; y += 1) if (isInk(x, y)) { left = x; break; }
    for (let x = png.width - 1; x >= 0 && right < 0; x -= 1)
      for (let y = y0; y < png.height; y += 1) if (isInk(x, y)) { right = x; break; }
    tops.push(top); lefts.push(left); rights.push(right);
  }
  await page.close();

  const spread = (a) => Math.max(...a) - Math.min(...a);
  const insetL = lefts[0] / dev.w;
  const insetR = (dev.w - 1 - rights[0]) / dev.w;
  const touches = lefts.some((v) => v <= 0) || rights.some((v) => v >= dev.w - 1);
  console.log(`${dev.w}×${dev.h}  (${steps} положений скролла)`);
  console.log(`  верх чернил:  ${Math.min(...tops)} … ${Math.max(...tops)} px, разброс ${spread(tops)} px`);
  console.log(`  левый край:   ${Math.min(...lefts)} … ${Math.max(...lefts)} px, разброс ${spread(lefts)} px`);
  console.log(`  правый край:  ${Math.min(...rights)} … ${Math.max(...rights)} px, разброс ${spread(rights)} px`);
  console.log(`  отступ слева ${(insetL * 100).toFixed(3)} %, справа ${(insetR * 100).toFixed(3)} % ` +
    `(цель ${(INSET * 100).toFixed(2)} %)`);
  console.log(`  касание краёв экрана: ${touches ? 'ЕСТЬ' : 'нет'}`);
  if (spread(tops) > 1) fail(`верх чернил гуляет на ${spread(tops)} px при ${dev.w}×${dev.h}`);
  if (spread(lefts) > 1 || spread(rights) > 1) fail(`края гуляют при ${dev.w}×${dev.h}`);
  if (touches) fail(`слово касается края экрана при ${dev.w}×${dev.h}`);
  if (Math.abs(insetL - INSET) > 0.002 || Math.abs(insetR - INSET) > 0.002)
    fail(`отступ от краёв вне допуска при ${dev.w}×${dev.h}`);
  partA.push({ size: `${dev.w}×${dev.h}`, topSpread: spread(tops), insetL, insetR, touches });
}

/* ЧАСТЬ Б ─────────────────────────────────────────────────────────────────── */

console.log('\nЧАСТЬ Б. Стенд высокого разрешения, условия 3…6.\n');

const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(600);
// слово лежит в шести группах (вход двигает литеры по одной), поэтому
// «строка контуров слова» — это склейка шести путей в их же порядке
const read = () => page.evaluate(() =>
  [...document.querySelectorAll('.wm--hero .wm__letter path')]
    .map((el) => el.getAttribute('d'))
    .join(''));
const dOpen = await read();
await page.evaluate(() => window.scrollTo(0, window.innerHeight * 1.2));
await page.waitForTimeout(1500);
const dTight = await read();
await page.evaluate(() => window.scrollTo(0, window.innerHeight * 1.6));
await page.waitForTimeout(1000);
const dTight2 = await read();
const viewBox = await page.evaluate(() => document.querySelector('.wm--hero .wm__svg').getAttribute('viewBox'));
await page.close();

console.log('Строки контуров сняты с живой страницы (хиро, атрибут d).');
console.log(`  прогресс 0   длина d ${dOpen.length}`);
console.log(`  прогресс 1   длина d ${dTight.length}   ${dTight === dTight2 ? 'дальше не меняется — упор достигнут' : 'ВНИМАНИЕ: ещё меняется'}`);
const seq = (d) => d.replace(/[^MLQZ]/g, '');
const nums = (d) => d.match(/-?\d[\d.]*/g).length;
console.log(`  последовательность команд ${seq(dOpen) === seq(dTight) ? 'идентична' : 'РАЗОШЛАСЬ'}, ` +
  `чисел ${nums(dOpen)} и ${nums(dTight)}`);
if (seq(dOpen) !== seq(dTight) || nums(dOpen) !== nums(dTight)) fail('топология разошлась');

const [, , vbW, vbH] = viewBox.split(/\s+/).map(Number);
const K = 4;
const W = Math.round(vbW * K);
const H = Math.round(vbH * K);
const rig = await browser.newPage({ viewport: { width: W, height: H } });
await rig.setContent(
  `<body style="margin:0;background:#000"><svg xmlns="http://www.w3.org/2000/svg" id="s"
     width="${W}" height="${H}" viewBox="${viewBox}" preserveAspectRatio="none"><path id="p" fill="#fff"/></svg></body>`,
);
const shot = async (d) => {
  await rig.evaluate((dd) => document.getElementById('p').setAttribute('d', dd), d);
  return PNG.sync.read(await rig.screenshot());
};
const pa = await shot(dOpen);
const pb = await shot(dTight);
await rig.close();
await browser.close();
server.close();

const covA = [];
const covB = [];
for (let x = 0; x < W; x += 1) { covA.push(colInk(pa, x)); covB.push(colInk(pb, x)); }
const gA = letterGroups(covA, Math.max(...covA));
const gB = letterGroups(covB, Math.max(...covB));
const NAMES = ['S', 'P', 'O', 'T', 'I', 'K'];

console.log('\n── УСЛОВИЕ 3: ШИРИНА И ПОЛОЖЕНИЕ КАЖДОЙ ЛИТЕРЫ ────────────────');
console.log('литера   левый край A / B      ширина A / B       расхождение, px');
let maxDx = 0;
if (gA.length !== 6 || gB.length !== 6) fail(`литеры не разделились: ${gA.length} и ${gB.length}`);
else {
  for (let i = 0; i < 6; i += 1) {
    const wA = gA[i][1] - gA[i][0] + 1;
    const wB = gB[i][1] - gB[i][0] + 1;
    const d = Math.max(Math.abs(gA[i][0] - gB[i][0]), Math.abs(wA - wB));
    maxDx = Math.max(maxDx, d);
    console.log(`  ${NAMES[i]}    ${String(gA[i][0]).padStart(6)} /${String(gB[i][0]).padStart(6)}` +
      `   ${String(wA).padStart(6)} /${String(wB).padStart(6)}      ${d}`);
  }
  console.log(`наибольшее расхождение: ${maxDx} px при масштабе ${K} px на единицу`);
  if (maxDx > 1) fail(`литеры разъезжаются на ${maxDx} px`);
}

const rows = [];
const add = (name, a, b, tgt, hard) => {
  const r = a / b;
  const dev = (r / tgt - 1) * 100;
  rows.push({ name, a, b, r, tgt, dev, hard });
  if (hard && Math.abs(dev) > TOL * 100) fail(`${name}: ${dev.toFixed(3)} %`);
};

/** Высота прописной — литера I, прямоугольник: покрытие столбца через неё. */
const capOf = (png, g) => {
  const xs = [];
  for (let x = g[0] + 2; x <= g[1] - 2; x += 1) xs.push(colInk(png, x));
  return median(xs);
};
add('высота прописной (I)', capOf(pa, gA[4]), capOf(pb, gB[4]), R_CAP, true);

/** Горизонтальный штрих — перекладина T у её левого конца. */
const barOf = (png, g) => {
  const span = g[1] - g[0];
  const xs = [];
  for (let x = g[0] + Math.round(span * 0.05); x <= g[0] + Math.round(span * 0.16); x += 1)
    xs.push(colInk(png, x));
  return median(xs);
};
add('горизонт. штрих (перекладина T)', barOf(pa, gA[3]), barOf(pb, gB[3]), R_HOR, true);

/**
 * Вертикальный штрих — горизонтальный срез литеры на заданной доле её высоты.
 *
 * Долю приходится выбирать под литеру: у P на середине высоты чаша ещё
 * не замкнулась и сливается со стойкой в один отрезок, у O на середине
 * два чистых штриха. Срез берётся там, где нужный штрих стоит отдельно.
 */
const stemOf = (png, g, frac, which) => {
  let top = -1, bot = -1;
  for (let y = 0; y < png.height; y += 1) {
    if (rowRuns(png, y, g[0], g[1]).length) { if (top < 0) top = y; bot = y; }
  }
  const runs = rowRuns(png, Math.round(top + (bot - top) * frac), g[0], g[1]);
  const r = which < 0 ? runs[runs.length - 1] : runs[which];
  return r ? r[1] - r[0] + 1 : NaN;
};
add('вертик. штрих I', stemOf(pa, gA[4], 0.5, 0), stemOf(pb, gB[4], 0.5, 0), R_VER, false);
add('вертик. штрих O слева', stemOf(pa, gA[2], 0.5, 0), stemOf(pb, gB[2], 0.5, 0), R_VER, false);
add('вертик. штрих O справа', stemOf(pa, gA[2], 0.5, -1), stemOf(pb, gB[2], 0.5, -1), R_VER, false);
add('вертик. штрих T', stemOf(pa, gA[3], 0.6, 0), stemOf(pb, gB[3], 0.6, 0), R_VER, false);
// у P стойка стоит одна ниже чаши, поэтому срез на 0.85 высоты
add('вертик. штрих P', stemOf(pa, gA[1], 0.85, 0), stemOf(pb, gB[1], 0.85, 0), R_VER, false);
// у K тоже: ниже развилки диагоналей остаётся только стойка
add('вертик. штрих K', stemOf(pa, gA[5], 0.5, 0), stemOf(pb, gB[5], 0.5, 0), R_VER, false);

console.log('\n── УСЛОВИЯ 4, 5, 6: ВЕРТИКАЛЬНАЯ ГЕОМЕТРИЯ ────────────────────');
console.log(''.padEnd(32) + 'раскрытое'.padStart(11) + 'сжатое'.padStart(11) +
  'отношение'.padStart(11) + 'цель'.padStart(9) + 'отклонение'.padStart(13));
for (const r of rows) {
  console.log(
    `${r.name.padEnd(32)} ${r.a.toFixed(2).padStart(10)} ${r.b.toFixed(2).padStart(10)} ` +
      `${r.r.toFixed(4).padStart(10)} ${r.tgt.toFixed(3).padStart(8)} ` +
      `${(r.dev >= 0 ? '+' : '') + r.dev.toFixed(3)} %`.padStart(12) +
      (r.hard ? (Math.abs(r.dev) <= TOL * 100 ? '  в допуске' : '  ВНЕ ДОПУСКА') : ''),
  );
}

const ink = { left: gA[0][0], right: gA[5][1] };
console.log(`\nширина чернил: раскрытое ${ink.right - ink.left + 1} px, ` +
  `сжатое ${gB[5][1] - gB[0][0] + 1} px при масштабе ${K}`);

writeFileSync('.shots/morph-raster.json', JSON.stringify({ partA, rows }, null, 2));
console.log(failed ? `\nПРОВАЛ: ${failed} проверок не прошло` : '\nВсе жёсткие условия выполнены.');
process.exit(failed ? 1 : 0);

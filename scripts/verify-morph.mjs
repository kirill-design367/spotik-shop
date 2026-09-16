/**
 * ПРОВЕРКА КОЭФФИЦИЕНТОВ МОРФА ПО РАСТРУ.
 *
 * Аналитический расчёт в шрифтовых единицах — это ещё не доказательство:
 * между ним и экраном лежит растеризатор. Здесь измеряется то, что реально
 * нарисовано пикселями.
 *
 * КАК ЭТО УСТРОЕНО
 * 1. Обе строки контуров берутся НЕ из исходников, а с живой страницы:
 *    атрибут d пути в хиро читается при прогрессе 0 и при прогрессе 1.
 *    Значит проверяется ровно то, что видит человек.
 * 2. Каждое измерение — отдельный снимок окна вокруг нужной детали.
 *    Оба состояния снимаются в окне ОДНОГО размера и с ОДНИМ масштабом,
 *    иначе сравнивать нечего.
 * 3. Толщина считается не порогом, а суммой покрытия: сглаженный край даёт
 *    дробную альфу, и сумма альфы вдоль столбца — это длина штриха
 *    с субпиксельной точностью. Порог дал бы ошибку в целый пиксель.
 *
 * Допуск по заданию — ±1 % на каждый коэффициент.
 */
import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';

const PORT = 4183;
const TARGET = { cap: 1.712, hor: 2.833, ver: 1.0, width: 1.0 };
const TOL = 0.01;

/* ── разбор d на контуры ────────────────────────────────────────────────── */

function contours(d) {
  const out = [];
  let cur = null;
  for (const m of d.matchAll(/([MLQZ])([^MLQZ]*)/g)) {
    const cmd = m[1];
    const nums = m[2].trim() ? m[2].trim().split(/\s+/).map(Number) : [];
    if (cmd === 'M') {
      cur = { pts: [], raw: m[0] };
      out.push(cur);
    } else if (cmd === 'Z') {
      cur.raw += 'Z';
      continue;
    } else cur.raw += m[0];
    for (let i = 0; i < nums.length; i += 2) cur.pts.push([nums[i], nums[i + 1]]);
  }
  for (const c of out) {
    const xs = c.pts.map((p) => p[0]);
    const ys = c.pts.map((p) => p[1]);
    c.box = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  }
  return out;
}

/** Контуры, перекрывающиеся по горизонтали, — это одна литера. */
function letters(d) {
  const cs = contours(d).sort((a, b) => a.box.x0 - b.box.x0);
  const groups = [];
  for (const c of cs) {
    const g = groups[groups.length - 1];
    if (g && c.box.x0 <= g.box.x1) {
      g.parts.push(c);
      g.box.x1 = Math.max(g.box.x1, c.box.x1);
      g.box.y0 = Math.min(g.box.y0, c.box.y0);
      g.box.y1 = Math.max(g.box.y1, c.box.y1);
    } else groups.push({ parts: [c], box: { ...c.box } });
  }
  for (const g of groups) g.d = g.parts.map((p) => p.raw).join('');
  return groups;
}

/* ── измерения по пикселям ──────────────────────────────────────────────── */

/** Сумма покрытия вдоль столбца x — длина чернил по вертикали, субпиксельно. */
function colInk(png, x) {
  let s = 0;
  for (let y = 0; y < png.height; y += 1) s += png.data[(png.width * y + x) * 4] / 255;
  return s;
}
function rowInk(png, y) {
  let s = 0;
  for (let x = 0; x < png.width; x += 1) s += png.data[(png.width * y + x) * 4] / 255;
  return s;
}
function median(a) {
  const s = [...a].sort((p, q) => p - q);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}
/** Габарит чернил по x с учётом частичного покрытия крайних столбцов. */
function inkWidth(png) {
  const cov = [];
  for (let x = 0; x < png.width; x += 1) cov.push(colInk(png, x));
  const peak = Math.max(...cov);
  let a = cov.findIndex((v) => v > peak * 0.002);
  let b = cov.length - 1;
  while (b > a && cov[b] <= peak * 0.002) b -= 1;
  return b - a + 1;
}

/* ── прогон ─────────────────────────────────────────────────────────────── */

const server = await serveOut(PORT);
const browser = await launch();

/** Шаг 1. Снять обе строки контуров с живой страницы. */
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(600);

const read = () => page.evaluate(() => document.querySelector('.wm--hero path').getAttribute('d'));
const dOpen = await read();
await page.evaluate(() => window.scrollTo(0, window.innerHeight * 1.2));
await page.waitForTimeout(1400);
const dTight = await read();
await page.evaluate(() => window.scrollTo(0, window.innerHeight * 1.6));
await page.waitForTimeout(1200);
const dTight2 = await read();
await page.close();

console.log('Строки контуров сняты с живой страницы (хиро, атрибут d).');
console.log(`  прогресс 0   длина d ${dOpen.length}`);
console.log(`  прогресс 1   длина d ${dTight.length}   ${dTight === dTight2 ? 'при дальнейшем скролле не меняется — упор достигнут' : 'ВНИМАНИЕ: ещё меняется'}`);
if (dOpen === dTight) throw new Error('состояния совпали — прогресс не доехал');

/** Топология на живой странице: последовательность команд обязана совпасть. */
const seq = (d) => d.replace(/[^MLQZ]/g, '');
const sOpen = seq(dOpen);
const sTight = seq(dTight);
console.log(
  `  последовательность команд: ${sOpen.length} и ${sTight.length} символов, ` +
    (sOpen === sTight ? 'идентична — точки только двигаются' : 'РАЗОШЛАСЬ'),
);
if (sOpen !== sTight) throw new Error('топология разошлась на странице');
const nOpen = dOpen.match(/-?\d[\d.]*/g).length;
const nTight = dTight.match(/-?\d[\d.]*/g).length;
console.log(`  чисел в d: ${nOpen} и ${nTight}${nOpen === nTight ? ' — совпадает' : ' — РАЗОШЛОСЬ'}`);
if (nOpen !== nTight) throw new Error('разное число координат');

const LO = letters(dOpen);
const LT = letters(dTight);
console.log(`  литер найдено: ${LO.length} и ${LT.length}`);
if (LO.length !== 6 || LT.length !== 6) throw new Error('литеры не разделились');

/** Шаг 2. Растровый стенд: одно окно и один масштаб на пару состояний. */
const VIEW_H = 219.29;
const VIEW_Y = -214.27;
const rig = await browser.newPage();
await rig.setContent(
  `<body style="margin:0;background:#000"><svg id="s" xmlns="http://www.w3.org/2000/svg"
     preserveAspectRatio="none"><path id="p" fill="#fff"/></svg></body>`,
);

async function shot(d, win, K) {
  const w = Math.round(win.w * K);
  const h = Math.round(win.h * K);
  await rig.setViewportSize({ width: w, height: h });
  await rig.evaluate(
    ({ d, win, w, h }) => {
      const s = document.getElementById('s');
      s.setAttribute('viewBox', `${win.x} ${win.y} ${win.w} ${win.h}`);
      s.setAttribute('width', w);
      s.setAttribute('height', h);
      document.getElementById('p').setAttribute('d', d);
    },
    { d, win, w, h },
  );
  return PNG.sync.read(await rig.screenshot());
}

/** Окно одного размера для обеих литер: позиция своя, габарит общий. */
function pairWindows(a, b, pad, maxPx) {
  const w = Math.max(a.x1 - a.x0, b.x1 - b.x0) + pad * 2;
  const h = Math.max(a.y1 - a.y0, b.y1 - b.y0) + pad * 2;
  const K = Math.min(maxPx / w, maxPx / h);
  const at = (bx) => ({ x: (bx.x0 + bx.x1) / 2 - w / 2, y: (bx.y0 + bx.y1) / 2 - h / 2, w, h });
  return { wa: at(a), wb: at(b), K };
}

const rows = [];

/* Прописная и вертикальный штрих — по литере I: она прямоугольная,
   её верх и низ это в точности линия прописных и базовая линия. */
{
  const A = LO[4];
  const B = LT[4];
  const { wa, wb, K } = pairWindows(A.box, B.box, 4, 2600);
  const pa = await shot(A.d, wa, K);
  const pb = await shot(B.d, wb, K);
  const caps = (png) => {
    const cov = [];
    for (let x = 0; x < png.width; x += 1) cov.push(colInk(png, x));
    const peak = Math.max(...cov);
    const idx = cov.map((v, i) => (v > peak * 0.98 ? i : -1)).filter((i) => i >= 0);
    return median(idx.map((i) => cov[i]));
  };
  const stems = (png) => {
    const rows = [];
    for (let y = 0; y < png.height; y += 1) {
      const v = rowInk(png, y);
      if (v > 0) rows.push({ y, v });
    }
    const mid = rows.slice(Math.floor(rows.length * 0.2), Math.floor(rows.length * 0.8));
    return median(mid.map((r) => r.v));
  };
  const capA = caps(pa) / K;
  const capB = caps(pb) / K;
  const verA = stems(pa) / K;
  const verB = stems(pb) / K;
  rows.push({ name: 'высота прописной (литера I)', a: capA, b: capB, r: capA / capB, t: TARGET.cap, K });
  rows.push({ name: 'вертикальный штрих (стойка I)', a: verA, b: verB, r: verA / verB, t: TARGET.ver, K });
}

/* Горизонтальный штрих — перекладина T, столбец у её левого конца:
   там кроме перекладины ничего нет. */
{
  const A = LO[3];
  const B = LT[3];
  const { wa, wb, K } = pairWindows(A.box, B.box, 4, 2600);
  const pa = await shot(A.d, wa, K);
  const pb = await shot(B.d, wb, K);
  const bar = (png) => {
    const cov = [];
    for (let x = 0; x < png.width; x += 1) cov.push(colInk(png, x));
    const peak = Math.max(...cov);
    const first = cov.findIndex((v) => v > peak * 0.002);
    let last = cov.length - 1;
    while (last > first && cov[last] <= peak * 0.002) last -= 1;
    const span = last - first;
    const from = first + Math.round(span * 0.06);
    const to = first + Math.round(span * 0.18);
    const s = [];
    for (let x = from; x <= to; x += 1) s.push(cov[x]);
    return median(s);
  };
  const horA = bar(pa) / K;
  const horB = bar(pb) / K;
  rows.push({ name: 'горизонтальный штрих (перекладина T)', a: horA, b: horB, r: horA / horB, t: TARGET.hor, K });
}

/* Ширина слова целиком. */
{
  const K = 3;
  const win = { x: 0, y: VIEW_Y, w: 1000, h: VIEW_H };
  const pa = await shot(dOpen, win, K);
  const pb = await shot(dTight, win, K);
  const wA = inkWidth(pa) / K;
  const wB = inkWidth(pb) / K;
  rows.push({ name: 'ширина слова', a: wA, b: wB, r: wB / wA, t: TARGET.width, K });
}

await rig.close();
await browser.close();
server.close();

/* ── вывод ──────────────────────────────────────────────────────────────── */

console.log('\nИзмерено по пикселям. Единицы — нормированные единицы контура');
console.log('(ширина слова = 1000). Для ширины отношение считается сжатое/раскрытое,');
console.log('для остального раскрытое/сжатое — как в задании.\n');
const pad = (s, n) => String(s).padEnd(n);
const num = (v, n = 8) => String(v.toFixed(3)).padStart(n);
console.log(
  pad('', 38) + pad('раскрытое', 11) + pad('сжатое', 11) + pad('отношение', 11) + pad('цель', 9) + 'отклонение',
);
let ok = true;
for (const r of rows) {
  const dev = (r.r / r.t - 1) * 100;
  const pass = Math.abs(dev) <= TOL * 100;
  if (!pass) ok = false;
  console.log(
    pad(r.name, 38) +
      num(r.a) +
      '  ' +
      num(r.b) +
      '  ' +
      num(r.r) +
      '  ' +
      String(r.t.toFixed(3)).padStart(6) +
      '   ' +
      (dev >= 0 ? '+' : '') +
      dev.toFixed(3) +
      ' %  ' +
      (pass ? 'в допуске' : 'ВНЕ ДОПУСКА'),
  );
}
console.log(`\nмасштабы съёмки: ${rows.map((r) => r.K.toFixed(1)).join(', ')} пикселя на единицу`);
console.log(ok ? 'Все четыре коэффициента внутри ±1 %.' : 'ЕСТЬ ВЫХОД ЗА ДОПУСК.');
writeFileSync('.shots/morph-raster.json', JSON.stringify(rows, null, 2));
// Ненулевой код возврата обязателен: скрипт стоит в CI сторожем закона.
process.exit(ok ? 0 : 1);

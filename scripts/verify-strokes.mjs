/**
 * ПРОВЕРКА ПРИЁМА ПО ПИКСЕЛЯМ.
 *
 * Арт-директор разобрал референс покадрово. Здесь мы замеряем СВОЙ результат
 * тем же способом: растрируем вордмарк в раскрытом и сжатом состоянии теми же
 * осями, что стоят на живой странице, и считаем по картинке фактические
 * высоту прописных и толщины штрихов. Декларации не годятся — нужны числа.
 *
 * Слово рендерится отдельно и целиком (на живой странице оно обрезано краями
 * экрана, и крайние литеры не померить). Оси, кегль и ширина берутся из той же
 * математики lib/wordmark.ts, поэтому замер относится именно к боевому кадру.
 *
 * Что меряем:
 *   I — прямоугольная литера: её высота = высота прописной,
 *       её ширина = толщина ВЕРТИКАЛЬНОГО штриха;
 *   T — вертикальный срез через левый вылет перекладины, где нет стойки:
 *       высота чернил = толщина ГОРИЗОНТАЛЬНОГО штриха.
 */
import { launch } from './browser.mjs';
import { serveOut } from './serve-out.mjs';
import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';

const font = readFileSync('public/fonts/spotik-wordmark.woff2').toString('base64');
// Меряем ту же выдачу, что уходит в публикацию, а не сервер разработки.
const site = await serveOut(4188, { gzip: false });
const URL = process.env.SHOT_URL || site.url;

const browser = await launch();

// ── 1. снимаем боевые параметры кадра прямо с живой страницы
const live = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await live.goto(URL, { waitUntil: 'networkidle' });
await live.evaluate(() => document.fonts.ready);
await live.waitForTimeout(800);
const states = [];
for (const [p, tag] of [[0, 'раскрыт'], [1, 'сжат']]) {
  await live.evaluate((f) => window.scrollTo(0, window.innerHeight * f), p);
  await live.waitForTimeout(800);
  states.push(
    await live.evaluate((t) => {
      const el = document.querySelector('.wm--hero .wm__text');
      const cs = getComputedStyle(el);
      return {
        tag: t,
        fontSize: parseFloat(cs.fontSize),
        axes: cs.fontVariationSettings,
        letterSpacing: cs.letterSpacing,
        width: el.getBoundingClientRect().width,
        vw: window.innerWidth,
      };
    }, tag),
  );
}
await live.close();

// ── 2. рендерим то же слово целиком и считаем пиксели
const page = await browser.newPage({ viewport: { width: 4000, height: 1600 } });

async function metrics(st) {
  await page.setContent(`<!doctype html><meta charset=utf-8><style>
@font-face{font-family:WM;src:url(data:font/woff2;base64,${font}) format('woff2-variations');
 font-weight:100 1000;font-stretch:25% 151%;font-display:block}
html,body{margin:0;background:#000}
#w{position:absolute;left:40px;top:40px;white-space:pre;font-family:WM;line-height:1;
   color:#fff;font-synthesis:none;display:inline-block;
   font-size:${st.fontSize}px;letter-spacing:${st.letterSpacing};
   font-variation-settings:${st.axes}}
</style><span id="w">SPOTIK</span>`);
  await page.evaluate(() => document.fonts.ready);
  const box = await page.evaluate(() => {
    const r = document.getElementById('w').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const clipH = Math.min(1600, Math.ceil(box.y + box.h + 40));
  const buf = await page.screenshot({
    clip: { x: 0, y: 0, width: Math.min(4000, Math.ceil(box.x + box.w + 40)), height: clipH },
  });
  const { width, height, data } = PNG.sync.read(buf);
  const ink = (x, y) =>
    x >= 0 && y >= 0 && x < width && y < height && data[(y * width + x) * 4] > 128;

  // вертикальные проекции: где есть чернила по колонкам
  const cols = new Uint8Array(width);
  for (let x = 0; x < width; x += 1)
    for (let y = 0; y < height; y += 1)
      if (ink(x, y)) { cols[x] = 1; break; }

  // режем на литеры по пустым промежуткам
  const letters = [];
  let s = -1;
  for (let x = 0; x <= width; x += 1) {
    if (x < width && cols[x] && s < 0) s = x;
    if ((x === width || !cols[x]) && s >= 0) { letters.push([s, x - 1]); s = -1; }
  }
  if (letters.length !== 6) throw new Error('литер найдено ' + letters.length + ', ожидалось 6');

  const colInk = (x) => {
    let top = -1, bot = -1;
    for (let y = 0; y < height; y += 1) if (ink(x, y)) { if (top < 0) top = y; bot = y; }
    return top < 0 ? null : { top, bot, h: bot - top + 1 };
  };

  // I — пятая литера
  const [ia, ib] = letters[4];
  const iMid = colInk(Math.round((ia + ib) / 2));
  const capH = iMid.h;
  const vert = ib - ia + 1;

  // T — четвёртая литера, срез по левому вылету перекладины
  const [ta, tb] = letters[3];
  const tCol = colInk(Math.round(ta + (tb - ta) * 0.08));
  const horiz = tCol.h;

  return { capH, vert, horiz, letters: letters.length, fontSize: st.fontSize, width: box.w, vw: st.vw };
}

const out = [];
for (const st of states) {
  const m = await metrics(st);
  out.push({ ...st, ...m });
  console.log(
    `${st.tag.padEnd(9)} кегль ${st.fontSize.toFixed(0).padStart(4)}px   ` +
      `высота прописной ${String(m.capH).padStart(4)}px   ` +
      `горизонталь ${String(m.horiz).padStart(3)}px   ` +
      `вертикаль ${String(m.vert).padStart(3)}px   ` +
      `ширина слова ${m.width.toFixed(0)}px`,
  );
  console.log(`          оси: ${st.axes}`);
}

const [o, t] = out;
console.log('\n── СВЕРКА С ЗАМЕРАМИ РЕФЕРЕНСА (1920×1080) ───────────────────────────');
const row = (name, got, want) => {
  const d = ((got - want) / want) * 100;
  console.log(
    `${name.padEnd(32)} получилось ${got.toFixed(3).padStart(6)}    в референсе ${want.toFixed(3).padStart(6)}    ` +
      `расхождение ${(d >= 0 ? '+' : '') + d.toFixed(1)}%`,
  );
};
row('высота прописной падает в', o.capH / t.capH, 770 / 450);
row('горизонтальный штрих худеет в', o.horiz / t.horiz, 123 / 43);
row('вертикальный штрих меняется в', o.vert / t.vert, 1);
console.log('');
console.log(`высота прописной   ${o.capH} → ${t.capH} px      (референс 770 → 450)`);
console.log(`горизонтальный штрих ${o.horiz} → ${t.horiz} px    (референс 123 → 43)`);
console.log(`вертикальный штрих   ${o.vert} → ${t.vert} px      (референс 48 → 48)`);
console.log(
  `ширина слова       ${o.width.toFixed(0)} → ${t.width.toFixed(0)} px при экране ${o.vw} px — ` +
    `вылет ${(o.width / o.vw).toFixed(3)} → ${(t.width / t.vw).toFixed(3)}, обрезка сохраняется`,
);
await browser.close();
site.close();

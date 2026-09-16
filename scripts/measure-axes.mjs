/**
 * Замер фактических метрик Roboto Flex в настоящем браузере.
 * Нужен, чтобы константы приёма стояли на измерении, а не на глаз.
 */
import { launch } from './browser.mjs';
import { readFileSync } from 'node:fs';

const font = readFileSync('public/fonts/spotik-wordmark.woff2').toString('base64');

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.setContent(`<!doctype html><meta charset=utf-8><style>
@font-face{font-family:WM;src:url(data:font/woff2;base64,${font}) format('woff2-variations');
 font-weight:100 1000;font-stretch:25% 151%;font-display:block}
body{margin:0;background:#000}
#p{position:absolute;left:0;top:0;white-space:pre;font-family:WM;font-size:200px;line-height:1;
   font-synthesis:none;color:#fff;display:inline-block}
</style><span id="p">SPOTIK</span>`);
await page.evaluate(() => document.fonts.ready);

const data = await page.evaluate(() => {
  const p = document.getElementById('p');
  const S = 200;
  const set = (o) => {
    p.style.fontVariationSettings = Object.entries(o)
      .map(([k, v]) => `'${k}' ${v}`).join(',');
    return p.getBoundingClientRect().width / S;
  };
  const out = { byWdth: [], byWght: [] };
  for (let w = 25; w <= 151; w += 3) {
    out.byWdth.push([w, set({ wght: 700, wdth: w, opsz: 144, YTUC: 760, YOPQ: 132, XOPQ: 92, XTRA: 468 })]);
  }
  for (let g = 100; g <= 1000; g += 100) {
    out.byWght.push([g, set({ wght: g, wdth: 25, opsz: 144, YTUC: 760, YOPQ: 132, XOPQ: 92, XTRA: 468 })]);
  }
  // влияние XOPQ/YOPQ на ширину слова
  out.byXopq = [];
  for (let x = 27; x <= 175; x += 20) {
    out.byXopq.push([x, set({ wght: 700, wdth: 25, opsz: 144, YTUC: 760, YOPQ: 132, XOPQ: x, XTRA: 468 })]);
  }
  out.byYtuc = [];
  for (let y = 528; y <= 760; y += 29) {
    out.byYtuc.push([y, set({ wght: 700, wdth: 25, opsz: 144, YTUC: y, YOPQ: 132, XOPQ: 92, XTRA: 468 })]);
  }
  return out;
});

const f = (a) => a.map(([k, v]) => `${k}:${v.toFixed(4)}`).join('  ');
console.log('ширина слова SPOTIK в em при разных wdth (wght700 YTUC760):');
console.log(' ', f(data.byWdth));
console.log('\nпри разных wght (wdth25):');
console.log(' ', f(data.byWght));
console.log('\nпри разных XOPQ (толщина вертикалей, wdth25):');
console.log(' ', f(data.byXopq));
console.log('\nпри разных YTUC (высота прописных, wdth25):');
console.log(' ', f(data.byYtuc));

// геометрия композиции
const OVER = 1.16;
console.log('\nчто получается на эталонных размерах при OVERSCAN=1.16:');
for (const [vw, vh] of [[390, 844], [1920, 1080], [2560, 1440]]) {
  for (const wdth of [25, 34, 46, 60]) {
    const em = data.byWdth.find(([w]) => w >= wdth)[1];
    const fs = (vw * OVER) / em;
    const cap = fs * 0.76;
    console.log(`  ${vw}x${vh}  wdth=${String(wdth).padStart(3)}  кегль=${fs.toFixed(0).padStart(4)}px  высота прописной=${cap.toFixed(0).padStart(4)}px  (${(cap / vh * 100).toFixed(0)}% высоты экрана)  ширина литеры=${(vw * OVER / 6).toFixed(0)}px`);
  }
}
await browser.close();

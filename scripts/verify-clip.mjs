/**
 * ПРОВЕРКА, ЧТО СЛОВО НЕ СРЕЗАНО НИ СВЕРХУ, НИ СНИЗУ.
 *
 * Признак срезки однозначный: у круглых литер (S, O) низ выходит НИЖЕ
 * базовой линии — это свес, он есть в любом шрифте. У прямоугольных I и T
 * низ лежит ровно на базовой линии. Если слой обрезает содержимое, свес
 * исчезает и низы выстраиваются по одной горизонтали.
 *
 * Считать «сколько должно быть» из константы нельзя: пропорция слоя теперь
 * зависит от окна. Поэтому ожидаемое берётся из САМОЙ ЖЕ страницы — в тот же
 * SVG временно кладутся пути отдельных литер и снимаются их
 * getBoundingClientRect. Это геометрия, а не растр. Потом то же самое
 * меряется по пикселям, и два числа сверяются.
 *
 * История вопроса в CLAUDE.md, Р-16: резала пара причин — contain: paint
 * вместе с высотой слоя, посчитанной до базовой линии. Обе устранены,
 * этот скрипт стоит сторожем, чтобы они не вернулись.
 */
import { PNG } from 'pngjs';
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';

const PORT = 4185;
const SIZES = [
  { w: 390, h: 844, mobile: true },
  { w: 1920, h: 1080, mobile: false },
  { w: 2560, h: 1440, mobile: false },
];

const server = await serveOut(PORT);
const browser = await launch();
let failed = 0;

console.log('Низ литеры O обязан лежать НИЖЕ низа литеры I: это свес круглой формы.');
console.log('Ожидаемое берётся из геометрии страницы, измеренное — из пикселей.\n');

for (const s of SIZES) {
  const page = await browser.newPage({
    viewport: { width: s.w, height: s.h },
    isMobile: s.mobile,
    hasTouch: s.mobile,
    deviceScaleFactor: 1,
  });
  await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('.hero__stage[data-entered]');
  await page.waitForTimeout(300);

  const info = await page.evaluate(() => {
    // литеры уже разложены по группам, искать их в строке d не нужно
    const wrap = document.querySelector('.wm--hero');
    const svg = wrap.querySelector('.wm__svg');
    const letters = [...wrap.querySelectorAll('.wm__letter')].map((g) => {
      const r = g.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    });
    const sr = svg.getBoundingClientRect();
    return {
      letters,
      svgTop: sr.top,
      svgBottom: sr.bottom,
      svgHeight: sr.height,
      contain: getComputedStyle(wrap).contain,
    };
  });

  const png = PNG.sync.read(await page.screenshot());
  const isInk = (x, y) => {
    const i = (png.width * y + x) * 4;
    const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
    return g > 90 && g - r > 40 && g - b > 40;
  };
  const yTop = Math.max(0, Math.floor(info.svgTop) - 4);
  const yBot = Math.min(png.height - 1, Math.ceil(info.svgBottom) + 6);
  const lowest = (L) => {
    const from = Math.max(0, Math.ceil(L.left + (L.right - L.left) * 0.33));
    const to = Math.min(png.width - 1, Math.floor(L.left + (L.right - L.left) * 0.67));
    let best = -1;
    for (let x = from; x <= to; x += 1)
      for (let y = yBot; y >= yTop; y -= 1) if (isInk(x, y)) { if (y > best) best = y; break; }
    return best;
  };

  const names = ['S', 'P', 'O', 'T', 'I', 'K'];
  const O = info.letters[2];
  const I = info.letters[4];
  const measured = lowest(O) - lowest(I);
  const expected = O.bottom - I.bottom;
  const ok = measured > 0 && Math.abs(measured - expected) <= Math.max(1.5, expected * 0.2);
  if (!ok) failed += 1;

  console.log(`${s.w}×${s.h}`);
  console.log(`  contain на слое: ${info.contain}; высота слоя ${info.svgHeight.toFixed(1)} px`);
  console.log(`  нижняя строка чернил: ${names.map((n, i) => `${n}:${String(lowest(info.letters[i])).padStart(5)}`).join('  ')}`);
  console.log(`  низ O − низ I: по пикселям ${measured.toFixed(1)} px, по геометрии ${expected.toFixed(1)} px  ` +
    (ok ? '— свес на месте, срезки нет' : '— РАСХОЖДЕНИЕ'));

  await page.close();
}

await browser.close();
server.close();
console.log(failed ? `\nСРЕЗКА: ${failed} размер(ов) не прошло` : '\nСрезки нет ни на одном размере.');
process.exit(failed ? 1 : 0);

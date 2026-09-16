/**
 * ПРОВЕРКА, ЧТО БУКВЫ БОЛЬШЕ НЕ СРЕЗАНЫ СНИЗУ.
 *
 * Признак срезки однозначный: у круглых литер (S, O) низ должен выходить
 * НИЖЕ базовой линии — это свес, он есть в любом шрифте. У прямоугольной I
 * низ лежит ровно на базовой линии. Если слой обрезает содержимое, свес
 * исчезает и низы всех литер выстраиваются по одной горизонтали.
 *
 * Поэтому здесь по растру живой страницы сравниваются нижние края O и I.
 * Разница должна быть равна расчётному свесу (5.02 единицы из 219.29 высоты
 * слоя). Ноль означает срезку.
 *
 * Границы литер берутся не на глаз: в тот же SVG временно кладутся пути
 * отдельных литер и снимаются их getBoundingClientRect.
 */
import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';

const PORT = 4185;
const OVERSHOOT_UNITS = 5.02;
const BOX_UNITS = 219.29;

const SIZES = [
  { w: 390, h: 844, mobile: true },
  { w: 1920, h: 1080, mobile: false },
  { w: 2560, h: 1440, mobile: false },
];

const server = await serveOut(PORT);
const browser = await launch();
let failed = 0;

console.log('Ожидаемый свес под базовой линией — 5.02 из 219.29 высоты слоя, то есть 2.29 %.');
console.log('Ноль разницы между низом O и низом I означал бы срезку.\n');

for (const s of SIZES) {
  const page = await browser.newPage({
    viewport: { width: s.w, height: s.h },
    isMobile: s.mobile,
    hasTouch: s.mobile,
    deviceScaleFactor: 1,
  });
  await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);

  const info = await page.evaluate(() => {
    const svg = document.querySelector('.wm--hero .wm__svg');
    const wrap = document.querySelector('.wm--hero');
    const d = svg.querySelector('path').getAttribute('d');
    const parts = d.split('M').slice(1).map((p) => 'M' + p);
    const box = (p) => {
      const n = p.match(/-?\d[\d.]*/g).map(Number);
      let x0 = Infinity, x1 = -Infinity;
      for (let i = 0; i < n.length; i += 2) { if (n[i] < x0) x0 = n[i]; if (n[i] > x1) x1 = n[i]; }
      return { x0, x1, p };
    };
    const bs = parts.map(box).sort((a, b) => a.x0 - b.x0);
    const g = [];
    for (const b of bs) {
      const last = g[g.length - 1];
      if (last && b.x0 <= last.x1) { last.x1 = Math.max(last.x1, b.x1); last.d += b.p; }
      else g.push({ x0: b.x0, x1: b.x1, d: b.p });
    }
    const rects = g.map((gr) => {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      el.setAttribute('d', gr.d);
      svg.appendChild(el);
      const r = el.getBoundingClientRect();
      el.remove();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    });
    const wr = wrap.getBoundingClientRect();
    const sr = svg.getBoundingClientRect();
    return {
      letters: rects,
      wrapBottom: wr.bottom,
      svgBottom: sr.bottom,
      svgTop: sr.top,
      svgHeight: sr.height,
      contain: getComputedStyle(wrap).contain,
      overflowStage: getComputedStyle(document.querySelector('.hero__stage') || wrap).overflow,
    };
  });

  const png = PNG.sync.read(await page.screenshot());
  /** Маска зелёных чернил вордмарка на тёмном фоне. */
  const ink = (x, y) => {
    const i = (png.width * y + x) * 4;
    const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
    return g > 90 && g - r > 40 && g - b > 40;
  };
  /**
   * Ищем нижнюю строку чернил ТОЛЬКО внутри слоя вордмарка: ниже по экрану
   * есть зелёная кнопка, и без этой границы замер поймал бы её.
   */
  const yTop = Math.max(0, Math.floor(info.svgTop));
  const yBot = Math.min(png.height - 1, Math.ceil(info.svgBottom) + 6);
  const lowest = (l, r) => {
    const from = Math.max(0, Math.ceil(l));
    const to = Math.min(png.width - 1, Math.floor(r));
    let best = -1;
    for (let x = from; x <= to; x += 1)
      for (let y = yBot; y >= yTop; y -= 1)
        if (ink(x, y)) { if (y > best) best = y; break; }
    return best;
  };

  const names = ['S', 'P', 'O', 'T', 'I', 'K'];
  const idxO = 2;
  const idxI = 4;
  const O = info.letters[idxO];
  const I = info.letters[idxI];
  // берём серединную треть литеры: края уходят за вьюпорт у крайних букв
  const mid = (L) => ({ l: L.left + (L.right - L.left) * 0.33, r: L.left + (L.right - L.left) * 0.67 });
  const bO = lowest(mid(O).l, mid(O).r);
  const bI = lowest(mid(I).l, mid(I).r);
  const expected = (OVERSHOOT_UNITS / BOX_UNITS) * info.svgHeight;

  const good = Math.abs(bO - bI - expected) <= Math.max(1.5, expected * 0.12);
  if (!good) failed += 1;

  const rows = names.map((n, i) => {
    const L = info.letters[i];
    const m = mid(L);
    return `${n}:${String(lowest(m.l, m.r)).padStart(5)}`;
  });

  console.log(`${s.w}×${s.h}`);
  console.log(`  contain на слое: ${info.contain} | overflow у .hero__stage: ${info.overflowStage}`);
  console.log(`  высота слоя ${info.svgHeight.toFixed(1)} px, низ слоя на y=${info.svgBottom.toFixed(1)}`);
  console.log(`  нижняя строка чернил по литерам: ${rows.join('  ')}`);
  console.log(
    `  низ O − низ I = ${(bO - bI).toFixed(1)} px, ожидалось ${expected.toFixed(1)} px  ` +
      (good ? '— свес на месте, срезки нет' : '— РАСХОЖДЕНИЕ'),
  );

  await page.screenshot({ path: `.shots/clip-after-${s.w}x${s.h}.png` });
  await page.close();
}

await browser.close();
server.close();
// Скрипт стоит в CI сторожем закона: провал обязан валить сборку.
console.log(failed ? `\nСРЕЗКА ВЕРНУЛАСЬ: ${failed} размер(ов) не прошло` : '\nСрезки нет ни на одном размере.');
process.exit(failed ? 0 + failed : 0);

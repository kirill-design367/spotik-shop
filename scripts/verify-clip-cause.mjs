/**
 * ЧТО ИМЕННО РЕЗАЛО БУКВЫ СНИЗУ — ОПЫТ, А НЕ ВЕРСИЯ.
 *
 * Подозреваемых двое, и они работают только вместе:
 *   А) contain: layout paint style на слое — paint обрезает по границам слоя
 *      ровно как overflow: hidden;
 *   Б) высота слоя в прошлой итерации считалась как
 *      --wm-top + --wm-cap, то есть до БАЗОВОЙ ЛИНИИ, без свеса круглых
 *      литер. Нижняя граница слоя приходилась точно на базовую линию.
 *
 * Поодиночке ни один не даёт видимой срезки: без paint слой ничего не режет,
 * а без урезанной высоты резать нечего. Проверяется прямым опытом: на живой
 * странице включаются все четыре сочетания и каждый раз замеряется свес
 * литеры O под базовой линией (низ O минус низ I).
 */
import { PNG } from 'pngjs';
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';

const PORT = 4186;
const server = await serveOut(PORT);
const browser = await launch();

for (const size of [{ w: 390, h: 844, m: true }, { w: 1920, h: 1080, m: false }, { w: 2560, h: 1440, m: false }]) {
  const page = await browser.newPage({
    viewport: { width: size.w, height: size.h },
    isMobile: size.m,
    hasTouch: size.m,
    deviceScaleFactor: 1,
  });
  await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);

  console.log(`\n${size.w}×${size.h}`);
  for (const mode of [
    { label: 'как отгружено', paint: false, shortHeight: false },
    { label: 'вернуть contain: paint', paint: true, shortHeight: false },
    { label: 'вернуть высоту по базовой линии', paint: false, shortHeight: true },
    { label: 'вернуть и то и другое (как было)', paint: true, shortHeight: true },
  ]) {
    const geo = await page.evaluate((m) => {
      const wrap = document.querySelector('.wm--hero');
      const svg = wrap.querySelector('.wm__svg');
      // Высоту, которую поставил JS, надо запомнить: обнулять её нельзя,
      // иначе слой схлопнется в ноль и опыт будет уже про другое.
      if (!wrap.dataset.fullH) wrap.dataset.fullH = wrap.style.height;
      const cs = getComputedStyle(wrap);
      const band = parseFloat(cs.getPropertyValue('--wm-top')) || 0;
      const cap = parseFloat(cs.getPropertyValue('--wm-cap')) || 0;
      wrap.style.contain = m.paint ? 'layout paint style' : 'layout style';
      wrap.style.height = m.shortHeight ? `${(band + cap).toFixed(1)}px` : wrap.dataset.fullH;
      const d = svg.querySelector('path').getAttribute('d');
      const parts = d.split('M').slice(1).map((p) => 'M' + p);
      const bs = parts
        .map((p) => {
          const n = p.match(/-?\d[\d.]*/g).map(Number);
          let x0 = Infinity, x1 = -Infinity;
          for (let i = 0; i < n.length; i += 2) { if (n[i] < x0) x0 = n[i]; if (n[i] > x1) x1 = n[i]; }
          return { x0, x1, p };
        })
        .sort((a, b) => a.x0 - b.x0);
      const g = [];
      for (const b of bs) {
        const last = g[g.length - 1];
        if (last && b.x0 <= last.x1) { last.x1 = Math.max(last.x1, b.x1); last.d += b.p; }
        else g.push({ x0: b.x0, x1: b.x1, d: b.p });
      }
      const rect = (dd) => {
        const el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        el.setAttribute('d', dd);
        svg.appendChild(el);
        const r = el.getBoundingClientRect();
        el.remove();
        return { left: r.left, right: r.right };
      };
      const sr = svg.getBoundingClientRect();
      const wr = wrap.getBoundingClientRect();
      return {
        O: rect(g[2].d), I: rect(g[4].d), top: sr.top, bottom: sr.bottom,
        wrapBottom: wr.bottom, wrapH: wr.height, svgBottom: sr.bottom,
      };
    }, mode);

    const png = PNG.sync.read(await page.screenshot());
    const ink = (x, y) => {
      const i = (png.width * y + x) * 4;
      const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
      return g > 90 && g - r > 40 && g - b > 40;
    };
    const yTop = Math.max(0, Math.floor(geo.top));
    const yBot = Math.min(png.height - 1, Math.ceil(geo.bottom) + 6);
    const lowest = (L) => {
      const from = Math.max(0, Math.ceil(L.left + (L.right - L.left) * 0.33));
      const to = Math.min(png.width - 1, Math.floor(L.left + (L.right - L.left) * 0.67));
      let best = -1;
      for (let x = from; x <= to; x += 1)
        for (let y = yBot; y >= yTop; y -= 1) if (ink(x, y)) { if (y > best) best = y; break; }
      return best;
    };
    const bO = lowest(geo.O);
    const bI = lowest(geo.I);
    const over = bO - bI;
    const verdict = bO < 0 || bI < 0 ? 'ЧЕРНИЛ НЕТ ВОВСЕ' : over > 0 ? 'цел' : 'СРЕЗАН';
    console.log(
      `  ${mode.label.padEnd(34)} высота слоя ${geo.wrapH.toFixed(0).padStart(4)} px, ` +
        `низ слоя y=${geo.wrapBottom.toFixed(0).padStart(4)}, низ чернил y=${geo.svgBottom.toFixed(0).padStart(4)}, ` +
        `свес O ${String(over).padStart(3)} px  ${verdict}`,
    );
  }
  await page.close();
}

await browser.close();
server.close();

/**
 * Кадры футера для отчёта: четыре состояния хода на двух размерах.
 * Снимается с собранной выдачи по боевому пути, как и все прочие проверки.
 */
import { mkdir } from 'node:fs/promises';
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';

const PORT = 4189;
const server = await serveOut(PORT);
await mkdir('.shots/footer', { recursive: true });
const browser = await launch();

const SIZES = [['390x844', 390, 844, true], ['1920x1080', 1920, 1080, false]];
// доля хода морфа; для «раскрыто с текстом» ждём выезд текста
const SPOTS = [
  ['1-начало-раскрытия', 0, 260],
  ['2-середина', 0.5, 260],
  ['3-раскрыто-без-текста', 0.985, 260],
  ['4-раскрыто-с-текстом', 1, 900],
];

for (const [sname, w, h, mob] of SIZES) {
  const page = await browser.newPage({
    viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob,
    deviceScaleFactor: mob ? 2 : 1,
  });
  await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('.hero__stage[data-entered]');
  for (const [name, f, wait] of SPOTS) {
    const state = await page.evaluate((frac) => {
      const el = document.getElementById('footer');
      const top = Math.ceil(el.getBoundingClientRect().top + window.scrollY);
      window.scrollTo(0, top + Math.round(window.innerHeight * 0.55) * frac);
      return 0;
    }, f);
    await page.waitForTimeout(wait);
    const info = await page.evaluate(() => {
      const r = [...document.querySelectorAll('.wm--footer .wm__letter path')]
        .map((p) => p.getBoundingClientRect());
      const cs = getComputedStyle(document.querySelector('.footer__body'));
      return {
        ink: (Math.max(...r.map((b) => b.bottom)) - Math.min(...r.map((b) => b.top))).toFixed(1),
        open: document.querySelector('.footer__stage').dataset.open,
        vis: cs.visibility,
      };
    });
    await page.screenshot({ path: `.shots/footer/${sname}-${name}.png` });
    console.log('%s  %s  чернила %s px, data-open=%s, текст %s',
      sname.padEnd(10), name.padEnd(24), info.ink.padStart(6), info.open, info.vis);
  }
  await page.close();
}
await browser.close();
server.close();

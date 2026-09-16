/** Скриншоты эталонных размеров + проверка на горизонтальный скролл. */
import { launch } from './browser.mjs';

const URL = process.env.SHOT_URL || 'http://localhost:3000/';
const SIZES = [
  ['mobile', 390, 844, 3],
  ['desktop', 1920, 1080, 1],
  ['wide', 2560, 1440, 1],
];
const SCROLLS = (process.env.SHOT_SCROLL || '0').split(',').map(Number);
const TAG = process.env.SHOT_TAG || '';

const browser = await launch();
for (const [name, w, h, dpr] of SIZES) {
  const page = await browser.newPage({
    viewport: { width: w, height: h },
    deviceScaleFactor: dpr > 1 ? 2 : 1,
    isMobile: name === 'mobile',
    hasTouch: name === 'mobile',
  });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);

  for (const s of SCROLLS) {
    if (s > 0) {
      await page.evaluate((frac) => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo(0, max * frac);
      }, s);
      await page.waitForTimeout(700);
    }
    await page.screenshot({ path: `.shots/${TAG}${name}-${s}.png` });
  }

  const diag = await page.evaluate(() => ({
    docW: document.documentElement.scrollWidth,
    winW: window.innerWidth,
    docH: document.documentElement.scrollHeight,
    wm: (() => {
      const t = document.querySelector(".wm--hero .wm__text");
      if (!t) return null;
      const r = t.getBoundingClientRect();
      return {
        w: +r.width.toFixed(1),
        fontSize: getComputedStyle(t).fontSize,
        axes: getComputedStyle(t).fontVariationSettings,
        left: +r.left.toFixed(1),
        right: +r.right.toFixed(1),
      };
    })(),
  }));
  const overflow = diag.docW > diag.winW + 1;
  console.log(
    `${name.padEnd(8)} ${w}x${h}  документ:${diag.docW} окно:${diag.winW} ` +
      `${overflow ? '!!! ГОРИЗОНТАЛЬНЫЙ СКРОЛЛ' : 'скролла по X нет'}  высота:${diag.docH}`,
  );
  if (diag.wm) {
    console.log(
      `         вордмарк: ширина ${diag.wm.w}px (экран ${w}px, вылет ${(diag.wm.w / w).toFixed(3)}x), ` +
        `кегль ${diag.wm.fontSize}, слева ${diag.wm.left}, справа ${diag.wm.right}`,
    );
    console.log(`         оси: ${diag.wm.axes}`);
  }
  if (errors.length) console.log('         ОШИБКИ:', errors.slice(0, 4).join(' | '));
  await page.close();
}
await browser.close();

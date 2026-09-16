/** Кадры прохода хиро: раскрытое → сжатое состояние вордмарка и пробуждение волны. */
import { launch } from './browser.mjs';
const URL = process.env.SHOT_URL || 'http://localhost:3000/';
const [W, H, name] = (process.env.SIZE || '1920x1080x desktop').split('x');
const browser = await launch();
const page = await browser.newPage({
  viewport: { width: +W, height: +H },
  isMobile: +W < 500, hasTouch: +W < 500, deviceScaleFactor: +W < 500 ? 2 : 1,
});
await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(900);
for (const p of [0, 0.25, 0.5, 0.75, 1]) {
  await page.evaluate((f) => window.scrollTo(0, window.innerHeight * f), p);
  await page.waitForTimeout(800);
  const st = await page.evaluate(() => {
    const t = document.querySelector('.wm--hero .wm__text');
    const cs = t ? getComputedStyle(t) : null;
    return { fs: cs?.fontSize, ax: cs?.fontVariationSettings };
  });
  console.log(`прогресс ${p}:  кегль ${st.fs}`);
  console.log(`            ${st.ax}`);
  await page.screenshot({ path: `.shots/hero-${name.trim()}-${p}.png` });
}
await browser.close();

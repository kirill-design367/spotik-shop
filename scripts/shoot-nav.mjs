/** Кадры полосы шапки на четырёх фонах и трёх размерах — .shots/nav/. */
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';
import { mkdirSync } from 'node:fs';

const PORT = 4236;
const OUT = '.shots/nav';
mkdirSync(OUT, { recursive: true });
const server = await serveOut(PORT);
const browser = await launch();

for (const [w, h] of [[390, 844], [1920, 1080]]) {
  const page = await browser.newPage({
    viewport: { width: w, height: h }, isMobile: w < 700, hasTouch: w < 700, deviceScaleFactor: 2,
  });
  await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('.hero__stage[data-entered]');
  await page.waitForTimeout(150);
  const m = await page.evaluate(() => {
    const sc = document.getElementById('scroller');
    const hero = document.getElementById('hero');
    const stage = document.querySelector('.hero__stage');
    const base = sc.getBoundingClientRect().top - sc.scrollTop;
    const heroTop = hero.getBoundingClientRect().top - base;
    return {
      stickEnd: heroTop + hero.offsetHeight - stage.offsetHeight,
      footTop: document.getElementById('footer').getBoundingClientRect().top - base,
      navH: document.querySelector('.nav .nav__row').offsetHeight,
      max: sc.scrollHeight - sc.clientHeight,
    };
  });
  const seg = await page.evaluate(() => {
    const sc = document.getElementById('scroller');
    const base = sc.getBoundingClientRect().top - sc.scrollTop;
    const el = [...document.querySelectorAll('.seg__btn')]
      .find((b) => getComputedStyle(b).backgroundColor === 'rgb(29, 185, 84)');
    return el ? el.getBoundingClientRect().top - base : null;
  });
  const stops = [
    ['1-верх', 0],
    ['2-слово', Math.round(m.stickEnd + m.navH + 260)],
    ['3-блоки', Math.round((m.stickEnd + m.footTop) / 2)],
    ['4-кромка', Math.round(m.footTop - m.navH / 2)],
    ['5-футер', Math.round(m.max)],
  ];
  if (seg != null) stops.push(['6-акцент', Math.round(seg - m.navH * 0.45)]);
  for (const [name, y] of stops) {
    await page.evaluate((v) => { document.getElementById('scroller').scrollTop = v; }, y);
    await page.waitForTimeout(120);
    await page.screenshot({ path: `${OUT}/${w}-${name}.png`, clip: { x: 0, y: 0, width: w, height: m.navH + 24 } });
  }
  await page.close();
  console.log('снято %s', w);
}
await browser.close();
server.close();

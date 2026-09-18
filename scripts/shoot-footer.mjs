/**
 * Кадры футера для отчёта: пять шагов хода на двух размерах.
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
/* Доля хода морфа. Отрицательная — это ПОДХОД: секция ещё едет, сцена
   не прилипла, слово сжато и идёт вверх вместе со страницей. Ноль — тот
   самый кадр, в котором низ чернил пришёл на свою линию и прибился. */
const SPOTS = [
  ['шаг1-подход', -0.6, 300],
  ['шаг2-прилипание', 0, 300],
  ['шаг3-рост', 0.5, 300],
  ['шаг4-остановка', 0.985, 300],
  ['шаг5-футер', 1, 1100],
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
    await page.evaluate((frac) => {
      const el = document.getElementById('footer');
      const top = Math.ceil(el.getBoundingClientRect().top + window.scrollY);
      // подход меряется экранами до прилипания, ход — долями самого хода
      window.scrollTo(0, frac < 0
        ? top + window.innerHeight * frac
        : top + Math.round(window.innerHeight * 0.55) * frac);
    }, f);
    await page.waitForTimeout(wait);
    const info = await page.evaluate(() => {
      const r = [...document.querySelectorAll('.wm--footer .wm__letter path')]
        .map((p) => p.getBoundingClientRect());
      const cs = getComputedStyle(document.querySelector('.footer__body'));
      const fill = document.querySelector('.footer__fill').getBoundingClientRect();
      return {
        ink: (Math.max(...r.map((b) => b.bottom)) - Math.min(...r.map((b) => b.top))).toFixed(1),
        open: document.getElementById('footer').dataset.open,
        vis: cs.visibility,
        // пустая зелёная полоса под словом: низ заливки минус низ чернил
        band: (fill.bottom - Math.max(...r.map((b) => b.bottom))).toFixed(2),
      };
    });
    await page.screenshot({ path: `.shots/footer/${sname}-${name}.png` });
    console.log('%s  %s  чернила %s px, полоса под словом %s px, data-open=%s, текст %s',
      sname.padEnd(10), name.padEnd(17), info.ink.padStart(6),
      info.band.padStart(7), info.open, info.vis);
  }
  await page.close();

  /* И отдельный кадр при «уменьшить движение»: там хода нет вовсе, футер
     сразу стоит в конечном состоянии — поле во весь экран, слово раскрыто,
     реквизиты на месте. Если эта ветка отвалится, на глаз этого не видно
     ни на одном из пяти кадров выше. */
  const rm = await browser.newPage({
    viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob,
    deviceScaleFactor: mob ? 2 : 1, reducedMotion: 'reduce',
  });
  await rm.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
  await rm.evaluate(() => document.fonts.ready);
  await rm.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await rm.waitForTimeout(800);
  const rmi = await rm.evaluate(() => {
    const fill = document.querySelector('.footer__fill').getBoundingClientRect();
    const field = document.querySelector('.footer__field').getBoundingClientRect();
    return {
      open: document.getElementById('footer').dataset.open,
      full: (field.bottom - fill.bottom).toFixed(2),
      vis: getComputedStyle(document.querySelector('.footer__body')).visibility,
    };
  });
  await rm.screenshot({ path: `.shots/footer/${sname}-уменьшенное-движение.png` });
  console.log('%s  %s  поле не доходит до низа сцены на %s px, data-open=%s, текст %s',
    sname.padEnd(10), 'уменьшенное-движение'.padEnd(17), rmi.full.padStart(6), rmi.open, rmi.vis);
  await rm.close();
}
await browser.close();
server.close();

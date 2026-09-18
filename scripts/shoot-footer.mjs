/**
 * Кадры футера для отчёта: подход, три положения роста, остановка и футер
 * с текстом — на двух размерах. Снимается с собранной выдачи по боевому
 * пути, как и все прочие проверки.
 *
 * Положения считаются от САМОГО ХОДА, а не от секции: прилипания нет,
 * ход роста равен разнице раскрытой и сжатой высоты чернил и кончается
 * там, где низ слоя пришёл на линию низа.
 */
import { mkdir, readFile } from 'node:fs/promises';
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';

const SRC = await readFile('lib/wordmark.ts', 'utf8');
const DATA = await readFile('lib/wordmark.data.ts', 'utf8');
const GAP = Number(/FOOTER_BOTTOM_GAP = ([\d.]+)/.exec(SRC)[1]);
const INK_TIGHT = Number(/WM_BOTTOM_TIGHT = ([\d.]+)/.exec(DATA)[1])
  / Number(/WM_BOX_HEIGHT = ([\d.]+)/.exec(DATA)[1]);

const PORT = 4189;
const server = await serveOut(PORT);
await mkdir('.shots/footer', { recursive: true });
const browser = await launch();

const SIZES = [['390x844', 390, 844, true], ['1920x1080', 1920, 1080, false]];
/* Доля хода роста. Отрицательная — ПОДХОД: секция едет, слово сжато,
   его низ ещё за нижним краем экрана. Единица — остановка роста.
   Больше единицы — хвост: страница едет дальше и выносит слово вверх,
   снизу выезжают реквизиты. */
const SPOTS = [
  ['1-подход', -0.7],
  ['2-рост-начало', 0.02],
  ['3-рост-середина', 0.5],
  ['4-рост-конец', 0.98],
  ['5-остановка', 1],
  ['6-футер-с-текстом', 2.6],
];

for (const [sname, w, h, mob] of SIZES) {
  const page = await browser.newPage({
    viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob,
    deviceScaleFactor: mob ? 2 : 1,
  });
  await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('.hero__stage[data-entered]');

  const g = await page.evaluate(() => {
    const l = document.querySelector('.wm--footer').getBoundingClientRect();
    return { bottomDoc: l.bottom + window.scrollY, layerH: l.height, vh: window.innerHeight,
      max: document.documentElement.scrollHeight - window.innerHeight };
  });
  const travel = g.layerH * (1 - INK_TIGHT);
  const end = g.bottomDoc - g.vh + GAP;

  for (const [name, f] of SPOTS) {
    await page.evaluate((v) => window.scrollTo(0, v),
      Math.round(Math.min(g.max, end - travel * (1 - f))));
    await page.waitForTimeout(320);
    const info = await page.evaluate(() => {
      const r = [...document.querySelectorAll('.wm--footer .wm__letter path')]
        .map((p) => p.getBoundingClientRect());
      const text = document.querySelector('.footer__col').getBoundingClientRect();
      return {
        top: Math.min(...r.map((b) => b.top)),
        bottom: Math.max(...r.map((b) => b.bottom)),
        ink: (Math.max(...r.map((b) => b.bottom)) - Math.min(...r.map((b) => b.top))).toFixed(1),
        under: (window.innerHeight - Math.max(...r.map((b) => b.bottom))).toFixed(1),
        text: text.top < window.innerHeight - 0.5 ? 'виден' : 'за краем',
      };
    });
    await page.screenshot({ path: `.shots/footer/${sname}-${name}.png` });
    console.log('%s  %s  верх %s  низ %s  чернила %s px, под словом %s px, текст %s',
      sname.padEnd(10), name.padEnd(18), info.top.toFixed(0).padStart(6),
      info.bottom.toFixed(0).padStart(6), info.ink.padStart(6),
      info.under.padStart(7), info.text);
  }
  await page.close();

  /* И отдельный кадр при «уменьшить движение»: хода там нет вовсе,
     футер сразу стоит раскрытым, реквизиты на месте. */
  const rm = await browser.newPage({
    viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob,
    deviceScaleFactor: mob ? 2 : 1, reducedMotion: 'reduce',
  });
  await rm.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
  await rm.evaluate(() => document.fonts.ready);
  await rm.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await rm.waitForTimeout(800);
  const rmi = await rm.evaluate(() => {
    const r = [...document.querySelectorAll('.wm--footer .wm__letter path')]
      .map((p) => p.getBoundingClientRect());
    const text = document.querySelector('.footer__col').getBoundingClientRect();
    return {
      ink: (Math.max(...r.map((b) => b.bottom)) - Math.min(...r.map((b) => b.top))).toFixed(1),
      text: text.top < window.innerHeight - 0.5 ? 'виден' : 'за краем',
    };
  });
  await rm.screenshot({ path: `.shots/footer/${sname}-уменьшенное-движение.png` });
  console.log('%s  %s  чернила %s px, текст %s',
    sname.padEnd(10), 'уменьшенное-движение'.padEnd(18), rmi.ink.padStart(6), rmi.text);
  await rm.close();
}
await browser.close();
server.close();

/**
 * ПОЛОСА ПРОКРУТКИ СЪЕДАЕТ ОТСТУП СЛОВА.
 *
 * В Chrome `100vw` — это ширина ВЬЮПОРТА ВМЕСТЕ с классической полосой
 * прокрутки, а область содержимого уже примерно на 15 px. Ширина слова
 * задавалась в vw, поэтому на живом экране правый отступ съедался целиком
 * и литера K уезжала под полосу. В headless-браузере полосы нет, и замер
 * этого не показывал.
 *
 * Здесь замер идёт ДВАЖДЫ: как есть и с принудительной классической
 * полосой (`::-webkit-scrollbar` с явной шириной делает полосу
 * НЕ оверлейной, то есть занимающей место в раскладке — ровно как
 * на настоящем десктопе).
 */
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';

const PORT = 4199;
const BAR = 15;
/* Полоса прокрутки теперь принадлежит КОНТЕЙНЕРУ, а не документу:
   документ у нас неподвижен (Р-37). Принуждаем к классической полосе
   именно его. */
const FORCE = `
  .scroller::-webkit-scrollbar { width: ${BAR}px; }
  .scroller::-webkit-scrollbar-thumb { background: #535353; }
  .scroller::-webkit-scrollbar-track { background: #212121; }
`;

let failed = 0;
const server = await serveOut(PORT);
// Playwright в headless по умолчанию передаёт Chromium `--hide-scrollbars`,
// и полосы нет вообще — именно поэтому дефект не воспроизводился в замерах.
// Снимаем этот аргумент: браузер начинает раскладывать настоящую полосу.
const browser = await launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
const rows = [];

for (const [w, h] of [[390, 844], [1920, 1080], [2560, 1440]]) {
  for (const bar of [false, true]) {
    const page = await browser.newPage({
      viewport: { width: w, height: h }, isMobile: w < 700, hasTouch: w < 700,
      deviceScaleFactor: 1,
    });
    await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
    if (bar) await page.addStyleTag({ content: FORCE });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForSelector('.hero__stage[data-entered]');
    await page.waitForTimeout(150);

    const m = await page.evaluate(() => {
      /* Опора замера — область СОДЕРЖИМОГО того, что прокручивается.
         Раньше это был документ; теперь контейнер, и его clientWidth
         как раз и есть ширина без полосы прокрутки. */
      const box = (document.getElementById('scroller') || document.documentElement).clientWidth;
      const ink = (sel) => {
        const ps = [...document.querySelectorAll(`${sel} .wm__letter path`)];
        if (ps.length !== 6) return null;
        const r = ps.map((p) => p.getBoundingClientRect());
        return { l: Math.min(...r.map((b) => b.left)), r: Math.max(...r.map((b) => b.right)) };
      };
      const hero = ink('.wm--hero');
      const f = document.getElementById('footer');
      window.scrollTo(0, document.documentElement.scrollHeight);
      return { box, vw: window.innerWidth, hero, footerTop: f.offsetTop };
    });
    await page.waitForTimeout(700);
    const foot = await page.evaluate(() => {
      const ps = [...document.querySelectorAll('.wm--footer .wm__letter path')];
      const r = ps.map((p) => p.getBoundingClientRect());
      return { l: Math.min(...r.map((b) => b.left)), r: Math.max(...r.map((b) => b.right)) };
    });
    await page.close();

    for (const [name, k] of [['хиро', m.hero], ['футер', foot]]) {
      const left = k.l;
      const right = m.box - k.r;
      rows.push({ w, h, bar, name, box: m.box, vw: m.vw, left, right,
        pl: (left / m.box) * 100, pr: (right / m.box) * 100 });
      if (bar && (right < 0 || Math.abs(left - right) > 1)) failed += 1;
    }
  }
}

console.log('── ОТСТУПЫ СЛОВА ОТ КРАЁВ ОБЛАСТИ СОДЕРЖИМОГО ──────────────────');
console.log('размер      полоса  блок   100vw   слой   слева    справа   слева %  справа %');
for (const r of rows)
  console.log('  %s %s %s %s %s %s %s %s %s',
    String(r.w + '×' + r.h).padEnd(10), (r.bar ? 'есть' : 'нет ').padEnd(6),
    String(r.box).padStart(5), String(r.vw).padStart(6), r.name.padEnd(6),
    r.left.toFixed(2).padStart(7), r.right.toFixed(2).padStart(8),
    r.pl.toFixed(3).padStart(8), r.pr.toFixed(3).padStart(8));

await browser.close();
server.close();
console.log('');
console.log(failed ? `НЕСИММЕТРИЧНО ИЛИ ВЫЛЕЗАЕТ: ${failed}` : 'ОТСТУПЫ СИММЕТРИЧНЫ ПРИ ВИДИМОЙ ПОЛОСЕ');
process.exit(failed ? 1 : 0);

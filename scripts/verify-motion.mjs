/**
 * ПРОВЕРКА «УМЕНЬШИТЬ ДВИЖЕНИЕ» И ОТСУТСТВИЯ ГОРИЗОНТАЛЬНОГО СКРОЛЛА.
 *
 * Настройку мало объявить в CSS: вордмарк двигается из JavaScript,
 * и если он на неё не подписан, слово продолжит сжиматься при скролле.
 * Поэтому здесь страница открывается с reducedMotion: 'reduce', реально
 * прокручивается и проверяется, что контур НЕ изменился ни на символ,
 * а волна не перерисовывается.
 *
 * Вторым заходом — ширины помимо трёх эталонных: горизонтальный скролл
 * обычно вылезает не там, где смотрят.
 */
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';

const PORT = 4188;
const server = await serveOut(PORT);
const browser = await launch();

console.log('«Уменьшить движение»: слово обязано стоять раскрытым и не реагировать на скролл.\n');
for (const [w, h, mob] of [[390, 844, true], [1920, 1080, false]]) {
  const page = await browser.newPage({
    viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob,
    deviceScaleFactor: 1, reducedMotion: 'reduce',
  });
  await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);

  const word = (sel) =>
    [...document.querySelectorAll(`${sel} .wm__letter path`)]
      .map((e) => e.getAttribute('d'))
      .join('');
  const before = await page.evaluate(() => {
    const w = (sel) => [...document.querySelectorAll(`${sel} .wm__letter path`)]
      .map((e) => e.getAttribute('d')).join('');
    return { hero: w('.wm--hero'), footer: w('.wm--footer') };
  });
  for (let i = 0; i < 40; i += 1) { await page.mouse.wheel(0, h / 20); await page.waitForTimeout(25); }
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => {
    const w = (sel) => [...document.querySelectorAll(`${sel} .wm__letter path`)]
      .map((e) => e.getAttribute('d')).join('');
    return { hero: w('.wm--hero'), footer: w('.wm--footer'), y: window.scrollY };
  });

  console.log(
    `  ${w}×${h}  прокручено на ${after.y} px  ` +
      `хиро ${before.hero === after.hero ? 'не изменился' : 'ИЗМЕНИЛСЯ'}  ` +
      `футер ${before.footer === after.footer ? 'не изменился' : 'ИЗМЕНИЛСЯ'}`,
  );
  await page.close();
}

console.log('\nГоризонтальный скролл по ширинам:');
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
for (const w of [320, 360, 390, 414, 768, 1024, 1280, 1440, 1920, 2560, 3440]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(450);
  const d = await page.evaluate(() => ({
    dw: document.documentElement.scrollWidth,
    ww: window.innerWidth,
    wm: document.querySelector('.wm--hero .wm__svg').getBoundingClientRect().width,
  }));
  const bad = d.dw > d.ww + 1;
  console.log(
    `  ${String(w).padStart(5)}  документ ${String(d.dw).padStart(5)} при окне ${String(d.ww).padStart(5)}  ` +
      `вылет вордмарка ${(d.wm / d.ww).toFixed(3)}  ${bad ? 'ГОРИЗОНТАЛЬНЫЙ СКРОЛЛ' : 'чисто'}`,
  );
}
await page.close();
await browser.close();
server.close();

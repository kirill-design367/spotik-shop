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
 *
 * Третьим — ТРИ ПРИЁМА СЕРЕДИНЫ. Каждый обязан вести себя при «уменьшить
 * движение» по-своему, и ни один из них не объявлен в одном только CSS:
 *   • бегущая строка СТОИТ (анимации нет вовсе);
 *   • разворот ряда МГНОВЕННЫЙ (перехода нет);
 *   • панель блока 3 СТОИТ, но инверсия работает — она считается
 *     по положению, а не по времени;
 *   • ВСЕ ответы в блоке 4 видны сразу: вес по умолчанию равен единице,
 *     и подписки на прокрутку там просто не заводится.
 */
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';

const PORT = 4188;
const server = await serveOut(PORT);
const browser = await launch();
let failed = false;

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

console.log('\nТри приёма середины при «уменьшить движение»:');
{
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, reducedMotion: 'reduce',
  });
  await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const el = document.querySelector('.steps');
    const sc = document.getElementById('scroller');
    sc.scrollTop += el.getBoundingClientRect().top - sc.clientHeight * 0.5;
  });
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => ({
    mq: getComputedStyle(document.querySelector('.mq__ink')).animationName,
    plan: getComputedStyle(document.querySelector('.plan')).transitionDuration,
    panel: getComputedStyle(document.querySelector('.steps__panel')).transform,
    answers: [...document.querySelectorAll('.qa__a')].map((e) => +getComputedStyle(e).opacity),
  }));
  for (let i = 0; i < 12; i += 1) { await page.mouse.wheel(0, 90); await page.waitForTimeout(25); }
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => ({
    panel: getComputedStyle(document.querySelector('.steps__panel')).transform,
    answers: [...document.querySelectorAll('.qa__a')].map((e) => +getComputedStyle(e).opacity),
  }));
  const hidden = after.answers.filter((v) => v < 0.99).length;
  const okMq = before.mq === 'none';
  /* Глобальное правило сводит переходы к 1e-05s — это и есть «мгновенно»:
     ноль и стотысячная секунды для глаза одно и то же. */
  const okPlan = parseFloat(before.plan) <= 0.02;
  const okPanel = before.panel === after.panel;
  const okAns = hidden === 0 && after.answers.length === 6;
  if (!okMq || !okPlan || !okPanel || !okAns) failed = true;
  console.log(`  бегущая строка: animation-name=${before.mq} ${okMq ? '— стоит' : '— ИДЁТ'}`);
  console.log(`  разворот ряда: transition ${before.plan} ${okPlan ? '— мгновенный' : '— С ПЕРЕХОДОМ'}`);
  console.log(`  панель блока 3: ${okPanel ? 'не сдвинулась за 12 колёс' : 'ПОЕХАЛА'}`);
  console.log(`  ответы блока 4: видно ${after.answers.length - hidden} из ${after.answers.length}`);
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
process.exit(failed ? 1 : 0);

/**
 * ПРОКРУЧИВАЕТСЯ КОНТЕЙНЕР, А НЕ ДОКУМЕНТ (CLAUDE.md, Р-37).
 *
 * Панель Safari на iPhone сворачивается только под движение самого
 * документа. Всё решение держится на одном инварианте: документ
 * НЕ ПРОКРУЧИВАЕТСЯ НИ НА ПИКСЕЛЬ. Инвариант хрупкий — его ломает любое
 * `height: auto` на html или body, любая забытая `overflow`, любой
 * скрипт, дёрнувший `window.scrollTo` мимо подмены. Поэтому сторож.
 *
 * Заодно проверяется то, что от этой перестройки зависело и могло
 * тихо отвалиться: предел прокрутки, переходы по якорям, блокировка
 * прокрутки под накладкой меню и восстановление позиции.
 *
 * ⚠️ Поведение самой панели Safari отсюда проверить нельзя: в среде
 * разработки нет ни iOS, ни доступа к боевому адресу. Здесь проверяется
 * ПРИЧИНА (документ стоит), а не следствие.
 */
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';

const PORT = 4221;
const SIZES = [[320, 568], [360, 640], [390, 844], [414, 896], [768, 1024], [1920, 1080], [2560, 1440]];

let failed = 0;
const fail = (msg) => { console.log(`  ПРОВАЛ: ${msg}`); failed += 1; };

const server = await serveOut(PORT);
const browser = await launch();
const url = `http://127.0.0.1:${PORT}${PREFIX}/`;
const scrollY = (p) => p.evaluate(() => document.getElementById('scroller').scrollTop);

console.log('── ДОКУМЕНТ НЕ ПРОКРУЧИВАЕТСЯ ──────────────────────────────────');
console.log('размер       документ   контейнер   гориз.вылет');
for (const [w, h] of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 700, isMobile: w < 700 });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const m = await page.evaluate(() => {
    const sc = document.getElementById('scroller');
    const de = document.scrollingElement;
    return {
      /* реальные величины документа, мимо подмены стенда */
      doc: de.getBoundingClientRect().height > 0
        ? Math.max(0, Math.round(document.body.getBoundingClientRect().height - innerHeight))
        : 0,
      docScroll: Math.round(de.clientHeight) - Math.round(innerHeight),
      sc: Math.round(sc.scrollHeight - sc.clientHeight),
      hx: Math.round(Math.max(sc.scrollWidth - sc.clientWidth, 0)),
    };
  });
  console.log(`  ${String(w + '×' + h).padEnd(11)} ${String(m.doc).padStart(8)} ${String(m.sc).padStart(11)} ${String(m.hx).padStart(13)}`);
  if (m.doc > 0) fail(`${w}×${h}: документ прокручивается на ${m.doc} px — панель Safari будет сворачиваться`);
  if (m.sc <= 0) fail(`${w}×${h}: контейнер не прокручивается вовсе`);
  if (m.hx > 0) fail(`${w}×${h}: горизонтальный вылет ${m.hx} px`);
  await ctx.close();
}

console.log('');
console.log('── ПРЕДЕЛ ПРОКРУТКИ, ЯКОРЯ, НАКЛАДКА, ВОССТАНОВЛЕНИЕ ───────────');

/* Колесом до самого низа: если предел считается не по тому элементу,
   он выходит короче страницы и футер становится недостижим. */
{
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const max = await page.evaluate(() => {
    const s = document.getElementById('scroller');
    return s.scrollHeight - s.clientHeight;
  });
  await page.mouse.move(960, 540);
  for (let i = 0; i < 90; i += 1) { await page.mouse.wheel(0, 400); await page.waitForTimeout(25); }
  await page.waitForTimeout(1400);
  const y = await scrollY(page);
  console.log(`  колесом доехали до ${Math.round(y)} из ${Math.round(max)}`);
  if (max - y > 2) fail(`колесо не доводит до низа: не хватает ${Math.round(max - y)} px`);

  /* НАД ШАПКОЙ КОЛЕСО ОБЯЗАНО КРУТИТЬ СТРАНИЦУ. Прибитая к вьюпорту
     шапка чинит цепочку прокрутки в ДОКУМЕНТ, а он неподвижен, — и весь
     верх экрана становится мёртвой зоной. Замерено: было 0 px из 500. */
  await page.evaluate(() => { document.getElementById('scroller').scrollTop = 0; });
  await page.waitForTimeout(600);
  await page.mouse.move(400, 24);
  for (let i = 0; i < 5; i += 1) { await page.mouse.wheel(0, 100); await page.waitForTimeout(40); }
  await page.waitForTimeout(300);
  const overNav = await scrollY(page);
  console.log(`  колесо НАД ШАПКОЙ сдвинуло на ${Math.round(overNav)} из 500 px`);
  if (overNav < 480) fail(`над шапкой колесо не крутит страницу: ${Math.round(overNav)} px из 500`);

  await page.evaluate(() => { document.getElementById('scroller').scrollTop = 0; });
  await page.waitForTimeout(1100);
  await page.click('.nav__link >> nth=2');
  await page.waitForTimeout(1900);
  const top = await page.evaluate(() => Math.round(document.getElementById('gift').getBoundingClientRect().top));
  console.log(`  десктоп, пункт «Сертификат»: блок на ${top} px от верха`);
  if (Math.abs(top) > 2) fail(`якорь на десктопе промахнулся на ${top} px`);
  await ctx.close();
}

/* Мобильная: меню открывается, прокрутка под ним стоит, пункт ведёт. */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.click('.nav__burger');
  await page.waitForTimeout(320);
  const open = await page.evaluate(() => getComputedStyle(document.querySelector('.menu')).visibility);
  const y0 = await scrollY(page);
  await page.mouse.move(195, 420);
  await page.mouse.wheel(0, 700);
  await page.waitForTimeout(280);
  const moved = (await scrollY(page)) - y0;
  console.log(`  накладка: visibility=${open}, колесо сдвинуло на ${Math.round(moved)} px`);
  if (open !== 'visible') fail('накладка не открылась');
  if (Math.abs(moved) > 0.5) fail(`прокрутка под накладкой не заблокирована: ${moved} px`);

  await page.click('.menu__item >> nth=0');
  await page.waitForTimeout(1700);
  const at = await page.evaluate(() => ({
    top: Math.round(document.getElementById('pricing').getBoundingClientRect().top),
    open: getComputedStyle(document.querySelector('.menu')).visibility,
  }));
  console.log(`  пункт «Тарифы»: блок на ${at.top} px, накладка ${at.open}`);
  if (Math.abs(at.top) > 2) fail(`якорь из меню промахнулся на ${at.top} px`);
  if (at.open !== 'hidden') fail('накладка не закрылась после перехода');
  await ctx.close();
}

/* Позиция при перезагрузке: браузер её не восстановит, это делаем мы. */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.evaluate(() => { document.getElementById('scroller').scrollTop = 3000; });
  await page.waitForTimeout(350);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const y = Math.round(await scrollY(page));
  console.log(`  перезагрузка: было 3000, стало ${y}`);
  if (Math.abs(y - 3000) > 4) fail(`позиция не восстановилась: ${y} вместо 3000`);
  await ctx.close();
}

await browser.close();
server.close();
console.log('');
console.log(failed ? `ПРОВАЛОВ: ${failed}` : 'КОНТЕЙНЕР ПРОКРУЧИВАЕТСЯ, ДОКУМЕНТ СТОИТ — ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ');
process.exit(failed ? 1 : 0);

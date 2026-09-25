/**
 * ПРОВЕРКА «УМЕНЬШИТЬ ДВИЖЕНИЕ» И ОТСУТСТВИЯ ГОРИЗОНТАЛЬНОГО СКРОЛЛА.
 *
 * Настройку мало объявить в CSS: вордмарк двигается из JavaScript,
 * и если он на неё не подписан, слово продолжит сжиматься при скролле.
 * Поэтому здесь страница открывается с reducedMotion: 'reduce', реально
 * прокручивается и проверяется, что контур НЕ изменился ни на символ,
 * а карточка не перерисовывается.
 *
 * Вторым заходом — ширины помимо трёх эталонных: горизонтальный скролл
 * обычно вылезает не там, где смотрят.
 *
 * Третьим — ПРИЁМЫ СЕРЕДИНЫ. Каждый обязан вести себя при «уменьшить
 * движение» по-своему, и ни один не объявлен в одном только CSS:
 *   • бегущая строка СТОИТ (анимации нет вовсе);
 *   • карточка НЕ ДВИЖЕТСЯ ВОВСЕ — проверяется по РАСТРУ, потому
 *     что по стилям движения холста не видно вообще;
 *   • маршрут ПОДСВЕЧЕН ЦЕЛИКОМ и все номера видны: подсветка считается
 *     по положению, и при «уменьшить движение» она просто выставлена
 *     в единицу;
 *   • подмена вопроса ответом ВЫКЛЮЧЕНА, и видно обе половины.
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

console.log('\nПриёмы середины при «уменьшить движение»:');
{
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, reducedMotion: 'reduce',
  });
  await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const el = document.querySelector('.route');
    const sc = document.getElementById('scroller');
    sc.scrollTop += el.getBoundingClientRect().top - sc.clientHeight * 0.5;
  });
  await page.waitForTimeout(600);
  const before = await page.evaluate(() => ({
    mq: getComputedStyle(document.querySelector('.mq__track')).animationName,
    off: document.querySelector('.route').style.getPropertyValue('--lit') || '0',
    spark: getComputedStyle(document.querySelector('.route__glints')).display,
    nums: [...document.querySelectorAll('.rstep__num')].map((e) => +getComputedStyle(e).opacity),
    /* Вопросы видны целиком, ответ стоит неподвижно и виден: строка
       не бежит вовсе, а полоса открыта. */
    run: [...document.querySelectorAll('.qa__run')].map((e) => getComputedStyle(e).animationName),
    q: [...document.querySelectorAll('.qa__q')].map((e) => +getComputedStyle(e).opacity),
    a: [...document.querySelectorAll('.qa__tick')].map((e) => +getComputedStyle(e).opacity),
  }));
  for (let i = 0; i < 12; i += 1) { await page.mouse.wheel(0, 90); await page.waitForTimeout(25); }
  await page.waitForTimeout(600);
  const after = await page.evaluate(() =>
    document.querySelector('.route').style.getPropertyValue('--lit') || '0');

  const dim = [...before.q, ...before.a].filter((v) => v < 0.99).length;
  const okMq = before.mq === 'none';
  /* При «уменьшить движение» фронт стоит за концом пути: маршрут
     подсвечен целиком и не двигается ни на пиксель прокрутки. */
  const okLit = Number(before.off) === 1 && Number(after) === 1;
  const okSpark = before.spark === 'none';
  const okNums = before.nums.length === 5 && before.nums.every((v) => v > 0.99);
  /* ⚠️ ЧИСЛО ВОПРОСОВ НЕ ЗАШИТО, И ЭТО НЕ ПОСЛАБЛЕНИЕ. Проверяется
     не «их шесть», а «видны ВСЕ и ни одна строка не бежит»: тексты
     вопросов — содержание, оно правится постановкой (в тридцать
     четвёртой их стало четыре), а зашитое число превращает правку
     текста в падение сторожа, которое ничего не значит. */
  const okAns =
    dim === 0 &&
    before.q.length > 0 &&
    before.a.length === before.q.length &&
    before.run.length === before.q.length &&
    before.run.every((v) => v === 'none');
  if (!okMq || !okLit || !okNums || !okAns || !okSpark) failed = true;
  console.log(`  бегущая строка: animation-name=${before.mq} ${okMq ? '— стоит' : '— ИДЁТ'}`);
  console.log(`  маршрут: подсветка ${before.off} → ${after} ${okLit ? '— целиком и не двигается' : '— ЕДЕТ'}`);
  console.log(`  бегущие огни маршрута: display=${before.spark} ${okSpark ? '— их нет' : '— ЕСТЬ'}`);
  console.log(`  номера шагов: видно ${before.nums.filter((v) => v > 0.99).length} из ${before.nums.length}`);
  console.log(`  вопрос и ответ: видно ${before.q.length + before.a.length - dim} из `
    + `${before.q.length + before.a.length}, строк бежит `
    + `${before.run.filter((v) => v !== 'none').length} из ${before.run.length}`);

  /* КАРТОЧКА ОБЯЗАНА СТОЯТЬ ЦЕЛИКОМ. Волны внутри больше нет, наклон
     под указателем не заводится, подсветка сзади статична — значит два
     растра одной карточки с паузой обязаны совпасть ПОБИТОВО. Проверка
     осталась именно растровой: по стилям «ничего не рисуется» не видно,
     а появись внутри любое движение — оно молча прошло бы мимо CSS. */
  await page.evaluate(() => {
    const el = document.querySelector('.card');
    const sc = document.getElementById('scroller');
    sc.scrollTop += el.getBoundingClientRect().top - sc.clientHeight * 0.3;
  });
  await page.waitForTimeout(1400);
  const box = await page.evaluate(() => {
    const r = document.querySelector('.card').getBoundingClientRect();
    return {
      x: Math.round(r.left), y: Math.round(r.top),
      width: Math.round(r.width), height: Math.round(r.height),
    };
  });
  const shot1 = await page.screenshot({ clip: box });
  await page.waitForTimeout(1500);
  const shot2 = await page.screenshot({ clip: box });
  const still = Buffer.compare(shot1, shot2) === 0;
  if (!still) failed = true;
  console.log(`  карточка тарифа: ${still ? 'не сдвинулась за 1.5 с' : 'ДВИЖЕТСЯ'}`);
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

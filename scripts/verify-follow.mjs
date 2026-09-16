/**
 * ПРОВЕРКА, ЧТО ТЕКСТЫ НЕ РАСХОДЯТСЯ С НИЖНЕЙ КРОМКОЙ СЛОВА.
 *
 * Тексты прицеплены к кромке чернил, а не к прогрессу скролла по отдельной
 * формуле. Разница принципиальная: при отдельной формуле они рано или
 * поздно разъедутся — на кадре, где одно значение уже новое, а второе ещё
 * старое. Здесь сдвиг считается из той же величины bottomAt(t), в том же
 * вызове, поэтому разъехаться нечему — но декларировать это мало.
 *
 * Скролл гонится настоящими событиями колеса, и на каждом кадре снимаются
 * ДВА числа: низ чернил и верх блока текстов. Их разность обязана быть
 * постоянной — сколько бы кадров ни прошло.
 *
 * Заодно проверяется главное требование к ходу: к моменту, когда хиро
 * отлипает, слово должно быть дожато полностью.
 */
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';

const PORT = 4201;
const server = await serveOut(PORT);
const browser = await launch();
let failed = 0;

const PROBE = `
window.__f = { rows: [], on: false };
(() => {
  const tick = () => {
    if (window.__f.on) {
      const g = document.querySelectorAll('.wm--hero .wm__letter');
      const foot = document.querySelector('.hero__foot');
      if (g.length && foot) {
        let bot = -1e9;
        for (const e of g) bot = Math.max(bot, e.getBoundingClientRect().bottom);
        let top = 1e9;
        for (const e of g) top = Math.min(top, e.getBoundingClientRect().top);
        window.__f.rows.push({
          y: window.scrollY,
          ink: +bot.toFixed(2),
          top: +top.toFixed(2),
          foot: +foot.getBoundingClientRect().top.toFixed(2),
        });
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();
`;

for (const [w, h, mob] of [[390, 844, true], [1920, 1080, false]]) {
  const page = await browser.newPage({
    viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob, deviceScaleFactor: 1,
  });
  await page.addInitScript(PROBE);
  await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.hero__stage[data-entered]');
  await page.waitForTimeout(400);

  const geo = await page.evaluate(() => {
    const hero = document.getElementById('hero');
    return { heroH: hero.offsetHeight, vh: window.innerHeight };
  });
  const travel = geo.heroH - geo.vh;

  await page.evaluate(() => { window.__f.rows.length = 0; window.__f.on = true; });
  for (let i = 0; i < 400; i += 1) {
    const y = await page.evaluate(() => window.scrollY);
    if (y >= travel * 1.05) break;
    await page.mouse.wheel(0, h / 90);
    await page.waitForTimeout(20);
  }
  await page.waitForTimeout(900);
  await page.evaluate(() => { window.__f.on = false; });
  const rows = await page.evaluate(() => window.__f.rows.slice());
  await page.close();

  const gaps = rows.map((r) => r.foot - r.ink);
  const spread = Math.max(...gaps) - Math.min(...gaps);
  const moved = Math.max(...rows.map((r) => r.ink)) - Math.min(...rows.map((r) => r.ink));

  console.log(`\n${w}×${h}`);
  console.log(`  ход хиро ${travel} px = ${(travel / h).toFixed(3)} высоты экрана`);
  console.log(`  кадров записано ${rows.length}, нижняя кромка прошла ${moved.toFixed(1)} px`);
  console.log(`  зазор «верх текстов минус низ чернил»: ` +
    `${Math.min(...gaps).toFixed(2)} … ${Math.max(...gaps).toFixed(2)} px, ` +
    `разброс ${spread.toFixed(2)} px`);
  if (spread > 1.0) { failed += 1; console.log(`  ПРОВАЛ: тексты разошлись с кромкой на ${spread.toFixed(2)} px`); }
  if (moved < 20) { failed += 1; console.log('  ПРОВАЛ: кромка почти не двигалась, замер бессмысленный'); }

  // дожатие: к концу хода слово обязано быть в полностью сжатом состоянии
  const heights = rows.map((r) => r.ink - r.top);
  const open = Math.max(...heights);
  const atEnd = rows.filter((r) => r.y >= travel - 2);
  const endH = atEnd.length ? Math.min(...atEnd.map((r) => r.ink - r.top)) : NaN;
  const tightExpected = open / 1.712 * (141.973 / 244.074) / (141.973 / 244.074);
  const ratio = open / endH;
  console.log(`  высота чернил: раскрытое ${open.toFixed(1)} px → на конце хода ${endH.toFixed(1)} px ` +
    `(в ${ratio.toFixed(3)} раза)`);
  console.log(`  сжатое состояние достигнуто: ${Math.abs(ratio - 244.074 / 141.973) < 0.01 ? 'ДА' : 'НЕТ'}`);
  if (!(Math.abs(ratio - 244.074 / 141.973) < 0.01)) {
    failed += 1;
    console.log('  ПРОВАЛ: слово не дожалось к моменту, когда хиро отлипает');
  }
}

await browser.close();
server.close();
console.log(failed ? `\nПРОВАЛ: ${failed} проверок` : '\nТексты идут с кромкой кадр в кадр.');
process.exit(failed ? 1 : 0);

/**
 * ПРОВЕРКА ВХОДА БУКВ.
 *
 * Вход двигает литеры трансформом, и это единственное место, где трансформ
 * вообще касается литер. Отсюда главный риск: если после входа у литеры
 * останется хоть какой-то сдвиг, она сместится, и условие 3 (ширина
 * и положение литеры постоянны) сломается молча.
 *
 * Поэтому здесь проверяется не «красиво ли», а четыре факта:
 *   1. пока вход идёт, литеры действительно сдвинуты;
 *   2. когда вход закончился, трансформы ТОЖДЕСТВЕННЫ (не «нулевые,
 *      но анимированные», а none), и слово стоит ровно там же, где стоит
 *      при выключенной анимации;
 *   3. скролл во время входа обрывает его немедленно;
 *   4. при prefers-reduced-motion входа нет вовсе.
 */
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';

const PORT = 4198;
const server = await serveOut(PORT);
const browser = await launch();
let failed = 0;
const fail = (m) => { failed += 1; console.log(`  ПРОВАЛ: ${m}`); };

const SNAP = () => ({
  entered: document.querySelector('.hero__stage')?.dataset.entered ?? null,
  transforms: [...document.querySelectorAll('.wm--hero .wm__letter')].map(
    (g) => getComputedStyle(g).transform,
  ),
  rects: [...document.querySelectorAll('.wm--hero .wm__letter')].map((g) => {
    const r = g.getBoundingClientRect();
    return [+r.left.toFixed(2), +r.top.toFixed(2), +r.width.toFixed(2), +r.height.toFixed(2)];
  }),
});

const isIdentity = (t) =>
  t === 'none' || t === 'matrix(1, 0, 0, 1, 0, 0)' || t === 'matrix(1,0,0,1,0,0)';

for (const [w, h, mob] of [[390, 844, true], [1920, 1080, false]]) {
  const open = (extra = {}) =>
    browser.newPage({ viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob,
      deviceScaleFactor: 1, ...extra });

  console.log(`\n${w}×${h}`);

  /* эталон: анимации нет вовсе — здесь слово стоит там, где обязано стоять */
  const ref = await open({ reducedMotion: 'reduce' });
  await ref.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
  await ref.waitForTimeout(700);
  const base = await ref.evaluate(SNAP);
  await ref.close();
  console.log(`  «уменьшить движение»: data-entered=${base.entered}, ` +
    `трансформы ${base.transforms.every(isIdentity) ? 'тождественны' : 'НЕ тождественны'}`);
  if (base.entered !== '1') fail('при reduced-motion вход не помечен завершённым');
  if (!base.transforms.every(isIdentity)) fail('при reduced-motion литеры сдвинуты');

  /* вход идёт */
  const p1 = await open();
  await p1.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'commit' });
  await p1.waitForTimeout(260);
  const mid = await p1.evaluate(SNAP);
  const moved = mid.transforms.filter((t) => !isIdentity(t)).length;
  console.log(`  через 260 мс: сдвинуто литер ${moved} из 6 — вход идёт`);
  if (moved === 0) fail('вход не запустился');

  /* вход доиграл сам */
  await p1.waitForTimeout(1400);
  const done = await p1.evaluate(SNAP);
  console.log(`  после входа: data-entered=${done.entered}, ` +
    `трансформы ${done.transforms.every(isIdentity) ? 'ТОЖДЕСТВЕННЫ' : 'НЕ тождественны'}`);
  console.log(`    ${done.transforms.map((t, i) => `${'SPOTIK'[i]}:${t}`).join('  ')}`);
  if (done.entered !== '1') fail('вход не пометил себя завершённым');
  if (!done.transforms.every(isIdentity)) fail('после входа остался сдвиг');
  const drift = Math.max(...done.rects.map((r, i) =>
    Math.max(...r.map((v, k) => Math.abs(v - base.rects[i][k])))));
  console.log(`  расхождение с эталоном по габаритам литер: ${drift.toFixed(2)} px`);
  if (drift > 0.5) fail(`литеры встали не на место: ${drift.toFixed(2)} px`);
  await p1.close();

  /* скролл во время входа обрывает его */
  const p2 = await open();
  await p2.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'commit' });
  await p2.waitForTimeout(220);
  await p2.mouse.wheel(0, 40);
  await p2.waitForTimeout(120);
  const cut = await p2.evaluate(SNAP);
  console.log(`  скролл на 220 мс: data-entered=${cut.entered}, ` +
    `трансформы ${cut.transforms.every(isIdentity) ? 'тождественны — вход оборван' : 'НЕ тождественны'}`);
  if (cut.entered !== '1') fail('скролл не оборвал вход');
  if (!cut.transforms.every(isIdentity)) fail('после обрыва остался сдвиг');
  await p2.close();
}

await browser.close();
server.close();
console.log(failed ? `\nПРОВАЛ: ${failed} проверок` : '\nВход корректен на обоих размерах.');
process.exit(failed ? 1 : 0);

/**
 * КАДРЫ ВХОДА БУКВ.
 *
 * Вход длится меньше секунды, и увидеть его иначе нельзя: скриншот
 * «после загрузки» показывает уже конечное состояние. Поэтому страница
 * открывается, и кадры снимаются по таймеру от момента, когда браузер
 * начал рисовать.
 */
import { mkdir } from 'node:fs/promises';
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';

const PORT = 4197;
const MS = [80, 200, 320, 440, 560, 700, 900, 1200];

const server = await serveOut(PORT);
const browser = await launch();
await mkdir('.shots/enter', { recursive: true });

for (const [w, h, mob] of [[390, 844, true], [1920, 1080, false]]) {
  const page = await browser.newPage({
    viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob, deviceScaleFactor: 1,
  });
  // грузим без ожидания сети: вход стартует вместе с первой отрисовкой
  await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'commit' });
  const t0 = Date.now();
  for (const ms of MS) {
    const wait = ms - (Date.now() - t0);
    if (wait > 0) await page.waitForTimeout(wait);
    await page.screenshot({ path: `.shots/enter/${w}-${String(ms).padStart(4, '0')}ms.png` });
  }
  console.log(`${w}×${h}: снято ${MS.length} кадров`);
  await page.close();
}
await browser.close();
server.close();

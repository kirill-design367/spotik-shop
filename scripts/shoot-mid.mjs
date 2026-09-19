/** Кадры середины страницы: блоки 2–6 на трёх размерах. */
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';
import { mkdirSync } from 'node:fs';

const PORT = 4191;
const SIZES = [
  { w: 390, h: 844, name: '390' },
  { w: 1920, h: 1080, name: '1920' },
  { w: 2560, h: 1440, name: '2560' },
];
const BLOCKS = ['pricing', 'how', 'faq'];

mkdirSync('.shots/mid', { recursive: true });
const server = await serveOut(PORT);
const browser = await launch();
for (const s of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const s_h = s.h;
  await page.goto(`http://127.0.0.1:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  // прокрутить страницу целиком, чтобы появление строк отыграло:
  // иначе кадр снимает ещё не показанные ряды
  const H = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < H; y += s_h) {
    await page.evaluate((v) => window.scrollTo(0, v), y);
    await page.waitForTimeout(140);
  }
  await page.waitForTimeout(700);
  for (const id of BLOCKS) {
    await page.evaluate((i) => {
      const el = document.getElementById(i);
      window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY);
    }, id);
    await page.waitForTimeout(900);
    const el = await page.$(`#${id}`);
    await el.screenshot({ path: `.shots/mid/${id}-${s.name}.png` }).catch(async () => {
      await page.screenshot({ path: `.shots/mid/${id}-${s.name}.png` });
    });
  }
  // горизонтальный скролл
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(`${s.name}: горизонтальный вылет ${over} px`);
  await ctx.close();
}
await browser.close();
server.close();

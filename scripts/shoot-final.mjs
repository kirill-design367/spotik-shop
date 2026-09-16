/** Итоговые скриншоты с собранной выдачи, по боевому пути /spotik-shop/. */
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { launch } from './browser.mjs';

const OUT = resolve('out'), PREFIX = '/spotik-shop', PORT = 4185;
const MIME = { '.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml' };
const server = createServer(async (req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (!u.startsWith(PREFIX)) { res.writeHead(404).end(); return; }
  let f = join(OUT, u.slice(PREFIX.length) || '/');
  try { if ((await stat(f)).isDirectory()) f = join(f, 'index.html'); } catch {}
  try { res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream' }).end(await readFile(f)); }
  catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(PORT, r));
await mkdir('.shots/final', { recursive: true });

const browser = await launch();
const SIZES = [['390x844', 390, 844, true], ['1920x1080', 1920, 1080, false], ['2560x1440', 2560, 1440, false]];
const SPOTS = [
  ['01-хиро', 'hero', 0],
  ['02-хиро-сжатие', 'hero', 0.6],
  ['03-хиро-сжат', 'hero', 1],
  ['04-тарифы', 'pricing', null],
  ['05-как-работает', 'how', null],
  ['06-преимущества', 'benefits', null],
  ['07-сертификат', 'gift', null],
  ['08-вопросы', 'faq', null],
  ['09-футер-начало', 'footer', 0],
  ['10-футер-раскрыт', 'footer', 1],
];

for (const [sname, w, h, mob] of SIZES) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob, deviceScaleFactor: mob ? 2 : 1 });
  await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1100);
  for (const [name, id, frac] of SPOTS) {
    await page.evaluate(([i, f]) => {
      const el = document.getElementById(i);
      const top = el.offsetTop;
      window.scrollTo(0, f === null ? top - 8 : top + (el.offsetHeight - window.innerHeight) * f);
    }, [id, frac]);
    await page.waitForTimeout(950);
    await page.screenshot({ path: `.shots/final/${sname}-${name}.png` });
  }
  await page.close();
  console.log(sname, 'снято');
}
await browser.close();
server.close();

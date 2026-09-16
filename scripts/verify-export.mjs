/**
 * ПРОВЕРКА ОПУБЛИКОВАННОЙ ВЫДАЧИ.
 *
 * Статический экспорт под basePath ломается тихо: страница открывается,
 * но часть ресурсов уходит мимо префикса и отдаёт 404. Ловится это только
 * тем, что выдачу реально поднимают по боевому пути и открывают браузером.
 * Проверка локально с корня (npx serve out) такую поломку НЕ воспроизводит.
 *
 * Скрипт поднимает out/ по адресу /spotik-shop/ и требует:
 *   • ноль ответов со статусом 400 и выше;
 *   • ноль ошибок JavaScript;
 *   • ни одного шрифта в состоянии error (состояние unloaded — норма:
 *     так браузер сообщает, что сабсет не понадобился, и это ровно то,
 *     ради чего объявления разложены по unicode-range);
 *   • ни одного горизонтального скролла на трёх эталонных размерах;
 *   • вордмарк занимает заданную долю ширины и НЕ упирается в края,
 *     а его контур непустой (пустой путь тоже «не ломает страницу»,
 *     но это не работа).
 */
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { launch } from './browser.mjs';

const OUT = resolve('out');
const PREFIX = '/spotik-shop';
const PORT = 4178;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.txt': 'text/plain', '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (!url.startsWith(PREFIX)) { res.writeHead(404).end('вне basePath'); return; }
  let f = join(OUT, url.slice(PREFIX.length) || '/');
  try { if ((await stat(f)).isDirectory()) f = join(f, 'index.html'); } catch {}
  try {
    let buf = await readFile(f);
    const ext = extname(f);
    const head = { 'content-type': MIME[ext] || 'application/octet-stream' };
    const compressible = ['.html', '.js', '.css', '.json', '.svg', '.txt'].includes(ext);
    if (compressible && /gzip/.test(req.headers['accept-encoding'] || '')) {
      buf = gzipSync(buf);
      head['content-encoding'] = 'gzip';
    }
    head['content-length'] = buf.length;
    res.writeHead(200, head);
    res.end(buf);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('404');
  }
});
await new Promise((r) => server.listen(PORT, r));

const SIZES = [['мобильный', 390, 844, true], ['десктоп', 1920, 1080, false], ['широкий', 2560, 1440, false]];
// Страница /fonts была временной витриной для отбора шрифтов и во второй
// итерации удалена: набор выбран, показывать больше нечего.
const PAGES = [['главная', `${PREFIX}/`]];

const browser = await launch();
let failed = 0;

for (const [pname, path] of PAGES) {
  for (const [sname, w, h, mob] of SIZES) {
    const page = await browser.newPage({
      viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob, deviceScaleFactor: mob ? 2 : 1,
    });
    const bad = [];
    page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
    page.on('pageerror', (e) => bad.push(`JS: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') bad.push(`консоль: ${m.text()}`); });

    await page.goto(`http://localhost:${PORT}${path}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(900);

    const d = await page.evaluate(() => {
      const t = document.querySelector('.wm--hero .wm__svg');
      const p = t?.querySelector('path');
      return {
        dw: document.documentElement.scrollWidth,
        ww: window.innerWidth,
        dh: document.documentElement.scrollHeight,
        fonts: [...document.fonts].map((f) => `${f.family}:${f.status}`),
        wmWidth: t ? +t.getBoundingClientRect().width.toFixed(1) : null,
        wmSize: t ? `слой ${t.getBoundingClientRect().height.toFixed(0)}px` : null,
        dLen: p ? (p.getAttribute('d') || '').length : 0,
      };
    });

    const xscroll = d.dw > d.ww + 1;
    const fontErr = d.fonts.filter((f) => f.endsWith(':error'));
    const fontsUsed = d.fonts.filter((f) => f.endsWith(':loaded')).length;
    // Третья итерация отменила вылет за края: слово вписано в экран
    // с отступом около 0.65 % ширины с каждой стороны.
    const fill = d.wmWidth ? d.wmWidth / d.ww : null;
    const fillBad = fill !== null && (fill < 0.96 || fill > 0.995);

    const pathBad = d.dLen < 500;
    const ok = !bad.length && !xscroll && !fontErr.length && !fillBad && !pathBad;
    if (!ok) failed += 1;
    console.log(
      `${ok ? 'OK  ' : 'СБОЙ'} ${pname.padEnd(9)} ${sname.padEnd(10)} ${w}×${h}  ` +
        `высота ${String(d.dh).padStart(6)}  ` +
        (fill ? `ширина вордмарка ${(fill * 100).toFixed(1)} % окна  ${d.wmSize}  длина d ${d.dLen}  ` : '') +
        `шрифтов загружено ${fontsUsed} из ${d.fonts.length} объявленных`,
    );
    if (xscroll) console.log(`      ГОРИЗОНТАЛЬНЫЙ СКРОЛЛ: документ ${d.dw} при окне ${d.ww}`);
    if (fontErr.length) console.log(`      ШРИФТЫ НЕ ЗАГРУЗИЛИСЬ: ${fontErr.join(', ')}`);
    if (fillBad) console.log(`      ШИРИНА ВОРДМАРКА ВНЕ ДОПУСКА: ${fill}`);
    if (pathBad) console.log(`      КОНТУР ВОРДМАРКА ПУСТ ИЛИ ОБРЕЗАН: длина d ${d.dLen}`);
    for (const b of [...new Set(bad)].slice(0, 6)) console.log(`      ${b}`);
    await page.close();
  }
}

await browser.close();
server.close();
console.log(failed ? `\nПРОВАЛ: ${failed} проверок не прошло` : '\nВсё прошло: выдача под basePath рабочая');
process.exit(failed ? 1 : 0);

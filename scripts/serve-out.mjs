/**
 * Поднимает собранную выдачу out/ по боевому пути.
 *
 * ⚠️ БОЕВОЙ ПУТЬ ТЕПЕРЬ КОРЕНЬ. До переезда со страниц GitHub сайт
 * жил в подпапке `/spotik-shop/`, и раздача с корня не воспроизводила
 * поломок basePath — самых дорогих. На spotik.shop подпапки нет,
 * и корень и есть боевой путь.
 *
 * Величина одна и она здесь; вторая половина — `BASE`
 * в `next.config.mjs`. Поедет сайт снова в подпапку — менять оба.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

export const PREFIX = '';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.txt': 'text/plain', '.ico': 'image/x-icon',
};
const COMPRESSIBLE = ['.html', '.js', '.css', '.json', '.svg', '.txt'];

export async function serveOut(port, { gzip = true, dir = 'out' } = {}) {
  const root = resolve(dir);
  const server = createServer(async (req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    if (!url.startsWith(PREFIX)) { res.writeHead(404).end('вне basePath'); return; }
    let f = join(root, url.slice(PREFIX.length) || '/');
    try { if ((await stat(f)).isDirectory()) f = join(f, 'index.html'); } catch {}
    try {
      let buf = await readFile(f);
      const ext = extname(f);
      const head = {
        'content-type': MIME[ext] || 'application/octet-stream',
        // Те же заголовки, что ставит nginx на сервере: HTML без
        // долгого кэша, остальное неизменяемое на год.
        'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
      };
      if (gzip && COMPRESSIBLE.includes(ext) && /gzip/.test(req.headers['accept-encoding'] || '')) {
        buf = gzipSync(buf);
        head['content-encoding'] = 'gzip';
      }
      head['content-length'] = buf.length;
      res.writeHead(200, head);
      res.end(buf);
    } catch {
      // На неизвестный путь nginx отдаёт 404.html из выдачи — так же,
      // как это делали страницы GitHub. Без этой ветки проверка боевой
      // 404-страницы не проверяла бы ничего.
      try {
        const nf = await readFile(join(root, '404.html'));
        res.writeHead(404, { 'content-type': MIME['.html'] });
        res.end(nf);
      } catch {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('404');
      }
    }
  });
  await new Promise((r) => server.listen(port, r));
  return { server, url: `http://localhost:${port}${PREFIX}/`, close: () => server.close() };
}

/**
 * Поднимает собранную выдачу out/ по боевому пути /spotik-shop/.
 * Один и тот же сервер для всех проверок: локальная раздача с корня
 * не воспроизводит поломки basePath, а они самые дорогие.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

export const PREFIX = '/spotik-shop';

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
        // GitHub Pages отдаёт статику сжатой и с длинным кэшем
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
      // GitHub Pages на неизвестный путь отдаёт 404.html из выдачи.
      // Без этого проверка боевой 404-страницы ничего бы не проверяла.
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

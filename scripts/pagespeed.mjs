/**
 * PageSpeed локально через Lighthouse — тот же движок, что у сервиса Google.
 * Сам сервис из этой среды недоступен: исходящие запросы к google.com
 * закрыты политикой. Выдача поднимается по боевому пути /spotik-shop/.
 */
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const OUT = resolve('out');
const PREFIX = '/spotik-shop';
const PORT = 4182;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json',
};

const server = createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (!url.startsWith(PREFIX)) { res.writeHead(404).end(); return; }
  let f = join(OUT, url.slice(PREFIX.length) || '/');
  try { if ((await stat(f)).isDirectory()) f = join(f, 'index.html'); } catch {}
  try {
    let buf = await readFile(f);
    const ext = extname(f);
    const head = {
      'content-type': MIME[ext] || 'application/octet-stream',
      // GitHub Pages отдаёт статику сжатой и с длинным кэшем. Без этого
      // замер штрафует за трафик, которого на боевой выдаче не будет.
      'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    };
    const compressible = ['.html', '.js', '.css', '.json', '.svg', '.txt'].includes(ext);
    if (compressible && /gzip/.test(req.headers['accept-encoding'] || '')) {
      buf = gzipSync(buf);
      head['content-encoding'] = 'gzip';
    }
    head['content-length'] = buf.length;
    res.writeHead(200, head);
    res.end(buf);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(PORT, r));
await mkdir('.shots', { recursive: true });

const run = (preset) =>
  new Promise((done) => {
    const args = [
      'lighthouse', `http://localhost:${PORT}${PREFIX}/`,
      `--preset=${preset === 'mobile' ? 'mobile' : 'desktop'}`,
      '--output=json', `--output-path=.shots/lh-${preset}.json`,
      '--chrome-flags=--headless=new --no-sandbox --disable-dev-shm-usage',
      '--only-categories=performance,accessibility,best-practices,seo',
      '--quiet',
    ];
    if (preset === 'mobile') args.splice(2, 1, '--form-factor=mobile', '--screenEmulation.mobile');
    const cp = spawn('npx', args, {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, CHROME_PATH: '/opt/pw-browsers/chromium' },
    });
    cp.on('close', done);
  });

for (const preset of ['mobile', 'desktop']) {
  await run(preset);
  const r = JSON.parse(await readFile(`.shots/lh-${preset}.json`, 'utf8'));
  const c = r.categories;
  const a = r.audits;
  const pct = (x) => Math.round((x?.score ?? 0) * 100);
  console.log(`\n=== ${preset === 'mobile' ? 'МОБИЛЬНЫЙ' : 'ДЕСКТОП'} ===`);
  console.log(
    `производительность ${String(pct(c.performance)).padStart(3)}   ` +
      `доступность ${String(pct(c.accessibility)).padStart(3)}   ` +
      `практики ${String(pct(c['best-practices'])).padStart(3)}   ` +
      `SEO ${String(pct(c.seo)).padStart(3)}`,
  );
  for (const k of ['first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift', 'speed-index'])
    console.log(`  ${(a[k]?.title ?? k).padEnd(28)} ${String(a[k]?.displayValue ?? '—').padStart(10)}`);
  const fails = Object.values(a).filter((x) => x.score !== null && x.score < 0.9 && x.scoreDisplayMode === 'binary');
  if (fails.length) console.log('  не прошло:', fails.map((x) => x.id).join(', '));
}
server.close();

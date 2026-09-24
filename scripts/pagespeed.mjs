/**
 * PageSpeed локально через Lighthouse — тот же движок, что у сервиса
 * Google. Сам сервис из этой среды недоступен: исходящие запросы
 * к google.com закрыты политикой.
 *
 * ⚠️ МЕРЯЕТСЯ БОЕВОЙ СЕРВЕР, А НЕ КАТАЛОГ `out/`. До тридцатой итерации
 * здесь стоял свой файловый сервер поверх `out/` — снимка статического
 * экспорта. Экспорта нет с двадцать седьмой (Р-85), `next build` каталог
 * не создаёт вовсе, и замер три итерации подряд снимался с ТРЁХДНЕВНОГО
 * снимка: правку футера двадцать девятой итерации он не видел
 * по построению. Это ровно тот класс беды, что описан в Р-47, —
 * проверка смотрела не на предмет, — и лечится он так же: открываем
 * ТО ЖЕ, ЧТО ВИДИТ ЧЕЛОВЕК, через общий `serveOut` (Р-101).
 *
 * ⚠️ БЕЗ БАЗЫ, И ЭТО НАМЕРЕННО: лендинг обязан собираться и работать
 * на умолчаниях из `lib/plans.ts` (закон 36). Заодно каждый прогон
 * это подтверждает.
 *
 * ⚠️ СЕРИЮ ЧИТАТЬ ЦЕЛИКОМ, А НЕ ОДИН ПРОГОН: разброс в три пункта
 * даёт среда контейнера — рядом добиваются браузеры других замеров.
 * Число прогонов задаётся первым доводом: `node scripts/pagespeed.mjs 3`.
 */
import { readFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { serveOut, PREFIX } from './serve-out.mjs';

const PORT = 4182;
const RAZ = Math.max(1, Number(process.argv[2] || 1));

await mkdir('.shots', { recursive: true });
const server = await serveOut(PORT);

const run = (preset, n) =>
  new Promise((done) => {
    const args = [
      'lighthouse', server.url,
      `--preset=${preset === 'mobile' ? 'mobile' : 'desktop'}`,
      '--output=json', `--output-path=.shots/lh-${preset}${n > 1 ? `-${n}` : ''}.json`,
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

console.log(`сервер поднят: ${server.url}${PREFIX ? ` (префикс ${PREFIX})` : ''}`);

for (let n = 1; n <= RAZ; n++) {
  for (const preset of ['mobile', 'desktop']) {
    await run(preset, n);
    const r = JSON.parse(await readFile(`.shots/lh-${preset}${n > 1 ? `-${n}` : ''}.json`, 'utf8'));
    const c = r.categories;
    const a = r.audits;
    const pct = (x) => Math.round((x?.score ?? 0) * 100);
    console.log(`\n=== ${preset === 'mobile' ? 'МОБИЛЬНЫЙ' : 'ДЕСКТОП'}${RAZ > 1 ? `, прогон ${n}` : ''} ===`);
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
}

server.close();

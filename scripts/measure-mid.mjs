/**
 * ЦЕНА ПРИЁМОВ СЕРЕДИНЫ — ОТДЕЛЬНЫМ ЗАМЕРОМ.
 *
 * Общий `measure-fps` гоняет сцены целиком и не отвечает на вопрос
 * «сколько стоит именно этот приём». Здесь каждый приём меряется
 * ВКЛЮЧЁННЫМ И ВЫКЛЮЧЕННЫМ на одном и том же движении: разница
 * и есть его цена.
 *
 *   1. СЦЕНА КАРТОЧЕК В ПОКОЕ. Страница стоит, четыре объёмные плиты
 *      на экране ДЫШАТ. Это главный новый расход двадцать третьей
 *      итерации, и мерить его надо отдельно от всего.
 *   2. СЦЕНА КАРТОЧЕК ПОД УКАЗАТЕЛЕМ: наклон, глянец и ореол разом.
 *   3. НАКЛОН ТЕКСТА КАРТОЧКИ — цена перерисовки HTML поверх сцены.
 *   4. БЕГУЩАЯ СТРОКА В ПОКОЕ и 5. НА ПРОКРУТКЕ.
 *   6. СВЕЧЕНИЕ МАРШРУТА В ПОКОЕ и 7. НА БЫСТРОМ СКРОЛЛЕ: три ореола
 *      обводкой поверх ядра.
 *   8. ПОДСВЕТКА МАРШРУТА (сам ход) при быстром скролле.
 *   9. БЕГУЩИЕ ОГНИ МАРШРУТА в покое.
 *
 * Выключение — ровно одно свойство на приём, раскладка при этом
 * не меняется: иначе сравнивались бы две разные страницы.
 *
 * ЧЕСТНАЯ ОГОВОРКА та же, что у measure-fps: в контейнере нет
 * видеоускорителя, Chromium растрирует программно. Для композитинга
 * и для backdrop-filter это ЗАНИЖЕННАЯ оценка.
 */
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';

const PORT = 4247;
const server = await serveOut(PORT);
const URL = `http://localhost:${PORT}${PREFIX}/`;

const PROBE = `
window.__fps = { frames: [], long: [] };
(() => {
  let prev = 0;
  const tick = (t) => { if (prev) window.__fps.frames.push(t - prev); prev = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__fps.long.push(Math.round(e.duration)); })
      .observe({ entryTypes: ['longtask'] });
  } catch {}
  window.__fpsReset = () => { window.__fps.frames.length = 0; window.__fps.long.length = 0; prev = 0; };
})();
`;

function stats(frames) {
  const f = frames.filter((x) => x > 0.2).sort((a, b) => a - b);
  if (!f.length) return null;
  const q = (p) => f[Math.min(f.length - 1, Math.floor(f.length * p))];
  return {
    n: f.length,
    median: q(0.5),
    p95: q(0.95),
    worst: f[f.length - 1],
    over: (f.filter((x) => x > 16.9).length / f.length) * 100,
  };
}

/**
 * `base` выключается в ОБЕИХ строках. Это не перестраховка: сцены
 * середины перекрываются по прокрутке — прогон «бегущая строка
 * на прокрутке» неизбежно заезжает в блок порядка, и без общего
 * выключения сравнивались бы две РАЗНЫЕ страницы, а не приём
 * с самим собой. Ловится это сразу: выключенная строка выходила
 * дороже включённой, чего быть не может.
 */
async function scene(page, label, off, drive, base = '') {
  const row = async (on) => {
    await page.evaluate((css) => { document.getElementById('probe-off').textContent = css; },
      on ? base : `${base}${off}`);
    await page.waitForTimeout(400);
    await page.evaluate(() => window.__fpsReset());
    await drive();
    const r = await page.evaluate(() => ({ frames: window.__fps.frames.slice(), long: window.__fps.long.slice() }));
    return { s: stats(r.frames), long: r.long };
  };
  /* Прогревочный проход в зачёт не идёт: первый прогон сцены тащит
     на себе разовую работу (компиляция шейдера, первая отрисовка слоя),
     и она осела бы в той половине замера, которая шла первой. */
  await row(true);
  const a = await row(false);
  const b = await row(true);
  await page.evaluate(() => { document.getElementById('probe-off').textContent = ''; });
  const line = (tag, v) => {
    if (!v.s) return `  ${tag.padEnd(12)} кадров не набралось`;
    return `  ${tag.padEnd(12)} кадров ${String(v.s.n).padStart(4)}   медиана ${v.s.median.toFixed(1).padStart(5)} мс`
      + `   худшие 5 % ${v.s.p95.toFixed(1).padStart(5)} мс   худший ${v.s.worst.toFixed(0).padStart(4)} мс`
      + `   свыше 16.9 мс ${v.s.over.toFixed(1).padStart(5)} %`
      + (v.long.length ? `   длинных задач ${v.long.length}` : '   длинных задач нет');
  };
  console.log(`\n${label}`);
  console.log(line('выключено', a));
  console.log(line('включено', b));
}

/* Профиль можно взять один: `node scripts/measure-mid.mjs 1920`.
   Прогон целиком занимает больше десяти минут, и в средах с потолком
   на длительность команды его приходится делить на три. */
const ONLY = process.argv[2];
const PROFILES = [
  ['ДЕСКТОП 1920', 1920, 1080, false, 1],
  ['ДЕСКТОП 2560', 2560, 1440, false, 1],
  ['МОБИЛЬНАЯ ЭМУЛЯЦИЯ', 390, 844, true, 4],
];
for (const [name, w, h, mob, cpu] of PROFILES.filter((p) => !ONLY || String(p[1]) === ONLY)) {
  const browser = await launch();
  const page = await browser.newPage({
    viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob, deviceScaleFactor: mob ? 2 : 1,
  });
  const cdp = await page.context().newCDPSession(page);
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  await page.addInitScript(PROBE);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => {
    const s = document.createElement('style');
    s.id = 'probe-off';
    document.head.appendChild(s);
  });
  await page.waitForTimeout(1000);
  console.log(`\n══ ${name}  ${w}×${h}${cpu > 1 ? `  процессор ×${cpu}` : ''} ══`);

  const park = async (sel, frac = 0.35) => {
    await page.evaluate(([s, f]) => {
      const el = document.querySelector(s);
      const sc = document.getElementById('scroller');
      sc.scrollTop += el.getBoundingClientRect().top - sc.clientHeight * f;
    }, [sel, frac]);
    await page.waitForTimeout(900);
  };
  const wheel = async (total, ms) => {
    const steps = Math.max(1, Math.round(ms / 50));
    for (let i = 0; i < steps; i += 1) {
      await page.mouse.wheel(0, total / steps);
      await page.waitForTimeout(50);
    }
  };

  /* ⚠️ КАРТА ВЫКЛЮЧАЕТСЯ ПРИЩЕМЛЕНИЕМ ВСЕХ ШЕСТИ ЧИСЕЛ. Наклон,
     дыхание, подъём, фольга и блик выводятся из `--rx/--ry/--tz`
     и `--px/--py/--spot`; прищемив их `!important`, мы оставляем
     ровно ту же раскладку и ту же картинку, но неподвижную. Разница
     между строками — цена ДВИЖЕНИЯ, а не самих градиентов.

     Прищемлять надо И карту, И её ореол: они едут одним набором. */
  const NOCARD =
    '.card{--rx:0!important;--ry:0!important;--tz:0!important;' +
    '--px:0!important;--py:0!important;--spot:0!important}';
  /* Свет за картой — СТАТИЧНЫЙ размытый слой, и его цену
     прищемлением чисел не снять: он их не читает вовсе.
     Значит его надо мерить СНЯТИЕМ самого слоя — и мерить
     врозь в покое (там он обязан стоить ноль, размытие
     считано один раз) и под указателем (там у него меняется
     прозрачность, а это уже работа в кадре). */
  const NOGLOW = '.cards__glow{display:none!important}';
  /* Ореолы ленты снимаются, ядро остаётся: меряется цена именно
     свечения, а не самой линии. */
  const NOHALO = '.route__halo{display:none!important}';

  await park('.cards', 0.1);
  await page.mouse.move(4, Math.round(h * 0.95));
  await scene(page, '1. КАРТЫ В ПОКОЕ: ЧЕТЫРЕ ДЫШАТ (страница стоит)', NOCARD, () =>
    page.waitForTimeout(4000),
  );

  await scene(page, '1а. СВЕТ ЗА КАРТАМИ В ПОКОЕ (страница стоит)', NOGLOW, () =>
    page.waitForTimeout(4000),
  );

  if (!mob) {
    /* Указатель идёт ПО ВСЕМ ЧЕТЫРЁМ подряд и непрерывно: наклон,
       фольга и блик считаются на каждом движении. Ровно тот случай,
       который просили замерить отдельно. */
    const sweep = async () => {
      const boxes = await page.$$eval('.card', (els) =>
        els.map((e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }),
      );
      for (const [x, y, bw, bh] of boxes) {
        for (let t = 0; t <= 1; t += 0.05) {
          await page.mouse.move(x + bw * t, y + bh * (0.25 + 0.5 * t));
          await page.waitForTimeout(16);
        }
      }
      await page.mouse.move(4, Math.round(h * 0.95));
      await page.waitForTimeout(400);
    };
    await scene(page, '2. КАРТЫ ПОД УКАЗАТЕЛЕМ (наклон, фольга, блик)', NOCARD, sweep);
    await scene(page, '2а. СВЕТ ЗА КАРТАМИ ПОД УКАЗАТЕЛЕМ', NOGLOW, sweep);
  }

  await park('.mq', 0.3);
  await page.mouse.move(4, Math.round(h * 0.95));
  await scene(page, '4. БЕГУЩАЯ СТРОКА В ПОКОЕ (страница стоит)',
    '.mq{display:none!important}', () => page.waitForTimeout(3000));

  await scene(page, '5. БЕГУЩАЯ СТРОКА НА ПРОКРУТКЕ',
    '.mq{display:none!important}', async () => {
      await park('.mq', 0.9);
      await wheel(h * 1.2, 3000);
    }, '.route__svg{display:none!important}');

  /* Свечение ленты — отдельно в покое и на ходу: в покое оно ничего
     не перерисовывает вовсе, а на быстром скролле обрезка меняется
     каждый кадр, и ореолы платят за это втрое. */
  await park('.route', 0.35);
  await scene(page, '6. СВЕЧЕНИЕ МАРШРУТА В ПОКОЕ (страница стоит)', NOHALO,
    () => page.waitForTimeout(3000), '.mq{display:none!important}');

  await scene(page, '7. СВЕЧЕНИЕ МАРШРУТА НА БЫСТРОМ СКРОЛЛЕ', NOHALO, async () => {
    await park('.route', 0.95);
    await wheel(h * 3.2, 2400);
  }, '.mq{display:none!important}');

  /* Бегущие огни — единственное, что движется в покое на этой
     странице, кроме бегущей строки. Мерить их надо врозь. */
  await park('.route', 0.35);
  await scene(page, '9. БЕГУЩИЕ ОГНИ МАРШРУТА В ПОКОЕ (страница стоит)',
    '.route__glints{display:none!important}', () => page.waitForTimeout(3000),
    '.mq{display:none!important}');

  /* Подсветка маршрута меряется на БЫСТРОМ скролле: именно там она
     обязана успевать за позицией. */
  await scene(page, '8. ПОДСВЕТКА МАРШРУТА (быстрый скролл)',
    '.route__svg{display:none!important}', async () => {
      await park('.route', 0.95);
      await wheel(h * 3.2, 2400);
    }, '.mq{display:none!important}');

  await browser.close();
}
server.close();

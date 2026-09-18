/**
 * ЗАМЕР ФАКТИЧЕСКОГО FPS.
 *
 * Декларации не годятся. Здесь измеряется то, что реально происходит:
 *
 * 1. В страницу внедряется счётчик на requestAnimationFrame. Он пишет
 *    интервалы между кадрами — то есть ровно то, что видит глаз.
 * 2. Скролл гонится НАСТОЯЩИМИ событиями колеса (mouse.wheel), а не
 *    window.scrollTo: иначе не работает ни Lenis, ни инерция, ни весь
 *    конвейер обработки ввода, и замер получился бы про другое.
 * 3. Параллельно снимается длительность длинных задач
 *    (PerformanceObserver longtask) — это главный источник срывов кадра.
 * 4. Мобильная эмуляция идёт с торможением процессора: Emulation
 *    .setCPUThrottlingRate, кратность задаётся аргументом.
 *
 * ЧЕСТНАЯ ОГОВОРКА. В контейнере нет видеоускорителя, Chromium растрирует
 * программно (SwiftShader). Для Canvas 2D и композитинга это ЗАНИЖЕННАЯ
 * оценка: на настоящем устройстве с GPU те же кадры дешевле. Цифры ниже
 * поэтому надо читать как нижнюю границу, а не как приговор.
 */
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';

// По умолчанию меряем БОЕВУЮ выдачу out/ по боевому пути: dev-сборка
// с горячей перезагрузкой дала бы цифры про другое приложение.
const PORT = 4187;
const server = process.env.FPS_URL ? null : await serveOut(PORT);
const URL = process.env.FPS_URL || `http://localhost:${PORT}${PREFIX}/`;
const SECONDS = Number(process.env.FPS_SECONDS || 6);

const PROBE = `
window.__fps = { frames: [], long: [], start: 0 };
(() => {
  let prev = 0;
  const tick = (t) => {
    if (prev) window.__fps.frames.push(t - prev);
    prev = t;
    window.__fps.raf = requestAnimationFrame(tick);
  };
  window.__fps.raf = requestAnimationFrame(tick);
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__fps.long.push({
        d: Math.round(e.duration),
        at: Math.round(e.startTime),
        who: (e.attribution || []).map((a) => a.name).join(','),
      });
    }).observe({ entryTypes: ['longtask'] });
  } catch {}
  window.__fpsReset = () => { window.__fps.frames.length = 0; window.__fps.long.length = 0; prev = 0; };
})();
`;

function stats(frames) {
  // Интервалы свыше 400 мс — это не кадры, а провалы: вкладка ушла в фон,
  // либо главный поток встал. Их НЕЛЬЗЯ молча выбрасывать (так было раньше,
  // и большая задержка пряталась от статистики), поэтому они считаются
  // отдельно и печатаются рядом.
  const all = frames.filter((x) => x > 0.2).sort((a, b) => a - b);
  const stalls = all.filter((x) => x >= 400);
  const f = all.filter((x) => x < 400);
  if (!f.length) return null;
  const q = (p) => f[Math.min(f.length - 1, Math.floor(f.length * p))];
  const median = q(0.5);
  const over = f.filter((x) => x > 16.9).length;
  const bad = f.filter((x) => x > 33.4).length;
  return {
    n: f.length,
    fpsMedian: 1000 / median,
    fpsP95: 1000 / q(0.95),
    median,
    p95: q(0.95),
    worst: f[f.length - 1],
    overPct: (over / f.length) * 100,
    badPct: (bad / f.length) * 100,
    stalls,
    worstAll: all[all.length - 1],
  };
}

async function measure(page, cdp, label, drive) {
  await page.evaluate(() => window.__fpsReset());
  await drive();
  const res = await page.evaluate(() => ({
    frames: window.__fps.frames.slice(),
    long: window.__fps.long.slice(),
  }));
  const s = stats(res.frames);
  if (!s) {
    console.log(`  ${label.padEnd(30)} кадров не набралось`);
    return;
  }
  const longSum = res.long.reduce((a, b) => a + b.d, 0);
  console.log(
    `  ${label.padEnd(30)} медиана ${s.fpsMedian.toFixed(1).padStart(5)} fps  ` +
      `(кадр ${s.median.toFixed(1)} мс)   худшие 5% ${s.fpsP95.toFixed(1).padStart(5)} fps ` +
      `(${s.p95.toFixed(1)} мс)   свыше 16.9 мс: ${s.overPct.toFixed(1)}%   ` +
      `свыше 33 мс: ${s.badPct.toFixed(1)}%   кадров ${s.n}` +
      (res.long.length ? `   длинных задач ${res.long.length} на ${longSum} мс` : '   длинных задач нет'),
  );
  if (s.stalls.length) {
    console.log(`  ${' '.repeat(32)}ПРОВАЛЫ КАДРА свыше 400 мс: ${s.stalls.length} шт., ` +
      `самый долгий ${s.worstAll.toFixed(0)} мс`);
  }
  if (res.long.length) {
    console.log(`  ${' '.repeat(32)}подробно: ` +
      res.long.map((e) => `${e.d} мс (${e.who || 'без атрибуции'})`).join(', '));
  }
}

async function run(profile) {
  const { name, width, height, mobile, cpu } = profile;
  const browser = await launch();
  const page = await browser.newPage({
    viewport: { width, height },
    isMobile: mobile,
    hasTouch: mobile,
    deviceScaleFactor: mobile ? 2 : 1,
  });
  const cdp = await page.context().newCDPSession(page);
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });

  await page.addInitScript(PROBE);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);

  console.log(`\n${name}  ${width}×${height}${cpu > 1 ? `  процессор замедлен ×${cpu}` : ''}`);

  const wheel = async (total, ms) => {
    const steps = Math.max(1, Math.round(ms / 50));
    for (let i = 0; i < steps; i += 1) {
      await page.mouse.wheel(0, total / steps);
      await page.waitForTimeout(50);
    }
  };
  const goto = async (frac) => {
    await page.evaluate((f) => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo(0, max * f);
    }, frac);
    await page.waitForTimeout(900);
  };

  // 1. вход букв. Меряется с чистой загрузки: вход играет один раз,
  //    и поймать его можно только там. Счётчик кадров ставится
  //    инициализирующим скриптом, то есть раньше первой отрисовки.
  await page.reload({ waitUntil: 'commit' });
  await measure(page, cdp, 'хиро: вход букв', async () => {
    await page.waitForTimeout(1600);
  });

  // 2. хиро: морф вордмарка от неподвижного верха вниз
  await goto(0);
  await measure(page, cdp, 'хиро: морф вордмарка', () => wheel(height * 1.05, SECONDS * 1000));

  // 3. футер: то же зеркально, слово растёт ВНИЗ от неподвижного верха
  await goto(0.88);
  await measure(page, cdp, 'футер: вордмарк наоборот', () => wheel(height * 0.9, SECONDS * 1000));

  // 4. середина страницы: блоки 2-6, где анимации нет
  await goto(0.45);
  await measure(page, cdp, 'блоки 2-6 (появление строк)', () => wheel(height * 1.5, SECONDS * 1000));

  await browser.close();
}

const PROFILES = [
  { name: 'ДЕСКТОП', width: 1920, height: 1080, mobile: false, cpu: 1 },
  { name: 'ДЕСКТОП 2560', width: 2560, height: 1440, mobile: false, cpu: 1 },
  { name: 'МОБИЛЬНАЯ ЭМУЛЯЦИЯ', width: 390, height: 844, mobile: true, cpu: 4 },
];

console.log('Замер fps. Скролл гонится настоящими событиями колеса, интервалы кадров');
console.log('снимаются requestAnimationFrame внутри страницы. В контейнере нет GPU,');
console.log('растеризация программная — это нижняя граница, на живом устройстве быстрее.');

for (const p of PROFILES) await run(p);
server?.close();

/**
 * МОБИЛЬНЫЙ СКРОЛЛ: ПОТЕРЯННЫЕ КАДРЫ ПО БЛОКАМ.
 *
 * Прежняя методика (measure-fps.mjs) мобильный дефект НЕ ЛОВИЛА, и вот
 * почему — три причины, каждая сама по себе достаточная:
 *
 *   1) она гоняла страницу КОЛЕСОМ. На телефоне колеса нет: там тач,
 *      родная инерция и совсем другой путь ввода — тач идёт через
 *      обработчики, которые может задержать главный поток, а колесо
 *      в мобильной эмуляции проходит через smoothWheel Lenis'а;
 *   2) она мерила КУСКАМИ по 10 секунд на выбранную сцену, а рвётся
 *      страница на переходах между блоками — там, где поднимается 3D;
 *   3) она докладывала МЕДИАНУ. Медиана 59.9 стоит намертво, даже если
 *      один кадр длится четыре секунды: в интервалах это один выброс
 *      из шестисот. Провалы шли отдельной строкой и читались как сноска.
 *
 * Здесь наоборот: один проход страницы СВЕРХУ ДОНИЗУ настоящим тач-жестом,
 * и главная цифра — ПОТЕРЯННЫЕ КАДРЫ, разложенные по блокам. Потерянный
 * кадр — это каждые 16.7 мс сверх одного кадра в интервале: скачок
 * на 200 мс это 11 потерянных кадров, и они видны как рывок.
 *
 * Отдельно пишутся длинные задачи (PerformanceObserver) с привязкой
 * к блоку, который в этот момент был на экране.
 *
 * ВАЖНО ПРО СРЕДУ. В контейнере нет видеоускорителя: WebGL идёт
 * программным растеризатором (SwiftShader). Для 3D это ЗАВЫШЕННАЯ цена —
 * на телефоне с GPU компиляция дешевле. Но порядок величин («секунды
 * главного потока против нуля») среда показывает честно, а именно он
 * и решает, где рвётся.
 */
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';

const PORT = 4217;
/* Профиль телефона, а не «узкое окно десктопа»: тач, мобильный UA
   и НАСТОЯЩИЙ dpr. Плотность пикселей здесь не косметика — растеризация
   идёт по площади буфера, и на 2.75 её втрое больше, чем на единице. */
const PHONE = {
  width: 393, height: 851, dsf: 2.75,
  ua: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36',
};
const CPU = Number(process.env.CPU || 4);
const FRAME = 1000 / 60;

const PROBE = `
window.__ms = { rows: [], long: [], on: false };
(() => {
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        if (window.__ms.on) window.__ms.long.push({ t: e.startTime, ms: e.duration, y: window.scrollY });
    }).observe({ entryTypes: ['longtask'] });
  } catch {}
})();
window.__msStart = () => {
  window.__ms.rows.length = 0;
  window.__ms.long.length = 0;
  window.__ms.on = true;
  const tick = (t) => {
    if (!window.__ms.on) return;
    window.__ms.rows.push([t, window.scrollY]);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = await serveOut(PORT);
const browser = await launch();

/** Один проход страницы сверху донизу тач-жестом. */
async function run(page, cdp, { label }) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(700);
  const geo = await page.evaluate(() => {
    const ids = ['hero', 'pricing', 'how', 'faq', 'footer'];
    const secs = ids.map((id) => {
      const el = document.getElementById(id);
      const r = el.getBoundingClientRect();
      return { id, top: r.top + window.scrollY, bottom: r.bottom + window.scrollY };
    });
    return { secs, doc: document.documentElement.scrollHeight, vh: window.innerHeight };
  });

  await page.evaluate(() => window.__msStart());
  /* Прокрутка гонится НАСТОЯЩИМИ тач-событиями: касание, серия движений
     и отрыв пальца. Инерцию после отрыва считает сам движок — замерено,
     что после 480 px перетаскивания страница доезжает до 739 px, то есть
     родная инерция работает. Input.synthesizeScrollGesture в этой среде
     не годится: он отвечает «ок» и не прокручивает ничего. */
  const max = geo.doc - geo.vh;
  const swipe = Math.round(geo.vh * 0.62);   // палец не проходит весь экран
  const x = Math.round(PHONE.width / 2);
  /* Крутим до самого низа, а не фиксированное число жестов: иначе футер
     в замер не попадает, а морф живёт как раз в нём. */
  for (let guard = 0; guard < 40; guard += 1) {
    const y = await page.evaluate(() => window.scrollY);
    if (y >= max - 2) break;
    const y0 = Math.round(PHONE.height * 0.78);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
    const steps = 18;
    for (let i = 1; i <= steps; i += 1) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [{ x, y: Math.round(y0 - (swipe * i) / steps) }],
      });
      await sleep(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(420);   // инерция докатывается
  }
  await sleep(600);
  await page.evaluate(() => { window.__ms.on = false; });
  const raw = await page.evaluate(() => window.__ms);

  // ── разбор ────────────────────────────────────────────────────────────
  const at = (y) => {
    const mid = y + geo.vh / 2;
    for (const s of geo.secs) if (mid >= s.top && mid < s.bottom) return s.id;
    return mid < geo.secs[0].top ? 'hero' : 'footer';
  };
  const per = new Map();
  for (const s of geo.secs) per.set(s.id, { frames: 0, lost: 0, worst: 0, ms: 0 });
  let lost = 0;
  let worst = 0;
  for (let i = 1; i < raw.rows.length; i += 1) {
    const dt = raw.rows[i][0] - raw.rows[i - 1][0];
    const id = at(raw.rows[i - 1][1]);
    const p = per.get(id);
    if (!p) continue;
    const l = Math.max(0, Math.round(dt / FRAME) - 1);
    p.frames += 1;
    p.lost += l;
    p.ms += dt;
    p.worst = Math.max(p.worst, dt);
    lost += l;
    worst = Math.max(worst, dt);
  }
  const longs = raw.long.map((l) => ({ ...l, id: at(l.y) }));
  return { label, per, lost, worst, longs, frames: raw.rows.length, geo };
}

const out = [];
const page = await browser.newPage({
  viewport: { width: PHONE.width, height: PHONE.height },
  deviceScaleFactor: PHONE.dsf,
  isMobile: true, hasTouch: true, userAgent: PHONE.ua,
});
const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
await page.addInitScript(PROBE);
await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForSelector('.hero__stage[data-entered]');

// первый проход — холодный: именно в нём поднимается 3D
out.push(await run(page, cdp, { label: 'первый проход (3D поднимается)' }));
// второй — по уже прогретой странице: столько стоит сам скролл
out.push(await run(page, cdp, { label: 'второй проход (всё уже поднято)' }));

await page.close();
await browser.close();
server.close();

console.log('МОБИЛЬНЫЙ ПРОФИЛЬ %d×%d, dpr %s, процессор замедлен ×%d',
  PHONE.width, PHONE.height, PHONE.dsf, CPU);
console.log('Прокрутка — настоящие тач-события: касание, 18 движений, отрыв, родная инерция.');
console.log('«Потеряно» — кадры сверх одного в интервале: 200 мс паузы = 11 потерянных.');
const NAMES = {
  hero: '1 хиро', pricing: '2 тарифы', how: '3 как работает',
  faq: '4 вопросы', footer: '5 футер',
};
for (const r of out) {
  console.log('');
  console.log('── %s ─────────────────────────', r.label.toUpperCase());
  console.log('блок               кадров   ПОТЕРЯНО   худший кадр');
  for (const [id, p] of r.per) {
    if (!p.frames) continue;
    console.log('  %s %s %s %s мс',
      (NAMES[id] || id).padEnd(18), String(p.frames).padStart(6),
      String(p.lost).padStart(10), p.worst.toFixed(0).padStart(11));
  }
  console.log('  ВСЕГО потеряно кадров: %d, худший кадр %s мс, кадров записано %d',
    r.lost, r.worst.toFixed(0), r.frames);
  if (r.longs.length) {
    console.log('  длинные задачи (>50 мс):');
    for (const l of r.longs.slice(0, 8))
      console.log('    %s мс в блоке %s', l.ms.toFixed(0).padStart(6), NAMES[l.id] || l.id);
    if (r.longs.length > 8) console.log('    … всего %d', r.longs.length);
  } else {
    console.log('  длинных задач нет');
  }
}

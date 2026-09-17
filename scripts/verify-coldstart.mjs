/**
 * ЛАГ НА ХОЛОДНОЙ ЗАГРУЗКЕ.
 *
 * Сразу после загрузки первое движение колеса не даёт роста: слово стоит,
 * потом рывком догоняет. На прогретой странице этого нет, поэтому меряется
 * ОБА состояния одним и тем же способом, и разница между ними и есть лаг.
 *
 * Считается два числа:
 *   • сколько кадров прошло от первого события колеса до первого изменения
 *     высоты чернил;
 *   • величина этого первого изменения — рывок, которым слово догоняет.
 *
 * Цикл записи заводится в момент начала замера, а не при инициализации:
 * rAF выполняются в порядке заказа, и пробник, заказанный раньше тикера
 * GSAP, читал бы DOM до отрисовки и отставал ровно на кадр.
 */
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';

const PORT = 4203;

const PROBE = `
window.__cs = { rows: [], on: false, wheel: -1 };
window.__csStart = () => {
  window.__cs.rows.length = 0;
  window.__cs.on = true;
  const tick = (now) => {
    if (!window.__cs.on) return;
    const ps = [...document.querySelectorAll('.wm--hero .wm__letter path')];
    if (ps.length === 6) {
      /* Форма берётся из атрибута d, а НЕ из габаритов на экране.
         Габариты врут: вход букв двигает литеры трансформом вразнобой,
         и высота «слова» скачет на 6…8 px, хотя форма стоит. Первый
         замер на этом и обманулся. */
      window.__cs.rows.push({
        t: now,
        y: window.scrollY,
        d: ps.map((p) => p.getAttribute('d')).join(''),
        ent: document.querySelector('.hero__stage').dataset.entered || '',
        // Lenis вешает класс lenis на <html> — по нему видно, с какого
        // кадра плавный скролл вообще существует
        lenis: document.documentElement.classList.contains('lenis') ? 1 : 0,
      });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
addEventListener('wheel', () => {
  if (window.__cs.wheel < 0) window.__cs.wheel = window.__cs.rows.length;
}, { passive: true, capture: true });
`;

/** Высота чернил из строки d: верх данных на нуле, значит это низ. */
function inkHeight(d) {
  const n = d.match(/-?\d[\d.]*/g);
  let max = -Infinity;
  for (let i = 1; i < n.length; i += 2) if (+n[i] > max) max = +n[i];
  return max;
}

const server = await serveOut(PORT);
const browser = await launch();
const out = [];

for (const warm of [false, true]) {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1,
  });
  const cdp = await page.context().newCDPSession(page);
  // Процессор замедлен в обоих случаях одинаково: окно до гидратации
  // на быстрой машине измеряется единицами миллисекунд, и дефект в него
  // просто не попадает. Замедление делает окно видимым, а не выдуманным.
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  await page.addInitScript(PROBE);
  await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'domcontentloaded' });

  /* Оба случая — СВЕЖАЯ загрузка, разница только в паузе перед колесом.
     Прогревать скроллом нельзя: window.scrollTo обходит Lenis и оставляет
     его внутреннюю цель рассинхронизированной, после чего первое же колесо
     даёт мгновенный доворот — и замер показывает не лаг, а артефакт. */
  if (warm) {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForSelector('.hero__stage[data-entered]');
    await page.waitForTimeout(2500);
  }

  await page.evaluate(() => { window.__cs.wheel = -1; window.__csStart(); });
  for (let i = 0; i < 30; i += 1) {
    await page.mouse.wheel(0, 26);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.__cs.on = false; });
  const raw = await page.evaluate(() => window.__cs);
  await page.close();
  const rows = raw.rows.map((r) => ({ ...r, h: inkHeight(r.d) }));
  const wheel = raw.wheel;

  const h0 = rows[wheel]?.h ?? rows[0].h;
  let first = -1;
  for (let i = wheel; i < rows.length; i += 1)
    if (Math.abs(rows[i].h - h0) > 0.01) { first = i; break; }
  const frames = first < 0 ? -1 : first - wheel;
  const jump = first < 0 ? 0 : Math.abs(rows[first].h - rows[first - 1].h);
  const steps = [];
  const ys = [];
  for (let i = Math.max(1, first); i < Math.min(rows.length, first + 12); i += 1) {
    steps.push(+(rows[i - 1].h - rows[i].h).toFixed(2));
    ys.push(rows[i].y - rows[i - 1].y);
  }
  // на каком кадре у литер пропал трансформ входа
  const entAt = rows.findIndex((r) => r.ent === '1');
  out.push({ warm, frames, jump, wheel, total: rows.length, steps, ys,
    scrolled: rows[first]?.y ?? 0, entAt: entAt < 0 ? -1 : entAt - wheel,
    lenisAt: (() => { const i = rows.findIndex((r) => r.lenis); return i < 0 ? -1 : i - wheel; })() });
}

console.log('── ОТ ПЕРВОГО КОЛЕСА ДО ПЕРВОГО ИЗМЕНЕНИЯ ФОРМЫ ────────────────');
console.log('состояние      кадров   первый скачок   скролл к этому моменту');
for (const r of out)
  console.log('  %s %s %s px %s px',
    (r.warm ? 'прогретая' : 'холодная ').padEnd(12),
    String(r.frames).padStart(6), r.jump.toFixed(2).padStart(13), String(r.scrolled).padStart(12));
console.log('');
console.log('первые шаги высоты чернил после старта (px за кадр):');
for (const r of out)
  console.log('  %s %s', (r.warm ? 'прогретая' : 'холодная ').padEnd(12), r.steps.join(' '));
console.log('');
console.log('первые шаги САМОГО СКРОЛЛА после старта (px за кадр):');
for (const r of out)
  console.log('  %s %s', (r.warm ? 'прогретая' : 'холодная ').padEnd(12), r.ys.join(' '));
console.log('');
console.log('Lenis появился на кадре / вход букв снят на кадре (от первого колеса):');
for (const r of out)
  console.log('  %s Lenis %s, вход %s',
    (r.warm ? 'прогретая' : 'холодная ').padEnd(12), r.lenisAt, r.entAt);

await browser.close();
server.close();
const cold = out.find((r) => !r.warm);
const warm = out.find((r) => r.warm);
const lag = cold.frames - warm.frames;
console.log('');
console.log('ЛАГ ХОЛОДНОГО СТАРТА: %d кадров сверх прогретой, рывок %s px против %s',
  lag, cold.jump.toFixed(2), warm.jump.toFixed(2));
process.exit(0);

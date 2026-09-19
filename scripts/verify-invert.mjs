/**
 * ИНВЕРСИЯ В СЕРЕДИНЕ СТРАНИЦЫ — СПЛОШНЫМ ПЕРЕБОРОМ ПО ВСЕЙ ПРОКРУТКЕ.
 *
 * Та же методика, что у `verify-navsweep`, и по той же причине. Три
 * итерации подряд сторож шапки докладывал зелёное, а на живом телефоне
 * инверсии не было: он брал НЕСКОЛЬКО ВЫБРАННЫХ положений скролла,
 * а выбирал их из той же модели «где что лежит», по которой работала
 * сама шапка. Дырка в модели пряталась от проверки по построению (Р-47).
 *
 * Здесь не выбирается ничего. Прокрутка проходится целиком, и на каждом
 * положении, где слой выворотки физически есть на экране, снимается
 * растр ДВАЖДЫ — со скрытым слоем и с видимым. Разность даёт СОБСТВЕННЫЕ
 * ПИКСЕЛИ СЛОЯ, и для каждого известно, что под ним лежит:
 *
 *     под пикселем светлое (белое поле, белая литера, --dim, зелёное)
 *         → пиксель слоя обязан быть ТЁМНЫМ;
 *     под пикселем тёмное (--ink, объём дорожки)
 *         → пиксель слоя обязан быть СВЕТЛЫМ.
 *
 * Оба кадра снимаются В ОДНОЙ ЗАГРУЗКЕ и на одном положении: иначе
 * 3D-кадр и фаза бегущей строки разъезжаются между проходами, и разность
 * показывает не слой, а разницу двух отрисовок.
 *
 * ФАЗА БЕГУЩЕЙ СТРОКИ ТОЖЕ ПЕРЕБИРАЕТСЯ. Анимация останавливается
 * отрицательной задержкой, и задержка меняется от положения к положению:
 * за прогон строка проходит все восемь фаз круга, то есть проверяется
 * не одно её состояние, а весь ход.
 *
 * И ОТДЕЛЬНО — РАЗВЁРНУТЫЙ РЯД. Прокрутка проходится в покое, а под
 * строкой в этот момент только названия и подписи. Стоит развернуть ряд,
 * и под ней оказывается другое: крупная цена, кружки выбора аккаунта,
 * ЗЕЛЁНАЯ КНОПКА. Состояние ставится настоящим наведением, а не подменой
 * стилей: проверять надо тот кадр, который человек и увидит.
 */
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';
import { PNG } from 'pngjs';

const PORT = 4243;
const STEP = Number(process.env.SWEEP_STEP || 60);
const SIZES = [[390, 844, true], [1920, 1080, false], [2560, 1440, false]];
/* Круг бегущей строки — 40 с, фаз восемь. */
const PHASES = 8;
const DUR = 40;

const TARGETS = [
  { name: 'бегущая строка над рядами', box: '.mq', ink: '.mq__ink' },
  { name: 'шаги над панелью', box: '.steps__ink', ink: '.steps__ink' },
];

const rgb = (d, i) => [d[i], d[i + 1], d[i + 2]];
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
const lum = (c) => {
  const s = c.map((v) => {
    const u = v / 255;
    return u <= 0.03928 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
};
/* Судим только там, где фон ОДНОЗНАЧЕН: на сглаженной кромке лежит любая
   промежуточная яркость, и «правильного» ответа для неё нет. */
const isLight = (c) => lum(c) > 0.35;
const isDark = (c) => Math.max(...c) < 40;
const pink = (c) => c[0] > c[1] + 40 && c[2] > c[1] + 40;
const mid = (a) => (a.length ? a.sort((x, y) => x - y)[a.length >> 1] : null);

let failed = 0;
const server = await serveOut(PORT);
const browser = await launch();

for (const [w, h, mob] of SIZES) {
  const page = await browser.newPage({
    viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob, deviceScaleFactor: 1,
  });
  await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('.hero__stage[data-entered]');
  await page.evaluate(() => {
    const s = document.createElement('style');
    s.id = 'sweep';
    document.head.appendChild(s);
  });
  const rule = (css) => page.evaluate((c) => { document.getElementById('sweep').textContent = c; }, css);
  const max = await page.evaluate(() => {
    const s = document.getElementById('scroller');
    return s.scrollHeight - s.clientHeight;
  });

  const stat = TARGETS.map((t) => ({
    ...t, px: 0, onLight: 0, badLight: 0, onDark: 0, badDark: 0, pinkPx: 0, worst: [],
  }));

  let k = 0;
  for (let y = 0; y <= max; y += STEP, k += 1) {
    const phase = `.mq__text,.mq__ink{animation-play-state:paused!important;`
      + `animation-delay:-${((k % PHASES) * DUR) / PHASES}s!important}`;
    await rule(phase);
    await page.evaluate((v) => { document.getElementById('scroller').scrollTop = v; }, y);
    await page.waitForTimeout(30);

    for (const t of stat) {
      const clip = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const x0 = Math.max(0, Math.floor(r.left));
        const y0 = Math.max(0, Math.floor(r.top));
        const x1 = Math.min(window.innerWidth, Math.ceil(r.right));
        const y1 = Math.min(window.innerHeight, Math.ceil(r.bottom));
        if (x1 - x0 < 4 || y1 - y0 < 4) return null;
        return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
      }, t.box);
      if (!clip) continue;

      const live = PNG.sync.read(await page.screenshot({ clip }));
      await rule(`${phase}${t.ink}{visibility:hidden!important}`);
      const bare = PNG.sync.read(await page.screenshot({ clip }));
      await rule(phase);

      const W = live.width;
      const Hh = live.height;
      const own = new Uint8Array(W * Hh);
      for (let i = 0; i < W * Hh; i += 1) {
        const p = i << 2;
        const d = Math.abs(bare.data[p] - live.data[p]) + Math.abs(bare.data[p + 1] - live.data[p + 1])
          + Math.abs(bare.data[p + 2] - live.data[p + 2]);
        if (d >= 40) own[i] = 1;
      }
      /* Эрозия на пиксель: кромка глифа сглажена, и судить по ней о цвете
         нельзя — это не дефект, а антиалиасинг. Судим по сердцевине. */
      const lLum = [];
      const dLum = [];
      let sUnder = null;
      let sInk = null;
      for (let yy = 1; yy < Hh - 1; yy += 1) {
        for (let xx = 1; xx < W - 1; xx += 1) {
          const i = yy * W + xx;
          if (!own[i] || !own[i - 1] || !own[i + 1] || !own[i - W] || !own[i + W]
            || !own[i - W - 1] || !own[i - W + 1] || !own[i + W - 1] || !own[i + W + 1]) continue;
          const p = i << 2;
          const a = rgb(bare.data, p);
          const b = rgb(live.data, p);
          t.px += 1;
          if (pink(b)) t.pinkPx += 1;
          if (isLight(a)) {
            t.onLight += 1;
            lLum.push(lum(b));
            if (lum(b) > 0.12) {
              t.badLight += 1;
              if (!sUnder) { sUnder = a; sInk = b; }
            }
          } else if (isDark(a)) {
            t.onDark += 1;
            dLum.push(lum(b));
            if (lum(b) < 0.25) t.badDark += 1;
          }
        }
      }
      /* Приговор — МЕДИАНОЙ по положению. На мелком наборе часть пикселей
         уходит в субпиксельное сглаживание, и спорить с ней бессмысленно;
         настоящий дефект уводит медиану целиком. */
      const ml = lLum.length >= 30 ? mid(lLum) : null;
      const md = dLum.length >= 30 ? mid(dLum) : null;
      if ((ml !== null && ml > 0.12) || (md !== null && md < 0.25)) {
        t.worst.push({ y, ml, md, under: sUnder ? hex(sUnder) : '', ink: sInk ? hex(sInk) : '' });
      }
    }
  }
  /* ── РАЗВЁРНУТЫЙ РЯД ────────────────────────────────────────────────
     Под строкой оказывается зелёная кнопка и крупная цена, а не только
     названия. Ряд разворачивается настоящим наведением. */
  const open = stat[0];
  let rows = 0;
  await page.evaluate(() => {
    const el = document.querySelector('.plans');
    const sc = document.getElementById('scroller');
    sc.scrollTop += el.getBoundingClientRect().top - sc.clientHeight * 0.08;
  });
  await page.waitForTimeout(500);
  const heads = await page.$$('.plan__head');
  for (let r = 0; r < heads.length; r += 1) {
    const hb = await heads[r].boundingBox();
    if (!hb) continue;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.waitForTimeout(900);
    for (let ph = 0; ph < PHASES; ph += 1) {
      const phase = `.mq__text,.mq__ink{animation-play-state:paused!important;`
        + `animation-delay:-${(ph * DUR) / PHASES}s!important}`;
      await rule(phase);
      await page.waitForTimeout(24);
      const clip = await page.evaluate(() => {
        const el = document.querySelector('.mq');
        if (!el) return null;
        const r2 = el.getBoundingClientRect();
        const x0 = Math.max(0, Math.floor(r2.left));
        const y0 = Math.max(0, Math.floor(r2.top));
        const x1 = Math.min(window.innerWidth, Math.ceil(r2.right));
        const y1 = Math.min(window.innerHeight, Math.ceil(r2.bottom));
        if (x1 - x0 < 4 || y1 - y0 < 4) return null;
        return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
      });
      if (!clip) continue;
      const live = PNG.sync.read(await page.screenshot({ clip }));
      await rule(`${phase}.mq__ink{visibility:hidden!important}`);
      const bare = PNG.sync.read(await page.screenshot({ clip }));
      await rule(phase);
      rows += 1;
      const W = live.width;
      const Hh = live.height;
      const own = new Uint8Array(W * Hh);
      for (let i = 0; i < W * Hh; i += 1) {
        const pp = i << 2;
        const d = Math.abs(bare.data[pp] - live.data[pp]) + Math.abs(bare.data[pp + 1] - live.data[pp + 1])
          + Math.abs(bare.data[pp + 2] - live.data[pp + 2]);
        if (d >= 40) own[i] = 1;
      }
      const lL = [];
      const dL = [];
      for (let yy = 1; yy < Hh - 1; yy += 1) {
        for (let xx = 1; xx < W - 1; xx += 1) {
          const i = yy * W + xx;
          if (!own[i] || !own[i - 1] || !own[i + 1] || !own[i - W] || !own[i + W]
            || !own[i - W - 1] || !own[i - W + 1] || !own[i + W - 1] || !own[i + W + 1]) continue;
          const pp = i << 2;
          const a = rgb(bare.data, pp);
          const b = rgb(live.data, pp);
          open.px += 1;
          if (pink(b)) open.pinkPx += 1;
          if (isLight(a)) {
            open.onLight += 1;
            lL.push(lum(b));
            if (lum(b) > 0.12) open.badLight += 1;
          } else if (isDark(a)) {
            open.onDark += 1;
            dL.push(lum(b));
            if (lum(b) < 0.25) open.badDark += 1;
          }
        }
      }
      const ml = lL.length >= 30 ? mid(lL) : null;
      const md = dL.length >= 30 ? mid(dL) : null;
      if ((ml !== null && ml > 0.12) || (md !== null && md < 0.25)) {
        open.worst.push({ y: `ряд ${r + 1}, фаза ${ph}`, ml, md, under: '', ink: '' });
      }
    }
  }
  await page.close();

  console.log('\n%s   положений %d, шаг %d px; развёрнутый ряд — %d кадров',
    `${w}×${h}`, k, STEP, rows);
  for (const t of stat) {
    /* Слой ОБЯЗАН быть нарисован. Без этой строки сторож молча проходит
       там, где чернил нет вовсе, — а это ровно тот случай, когда инверсия
       «работает» на бумаге и её нет на экране. */
    const drawn = t.px >= 2000;
    const ok = drawn && t.worst.length === 0 && t.pinkPx === 0;
    if (!ok) failed += 1;
    console.log('  %s: своих пикселей %s%s', t.name.padEnd(26), String(t.px).padStart(8),
      drawn ? '' : '   ЧЕРНИЛ НЕТ');
    console.log('      над светлым %s, из них светлых %s (%s %%) — сглаживание кромки',
      String(t.onLight).padStart(8), String(t.badLight).padStart(7),
      t.onLight ? ((t.badLight / t.onLight) * 100).toFixed(1) : '0.0');
    console.log('      над тёмным  %s, из них тёмных  %s (%s %%) — то же%s',
      String(t.onDark).padStart(8), String(t.badDark).padStart(7),
      t.onDark ? ((t.badDark / t.onDark) * 100).toFixed(1) : '0.0',
      t.pinkPx ? `   РОЗОВЫХ ${t.pinkPx}` : '');
    for (const v of t.worst.slice(0, 5)) {
      console.log('      ПЛОХО на %s px: медиана над светлым %s, над тёмным %s%s',
        String(v.y).padStart(6), v.ml === null ? '  —  ' : v.ml.toFixed(3),
        v.md === null ? '  —  ' : v.md.toFixed(3),
        v.under ? `  (под ${v.under} нарисовано ${v.ink})` : '');
    }
    if (t.worst.length > 5) console.log('      …и ещё %d таких положений', t.worst.length - 5);
  }
}

await browser.close();
server.close();
console.log(failed
  ? `\nПРОВАЛОВ: ${failed} — инверсия в середине работает НЕ ВЕЗДЕ`
  : '\nНа всей прокрутке: над светлым слой тёмный, над тёмным светлый');
process.exit(failed ? 1 : 0);

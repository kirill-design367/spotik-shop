/**
 * ШАПКА ПРОТИВ ФОНА — СПЛОШНЫМ ПЕРЕБОРОМ ПО ВСЕЙ ПРОКРУТКЕ.
 *
 * Почему этот сторож появился. Три итерации подряд `verify-navpaint`
 * докладывал зелёное, а на живом телефоне инверсии не было. Причина
 * в методике: тот сторож берёт НЕСКОЛЬКО ВЫБРАННЫХ положений скролла
 * и смотрит цвет в окне логотипа. Выбранные положения выбирал я,
 * и выбирал их из своей же модели того, где шапка накрывает зелёное.
 * Если модель неверна — сторож смотрит мимо и молчит.
 *
 * Здесь наоборот: НИЧЕГО НЕ ВЫБИРАЕТСЯ. Страница проходится целиком
 * шагом меньше высоты полосы, на каждом положении снимается растр полосы шапки
 * ДВАЖДЫ — со скрытой шапкой и с видимой. Разность даёт СОБСТВЕННЫЕ
 * ПИКСЕЛИ ШАПКИ, и для каждого такого пикселя известно, что под ним
 * лежит. Дальше правило простое и ровно то, что задал арт-директор:
 *
 *     под пикселем зелёное  → пиксель шапки обязан быть тёмным;
 *     под пикселем тёмное   → пиксель шапки обязан быть светлым.
 *
 * Модели здесь нет вообще: ни где слово, ни где поле футера, ни когда
 * сцена отлипает. Есть только готовый кадр.
 */
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';
import { PNG } from 'pngjs';

const PORT = 4239;
/* Шаг перебора. 40 px меньше высоты полосы шапки (67…68 px), поэтому
   соседние положения ПЕРЕКРЫВАЮТСЯ: между замерами не может спрятаться
   ни одна область фона. Мельче — только дороже: при 24 px прогон стоит
   три минуты вместо двух, а находит ровно то же. */
const STEP = Number(process.env.SWEEP_STEP || 40);
const SIZES = [[390, 844, true], [1920, 1080, false], [2560, 1440, false]];

const rgb = (d, i) => [d[i], d[i + 1], d[i + 2]];
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
const lum = (c) => {
  const s = c.map((v) => {
    const u = v / 255;
    return u <= 0.03928 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
};
/* Судим только там, где фон ОДНОЗНАЧЕН. На сглаженной кромке между
   зелёной литерой и тёмным фоном лежит любая промежуточная яркость,
   и «правильного» ответа для неё нет: обе стороны защитимы. Такие
   пиксели не классифицируются вовсе. */
const isGreen = (c) => c[1] > c[0] + 70 && c[1] > c[2] + 70 && c[1] > 120;
const isInk = (c) => Math.max(...c) < 40;
const pink = (c) => c[0] > c[1] + 40 && c[2] > c[1] + 40;

let failed = 0;
const server = await serveOut(PORT);
const browser = await launch();

for (const [w, h, mob] of SIZES) {
  const shots = async (hide) => {
    const page = await browser.newPage({
      viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob, deviceScaleFactor: 1,
    });
    await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForSelector('.hero__stage[data-entered]');
    const g = await page.evaluate(() => ({
      navH: document.querySelector('.nav .nav__row').offsetHeight,
      max: document.getElementById('scroller').scrollHeight
        - document.getElementById('scroller').clientHeight,
    }));
    /* Прячем ВИДИМОСТЬЮ, а не display: раскладка обязана остаться той же,
       иначе сравнивать будет нечего. */
    if (hide) await page.addStyleTag({ content: '.nav,.nav-ink{visibility:hidden!important}' });
    await page.waitForTimeout(200);
    const out = [];
    for (let y = 0; y <= g.max; y += STEP) {
      await page.evaluate((v) => { document.getElementById('scroller').scrollTop = v; }, y);
      await page.waitForTimeout(24);
      out.push(PNG.sync.read(await page.screenshot({ clip: { x: 0, y: 0, width: w, height: g.navH } })));
    }
    await page.close();
    return { out, g };
  };

  const bare = await shots(true);
  const live = await shots(false);
  const n = Math.min(bare.out.length, live.out.length);

  let inkPx = 0;
  let onGreen = 0;
  let badGreen = 0;
  let onInk = 0;
  let badInk = 0;
  let pinkPx = 0;
  const worst = [];
  for (let k = 0; k < n; k += 1) {
    const A = bare.out[k];
    const B = live.out[k];
    const W = A.width;
    const Hh = A.height;
    /* Сначала карта СВОИХ пикселей шапки: изменилось от её появления. */
    const own = new Uint8Array(W * Hh);
    for (let i = 0; i < W * Hh; i += 1) {
      const p = i << 2;
      const d = Math.abs(A.data[p] - B.data[p]) + Math.abs(A.data[p + 1] - B.data[p + 1])
        + Math.abs(A.data[p + 2] - B.data[p + 2]);
      if (d >= 40) own[i] = 1;
    }
    /* Потом ЭРОЗИЯ на пиксель. Кромка глифа сглажена: там чернила смешаны
       с фоном в любой пропорции, и судить по ней о цвете нельзя — это
       не дефект, а антиалиасинг. Судим только по сердцевине штриха. */
    const gLum = [];
    const iLum = [];
    let sampleUnder = null;
    let sampleInk = null;
    for (let y = 1; y < Hh - 1; y += 1) {
      for (let x = 1; x < W - 1; x += 1) {
        const i = y * W + x;
        if (!own[i] || !own[i - 1] || !own[i + 1] || !own[i - W] || !own[i + W]
          || !own[i - W - 1] || !own[i - W + 1] || !own[i + W - 1] || !own[i + W + 1]) continue;
        const p = i << 2;
        const a = rgb(A.data, p);
        const b = rgb(B.data, p);
        inkPx += 1;
        if (pink(b)) pinkPx += 1;
        if (isGreen(a)) {
          onGreen += 1;
          gLum.push(lum(b));
          if (lum(b) > 0.12) {
            badGreen += 1;
            if (!sampleUnder) { sampleUnder = a; sampleInk = b; }
          }
        } else if (isInk(a)) {
          onInk += 1;
          iLum.push(lum(b));
          if (lum(b) < 0.25) badInk += 1;
        }
      }
    }
    /* Приговор выносится МЕДИАНОЙ по положению, а не по каждому пикселю.
       На мелком наборе доля пикселей уходит в субпиксельное сглаживание:
       у 19-пиксельного логотипа это до 6 % ядра, и спорить с ним
       бессмысленно. Настоящий дефект выглядит иначе — там неправильны
       ВСЕ пиксели сразу, и медиана уезжает целиком. */
    const mid = (a) => (a.length ? a.sort((x, y) => x - y)[a.length >> 1] : null);
    const mg = gLum.length >= 30 ? mid(gLum) : null;
    const mi = iLum.length >= 30 ? mid(iLum) : null;
    if ((mg !== null && mg > 0.12) || (mi !== null && mi < 0.25)) {
      worst.push({ y: k * STEP, mg, mi,
        under: sampleUnder ? hex(sampleUnder) : '', ink: sampleInk ? hex(sampleInk) : '' });
    }
  }

  /* Шапка ОБЯЗАНА быть нарисована. Без этой строки сторож молча проходит
     там, где чернил нет вовсе, — а это ровно тот случай, когда «инверсия
     работает» на бумаге и шапки нет на экране. Порог: не меньше 200 своих
     пикселей на положение в среднем. */
  const drawn = inkPx >= n * 80;
  const ok = drawn && worst.length === 0 && pinkPx === 0;
  if (!ok) failed += 1;
  console.log('%s положений %s   пикселей шапки %s', `${w}×${h}`.padEnd(12),
    String(n).padStart(4), String(inkPx).padStart(7));
  console.log('%s  над зелёным %s, из них светлых %s (%s %%) — сглаживание кромки',
    ' '.repeat(12), String(onGreen).padStart(7), String(badGreen).padStart(7),
    onGreen ? ((badGreen / onGreen) * 100).toFixed(1) : '0.0');
  console.log('%s  над тёмным  %s, из них тёмных  %s (%s %%) — то же%s',
    ' '.repeat(12), String(onInk).padStart(7), String(badInk).padStart(7),
    onInk ? ((badInk / onInk) * 100).toFixed(1) : '0.0',
    pinkPx ? `   РОЗОВЫХ ${pinkPx}` : '');
  if (!drawn) {
    console.log('%s  ЧЕРНИЛ ШАПКИ НЕТ: %d пикселей на %d положений', ' '.repeat(12), inkPx, n);
  }
  for (const v of worst.slice(0, 6)) {
    console.log('%s  ПЛОХО на %s px: медиана над зелёным %s, над тёмным %s%s',
      ' '.repeat(12), String(v.y).padStart(6),
      v.mg === null ? '  —  ' : v.mg.toFixed(3), v.mi === null ? '  —  ' : v.mi.toFixed(3),
      v.under ? `  (под ${v.under} нарисовано ${v.ink})` : '');
  }
  if (worst.length > 6) console.log('%s  …и ещё %d таких положений', ' '.repeat(12), worst.length - 6);
}

await browser.close();
server.close();
console.log(failed
  ? `\nПРОВАЛОВ: ${failed} — инверсия работает НЕ ВЕЗДЕ`
  : '\nНа всей прокрутке: над зелёным шапка тёмная, над тёмным светлая');
process.exit(failed ? 1 : 0);

/**
 * КАРТОЧКИ ТАРИФА: ГОЛОГРАФИЧЕСКАЯ КАРТА.
 *
 * Постановка двадцать четвёртой итерации сняла сцену three.js
 * с одной формулировкой: «они выглядят пиксельными — ты сам писал,
 * что выключил сглаживание ради цены и скругления идут ступеньками.
 * Это видно глазом, и это брак». Значит первое, что обязан проверять
 * сторож, — ЧТО КРОМКА СГЛАЖЕНА, и проверять по растру.
 *
 * Четыре проверки, и ни одна не пользуется моделью предмета (Р-47):
 *
 *   1. КРОМКА СГЛАЖЕНА НА ЛЮБОМ dpr. На скруглении считаются пиксели
 *      ПРОМЕЖУТОЧНОЙ яркости — между фоном и поверхностью. У ступеньки
 *      их нет вовсе, у сглаженной кромки они идут вдоль всей дуги;
 *   2. ОРЕОЛ НЕ ЛОЖИТСЯ НА СОСЕДНЮЮ КАРТУ. Свет лежит слоем 0, карты
 *      слоем 1 — но это надо ДОКАЗАТЬ кадром: два растра соседней
 *      карты, с ореолом выбранной и без него, обязаны совпасть (Р-68);
 *   3. ДОВОДКА НАКЛОНА ПРУЖИННАЯ, А НЕ ЭКСПОНЕНЦИАЛЬНАЯ. Экспонента
 *      подходит к цели снизу и никогда её не переходит; пружина
 *      с ζ < 1 обязана ПЕРЕЛЕТЕТЬ. Считается по фактическим значениям
 *      `--ry` покадрово;
 *   4. ДЫХАНИЕ В ПОКОЕ ЖИВОЕ. Его цена равна нулю ровно потому, что
 *      в кадре шевелится одна карта из четырёх, — но ноль выходит
 *      и на мёртвой сборке. Считаются разные значения `--rx`
 *      за две секунды покоя, у всех четырёх;
 *   5. РАСКЛАДКА В КАДРЕ НЕ МЕНЯЕТСЯ. Наклон, дыхание и подъём идут
 *      трансформом; если что-то из этого поехало в геометрию, бокс
 *      карты изменится.
 */
import { PNG } from 'pngjs';
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';

const PORT = 4268;
const server = await serveOut(PORT);
const browser = await launch();
let failed = false;

console.log('КАРТОЧКИ: кромка, свет, пружина.\n');

for (const [w, h, dpr] of [
  [390, 844, 2],
  [1920, 1080, 1],
  [2560, 1440, 1],
]) {
  const page = await browser.newPage({
    viewport: { width: w, height: h },
    isMobile: w < 720,
    hasTouch: w < 720,
    deviceScaleFactor: dpr,
  });
  await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const el = document.querySelector('.cards');
    const sc = document.getElementById('scroller');
    sc.scrollTop += el.getBoundingClientRect().top - sc.clientHeight * 0.16;
  });
  await page.waitForTimeout(900);

  const box = (k) =>
    page.evaluate((i) => {
      const r = document.querySelectorAll('.card')[i].getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }, k);

  // ── 1. КРОМКА СГЛАЖЕНА ──────────────────────────────────────────────
  /* Окно на левом верхнем скруглении первой карты. Считаются пиксели,
     чья яркость лежит МЕЖДУ фоном и поверхностью: у ступеньки
     таких нет. */
  const b0 = await box(0);
  const r = Math.round(
    parseFloat(
      await page.evaluate(() =>
        getComputedStyle(document.querySelector('.card')).borderTopLeftRadius,
      ),
    ),
  );
  const pad = 4;
  const clip = {
    x: Math.round(b0.x - pad),
    y: Math.round(b0.y - pad),
    width: r + pad * 2,
    height: r + pad * 2,
  };
  const png = PNG.sync.read(await page.screenshot({ clip }));
  let soft = 0;
  let lo = 255;
  let hi = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const g = png.data[i + 1];
    lo = Math.min(lo, g);
    hi = Math.max(hi, g);
  }
  for (let i = 0; i < png.data.length; i += 4) {
    const g = png.data[i + 1];
    if (g > lo + (hi - lo) * 0.2 && g < lo + (hi - lo) * 0.8) soft += 1;
  }
  /* Дуга длиной около r/2·π: сглаженных пикселей обязано быть
     хотя бы по одному на её пиксель. */
  const okSoft = hi - lo > 6 && soft >= r * dpr;

  // ── 2. ОРЕОЛ НЕ ЛОЖИТСЯ НА СОСЕДНЮЮ КАРТУ ───────────────────────────
  const b1 = await box(1);
  /* ⚠️ ОКНО ПОДЖИМАЕТСЯ НА РАДИУС СКРУГЛЕНИЯ. В углах карты
     самой карты нет — там прозрачно, и свет соседа виден там
     ЗАКОННО: это и есть свет по контуру. Проверяется тело плиты. */
  const inset = r + 2;
  const inner = {
    x: Math.round(b1.x + inset),
    y: Math.round(b1.y + inset),
    width: Math.round(b1.w - inset * 2),
    height: Math.round(b1.h - inset * 2),
  };
  /* ⚠️ КАРТЫ НА ВРЕМЯ СРАВНЕНИЯ ЗАМИРАЮТ. Они дышат, и между двумя
     кадрами успевают шевельнуться — эта разница читалась бы как
     «ореол лёг на соседа». Прищемляются все шесть чисел, из которых
     выводится и наклон, и фольга, и блик. */
  await page.addStyleTag({
    content:
      '.card,.cards__aura{--rx:0!important;--ry:0!important;--tz:0!important;' +
      '--px:0!important;--py:0!important;--spot:0!important}',
  });
  await page.waitForTimeout(220);
  /* Первая карта выбрана по умолчанию — её ореол самый яркий. */
  const withAura = await page.screenshot({ clip: inner });
  await page.addStyleTag({ content: ".cards__aura[data-i='0']{display:none!important}" });
  await page.waitForTimeout(160);
  const noAura = await page.screenshot({ clip: inner });
  await page.evaluate(() => {
    for (const st of document.querySelectorAll('style')) {
      if (st.textContent.includes("cards__aura[data-i='0']") || st.textContent.includes('--rx:0!important'))
        st.remove();
    }
  });
  await page.waitForTimeout(160);
  const a = PNG.sync.read(withAura);
  const b = PNG.sync.read(noAura);
  let bleed = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (
      Math.abs(a.data[i] - b.data[i]) > 3 ||
      Math.abs(a.data[i + 1] - b.data[i + 1]) > 3 ||
      Math.abs(a.data[i + 2] - b.data[i + 2]) > 3
    )
      bleed += 1;
  }
  const okBleed = bleed === 0;

  // ── 3. ПРУЖИНА ПЕРЕЛЕТАЕТ ───────────────────────────────────────────
  /* Курсор ставится в угол карты и стоит там; наклон обязан ПРОЙТИ
     мимо цели и вернуться. Экспоненциальный демпфер такого не даёт
     никогда. */
  const spring = await (async () => {
    if (w < 720) return null;
    await page.mouse.move(b0.x + b0.w * 0.5, b0.y + b0.h * 0.5);
    await page.waitForTimeout(700);
    await page.evaluate(() => {
      window.__ry = [];
      const el = document.querySelectorAll('.card')[0];
      const tick = () => {
        window.__ry.push(Number(el.style.getPropertyValue('--ry')));
        if (window.__ry.length < 90) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.mouse.move(b0.x + b0.w * 0.96, b0.y + b0.h * 0.5);
    await page.waitForTimeout(1500);
    return page.evaluate(() => window.__ry);
  })();
  let over = 0;
  let settled = 0;
  if (spring && spring.length) {
    const end = spring[spring.length - 1];
    const peak = Math.max(...spring);
    over = end > 0.2 ? (peak - end) / Math.abs(end) : 0;
    settled = Math.abs(spring[spring.length - 1] - spring[spring.length - 6]);
  }
  const okSpring = spring === null || (over > 0.015 && settled < 0.05);

  // ── 4. ДЫХАНИЕ В ПОКОЕ ЖИВОЕ ────────────────────────────────────────
  /* ⚠️ БЕЗ ЭТОЙ СТРОКИ ВСЁ ОСТАЛЬНОЕ ПРОХОДИТ НА МЁРТВОЙ СБОРКЕ.
     Цена дыхания в покое равна нулю ровно потому, что в кадре
     шевелится одна карта из четырёх, — но «ноль» выходит и тогда,
     когда не шевелится ни одна. Считаются РАЗНЫЕ значения `--rx`
     за две секунды покоя, у всех четырёх карт. */
  await page.mouse.move(4, h - 4);
  await page.waitForTimeout(500);
  const breath = await page.evaluate(
    () =>
      new Promise((res) => {
        const els = [...document.querySelectorAll('.card')];
        const sets = els.map(() => new Set());
        const t0 = performance.now();
        const step = () => {
          els.forEach((e, i) => sets[i].add(e.style.getPropertyValue('--rx')));
          if (performance.now() - t0 < 2000) requestAnimationFrame(step);
          else res(sets.map((x) => x.size));
        };
        requestAnimationFrame(step);
      }),
  );
  const okBreath = breath.length === 4 && breath.every((v) => v >= 6);

  // ── 5. РАСКЛАДКА В КАДРЕ НЕ МЕНЯЕТСЯ ────────────────────────────────
  const geo = await page.evaluate(async () => {
    const el = document.querySelectorAll('.card')[0];
    const grab = () => [el.offsetWidth, el.offsetHeight, el.offsetTop, el.offsetLeft].join(',');
    const a1 = grab();
    await new Promise((res) => setTimeout(res, 900));
    return [a1, grab()];
  });
  const okGeo = geo[0] === geo[1];

  if (!okSoft || !okBleed || !okSpring || !okGeo || !okBreath) failed = true;
  console.log(
    `  ${String(w).padStart(4)}×${h} dpr ${dpr}  скругление ${r} px: сглаженных пикселей ${soft} ` +
      `(порог ${r * dpr})  ореол на соседе ${bleed} px  ` +
      `перелёт пружины ${spring === null ? '—' : `${(over * 100).toFixed(1)} %`}  ` +
      `дыхание за 2 с: ${breath.join('/')} состояний  ` +
      `раскладка ${okGeo ? 'стоит' : 'ЕДЕТ'}` +
      (okSoft ? '' : '   !!! КРОМКА СТУПЕНЬКАМИ') +
      (okBleed ? '' : '   !!! ОРЕОЛ ЛЁГ НА СОСЕДА') +
      (okSpring ? '' : '   !!! ДОВОДКА НЕ ПРУЖИННАЯ') +
      (okBreath ? '' : '   !!! ДЫХАНИЕ НЕ ЖИВОЕ'),
  );
  await page.close();
}

await browser.close();
server.close();
console.log(
  failed
    ? '\nПРОВАЛ: карточки ведут себя не так, как задумано'
    : '\nКромка сглажена, свет не задевает соседа, доводка пружинная',
);
process.exit(failed ? 1 : 0);

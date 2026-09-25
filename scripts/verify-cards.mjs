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
 *   2. СВЕТ НЕ ЛОЖИТСЯ НА СОСЕДНЮЮ КАРТУ. Свет лежит слоем 0, карты
 *      слоем 1 — но это надо ДОКАЗАТЬ кадром: два растра соседней
 *      карты, со светом выбранной и без него, обязаны совпасть (Р-68);
 *   2а. ⚠️ ВОКРУГ СЕТКИ НЕТ НИ ОДНОГО ПРЯМОГО УГЛА И НИ ОДНОЙ ПРЯМОЙ
 *      СВЕТЛОЙ ЛИНИИ. Двадцать пятая итерация сняла свет, набранный
 *      стопкой колец `box-shadow`: у колец жёсткие прямые кромки,
 *      и десять контуров вокруг каждой из четырёх карт складывались
 *      в прямоугольное поле вокруг ВСЕЙ сетки. Проверяется двумя
 *      числами по растру: наибольший СКАЧОК яркости между соседними
 *      пикселями (у размытого света его нет, у кромки он есть)
 *      и то, что углы прямоугольника, описанного вокруг светлых
 *      пикселей, ТЁМНЫЕ — у поля они были бы светлыми;
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
  /* ⚠️ ПЕРЕЛИВ ПО КАЙМЕ ЗАМОРОЖЕН НА ВСЁ ВРЕМЯ РАСТРОВЫХ ПРОВЕРОК.
     Свет за картой и кромку судят РАЗНОСТЬЮ двух кадров, а перелив
     движется — между кадрами он успевает уехать, и разность
     наполняется его следом. Это ровно то же правило, по которому
     на время снимка гасится сам свет: сравнивать надо один предмет,
     а не два. Сам перелив проверяется отдельно и с живой анимацией. */
  await page.addStyleTag({ content: '.card__edge::before{animation:none!important}' });
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
     таких нет.

     ⚠️ СВЕТ НА ВРЕМЯ ЭТОЙ ПРОВЕРКИ ГАСИТСЯ. Он мягко поднимает
     яркость снаружи карты, и вилка «самый тёмный — самый светлый»
     в окне начинает описывать не кромку, а спад света: полоса
     20…80 % уезжает целиком выше перехода, и сглаженные пиксели
     в счёт не попадают. Проверяется кромка ПЛИТЫ, значит фон
     под ней должен быть чистым. */
  await page.addStyleTag({ content: '.cards__glow{display:none!important}' });
  await page.waitForTimeout(200);
  const b0 = await box(0);
  const r = Math.round(
    parseFloat(
      await page.evaluate(() =>
        getComputedStyle(document.querySelector('.card')).borderTopLeftRadius,
      ),
    ),
  );
  const pad = 4;
  /* ⚠️ ОКНО НАКРЫВАЕТ ТОЛЬКО ДУГУ, И НИ ПИКСЕЛЯ БОЛЬШЕ. Прежнее
     было `r + 2·pad`, то есть заходило внутрь плиты за скругление, —
     и на 390 в него попадала первая строка НАЗВАНИЯ. Белые чернила
     давали hi = 255, полоса 20…80 % уезжала в 65…208, а настоящий
     переход 18 → 55 не попадал в неё вовсе. */
  const clip = {
    x: Math.round(b0.x - pad),
    y: Math.round(b0.y - pad),
    width: r + pad,
    height: r + pad,
  };
  const png = PNG.sync.read(await page.screenshot({ clip }));
  /* ⚠️ ПОЛКИ СНИМАЮТСЯ МЕДИАНОЙ ДВУХ УГЛОВ, А НЕ МИНИМУМОМ
     И МАКСИМУМОМ ПО ОКНУ. Любая посторонняя яркость — чернила,
     блик, соседний слой — сдвигает вилку целиком, и переход
     перестаёт попадать в полосу. Верхний левый угол окна лежит
     ЗА дугой (фон), нижний правый — в теле плиты; обе величины
     берутся из самого кадра, модели предмета в них нет (Р-47). */
  const patch = (x0, y0) => {
    const v = [];
    for (let y = y0; y < y0 + 4; y += 1)
      for (let x = x0; x < x0 + 4; x += 1) v.push(png.data[(y * png.width + x) * 4 + 1]);
    return v.sort((p, q) => p - q)[v.length >> 1];
  };
  /* ⚠️ ВЕРХНЯЯ ПОЛКА БЕРЁТСЯ С КАЙМЫ, А НЕ С ПЛИТЫ. С тридцать
     четвёртой итерации внешний контур карты — это КАЙМА в один
     пиксель, и она СВЕТЛЕЕ плиты: переход снаружи внутрь идёт
     фон → кайма, а не фон → плита. Полка, снятая в теле плиты,
     лежала бы НИЖЕ каймы, полоса 20…80 % уезжала бы под неё,
     и сглаженные пиксели в счёт не попадали бы вовсе — сторож
     докладывал бы ступеньку на исправной кромке.

     Полка снимается из САМОГО КАДРА: в каждой строке окна берётся
     самый светлый пиксель (это и есть кайма), и по строкам берётся
     медиана. Модели предмета здесь нет (Р-47) — только то,
     что нарисовано. */
  const lo = patch(0, 0);
  const rowMax = [];
  for (let y = 0; y < png.height; y += 1) {
    let m = 0;
    for (let x = 0; x < png.width; x += 1) m = Math.max(m, png.data[(y * png.width + x) * 4 + 1]);
    rowMax.push(m);
  }
  const hi = [...rowMax].sort((p, q) => p - q)[rowMax.length >> 1];
  /* ⚠️ СЧИТАЕТСЯ ТОЛЬКО ВНЕШНИЙ СКАТ, ДО ГРЕБНЯ КАЙМЫ. За каймой
     идёт плита, и её яркость лежит МЕЖДУ фоном и каймой — то есть
     попала бы в полосу целиком и дала бы сотни «сглаженных»
     пикселей на ровном месте. */
  let soft = 0;
  for (let y = 0; y < png.height; y += 1) {
    if (rowMax[y] < lo + (hi - lo) * 0.5) continue;
    let greben = 0;
    for (let x = 0; x < png.width; x += 1) {
      if (png.data[(y * png.width + x) * 4 + 1] === rowMax[y]) { greben = x; break; }
    }
    for (let x = 0; x < greben; x += 1) {
      const g = png.data[(y * png.width + x) * 4 + 1];
      if (g > lo + (hi - lo) * 0.2 && g < lo + (hi - lo) * 0.8) soft += 1;
    }
  }
  /* ПОРОГ РАЗЛИЧАЕТ СТУПЕНЬКУ ОТ СГЛАЖИВАНИЯ, А НЕ ОДНО
     сглаживание от другого. У ступеньки промежуточных
     пикселей НЕТ ВОВСЕ, у сглаженной дуги их порядка её длины.
     Требовать по одному НА КАЖДУЮ СТРОКУ нельзя: там, где дуга
     идёт почти вертикально и кромка ложится на границу пикселя,
     честно сглаженный растр даёт переход в ОДИН пиксель
     без промежуточной яркости. Поэтому считается СУММА вдоль
     всей дуги, а порог взят с запасом к квантованию. */
  /* ⚠️ ПОРОГ ПЕРЕСЧИТАН ПОД ВНЕШНИЙ СКАТ. Прежний считал пиксели
     по всей дуге и брал 0.6 её длины; теперь считается ОДИН скат
     на строку, и у честно сглаженной кромки он даёт около пикселя
     на строку. Порог — треть строк окна: у ступеньки промежуточных
     пикселей нет ВОВСЕ, так что различать надо ноль и «есть». */
  const softMin = Math.max(6, Math.round(png.height * 0.33));
  const okSoft = hi - lo > 6 && soft >= softMin;
  await page.evaluate(() => {
    for (const st of document.querySelectorAll('style')) {
      if (st.textContent.includes('.cards__glow{display:none')) st.remove();
    }
  });
  await page.waitForTimeout(300);

  // ── 2. СВЕТ НЕ ЛОЖИТСЯ НА СОСЕДНЮЮ КАРТУ ────────────────────────────
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
      '.card{--rx:0!important;--ry:0!important;--tz:0!important;' +
      '--px:0!important;--py:0!important;--spot:0!important}',
  });
  await page.waitForTimeout(220);
  /* Первая карта выбрана по умолчанию — её свет самый яркий. */
  const withAura = await page.screenshot({ clip: inner });
  await page.addStyleTag({ content: ".cards__glow[data-i='0']{display:none!important}" });
  await page.waitForTimeout(400);
  const noAura = await page.screenshot({ clip: inner });
  await page.evaluate(() => {
    for (const st of document.querySelectorAll('style')) {
      if (st.textContent.includes("cards__glow[data-i='0']") || st.textContent.includes('--rx:0!important'))
        st.remove();
    }
  });
  await page.waitForTimeout(400);
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

  // ── 2а. НИ ПРЯМОГО УГЛА, НИ ПРЯМОЙ СВЕТЛОЙ ЛИНИИ ВОКРУГ СЕТКИ ───────
  /* ⚠️ СУДИТСЯ РАЗНОСТЬ ДВУХ КАДРОВ, А НЕ ОДИН КАДР. Вокруг сетки
     лежит обычное содержимое страницы — заголовок, плашки срока,
     строка «ВЫБРАНО», кнопка, — и у его чернил скачок яркости
     в две с лишним сотни уровней совершенно законный. Первый заход
     считал именно его и падал на ровном месте. Разность «со светом
     минус без света» не содержит ничего, кроме САМОГО СВЕТА:
     всё остальное в обоих кадрах одинаково и вычитается в ноль. */
  const grid = await page.evaluate(() => {
    const g = document.querySelector('.cards').getBoundingClientRect();
    return { x: g.x, y: g.y, w: g.width, h: g.height };
  });
  await page.addStyleTag({
    content:
      '.card{--rx:0!important;--ry:0!important;--tz:0!important;' +
      '--px:0!important;--py:0!important;--spot:0!important}',
  });
  /* ⚠️ НА ВРЕМЯ СНИМКА ВОКРУГ СЕТКИ НЕ ОСТАЁТСЯ НИЧЕГО, КРОМЕ
     ФОНА, и это не удобство, а условие замера. Свет полупрозрачный:
     над тёмным фоном он поднимает яркость сильнее, чем над светлой
     плашкой срока, — и на КРОМКЕ ПЛАШКИ разность даёт скачок
     в полсотни уровней, который принадлежит ПЛАШКЕ, а не свету.
     Первый заход считал именно его и падал на ровном месте:
     скачок 55 уровней стоял над переключателем срока, выше самих
     карт. Тот же класс у шапки: её чернила рисует выворотка
     СОБСТВЕННОГО фона (Р-47), а фон под ней меняет именно свет.
     `visibility` вместо `display` — чтобы раскладка не ехала и сетка
     осталась на своём месте. */
  await page.addStyleTag({
    content:
      '/*iso*/.nav,.nav-ink,#pricing .shell>*:not(.cards),' +
      'main>*:not(#pricing){visibility:hidden!important}',
  });
  await page.waitForTimeout(300);
  const gpad = Math.round(Math.min(150, grid.w * 0.16));
  const halo = {
    x: Math.max(0, Math.round(grid.x - gpad)),
    y: Math.max(0, Math.round(grid.y - gpad)),
    width: Math.round(Math.min(w - Math.max(0, grid.x - gpad), grid.w + gpad * 2)),
    height: Math.round(grid.h + gpad * 2),
  };
  const onShot = PNG.sync.read(await page.screenshot({ clip: halo }));
  /* ⚠️ ТРЕТИЙ КАДР — КОНТРОЛЬНЫЙ: тот же свет с ПРЯМЫМИ углами.
     Он и есть тот брак, который видел арт-директор, и по нему
     калибруется проверка 2б: без контроля не видно, ЧТО именно
     число различает. */
  await page.addStyleTag({ content: '/*sq*/.cards__glow{border-radius:0!important}' });
  await page.waitForTimeout(300);
  const sqShot = PNG.sync.read(await page.screenshot({ clip: halo }));
  await page.evaluate(() => {
    for (const st of document.querySelectorAll('style')) {
      if (st.textContent.includes('/*sq*/')) st.remove();
    }
  });
  await page.addStyleTag({ content: '.cards__glow{display:none!important}' });
  await page.waitForTimeout(400);
  const offShot = PNG.sync.read(await page.screenshot({ clip: halo }));
  await page.evaluate(() => {
    for (const st of document.querySelectorAll('style')) {
      if (
        st.textContent.includes('.cards__glow{display:none') ||
        st.textContent.includes('--rx:0!important') ||
        st.textContent.includes('/*iso*/')
      )
        st.remove();
    }
  });
  await page.waitForTimeout(400);

  const W = onShot.width;
  const H = onShot.height;
  /* Разность в уровнях яркости: это и есть свет и ничего кроме. */
  const dif = new Float32Array(W * H);
  const L = (png, i) => (png.data[i] * 299 + png.data[i + 1] * 587 + png.data[i + 2] * 114) / 1000;
  for (let k = 0; k < W * H; k += 1) dif[k] = Math.abs(L(onShot, k * 4) - L(offShot, k * 4));

  /* Тела карт из счёта исключаются: карта непрозрачна, света
     под ней не видно, а на её кромке разность обрывается законно. */
  const cardBoxes = await page.evaluate(
    (o) =>
      [...document.querySelectorAll('.card')].map((el) => {
        const b = el.getBoundingClientRect();
        return { x: b.x - o.x, y: b.y - o.y, w: b.width, h: b.height };
      }),
    { x: halo.x, y: halo.y },
  );
  const inCard = (px, py) =>
    cardBoxes.some(
      (b) =>
        px >= (b.x - 3) * dpr && px <= (b.x + b.w + 3) * dpr &&
        py >= (b.y - 3) * dpr && py <= (b.y + b.h + 3) * dpr,
    );

  let jump = 0;
  let peak = 0;
  let lit = 0;
  let minX = W;
  let minY = H;
  let maxX = -1;
  let maxY = -1;
  /* Разность в один уровень — это уже свет: на тёмном фоне он виден. */
  const FLOOR = 1;
  for (let y = 1; y < H - 1; y += 1) {
    for (let x = 1; x < W - 1; x += 1) {
      if (inCard(x, y)) continue;
      const v = dif[y * W + x];
      if (v > peak) peak = v;
      if (v > FLOOR) {
        lit += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      if (inCard(x + 1, y) || inCard(x, y + 1)) continue;
      jump = Math.max(jump, Math.abs(v - dif[y * W + x + 1]), Math.abs(v - dif[(y + 1) * W + x]));
    }
  }
  /* Углы описанного прямоугольника: у прямоугольного поля они
     светлые, у четырёх размытых пятен — пустые. */
  const corners =
    maxX < 0
      ? []
      : [
          dif[(minY + 2) * W + minX + 2],
          dif[(minY + 2) * W + maxX - 2],
          dif[(maxY - 2) * W + minX + 2],
          dif[(maxY - 2) * W + maxX - 2],
        ];
  const cornerMax = corners.length ? Math.max(...corners) : 999;

  /* Свет обязан БЫТЬ: без этой строки проверка прошла бы на пустой
     странице (Р-47). */
  const okLitSome = lit > 400;
  /* ⚠️ ПОРОГ СКАЧКА ВЫВОДИТСЯ ИЗ САМОГО СВЕТА, А НЕ ЗАДАН ЧИСЛОМ.
     Абсолютный порог здесь не работает: чем ярче свет, тем круче
     его собственный спад — у света амплитудой 90 уровней
     на переходе в три десятка пикселей три уровня на пиксель
     совершенно законны. Кромка отличается от спада не крутизной
     в уровнях, а ДОЛЕЙ от собственной амплитуды: у размытой тени
     это единицы процентов, у стопки колец было 55 из 90, то есть
     больше половины. Порог — десятая часть амплитуды. */
  const edgeMax = Math.max(2, peak * 0.1);
  const okNoEdge = jump <= edgeMax;
  const okNoRect = cornerMax <= FLOOR;

  // ── 2б. ФОРМА СВЕТА ПОВТОРЯЕТ СКРУГЛЕНИЕ КАРТЫ ─────────────────────
  /* ⚠️ ЭТОГО СТОРОЖ НЕ ВИДЕЛ ТРИ ИТЕРАЦИИ, И ВОТ ПОЧЕМУ. Проверка 2а
     ищет скачок яркости и светлые углы описанного прямоугольника —
     у размытой тени ПРЯМОУГОЛЬНИКА нет ни того, ни другого: она
     такая же гладкая, как у скруглённой. А глазом видно другое:
     тень обрезается по собственному border-box, и при нулевом
     радиусе между скруглённым углом КАРТЫ и прямым углом ТЕНИ
     остаётся мёртвый клин — свет вокруг карты обрывается прямым
     углом. Ровно это и есть «квадраты по бокам».

     Замер прямой: берутся восемь точек на одинаковом расстоянии
     ОТ КОНТУРА КАРТЫ — четыре по нормали к сторонам и четыре
     по диагонали из центров угловых дуг. У света, повторяющего
     карту, все восемь равны; у прямоугольного диагональные лежат
     в мёртвом клине и дают ноль. Расстояние берётся меньше
     r·(√2−1): дальше клина уже нет и различать нечего. */
  const rr = await page.evaluate(
    () => parseFloat(getComputedStyle(document.querySelector('.card')).borderTopLeftRadius) || 0,
  );
  const probe = (src, b) => {
    const D = Math.max(3, rr * 0.25);
    const at = (px, py) => {
      const vs = [];
      for (let y = -1; y <= 1; y += 1) {
        for (let x = -1; x <= 1; x += 1) {
          const ix = Math.round((px + x) * dpr);
          const iy = Math.round((py + y) * dpr);
          if (ix < 0 || iy < 0 || ix >= W || iy >= H) continue;
          vs.push(Math.abs(L(src, (iy * W + ix) * 4) - L(offShot, (iy * W + ix) * 4)));
        }
      }
      vs.sort((p, q) => p - q);
      return vs.length ? vs[vs.length >> 1] : 0;
    };
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const edges = [
      at(cx, b.y - D),
      at(cx, b.y + b.h + D),
      at(b.x - D, cy),
      at(b.x + b.w + D, cy),
    ];
    const k = (rr + D) / Math.SQRT2;
    const corners = [
      at(b.x + rr - k, b.y + rr - k),
      at(b.x + b.w - rr + k, b.y + rr - k),
      at(b.x + rr - k, b.y + b.h - rr + k),
      at(b.x + b.w - rr + k, b.y + b.h - rr + k),
    ];
    edges.sort((p, q) => p - q);
    const med = edges[2];
    return med > 0.5 ? Math.min(...corners) / med : 0;
  };
  /* Судится ВЫБРАННАЯ карта: её свет ярче всех, и шум от соседей
     на её долю приходится меньше всего. */
  const selBox = await page.evaluate(
    (o) => {
      const el = document.querySelector(".card[aria-checked='true']") || document.querySelector('.card');
      const b = el.getBoundingClientRect();
      return { x: b.x - o.x, y: b.y - o.y, w: b.width, h: b.height };
    },
    { x: halo.x, y: halo.y },
  );
  const round = probe(onShot, selBox);
  const square = probe(sqShot, selBox);
  /* ⚠️ ПОРОГ ВЗЯТ ИЗ КОНТРОЛЯ, А НЕ НАЗНАЧЕН. У света, повторяющего
     карту, угол даёт около 30 % яркости стороны — и это НЕ дефект,
     а геометрия: угол выпуклый, и размытие сходится там вдвое
     быстрее, чем у прямой стороны. У прямоугольного света на том же
     кадре 9 %: мёртвый клин между дугой карты и прямым углом тени.
     Порог 20 % лежит ровно посередине, с полуторным запасом
     в обе стороны. */
  const okRound = round >= 0.2;

  // ── 3. ПРУЖИНА ПЕРЕЛЕТАЕТ ───────────────────────────────────────────
  /* Курсор ставится в угол карты и стоит там; наклон обязан ПРОЙТИ
     мимо цели и вернуться. Экспоненциальный демпфер такого не даёт
     никогда. */
  /* ⚠️ ШАГ БЕРЁТСЯ ОТ КРАЯ ДО КРАЯ, А ПЕРЕЛЁТ СЧИТАЕТСЯ
     ОТ ПИКА ДО БЛИЖАЙШЕГО ПРОВАЛА, А НЕ ДО КОНЦА ЗАМЕРА.
     Причина одна и она важная: на том же `--ry` сидит ДЫХАНИЕ,
     и его амплитуда сравнима с самим перелётом. Прежняя
     формула брала «пик минус последний отсчёт», то есть сравнивала
     два момента в полутора секундах друг от друга, и в ответе
     сидело столько же дыхания, сколько пружины: три прогона
     на НЕИЗМЕННОМ коде давали то 9 %, то 3 %. Разводится это
     СКОРОСТЬЮ: дыхание проходит свою амплитуду за десятки секунд,
     пружина возвращается с пика за полсекунды. В окне в 0.5 с
     дыхание даёт сотые градуса, а перелёт — целый градус.
     У экспоненты провала после пика нет вовсе. */
  const spring = await (async () => {
    if (w < 720) return null;
    await page.mouse.move(b0.x + b0.w * 0.04, b0.y + b0.h * 0.5);
    await page.waitForTimeout(900);
    await page.evaluate(() => {
      window.__ry = [];
      const el = document.querySelectorAll('.card')[0];
      const tick = () => {
        window.__ry.push(Number(el.style.getPropertyValue('--ry')));
        if (window.__ry.length < 130) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.mouse.move(b0.x + b0.w * 0.96, b0.y + b0.h * 0.5);
    await page.waitForTimeout(2600);
    return page.evaluate(() => window.__ry);
  })();
  if (process.env.DBG_SPRING && spring) console.log('    spring', spring.length, JSON.stringify(spring));
  let over = 0;
  let settled = 0;
  if (spring && spring.length) {
    const start = spring[0];
    const end = spring[spring.length - 1];
    const step = Math.abs(end - start);
    const peakAt = spring.indexOf(Math.max(...spring));
    /* Провал ищется в полусекунде ПОСЛЕ пика: тридцать кадров. */
    const dip = Math.min(...spring.slice(peakAt, peakAt + 30));
    over = step > 1 ? (spring[peakAt] - dip) / step : 0;
    settled = Math.abs(spring[spring.length - 1] - spring[spring.length - 6]);
  }
  const okSpring = spring === null || (over > 0.02 && settled < 0.05);

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

  // ── 6. КАЙМА У КАЖДОЙ КАРТЫ, И У ВЫБРАННОЙ ОНА ЗЕЛЁНАЯ ──────────────
  /* Постановка тридцать четвёртой итерации: «карточки сливаются
     с фоном; у каждой тонкая светлая кайма в один пиксель, у ВЫБРАННОЙ
     кайма зелёная». Судится по РАСТРУ левой кромки на середине высоты:
     берётся полоска, накрывающая фон, кайму и начало плиты, и в ней
     ищется самый светлый столбец. Свет на время снимка гасится — он
     поднимает яркость снаружи карты и смазал бы разницу «фон — кайма».

     ⚠️ ЗЕЛЕНЬ СУДИТСЯ РАЗНОСТЬЮ КАНАЛОВ, А НЕ ПОХОЖЕСТЬЮ НА ЦВЕТ.
     У светлой каймы каналы равны, у зелёной зелёный заметно выше
     красного — и это верно при любой яркости, то есть не зависит
     ни от подложки, ни от того, что мы написали в CSS. */
  await page.addStyleTag({ content: '.cards__glow{display:none!important}' });
  await page.waitForTimeout(250);
  const vybrana = await page.evaluate(() =>
    [...document.querySelectorAll('.card')].findIndex((e) => e.getAttribute('aria-checked') === 'true'),
  );
  const kaymy = [];
  for (let i = 0; i < 4; i += 1) {
    const b = await box(i);
    const clip = {
      x: Math.round(b.x - 3),
      y: Math.round(b.y + b.h / 2 - 2),
      width: 10,
      height: 5,
    };
    const im = PNG.sync.read(await page.screenshot({ clip }));
    const stolb = (x) => {
      const v = [];
      for (let y = 0; y < im.height; y += 1) {
        const o = (y * im.width + x) * 4;
        v.push([im.data[o], im.data[o + 1], im.data[o + 2]]);
      }
      v.sort((p, q) => p[1] - q[1]);
      return v[v.length >> 1];
    };
    let luch = null;
    for (let x = 0; x < im.width; x += 1) {
      const c = stolb(x);
      if (!luch || c[1] > luch[1]) luch = c;
    }
    const fon = stolb(0);
    const plita = stolb(im.width - 1);
    kaymy.push({
      vyshe: Math.min(luch[1] - fon[1], luch[1] - plita[1]),
      zelen: luch[1] - luch[0],
    });
  }
  /* Кайма обязана быть светлее И фона, И плиты — иначе это
     не кайма, а просто край плиты. */
  const okKayma = kaymy.length === 4 && kaymy.every((k) => k.vyshe >= 8);
  const okZelen =
    vybrana >= 0 &&
    kaymy[vybrana].zelen >= 25 &&
    kaymy.every((k, i) => i === vybrana || Math.abs(k.zelen) <= 8);
  await page.evaluate(() => {
    for (const st of document.querySelectorAll('style')) {
      if (st.textContent.includes('.cards__glow{display:none')) st.remove();
    }
  });
  await page.waitForTimeout(200);

  if (
    !okKayma ||
    !okZelen ||
    !okSoft ||
    !okBleed ||
    !okSpring ||
    !okGeo ||
    !okBreath ||
    !okNoEdge ||
    !okNoRect ||
    !okRound ||
    !okLitSome
  )
    failed = true;
  console.log(
    `  ${String(w).padStart(4)}×${h} dpr ${dpr}  скругление ${r} px: сглаженных пикселей ${soft} ` +
      `(порог ${softMin})  свет на соседе ${bleed} px  ` +
      `перелёт пружины ${spring === null ? '—' : `${(over * 100).toFixed(1)} %`}  ` +
      `дыхание за 2 с: ${breath.join('/')} состояний  ` +
      `раскладка ${okGeo ? 'стоит' : 'ЕДЕТ'}` +
      (okSoft ? '' : '   !!! КРОМКА СТУПЕНЬКАМИ') +
      (okBleed ? '' : '   !!! СВЕТ ЛЁГ НА СОСЕДА') +
      (okSpring ? '' : '   !!! ДОВОДКА НЕ ПРУЖИННАЯ') +
      (okBreath ? '' : '   !!! ДЫХАНИЕ НЕ ЖИВОЕ'),
  );
  console.log(
    `            кайма: светлее фона и плиты на ${kaymy.map((k) => k.vyshe).join('/')} уровня ` +
      `(порог 8), зелень выбранной ${vybrana >= 0 ? kaymy[vybrana].zelen : '—'} ` +
      `против ${kaymy.filter((_, i) => i !== vybrana).map((k) => k.zelen).join('/')} у остальных` +
      (okKayma ? '' : '   !!! КАЙМЫ НЕТ') +
      (okZelen ? '' : '   !!! КАЙМА ВЫБРАННОЙ НЕ ЗЕЛЁНАЯ'),
  );
  console.log(
    `            свет вокруг сетки: ${lit} светлых пикселей, ` +
      `амплитуда ${peak.toFixed(0)}, наибольший скачок ${jump.toFixed(1)} уровня ` +
      `(порог ${edgeMax.toFixed(1)}), ` +
      `углы описанного прямоугольника ${cornerMax.toFixed(1)} (порог ${FLOOR})` +
      (okLitSome ? '' : '   !!! СВЕТА НЕТ ВОВСЕ') +
      (okNoEdge ? '' : '   !!! ВИДИМАЯ КРОМКА: КОЛЬЦО ИЛИ СТУПЕНЬ') +
      (okNoRect ? '' : '   !!! ПРЯМОУГОЛЬНОЕ ПОЛЕ ВОКРУГ СЕТКИ'),
  );
  console.log(
    `            форма света: у угла карты ${(round * 100).toFixed(0)} % ` +
      `от яркости у стороны (порог 20), у прямоугольного света на том же ` +
      `кадре ${(square * 100).toFixed(0)} %` +
      (okRound ? '' : '   !!! СВЕТ ОБРЫВАЕТСЯ ПРЯМЫМ УГЛОМ'),
  );
  await page.close();
}

// ── 7. ПЕРЕЛИВ ИДЁТ ПО КОНТУРУ, А ПРИ «УМЕНЬШИТЬ ДВИЖЕНИЕ» СТОИТ ──────
/* Постановка: «по кайме выбранной медленно идёт светлый зелёный блик».
   Судится по РАСТРУ и по ПОРЯДКУ, а не по тому, что написано в CSS:
   снимается серия кадров за один круг, в каждом берутся четыре точки
   каймы — верх, низ, лево, право, — и смотрится, КАКАЯ из них сейчас
   самая светлая. У блика, идущего по контуру, эта точка обязана
   смениться: за круг он проходит все четыре стороны. У неподвижной
   каймы она одна и та же на всех кадрах — и это ровно то, что
   требуется при «уменьшить движение».

   ⚠️ ТОЧКИ БЕРУТСЯ ОТ ЖИВОГО БОКСА НА КАЖДОМ КАДРЕ. Карта дышит,
   и за восемь секунд её кромка успевает уехать на пиксель: точки,
   посчитанные один раз, съехали бы с каймы на фон. */
{
  const zamer = async (reduced) => {
    const page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
      reducedMotion: reduced ? 'reduce' : 'no-preference',
    });
    await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => {
      const el = document.querySelector('.cards');
      const sc = document.getElementById('scroller');
      sc.scrollTop += el.getBoundingClientRect().top - sc.clientHeight * 0.16;
    });
    /* Свет за картой гасится: он ярче блика и при поиске самой
       светлой точки каймы победил бы всегда. */
    await page.addStyleTag({ content: '.cards__glow{display:none!important}' });
    await page.waitForTimeout(700);

    const storony = [];
    const zelen = [];
    for (let k = 0; k < 14; k += 1) {
      const b = await page.evaluate(() => {
        const el =
          document.querySelector(".card[aria-checked='true']") || document.querySelector('.card');
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      });
      const im = PNG.sync.read(
        await page.screenshot({
          clip: {
            x: Math.round(b.x - 2),
            y: Math.round(b.y - 2),
            width: Math.round(b.w + 4),
            height: Math.round(b.h + 4),
          },
        }),
      );
      /* Самый светлый пиксель в окне 5×5 вокруг точки каймы. Окно
         нужно ровно затем, чтобы пережить дыхание: оно двигает
         кромку на доли пикселя. */
      const yark = (px, py) => {
        let best = [0, 0, 0];
        for (let y = py - 2; y <= py + 2; y += 1) {
          for (let x = px - 2; x <= px + 2; x += 1) {
            if (x < 0 || y < 0 || x >= im.width || y >= im.height) continue;
            const o = (y * im.width + x) * 4;
            if (im.data[o + 1] > best[1]) best = [im.data[o], im.data[o + 1], im.data[o + 2]];
          }
        }
        return best;
      };
      const mid = [
        yark(Math.round(im.width / 2), 2),
        yark(im.width - 3, Math.round(im.height / 2)),
        yark(Math.round(im.width / 2), im.height - 3),
        yark(2, Math.round(im.height / 2)),
      ];
      let luchshaya = 0;
      for (let i = 1; i < 4; i += 1) if (mid[i][1] > mid[luchshaya][1]) luchshaya = i;
      storony.push(luchshaya);
      zelen.push(mid[luchshaya][1] - mid[luchshaya][0]);
      await page.waitForTimeout(520);
    }
    await page.close();
    return { storon: new Set(storony).size, zelen: Math.min(...zelen) };
  };

  const zhivoy = await zamer(false);
  const tikho = await zamer(true);
  /* Круг идёт семь секунд, серия — 14 кадров по 0.52 с плюс время
     самих снимков, то есть заведомо больше круга. Блик обязан
     побывать не меньше чем на трёх сторонах из четырёх. */
  const okBeg = zhivoy.storon >= 3;
  const okTikho = tikho.storon === 1 && tikho.zelen >= 25;
  if (!okBeg || !okTikho) failed = true;
  console.log(
    `\n  перелив по кайме: за круг блик побывал на ${zhivoy.storon} сторонах из 4 ` +
      `(порог 3); при «уменьшить движение» сторон ${tikho.storon} (нужна 1), ` +
      `кайма остаётся зелёной на ${tikho.zelen} уровня (порог 25)` +
      (okBeg ? '' : '   !!! ПЕРЕЛИВ НЕ ИДЁТ') +
      (okTikho ? '' : '   !!! ПРИ «УМЕНЬШИТЬ ДВИЖЕНИЕ» ПЕРЕЛИВ НЕ ЗАМЕР'),
  );
}

await browser.close();
server.close();
console.log(
  failed
    ? '\nПРОВАЛ: карточки ведут себя не так, как задумано'
    : '\nКромка сглажена, свет мягкий и без углов, доводка пружинная',
);
process.exit(failed ? 1 : 0);

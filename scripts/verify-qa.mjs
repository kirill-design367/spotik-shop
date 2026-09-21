/**
 * ВОПРОСЫ: ОТВЕТ БЕЖИТ ОДНОЙ СТРОКОЙ ПОПЕРЁК ВОПРОСА.
 *
 * Двадцать пятая итерация переставила саму полосу: была под
 * вопросом, зелёная и мелкая, стала ПОПЕРЁК вопроса, белая
 * и крупная. Семь требований, и каждое проверяется отдельно:
 *
 *   1. ответ строго в ОДНУ строку, без переносов;
 *   2. петля БЕЗ ШВА;
 *   3. скорость спокойная;
 *   4. ушёл курсор — строка уходит ПЛАВНО;
 *   5. одновременно бежит ТОЛЬКО ОДНА строка;
 *   6. раскладка НЕ ПРЫГАЕТ, когда строка появилась;
 *   7. строка идёт ПОПЕРЁК НАБОРА вопроса, она БЕЛАЯ,
 *      а сам вопрос на это время ПРИГЛУШЁН — именно приглушением
 *      держится читаемость обоих.
 *
 * ⚠️ ПРО МЕТОДИКУ. Три из семи судятся по ГОТОВОМУ КАДРУ или
 * по фактическому трансформу, а не по нашим же числам: шов
 * ловится сравнением начала и конца круга по СТОЛБЦАМ ЧЕРНИЛ,
 * скорость — сдвигом дорожки за известное время, прыжок раскладки —
 * координатами всех шести вопросов до и после включения строки.
 * Сторож, который читал бы `--dur` и сравнивал его с формулой
 * из предмета, сошёлся бы с ним по построению (Р-47).
 *
 * ⚠️ НА ВРЕМЯ СНИМКА ШВА ВОПРОС ПРЯЧЕТСЯ, И ЭТО НЕ ПОДГОНКА.
 * Полоса теперь лежит ПОВЕРХ набора вопроса, и в её растр
 * попадают чужие чернила — белые и НЕПОДВИЖНЫЕ. Столбец,
 * в котором стоит литера вопроса, НИКОГДА не будет пустым —
 * то есть настоящая пустота в петле спряталась бы за вопросом.
 * `visibility` раскладку не трогает, и полоса остаётся на месте.
 *
 * ⚠️ ПРО ДВА ПУТИ. На точном указателе строку ведёт `:hover` в CSS,
 * на касаниях — ближайший к линии отсчёта. Это РАЗНЫЕ механизмы,
 * и проверяются они врозь: перебор прокрутки на мобильном профиле
 * и наведение на десктопном.
 */
import { PNG } from 'pngjs';
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';

const PORT = 4267;
const server = await serveOut(PORT);
const browser = await launch();
let failed = false;

/**
 * ШОВ: СКОЛЬКО СТОЛБЦОВ ПОЛОСЫ ЗАПОЛНЕНЫ В ОДНОМ КАДРЕ И ПУСТЫ В ДРУГОМ.
 *
 * ⚠️ ПОБИТОВОЕ СРАВНЕНИЕ ЗДЕСЬ НЕ ГОДИТСЯ, И ЭТО ЗАМЕР. Ширина одной
 * копии дробная (1055.75 px на 1920), значит в конце круга дорожка
 * стоит на той же букве, но в ДРУГОЙ доле пикселя — сглаживание
 * глифов выходит иным. Шумовая полка: сдвиг на 0.12 px даёт уже
 * 1791 различающийся пиксель, на 0.5 px — 6991. Строгий сторож ловил
 * бы эту долю пикселя и звал её швом.
 *
 * Настоящий шов выглядит иначе: в конце круга справа открывается
 * ПУСТОТА — дорожка кончилась. Поэтому считаются СТОЛБЦЫ: в одном
 * кадре чернила есть, в другом их нет вовсе (с допуском в соседний
 * столбец). Пустота на полтысячи пикселей даёт полтысячи таких
 * столбцов, сглаживание — ни одного.
 */
function diff(a, b) {
  const x = PNG.sync.read(a);
  const y = PNG.sync.read(b);
  if (x.width !== y.width || x.height !== y.height) return Infinity;
  const ink = (img) => {
    const c = new Array(img.width).fill(0);
    for (let j = 0; j < img.height; j += 1) {
      for (let i = 0; i < img.width; i += 1) {
        const p = (j * img.width + i) * 4;
        /* Строка теперь БЕЛАЯ, а не зелёная: чернила
           опознаются по яркости над фоном `--ink` (18). */
        const lum = (img.data[p] * 299 + img.data[p + 1] * 587 + img.data[p + 2] * 114) / 1000;
        if (lum > 70) c[i] += 1;
      }
    }
    return c;
  };
  const ia = ink(x);
  const ib = ink(y);
  /* ⚠️ И СТОРОЖ ОБЯЗАН ПАДАТЬ, КОГДА НЕ НАРИСОВАНО НИЧЕГО. Без этой
     строки «пустых столбцов ноль» вышло бы и на сборке, где строки
     нет вовсе: пусто в обоих кадрах — значит расхождений нет (Р-47). */
  if (!ia.some((v) => v >= 2) || !ib.some((v) => v >= 2)) return Infinity;
  const near = (arr, i) => Math.max(arr[i - 1] ?? 0, arr[i], arr[i + 1] ?? 0);
  let n = 0;
  for (let i = 0; i < ia.length; i += 1) {
    if ((ia[i] >= 2 && near(ib, i) === 0) || (ib[i] >= 2 && near(ia, i) === 0)) n += 1;
  }
  return n;
}

console.log('ВОПРОСЫ: ответ бежит одной строкой.\n');

for (const [w, h, mob] of [
  [390, 844, true],
  [1920, 1080, false],
  [2560, 1440, false],
]) {
  const page = await browser.newPage({
    viewport: { width: w, height: h },
    isMobile: mob,
    hasTouch: mob,
    deviceScaleFactor: 1,
  });
  await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);

  // ── 1. ОДНА СТРОКА, БЕЗ ПЕРЕНОСОВ ──────────────────────────────────
  const lines = await page.evaluate(() =>
    [...document.querySelectorAll('.qa__item')].map((it) => {
      const c = it.querySelector('.qa__copy');
      const r = c.getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(c).lineHeight);
      return {
        wrap: getComputedStyle(c).whiteSpace,
        /* Высота копии больше одного интерлиньяжа — значит перенос. */
        rows: Math.round(r.height / lh),
      };
    }),
  );
  const okOne = lines.length === 6 && lines.every((l) => l.wrap === 'nowrap' && l.rows === 1);

  // ── 2. ПЕТЛЯ БЕЗ ШВА ────────────────────────────────────────────────
  /* Кадр в начале круга и кадр в его конце обязаны совпасть: дорожка
     несёт две одинаковые копии, ход ровно −50 % её ширины. Судится
     ПОБИТОВО по растру полосы, а не по числам в CSS. */
  const K = 1;
  /* ⚠️ ПОЗИЦИЮ СТАВИМ НАПРЯМУЮ И ДАЁМ ЕЙ СОЙТИСЬ. `scrollIntoView`
     при вложенной прокрутке двигает не то (Р-37), а на точном
     указателе позицию ведёт Lenis и доводит её сам — мгновенное
     чтение после записи возвращает промежуточное значение, и два
     кадра снимаются с РАЗНЫХ мест. Ровно на этом сторож и падал
     «швом» в 15 % пикселей (Р-45, Р-61). */
  await page.evaluate((k) => {
    const it = document.querySelectorAll('.qa__item')[k];
    const sc = document.getElementById('scroller');
    sc.scrollTop += it.getBoundingClientRect().top - sc.clientHeight * 0.4;
    it.setAttribute('data-on', '');
  }, K);
  await page.waitForTimeout(700);
  const strip = await page.evaluate((k) => {
    const r = document.querySelectorAll('.qa__item')[k]
      .querySelector('.qa__tick')
      .getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  }, K);
  const at = async (ms) => {
    await page.evaluate(
      ([k, t]) => {
        const run = document.querySelectorAll('.qa__item')[k].querySelector('.qa__run');
        for (const a of run.getAnimations()) {
          a.pause();
          a.currentTime = t;
        }
      },
      [K, ms],
    );
    await page.waitForTimeout(120);
    /* Прямоугольник читается ЗАНОВО перед каждым кадром: если полоса
       всё-таки уехала, сторож обязан упасть на несовпадении рамки,
       а не выдать это за шов. */
    const now = await page.evaluate((k) => {
      const r = document.querySelectorAll('.qa__item')[k]
        .querySelector('.qa__tick')
        .getBoundingClientRect();
      return Math.round(r.y);
    }, K);
    if (now !== strip.y) return null;
    return page.screenshot({ clip: strip });
  };
  const dur = await page.evaluate((k) => {
    const run = document.querySelectorAll('.qa__item')[k].querySelector('.qa__run');
    const a = run.getAnimations()[0];
    return a ? a.effect.getTiming().duration : 0;
  }, K);
  await page.addStyleTag({ content: '/*noq*/.qa__q{visibility:hidden!important}' });
  await page.waitForTimeout(150);
  const a0 = dur ? await at(0.5) : null;
  const a1 = dur ? await at(dur - 0.5) : null;
  const seam = a0 && a1 ? diff(a0, a1) : Infinity;
  await page.evaluate(() => {
    for (const st of document.querySelectorAll('style'))
      if (st.textContent.includes('/*noq*/')) st.remove();
  });
  await page.waitForTimeout(150);
  const okSeam = seam <= Math.round(strip.width * 0.01);

  // ── 3. СКОРОСТЬ ─────────────────────────────────────────────────────
  /* Меряется ФАКТИЧЕСКИМ сдвигом дорожки за известное время, а не
     нашей же формулой. Спокойная — это десятки пикселей в секунду. */
  const speed = await page.evaluate(
    async ([k]) => {
      const run = document.querySelectorAll('.qa__item')[k].querySelector('.qa__run');
      const a = run.getAnimations()[0];
      if (!a) return 0;
      const x = () => new DOMMatrixReadOnly(getComputedStyle(run).transform).m41;
      a.pause();
      a.currentTime = 1000;
      const x1 = x();
      a.currentTime = 3000;
      const x2 = x();
      return Math.abs(x2 - x1) / 2;
    },
    [K],
  );
  const okSpeed = speed > 30 && speed < 110;

  // ── 6. РАСКЛАДКА НЕ ПРЫГАЕТ ─────────────────────────────────────────
  const jump = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.qa__item')];
    for (const it of items) it.removeAttribute('data-on');
    const off = items.map((it) => it.querySelector('.qa__q').getBoundingClientRect().top);
    let worst = 0;
    for (let k = 0; k < items.length; k += 1) {
      items[k].setAttribute('data-on', '');
      const on = items.map((it) => it.querySelector('.qa__q').getBoundingClientRect().top);
      for (let i = 0; i < on.length; i += 1) worst = Math.max(worst, Math.abs(on[i] - off[i]));
      items[k].removeAttribute('data-on');
    }
    return worst;
  });
  const okJump = jump < 0.01;

  // ── 7. ПОПЕРЁК ВОПРОСА, БЕЛАЯ, КРУПНАЯ, ВОПРОС ПРИГЛУШЁН ────────────
  /* Постановка: «строка бежит прямо через набор вопроса», «цвет
     белый», «кегль крупнее», «пока бежит ответ, сам вопрос
     приглушается». Все четыре — измеримые величины, и берутся они
     из живой страницы, а не из наших констант. */
  /* ⚠️ ПРИГЛУШЕНИЕ ЧИТАЕТСЯ ПОСЛЕ ПЕРЕХОДА, А НЕ СРАЗУ
     ЗА АТРИБУТОМ. У `opacity` стоит переход в 320 мс, и в тот же
     кадр `getComputedStyle` честно отдаёт ЕЩЁ ПРЕЖНЕЕ значение —
     первый заход читал 1.00 и честно падал. */
  const across = await (async () => {
    const box = await page.evaluate(() => {
      const it = document.querySelectorAll('.qa__item')[0];
      it.removeAttribute('data-on');
      return Number(getComputedStyle(it.querySelector('.qa__q')).opacity);
    });
    await page.evaluate(() => document.querySelectorAll('.qa__item')[0].setAttribute('data-on', ''));
    await page.waitForTimeout(520);
    const on = await page.evaluate(() => {
      const it = document.querySelectorAll('.qa__item')[0];
      const q = it.querySelector('.qa__q');
      const tick = it.querySelector('.qa__tick');
      const cs = getComputedStyle(it.querySelector('.qa__copy'));
      const qb = q.getBoundingClientRect();
      const tb = tick.getBoundingClientRect();
      return {
        /* Середина полосы обязана лежать ВНУТРИ набора вопроса. */
        inside: tb.top + tb.height / 2 > qb.top && tb.top + tb.height / 2 < qb.bottom,
        /* И полоса обязана перекрывать набор, а не касаться его краем. */
        overlap: Math.min(tb.bottom, qb.bottom) - Math.max(tb.top, qb.top),
        tickH: tb.height,
        color: cs.color,
        size: parseFloat(cs.fontSize),
        dim: Number(getComputedStyle(q).opacity),
      };
    });
    await page.evaluate(() => document.querySelectorAll('.qa__item')[0].removeAttribute('data-on'));
    await page.waitForTimeout(400);
    return { ...on, bright: box };
  })();
  const okAcross =
    across.inside &&
    across.overlap >= across.tickH * 0.9 &&
    across.color === 'rgb(255, 255, 255)' &&
    across.size >= 18 &&
    across.bright > 0.98 &&
    across.dim <= 0.5 &&
    across.dim >= 0.2;

  // ── 4 и 5: два пути, и они разные ───────────────────────────────────
  let many = 0;
  let seen = 0;
  let fade = -1;
  if (mob) {
    /* НА КАСАНИЯХ — перебор всей прокрутки блока: одновременно
       бежит не больше одной строки, и хотя бы раз бежит ровно одна. */
    const range = await page.evaluate(() => {
      const el = document.querySelector('.qa');
      const sc = document.getElementById('scroller');
      const base = sc.getBoundingClientRect().top - sc.scrollTop;
      const r = el.getBoundingClientRect();
      return { from: r.top - base - sc.clientHeight, to: r.bottom - base };
    });
    let pos = 0;
    for (let y = range.from; y <= range.to; y += 14) {
      await page.evaluate((t) => {
        document.getElementById('scroller').scrollTop = Math.max(0, t);
      }, y);
      await page.waitForTimeout(24);
      const n = await page.evaluate(
        () =>
          [...document.querySelectorAll('.qa__item')].filter(
            (it) => Number(getComputedStyle(it).getPropertyValue('--on')) > 0.01,
          ).length,
      );
      pos += 1;
      if (n > 1) many += 1;
      if (n === 1) seen += 1;
    }
    console.log(
      `  ${String(w).padStart(4)}×${h}  касания: положений ${pos}, с двумя строками ${many}, ` +
        `с одной ${seen}`,
    );
  } else {
    /* НА ТОЧНОМ УКАЗАТЕЛЕ — наведение. Ведёт его CSS, поэтому
       проверяем и то, что бежит ровно одна, и то, что после ухода
       курсора строка гаснет ПЛАВНО, а не пропадает в один кадр. */
    await page.evaluate(() => {
      const it = document.querySelectorAll('.qa__item')[2];
      it.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(300);
    const b = await page.evaluate(() => {
      const r = document.querySelectorAll('.qa__item')[2].querySelector('.qa__q').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.move(b.x, b.y);
    await page.waitForTimeout(500);
    const onNow = await page.evaluate(
      () =>
        [...document.querySelectorAll('.qa__item')].filter(
          (it) => Number(getComputedStyle(it).getPropertyValue('--on')) > 0.01,
        ).length,
    );
    if (onNow > 1) many += 1;
    if (onNow === 1) seen += 1;
    /* Уход курсора: снимаем прозрачность покадрово и считаем,
       сколько миллисекунд она падала. Мгновенное исчезновение —
       это ноль. */
    await page.mouse.move(4, h - 4);
    fade = await page.evaluate(
      () =>
        new Promise((res) => {
          const el = document.querySelectorAll('.qa__item')[2].querySelector('.qa__tick');
          const t0 = performance.now();
          const step = () => {
            const v = Number(getComputedStyle(el).opacity);
            const dt = performance.now() - t0;
            if (v < 0.02 || dt > 1500) res(Math.round(dt));
            else requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        }),
    );
    console.log(
      `  ${String(w).padStart(4)}×${h}  наведение: бежит строк ${onNow}, ` +
        `гаснет за ${fade} мс (окно 150…900)`,
    );
  }
  const okOnly = many === 0 && seen > 0;
  const okFade = mob || (fade >= 150 && fade <= 900);

  if (!okOne || !okSeam || !okSpeed || !okJump || !okOnly || !okFade || !okAcross) failed = true;
  console.log(
    `            строк в ответе ${lines.map((l) => l.rows).join('')}  ` +
      `шов: пустых столбцов ${seam === Infinity ? '—' : seam} из ${strip.width}  ` +
      `скорость ${speed.toFixed(1)} px/с  круг ${(dur / 1000).toFixed(1)} с  ` +
      `прыжок раскладки ${jump.toFixed(3)} px` +
      (okOne ? '' : '   !!! ОТВЕТ НЕ В ОДНУ СТРОКУ') +
      (okSeam ? '' : '   !!! ШОВ В ПЕТЛЕ') +
      (okSpeed ? '' : '   !!! СКОРОСТЬ ВНЕ ОКНА') +
      (okJump ? '' : '   !!! РАСКЛАДКА ПРЫГАЕТ') +
      (okOnly ? '' : '   !!! БЕЖИТ НЕ ОДНА СТРОКА') +
      (okFade ? '' : '   !!! СТРОКА ПРОПАДАЕТ РЫВКОМ'),
  );
  console.log(
    `            поперёк вопроса: перекрытие ${across.overlap.toFixed(0)} из ${across.tickH.toFixed(0)} px, ` +
      `цвет ${across.color}, кегль ${across.size.toFixed(1)} px, ` +
      `вопрос ${across.bright.toFixed(2)} → ${across.dim.toFixed(2)}` +
      (okAcross ? '' : '   !!! СТРОКА НЕ ПОПЕРЁК, НЕ БЕЛАЯ ИЛИ ВОПРОС НЕ ПРИГЛУШЁН'),
  );
  await page.close();
}

await browser.close();
server.close();
console.log(
  failed
    ? '\nПРОВАЛ: бегущая строка ответа ведёт себя не так, как задумано'
    : '\nОтвет бежит одной строкой: петля без шва, одна за раз, раскладка стоит',
);
process.exit(failed ? 1 : 0);

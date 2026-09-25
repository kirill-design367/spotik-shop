/**
 * МАРШРУТ: ПОДСВЕТКА ИДЁТ ОТ НАЧАЛА К КОНЦУ И ВОЗВРАЩАЕТСЯ.
 *
 * Постановка: «подсветка привязана к скроллу, идёт строго от начала
 * к концу; прокрутил назад — гаснет обратно. Номер шага появляется,
 * когда подсветка дошла до его точки, не раньше. Движение непрерывное,
 * без ступенек».
 *
 * Проверяется это ДВУМЯ РАЗНЫМИ ПРОХОДАМИ, и смешивать их нельзя.
 *
 *   ПЕРЕБОР ПОЛОЖЕНИЙ (телепорт + выдержка) отвечает на вопросы
 *   «монотонно ли», «в том ли порядке загораются номера» и «доходит ли
 *   ход до концов». Выдержка обязательна: на касаниях подсветку ведёт
 *   демпфер, и мгновенное чтение после записи `scrollTop` возвращает
 *   ещё вчерашнее значение.
 *
 *   ЖИВОЙ ПРОХОД КОЛЕСОМ отвечает на вопрос «нет ли ступенек». Здесь
 *   выдержка, наоборот, запрещена: она бы и сгладила ровно то, что
 *   ищем. Метрика та же, что у морфа вордмарка (Р-18): кадров, где
 *   скролл ехал, а подсветка стояла.
 *
 * И отдельной строкой — РАСТР: сторож обязан падать, когда линии нет
 * вовсе. Без этой строки все инварианты выше проходили бы и на сборке,
 * где маска сломана и не рисуется ничего (Р-47).
 *
 * ── ДВАДЦАТЬ ПЕРВАЯ ИТЕРАЦИЯ ДОБАВИЛА ДВЕ ПРОВЕРКИ ────────────────────────
 * КОГДА ЗАГОРАЕТСЯ ШАГ. Постановка: «шаг должен загораться, пока он ещё
 * в НИЖНЕЙ половине экрана, а не когда доехал до середины; к моменту,
 * когда блок уходит вверх, маршрут обязан быть пройден целиком».
 * Меряется положение точки шага на экране в тот момент, когда её номер
 * загорелся, — в долях высоты экрана, где 0.5 это середина.
 *
 * ЛИНИЯ НЕ РЕЖЕТ ТЕКСТ. Шаги стоят рельефом, текст занимает всю ширину,
 * и петля, поставленная по долям перегона, проходила прямо по абзацу.
 * Проверяется по растру и по фактическим строчным боксам: зелёных
 * пикселей внутри строки быть не должно. Это ровно тот класс дефекта,
 * который видно глазом и не видно ни одному инварианту выше.
 */
import { PNG } from 'pngjs';
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';

const PORT = 4263;
const SETTLE = 260; // выдержка на схождение демпфера, мс
const server = await serveOut(PORT);
const browser = await launch();
let failed = false;

/**
 * Сколько пикселей ЛЕНТЫ на кадре.
 *
 * ⚠️ ПОРОГ НИЗКИЙ, И ЭТО ОБЯЗАТЕЛЬНО. Ядро ленты почти белое
 * (160, 226, 183), а ореолы — зелёное с прозрачностью 0.09…0.2
 * поверх `--ink`, то есть около (20, 51, 31). Строгий порог
 * «зелёный вдвое больше соседей» не видит ни того, ни другого:
 * у белого ядра красный слишком велик, у ореола зелёный слишком мал.
 */
function band2(buf) {
  const img = PNG.sync.read(buf);
  let n = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i];
    const g = img.data[i + 1];
    const b = img.data[i + 2];
    if (g > 26 && g > r + 8 && g > b + 8) n += 1;
  }
  return n;
}

/** Сколько зелёных пикселей на кадре — грубо, по превышению зелёного канала. */
function greens(buf) {
  const img = PNG.sync.read(buf);
  let n = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i];
    const g = img.data[i + 1];
    const b = img.data[i + 2];
    if (g > 70 && g > r * 1.8 && g > b * 1.8) n += 1;
  }
  return n;
}

const PROBE = `
window.__rt = { rows: [], on: false };
(() => {
  const tick = () => {
    if (window.__rt.on) {
      const rt = document.querySelector('.route');
      const sc = document.getElementById('scroller');
      if (rt && sc) window.__rt.rows.push([sc.scrollTop, Number(rt.style.getPropertyValue('--lit') || 0)]);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();
`;

console.log('МАРШРУТ: перебор положений плюс живой проход колесом.\n');

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
  await page.addInitScript(PROBE);
  await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);

  const range = await page.evaluate(() => {
    const el = document.querySelector('.route');
    const sc = document.getElementById('scroller');
    const base = sc.getBoundingClientRect().top - sc.scrollTop;
    const r = el.getBoundingClientRect();
    return { from: r.top - base - sc.clientHeight, to: r.bottom - base };
  });

  const park = async (top) => {
    await page.evaluate((t) => {
      document.getElementById('scroller').scrollTop = Math.max(0, t);
    }, top);
    await page.waitForTimeout(SETTLE);
  };
  const state = () =>
    page.evaluate(() => ({
      p: Number(document.querySelector('.route').style.getPropertyValue('--lit') || 0),
      n: [...document.querySelectorAll('.rstep')].map((e) =>
        Number(getComputedStyle(e).getPropertyValue('--n')),
      ),
    }));

  const ys = [];
  for (let y = range.from; y <= range.to; y += 26) ys.push(y);

  /* Точки шагов на странице — по ним считается, где был шаг в тот
     момент, когда загорелся его номер. */
  const dots = await page.evaluate(() => {
    const el = document.querySelector('.route');
    const sc = document.getElementById('scroller');
    const base = sc.getBoundingClientRect().top - sc.scrollTop;
    const top = el.getBoundingClientRect().top - base;
    return {
      vh: sc.clientHeight,
      bottom: el.getBoundingClientRect().bottom - base,
      y: [...document.querySelectorAll('.rstep')].map(
        (e) => top + parseFloat(e.style.getPropertyValue('--dot-y') || '0'),
      ),
    };
  });
  const litAt = new Array(dots.y.length).fill(null);

  // ── проход вниз: монотонность и порядок ──────────────────────────────
  let backSlip = 0;
  let orderBad = 0;
  let prev = -1;
  let last = null;
  for (const y of ys) {
    await park(y);
    const r = await state();
    if (prev >= 0 && r.p < prev - 1e-6) backSlip += 1;
    prev = r.p;
    for (let i = 1; i < r.n.length; i += 1) {
      /* Порог выше «подготовительного» свечения: оно разрешено
         постановкой отдельно и до порядка отношения не имеет. */
      if (r.n[i] > 0.3 && r.n[i - 1] < 0.999) orderBad += 1;
    }
    /* Где был шаг на экране в тот момент, когда его номер загорелся. */
    for (let i = 0; i < r.n.length; i += 1) {
      if (litAt[i] === null && r.n[i] >= 0.5) litAt[i] = (dots.y[i] - y) / dots.vh;
    }
    last = r;
  }

  // ── проход вверх: гаснет обратно ─────────────────────────────────────
  let fwdSlip = 0;
  prev = 2;
  for (let i = ys.length - 1; i >= 0; i -= 1) {
    await park(ys[i]);
    const r = await state();
    if (r.p > prev + 1e-6) fwdSlip += 1;
    prev = r.p;
  }
  await park(range.from);
  const first = await state();

  // ── живой проход колесом: ступенек быть не должно ────────────────────
  await park(range.from + 20);
  await page.evaluate(() => {
    window.__rt.rows.length = 0;
    window.__rt.on = true;
  });
  const total = range.to - range.from;
  for (let i = 0; i < 40; i += 1) {
    await page.mouse.wheel(0, total / 40);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    window.__rt.on = false;
  });
  const rows = await page.evaluate(() => window.__rt.rows);
  let dead = 0;
  let moved = 0;
  let maxStep = 0;
  for (let i = 1; i < rows.length; i += 1) {
    const dy = rows[i][0] - rows[i - 1][0];
    const dp = Math.abs(rows[i][1] - rows[i - 1][1]);
    if (Math.abs(dy) > 0.5 && rows[i - 1][1] > 0 && rows[i - 1][1] < 1) {
      moved += 1;
      if (dp < 1e-6) dead += 1;
    }
    maxStep = Math.max(maxStep, dp);
  }

  // ── растр: линия обязана появиться ───────────────────────────────────
  const vis = () =>
    page.evaluate(() => {
      const r = document.querySelector('.route').getBoundingClientRect();
      const x = Math.max(0, Math.round(r.left));
      const y = Math.max(0, Math.round(r.top));
      return {
        x,
        y,
        width: Math.max(1, Math.round(Math.min(r.right, window.innerWidth) - x)),
        height: Math.max(1, Math.round(Math.min(r.bottom, window.innerHeight) - y)),
      };
    });
  await park(range.from + total * 0.02);
  const dark = greens(await page.screenshot({ clip: await vis() }));
  await park(range.from + total * 0.6);
  const lit = greens(await page.screenshot({ clip: await vis() }));

  /* Маршрут обязан быть пройден ДО ТОГО, как блок уйдёт вверх:
     ставим его низ на 70 % высоты экрана — блок ещё виден. */
  await park(dots.bottom - dots.vh * 0.7);
  /* Демпфер на касаниях доводит подсветку за 120 мс, а прыжок сюда
     идёт с другого конца страницы: одной выдержки мало. */
  await page.waitForTimeout(SETTLE * 2);
  const early = await state();

  const lowest = Math.min(...litAt.map((v) => (v === null ? -1 : v)));
  const okWhen = litAt.every((v) => v !== null && v > 0.5);
  const okAhead = early.p > 0.999;

  const okEnds = last.p > 0.999 && last.n.every((v) => v > 0.999) && first.p < 0.001;
  const okDraw = lit > dark + 200;
  const okLive = moved > 10 && dead === 0;
  /* ── линия не режет текст: растр против строчных боксов ───────────── */
  await park(range.from + total * 0.6);
  const geo = await page.evaluate(() => {
    const r = document.querySelector('.route').getBoundingClientRect();
    const rects = [];
    for (const el of document.querySelectorAll('.rstep__t, .rstep__d')) {
      const range2 = document.createRange();
      range2.selectNodeContents(el);
      for (const b of range2.getClientRects()) {
        if (b.width < 2 || b.height < 2) continue;
        rects.push({ x: b.x - r.x, y: b.y - r.y, w: b.width, h: b.height });
      }
    }
    return { box: { x: r.x, y: r.y, width: r.width, height: r.height }, rects };
  });
  let crossed = 0;
  if (geo.box.height > 0 && geo.box.width > 0) {
    const shot = PNG.sync.read(
      await page.screenshot({
        clip: {
          x: Math.max(0, geo.box.x),
          y: Math.max(0, geo.box.y),
          width: geo.box.width,
          height: geo.box.height,
        },
        // блок выше экрана — снимок всё равно нужен целиком
        scale: 'css',
      }),
    );
    const dy = geo.box.y < 0 ? geo.box.y : 0;
    for (const b of geo.rects) {
      let hit = 0;
      const x0 = Math.max(0, Math.floor(b.x));
      const x1 = Math.min(shot.width, Math.ceil(b.x + b.w));
      const y0 = Math.max(0, Math.floor(b.y + dy));
      const y1 = Math.min(shot.height, Math.ceil(b.y + b.h + dy));
      for (let yy = y0; yy < y1; yy += 1) {
        for (let xx = x0; xx < x1; xx += 1) {
          const i = (yy * shot.width + xx) * 4;
          const rr = shot.data[i];
          const gg = shot.data[i + 1];
          const bb = shot.data[i + 2];
          if (gg > 70 && gg > rr + 40 && gg > bb + 40) hit += 1;
        }
      }
      if (hit > 6) crossed += 1;
    }
  }

  /* ── ЛИНИЯ ОБЯЗАНА ВЫХОДИТЬ ЗА ОБА КРАЯ ЭКРАНА ─────────────────────
     Постановка двадцать второй итерации: «петли должны уходить
     за левый и правый край вьюпорта и возвращаться». Проверяется
     РАСТРОМ готового кадра, а не координатами пути: координаты — это
     модель предмета, а нужен результат. Перебираем блок сверху донизу
     и смотрим, коснулась ли зелень крайнего столбца пикселей слева
     и справа. */
  let touchL = 0;
  let touchR = 0;
  /* ⚠️ ОГНИ НА ВРЕМЯ ПРОВЕРКИ ГАСЯТСЯ. Они бегут по ленте сами
     и попадают в крайний столбец случайно: два прогона подряд
     на ОДНОМ И ТОМ ЖЕ коде давали 292 px и 47 px. Считать надо
     саму линию, а она стоит. */
  await page.addStyleTag({ content: '.route__glints{visibility:hidden!important}' });
  for (let t = 0; t <= 1.0001; t += 0.04) {
    await park(range.from + total * t);
    const band = await page.evaluate(() => {
      const r = document.querySelector('.route').getBoundingClientRect();
      const y = Math.max(0, Math.round(r.top));
      const hh = Math.round(Math.min(r.bottom, window.innerHeight) - y);
      return hh > 8 ? { x: 0, y, width: window.innerWidth, height: hh } : null;
    });
    if (!band) continue;
    const png = PNG.sync.read(await page.screenshot({ clip: band }));
    for (let yy = 0; yy < png.height; yy += 1) {
      for (const [xx, side] of [[0, 'L'], [png.width - 1, 'R']]) {
        const i = (yy * png.width + xx) * 4;
        const rr = png.data[i];
        const gg = png.data[i + 1];
        const bb = png.data[i + 2];
        /* Порог берёт и тусклую часть: «линия дошла до края» — это
           про геометрию, а не про то, зажглась ли она там. */
        if (gg > 30 && gg > rr + 10 && gg > bb + 8) {
          if (side === 'L') touchL += 1;
          else touchR += 1;
        }
      }
    }
  }
  await page.evaluate(() => {
    for (const st of document.querySelectorAll('style')) {
      if (st.textContent.includes('route__glints{visibility')) st.remove();
    }
  });
  const okOut = touchL > 0 && touchR > 0;

  /* ── ЛИНИЯ ПРОХОДИТ СКВОЗЬ ЦЕНТР КАЖДОЙ ЦИФРЫ ─────────────────────
     Требование двадцать четвёртой итерации, и оно жёсткое: с 1 по 5
     включительно, на всех трёх размерах.

     ⚠️ СУДИМ ПО РАСТРУ, А НЕ ПО КООРДИНАТАМ В КОДЕ. Именно координаты
     и врали: точка бралась из центра номера, но `getBoundingClientRect`
     отдаёт бокс ВМЕСТЕ С ТРАНСФОРМОМ, а на номере висел приезд
     на 10 px. Любая проверка, читающая те же `--dot-x`, что пишет
     предмет, сошлась бы с ним по построению (Р-47).

     Как меряется: цифра ставится на середину экрана (там фронт её уже
     прошёл), НОМЕР И УЗЕЛ СВЕТА ПРЯЧУТСЯ — цифра сама зелёная, а узел
     света стоит ровно на точке и подменил бы собой линию, — и берётся
     полоса шириной ±44 px и высотой 60 px вокруг центра. Там линия
     идёт строго вертикально (прямой участок из номера вниз и в номер
     сверху), поэтому у столбцов есть явный пик. Пик обязан стоять
     на центре цифры с допуском 4 px. Порог берётся по ЯДРУ: ореолы
     полупрозрачные и шириной до 13 px, по ним промах в 10 px
     не отличить от попадания. */
  const thru = new Array(5).fill(null);
  let pastLast = -1;
  {
    await page.addStyleTag({
      content: '.rstep__num,.rstep__dot{visibility:hidden!important}',
    });
    const core = (img, x0) => {
      const cols = new Map();
      let total = 0;
      for (let yy = 0; yy < img.height; yy += 1) {
        for (let xx = 0; xx < img.width; xx += 1) {
          const q = (yy * img.width + xx) * 4;
          const r = img.data[q];
          const g = img.data[q + 1];
          const b = img.data[q + 2];
          if (g > 140 && g > r + 30 && g > b + 25) {
            cols.set(x0 + xx, (cols.get(x0 + xx) ?? 0) + 1);
            total += 1;
          }
        }
      }
      let peak = null;
      let best = 0;
      for (const [x, n] of cols) if (n > best) ((best = n), (peak = x));
      return { total, peak };
    };
    const strip = async (x0, y0, wid, hei) => {
      const xa = Math.max(0, Math.round(x0));
      const ya = Math.max(0, Math.round(y0));
      const xb = Math.min(w, Math.round(x0 + wid));
      const yb = Math.min(h, Math.round(y0 + hei));
      if (xb - xa < 4 || yb - ya < 4) return { total: 0, peak: null };
      const png = PNG.sync.read(
        await page.screenshot({ clip: { x: xa, y: ya, width: xb - xa, height: yb - ya } }),
      );
      return core(png, xa);
    };
    for (let i = 0; i < 5; i += 1) {
      await park(dots.y[i] - dots.vh * 0.5);
      const c = await page.evaluate((k) => {
        const r = document.querySelectorAll('.rstep')[k]
          .querySelector('.rstep__num')
          .getBoundingClientRect();
        return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
      }, i);
      const got = await strip(c.cx - 44, c.cy - 30, 88, 60);
      thru[i] = got.total >= 8 && got.peak !== null ? Math.abs(got.peak + 0.5 - c.cx) : null;
      /* И отдельно: линия обязана ДОЙТИ до пятой цифры и ПРОЙТИ ЕЁ. */
      if (i === 4) pastLast = (await strip(c.cx - 44, c.cy + 40, 88, 70)).total;
    }
    await page.evaluate(() => {
      for (const st of document.querySelectorAll('style')) {
        if (st.textContent.includes('rstep__num,.rstep__dot{visibility')) st.remove();
      }
    });
  }
  const okThru = thru.every((v) => v !== null && v <= 4);
  const okPast = pastLast > 0;

  /* ── ФРОНТ СТОИТ РОВНО НА НОМЕРЕ, КОГДА ТОТ ЗАГОРЕЛСЯ ──────────────
     Постановка: «номер загорается только когда линия до него дошла».
     Судим по РАСТРУ, а не по нашей же арифметике: находим положение,
     где номер третьего шага набрал полную яркость, и смотрим полосу
     линии ВЫШЕ точки и НИЖЕ неё. Выше обязано быть заметно ярче:
     это и значит, что фронт стоит на номере, а не прошёл раньше. */
  let aboveN = -1;
  let belowN = -1;
  {
    const K = 2;
    let hit = null;
    for (const y of ys) {
      await park(y);
      const r = await state();
      if (r.n[K] > 0.98) {
        hit = y;
        break;
      }
    }
    if (hit !== null) {
      /* ⚠️ НОМЕР НА ВРЕМЯ СНИМКА ПРЯЧЕТСЯ. Линия проходит СКВОЗЬ цифру,
         и цифра её закрывает — причём сама она тоже зелёная и попала бы
         в счёт. `visibility` раскладку не трогает, поэтому координаты
         остаются теми же. */
      await page.addStyleTag({ content: '.rstep__num{visibility:hidden!important}' });
      const bx = await page.evaluate((k) => {
        const rt = document.querySelector('.route').getBoundingClientRect();
        const st = document.querySelectorAll('.rstep')[k];
        const dx = parseFloat(st.style.getPropertyValue('--dot-x') || '0');
        const dy = parseFloat(st.style.getPropertyValue('--dot-y') || '0');
        return {
          x: Math.max(0, Math.round(rt.left + dx - 16)),
          yA: Math.round(rt.top + dy - 58),
          yB: Math.round(rt.top + dy + 70),
        };
      }, K);
      /* Высота 52 при шаге штриха 50: хотя бы половина штриха попадёт
         в окно при любой фазе пунктира. */
      const slab = async (yy) => {
        if (yy < 0 || yy + 52 > h) return -1;
        return band2(await page.screenshot({ clip: { x: bx.x, y: yy, width: 32, height: 52 } }));
      };
      aboveN = await slab(bx.yA);
      belowN = await slab(bx.yB);
      await page.evaluate(() => {
        for (const st of document.querySelectorAll('style')) {
          if (st.textContent.includes('rstep__num{visibility')) st.remove();
        }
      });
    }
  }
  const okFront = aboveN < 0 || belowN < 0 || aboveN > belowN * 2 + 20;

  /* ── ДВЕ СТРОКИ ДВАДЦАТЬ ПЯТОЙ ИТЕРАЦИИ ─────────────────────────
     Обе про дефект, которого Chromium не показывает: на живом
     iPhone линия шла через цифры 1–3 и пропадала у 4 и 5.

     1. НИ ОДНОГО ГРУППОВОГО `opacity` В ЛЕНТЕ. `opacity` на пути —
        это свойство ГРУППЫ: движок рисует элемент в отдельный
        буфер размером с его bbox и накладывает буфер. У тусклой
        ленты bbox — весь блок; WebKit на iOS ограничивает размер
        такого буфера и УСЕКАЕТ его, сохраняя начало координат,
        то есть теряет НИЗ. Прозрачность обводки задаётся
        `stroke-opacity`: она множит альфу самой краски, буфера
        не заводит вовсе. Chromium рисует одинаково в обоих
        случаях — поэтому сторож и нужен.

     2. НИ ОДНОГО ПОВОРОТА КРУЧЕ ПОРОГА. «Угловато» — это малый
        радиус кривизны, и он считается по готовому пути,
        а не обсуждается. */
  const layers = await page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll('.route__svg path, .route__svg g')) {
      const o = getComputedStyle(el).opacity;
      if (o !== '1') bad.push(`${el.getAttribute('class') || el.tagName}=${o}`);
    }
    return bad;
  });
  const okLayer = layers.length === 0;

  const curve = await page.evaluate(() => {
    const p = document.querySelector('.route__dim');
    if (!p || (p.getAttribute('d') || '').length < 8) return null;
    const L = p.getTotalLength();
    const pts = [];
    for (let s = 0; s <= L; s += 4) pts.push(p.getPointAtLength(s));
    let min = Infinity;
    let tight = 0;
    for (let i = 1; i < pts.length - 1; i += 1) {
      const a = pts[i - 1];
      const b = pts[i];
      const c = pts[i + 1];
      const ab = Math.hypot(b.x - a.x, b.y - a.y);
      const bc = Math.hypot(c.x - b.x, c.y - b.y);
      const ca = Math.hypot(a.x - c.x, a.y - c.y);
      const area2 = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y));
      if (area2 < 1e-6) continue;
      const r = (ab * bc * ca) / (2 * area2);
      if (r < min) min = r;
      if (r < 18) tight += 1;
    }
    return { min: Number.isFinite(min) ? min : -1, tight, n: pts.length };
  });
  const okCurve = !!curve && curve.min >= 18 && curve.tight === 0;

  /* Размер поверхности в пикселях УСТРОЙСТВА. На касаниях ленту
     рисует ХОЛСТ, и мерить надо его буфер: он и есть та величина,
     из-за которой на iOS пропадал низ ленты. На точном указателе
     лента по-прежнему SVG, и меряется самый крупный кусок.

     ⚠️ У ХОЛСТА БУФЕР ОТ ВЫСОТЫ БЛОКА НЕ ЗАВИСИТ ВОВСЕ — он равен
     полосе вокруг экрана. Отдельной строкой проверяется, что
     холст ЖИВОЙ: пустой прошёл бы и так. */
  const chunk = await page.evaluate((dpr) => {
    const cvs = [...document.querySelectorAll('.route[data-cv] .route__cvs .route__cv')];
    if (cvs.length) {
      let wm = 0;
      let hm = 0;
      let live = 0;
      for (const c of cvs) {
        const b = c.getBoundingClientRect();
        if (b.width > 10 && b.height > 10) live += 1;
        wm = Math.max(wm, c.width);
        hm = Math.max(hm, c.height);
      }
      return { w: wm, h: hm, live, cv: true };
    }
    let wMax = 0;
    let hMax = 0;
    let live = 0;
    for (const el of document.querySelectorAll('.route__chunk .route__halo--3')) {
      if ((el.getAttribute('d') || '').length < 8) continue;
      live += 1;
      const b = el.getBBox();
      wMax = Math.max(wMax, b.width);
      hMax = Math.max(hMax, b.height);
    }
    return { w: Math.round(wMax * dpr), h: Math.round(hMax * dpr), live, cv: false };
  }, mob ? 3 : 1);
  const okChunk = chunk.live !== 0 && chunk.w > 10 && chunk.w <= 2048 && chunk.h <= 2048;


  /* ── ШТРИХИ ЛЕНТЫ ОДИНАКОВЫЕ ───────────────────────────────────────
     Постановка тридцать третьей итерации: «эталон — ровный чистый
     штрих: одинаковая длина, скруглённые концы, равномерное свечение
     без точек и срезов. Проверь растром вдоль всей ленты».

     СКЕЛЕТ СНИМАЕТСЯ С РАСТРА, а не берётся из пути (Р-47). В каждой
     строке кадра ищется наибольший ИЗБЫТОК ЗЕЛЁНОГО над красным —
     это ядро ленты; белый набор блока в счёт не идёт вовсе, у него
     избыток нулевой. Подряд идущие яркие строки складываются
     в ШТРИХ, и на каждый снимаются три числа: высота, яркость ядра
     и СУММА ЗЕЛЕНИ ПОПЕРЁК СТРОКИ — то есть сколько всего света
     в этом месте ленты.

       ВЫСОТА ловит СРЕЗ: стык кусков, попавший внутрь штриха, режет
       его — в контрольном прогоне на прежнем коде среди штрихов
       в 29 px нашёлся один в 19.

       ПОПЕРЕЧНАЯ СУММА ловит МИКРОТОЧКУ: на том же стыке сходятся
       два полупрозрачных скруглённых конца, их прозрачности
       складываются, и света в этом месте становится в полтора раза
       больше. Ядро при этом непрозрачно и не меняется вовсе —
       поэтому «яркую точку» видно только по сумме, а не по пику.

     ⚠️ СЧИТАЮТСЯ ТОЛЬКО БЛИЗКИЕ К ВЕРТИКАЛИ ШТРИХИ: на пологом
     участке строка кадра идёт вдоль ленты, и «высота штриха» там
     не значит ничего. Вертикальный участок есть у каждой цифры
     по построению — линия выходит из номера прямо вниз.

     ⚠️ И ПРИХОДИТЬ СЮДА НАДО ПЛАВНОЙ ПРОКРУТКОЙ, А НЕ ТЕЛЕПОРТОМ:
     холст перерисовывается ПОЛОСОЙ вокруг фронта, и что осталось
     на нём от прошлых кадров — это и есть предмет проверки. */
  await page.evaluate(() => {
    const st = document.createElement('style');
    st.id = 'lenta-tikho';
    st.textContent =
      '.route__list{visibility:hidden!important}.route__wave{display:none!important}';
    document.head.appendChild(st);
  });
  const lenta = { runs: 0, lenMed: 0, lenMin: 0, lenMax: 0, pkMin: 0, bumps: 0, ratio: 0 };
  {
    const target = range.from + total * 0.62;
    let cur = Math.max(0, range.from - 40);
    await park(cur);
    while (cur < target) {
      cur = Math.min(target, cur + 50);
      await page.evaluate((t) => {
        document.getElementById('scroller').scrollTop = t;
      }, cur);
      await page.waitForTimeout(24);
    }
    await page.waitForTimeout(SETTLE * 2);

    const clip = await page.evaluate(() => {
      const r = document.querySelector('.route').getBoundingClientRect();
      const y = Math.max(0, Math.round(r.top));
      const hh = Math.round(Math.min(r.bottom, window.innerHeight) - y);
      return hh > 120 ? { x: 0, y, width: window.innerWidth, height: hh } : null;
    });
    if (clip) {
      const A = PNG.sync.read(await page.screenshot({ clip, scale: 'css' }));
      const gv = (x, y) => {
        if (x < 0 || y < 0 || x >= A.width || y >= A.height) return 0;
        const i = (y * A.width + x) * 4;
        return Math.max(0, A.data[i + 1] - A.data[i]);
      };
      const P = [];
      const X = [];
      for (let y = 0; y < A.height; y += 1) {
        let b = 0;
        let bx = 0;
        for (let x = 0; x < A.width; x += 1) {
          const v = gv(x, y);
          if (v > b) {
            b = v;
            bx = x;
          }
        }
        P.push(b);
        X.push(bx);
      }
      const C = Math.max(...P);
      const hi = C * 0.55;
      const runs = [];
      let y0 = -1;
      for (let y = 0; y <= A.height; y += 1) {
        const on = y < A.height && P[y] >= hi;
        if (on && y0 < 0) y0 = y;
        if (!on && y0 >= 0) {
          const y1 = y - 1;
          const L = y1 - y0 + 1;
          if (y0 > 0 && y1 < A.height - 1 && L >= 8 && Math.abs(X[y1] - X[y0]) <= L * 0.4) {
            let pk = 0;
            const sums = [];
            for (let k = y0; k <= y1; k += 1) {
              pk = Math.max(pk, P[k]);
              let sm = 0;
              for (let x = Math.max(0, X[k] - 24); x < Math.min(A.width, X[k] + 25); x += 1)
                sm += gv(x, k);
              sums.push(sm);
            }
            sums.sort((a2, b2) => a2 - b2);
            runs.push({ L, pk: pk / C, med: sums[sums.length >> 1], max: sums[sums.length - 1] });
          }
          y0 = -1;
        }
      }
      const lens = runs.map((r) => r.L).sort((a2, b2) => a2 - b2);
      const meds = runs.map((r) => r.med).sort((a2, b2) => a2 - b2);
      const base = meds.length ? meds[meds.length >> 1] : 1;
      lenta.runs = runs.length;
      lenta.lenMed = lens.length ? lens[lens.length >> 1] : 0;
      lenta.lenMin = lens.length ? lens[0] : 0;
      lenta.lenMax = lens.length ? lens[lens.length - 1] : 0;
      lenta.pkMin = runs.length ? Math.min(...runs.map((r) => r.pk)) : 0;
      lenta.ratio = runs.length ? Math.max(...runs.map((r) => r.max)) / base : 0;
      lenta.bumps = runs.filter((r) => r.max > base * 1.4).length;
    }
  }
  await page.evaluate(() => document.getElementById('lenta-tikho')?.remove());
  /* Пороги взяты из КОНТРОЛЬНОГО ПРОГОНА НА ПРЕЖНЕМ КОДЕ: там среди
     штрихов в 29 px нашёлся один в 19 (0.66 медианы) и четыре места
     со светом в 1.44…1.55 медианы. На починенном — 26 px (0.90)
     и ни одного места ярче 1.35. */
  const okShtrih =
    lenta.runs >= 5 &&
    lenta.lenMin >= lenta.lenMed * 0.8 &&
    lenta.lenMax <= lenta.lenMed * 1.3 &&
    lenta.pkMin >= 0.6 &&
    lenta.bumps === 0;

  if (!okLayer || !okCurve || !okChunk || !okShtrih) failed = true;

  if (
    backSlip || fwdSlip || orderBad || !okEnds || !okDraw || !okLive || !okWhen || !okAhead ||
    crossed || !okOut || !okFront || !okThru || !okPast
  )
    failed = true;

  console.log(
    `  ${String(w).padStart(4)}×${h}  положений ${String(ys.length).padStart(3)}  ` +
      `откатов вниз ${backSlip}  вверх ${fwdSlip}  порядок нарушен ${orderBad}  ` +
      `концы ${first.p.toFixed(3)}…${last.p.toFixed(3)}  ` +
      `на колесе: подсветка стояла ${dead} из ${moved} подвижных кадров, ` +
      `наибольший шаг ${maxStep.toFixed(3)}  зелёных ${dark} → ${lit}` +
      (okEnds ? '' : '   !!! КОНЦЫ ХОДА') +
      (okDraw ? '' : '   !!! ЛИНИЯ НЕ РИСУЕТСЯ') +
      (okLive ? '' : '   !!! СТУПЕНЬКИ'),
  );
  console.log(
    `            шаг загорается на ${litAt
      .map((v) => (v === null ? '—' : v.toFixed(2)))
      .join(' / ')} высоты экрана (самый поздний ${lowest.toFixed(2)}, порог 0.50)  ` +
      `маршрут при низе блока на 0.7 экрана: ${early.p.toFixed(3)}  ` +
      `строк перерезано линией ${crossed} из ${geo.rects.length}  ` +
      `за край экрана: слева ${touchL} px, справа ${touchR} px  ` +
      `в момент зажигания 3-го номера ленты выше точки ${aboveN} px, ниже ${belowN} px` +
      (okFront ? '' : '   !!! НОМЕР ЗАГОРАЕТСЯ РАНЬШЕ ЛИНИИ') +
      '',
  );
  console.log(
    `            штрихов промерено ${lenta.runs}  длина ${lenta.lenMin}…${lenta.lenMax} px ` +
      `при медиане ${lenta.lenMed} (допуск ×0.8…×1.3)  ядро не тусклее ` +
      `${(lenta.pkMin * 100).toFixed(0)} %  света в штрихе не больше ` +
      `${lenta.ratio.toFixed(2)} медианы, мест ярче 1.40 — ${lenta.bumps}` +
      (okShtrih ? '' : '   !!! ШТРИХИ РАЗНЫЕ'),
  );
  console.log(
    `            ядро ленты от центра цифры: ${thru
      .map((v) => (v === null ? 'нет линии' : `${v.toFixed(1)} px`))
      .join(' / ')} (допуск 4.0)  ниже пятой цифры ядра ${pastLast} px` +
      (okThru ? '' : '   !!! ЛИНИЯ НЕ ПРОХОДИТ СКВОЗЬ ЦИФРУ') +
      (okPast ? '' : '   !!! ЛИНИЯ НЕ ДОХОДИТ ДО ПЯТОЙ ЦИФРЫ') +
      (okOut ? '' : '   !!! ЛИНИЯ НЕ ВЫХОДИТ ЗА КРАЙ') +
      (okWhen ? '' : '   !!! ЗАГОРАЕТСЯ ПОЗДНО') +
      (okAhead ? '' : '   !!! МАРШРУТ НЕ ДОЙДЁН') +
      (crossed ? '   !!! ЛИНИЯ РЕЖЕТ ТЕКСТ' : ''),
  );
  console.log(
    `            самый крутой поворот ${curve ? curve.min.toFixed(1) : '—'} px ` +
      `(порог 18), круче порога ${curve ? curve.tight : '—'} из ${curve ? curve.n : 0}  ` +
      (chunk.cv
        ? `холстов ${chunk.live}, самый крупный ${chunk.w}×${chunk.h} пикселей устройства (порог 2048)  `
        : `кусков живых ${chunk.live}, самый крупный ${chunk.w}×${chunk.h} пикселей устройства (порог 2048)  `) +
      `группового opacity в ленте: ${layers.length ? layers.join(', ') : 'нет'}` +
      (okCurve ? '' : '   !!! УГЛОВАТЫЙ ПОВОРОТ') +
      (okChunk ? '' : '   !!! КУСОК БОЛЬШЕ ПРЕДЕЛА СЛОЯ') +
      (okLayer ? '' : '   !!! ГРУППОВОЙ OPACITY: НА iOS НИЗ ЛЕНТЫ ПРОПАДЁТ'),
  );
  await page.close();
}

await browser.close();
server.close();
console.log(
  failed
    ? '\nПРОВАЛ: подсветка маршрута ведёт себя не так, как задумано'
    : '\nПодсветка идёт от начала к концу, возвращается и не ступает',
);
process.exit(failed ? 1 : 0);

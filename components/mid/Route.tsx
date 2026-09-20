'use client';

import { useEffect, useRef } from 'react';
import { MORPH_DAMP_TOUCH_MS, finePointer, onLayoutChange, onScrollY, scroller } from '@/lib/scroll';
import { prefersReducedMotion } from '@/lib/motion';

export type Step = { t: string; d: string };

/**
 * БЛОК ПОРЯДКА — МАРШРУТ, А НЕ СХЕМА.
 *
 * По блоку змейкой идёт прерывистая зелёная линия. Она петляет: уходит
 * далеко вправо и возвращается к следующей точке, петли разного размера
 * и с разным шагом. По мере прокрутки линия подсвечивается от начала
 * к концу — как прокладываемый путь; прокрутил назад — гаснет обратно.
 * На пяти точках стоят шаги: когда подсветка доходит до точки,
 * появляется крупный номер и подсвечивается сам шаг.
 *
 * ── ПУТЬ ГЕНЕРИРУЕТСЯ ОТ ФАКТИЧЕСКОЙ ГЕОМЕТРИИ, А НЕ РИСУЕТСЯ РУКАМИ ──────
 * Точки маршрута обязаны стоять ровно на вертикальных центрах шагов,
 * иначе номер и подсветка разъезжаются с линией. Поэтому путь собирается
 * в JS ПРИ РАСКЛАДКЕ: берутся измеренные центры, между ними вставляются
 * блуждающие точки с неровным шагом, и всё это сглаживается сплайном
 * Catmull-Rom, который проходит ЧЕРЕЗ все свои точки. Неровность берётся
 * из фиксированной таблицы, а не из `Math.random`: иначе кадр в проверке
 * каждый раз другой.
 *
 * ── ПОДСВЕТКА: ТРИ ЛИНИИ И НИ ОДНОЙ МАСКИ ─────────────────────────────────
 * Прерывистость и подсветка — две разные вещи, и одним `stroke-dasharray`
 * их не выразить: он на элементе один.
 *
 * ⚠️ МАСКУ ПРИШЛОСЬ УБРАТЬ, И ЭТО ЗАМЕР, А НЕ ВКУС. Первый заход
 * обрезал сплошную яркую линию СТАТИЧНОЙ маской-пунктиром — казалось,
 * что статичную маску браузер не трогает. Замер на быстром скролле:
 * 2.2 % кадров дороже 16.9 мс на 1920 и 7.1 % на 2560; та же сцена
 * без маски — 0.0 %, и ровно 0.0 % когда линии нет вовсе. То есть
 * маска и была всей ценой: масштабируется она по площади, а площадь
 * у маршрута — весь блок.
 *
 * Пунктир теперь набирается ТРЕМЯ ОБЫЧНЫМИ ЛИНИЯМИ, без единого фильтра:
 *
 *     тусклая   — пунктир `9 10`, лежит всегда, прозрачность 0.2;
 *     яркая     — СПЛОШНАЯ, обрезана по длине через `pathLength="1"`
 *                 и `stroke-dashoffset = 1 − p`. Это единственное,
 *                 что меняется в кадре, и стоит это ноль;
 *     просветы  — тот же пунктир, сдвинутый в противофазу (`10 9`
 *                 со смещением −9) и покрашенный в фон. Он лежит
 *                 ПОВЕРХ яркой и вырезает из неё ровно те куски,
 *                 где у тусклой линии пустота. Статичен.
 *
 * Фон здесь взять честно неоткуда, кроме как перечислить его: под
 * маршрутом всегда `--ink`, потому что блок лежит на фоне страницы
 * и ничего под него не заезжает. Если под блок когда-нибудь подложат
 * другой фон, эта линия перестанет попадать в цвет — и это тот
 * единственный случай, ради которого стоит вернуть маску.
 *
 * ── ЧТО СЧИТАЕТСЯ В КАДРЕ ──────────────────────────────────────────────────
 * Одна запись атрибута и пять записей переменной. Ни одного чтения
 * геометрии: и центры шагов, и длины вдоль пути сняты при раскладке.
 *
 * ── БЕЗ СКРИПТА И ПРИ «УМЕНЬШИТЬ ДВИЖЕНИЕ» ────────────────────────────────
 * Номера и шаги лежат в разметке и по умолчанию видны целиком (`--n: 1`
 * задаёт CSS). Линия — декорация: её `d` собирается из геометрии, и без
 * скрипта её просто нет. При «уменьшить движение» линия подсвечена
 * целиком, подписки не заводится.
 */

/** Доли ширины, на которых стоят точки маршрута. Неровные намеренно. */
const ANCHOR_X = [0.125, 0.065, 0.155, 0.055, 0.115];
/** Доли ширины, куда уходит ДАЛЬНЯЯ точка петли. Тоже неровные. */
const LOOP_X = [0.74, 0.34, 0.86, 0.46];
/**
 * Доли перегона для трёх блуждающих точек каждой петли.
 *
 * ТОЧЕК ИМЕННО ТРИ, И ЭТО НЕ ИЗЛИШЕСТВО. При двух касательная сплайна
 * в самой точке маршрута выходила почти горизонтальной — линия уезжала
 * вбок ровно на высоте заголовка и резала строку. С тремя ближние
 * соседи стоят почти под точкой, касательная встаёт вертикально,
 * и линия уходит из точки ВНИЗ, а вбок гуляет уже в промежутке
 * между шагами.
 */
const LOOP_T = [
  [0.16, 0.5, 0.86],
  [0.2, 0.54, 0.82],
  [0.14, 0.46, 0.88],
  [0.18, 0.56, 0.84],
];
/** Насколько ближние точки петли отходят вбок от своей точки маршрута. */
const NEAR_X = [0.1, 0.07, 0.12, 0.08];
/** Дрожь пера: фиксированная таблица, одна и та же на каждой сборке. */
const WOBBLE = [
  0.42, -0.77, 0.19, 0.88, -0.35, 0.64, -0.91, 0.28, 0.73, -0.16, 0.55, -0.68, 0.31, -0.84, 0.47,
  0.92, -0.24, 0.61, -0.53, 0.36, 0.79, -0.41, 0.14, -0.95,
];

/** На узком экране петли мельче: тот же ход, меньший размах. */
const NARROW = 720;

type Pt = { x: number; y: number };

/** Кубика из четырёх точек по Catmull-Rom (натяжение 0.5). */
function segment(p0: Pt, p1: Pt, p2: Pt, p3: Pt, jit: number) {
  const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
  const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
  // дрожь пера: контрольные точки чуть уводятся вбок, и дуга перестаёт
  // быть математически ровной, оставаясь гладкой
  c1.x += jit;
  c2.x -= jit * 0.7;
  return { c1, c2 };
}

/** Точка на кубике — нужна только для подсчёта длины при раскладке. */
function at(p1: Pt, c1: Pt, c2: Pt, p2: Pt, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p1.x + b * c1.x + c * c2.x + d * p2.x,
    y: a * p1.y + b * c1.y + c * c2.y + d * p2.y,
  };
}

type Built = { d: string; frac: number[] };

/** Собирает путь через заданные точки и считает, на какой доле длины они стоят. */
function buildPath(w: number, h: number, ys: number[], narrow: boolean): Built {
  const k = narrow ? 0.46 : 1; // петли мельче на узком экране
  const ax = ANCHOR_X.map((f) => w * (narrow ? f * 0.72 : f));
  const anchors: Pt[] = ys.map((y, i) => ({ x: ax[i], y }));

  const pts: Pt[] = [];
  const mark: number[] = []; // индексы точек маршрута внутри pts

  // заход сверху и выход вниз: линия начинается выше первой точки
  const lead = Math.max(28, (ys[1] - ys[0]) * 0.55);
  pts.push({ x: anchors[0].x + w * 0.09 * k, y: Math.max(2, ys[0] - lead) });

  for (let i = 0; i < anchors.length; i += 1) {
    if (i > 0) {
      const a = anchors[i - 1];
      const b = anchors[i];
      const g = i - 1;
      const ts = LOOP_T[g];
      const near = w * NEAR_X[g] * k;
      const far = a.x + (w * LOOP_X[g] - a.x) * k;
      const xs = [a.x + near, far, b.x + near * 0.8];
      for (let j = 0; j < 3; j += 1) {
        pts.push({ x: xs[j], y: a.y + (b.y - a.y) * ts[j] });
      }
    }
    mark.push(pts.length);
    pts.push(anchors[i]);
  }
  const tail = Math.max(28, (ys[4] - ys[3]) * 0.5);
  pts.push({ x: anchors[4].x + w * 0.3 * k, y: Math.min(h - 2, ys[4] + tail) });

  // ── сборка пути и длин ────────────────────────────────────────────────
  let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  const lenAt: number[] = [0];
  let len = 0;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? pts[i + 1];
    const jit = WOBBLE[i % WOBBLE.length] * Math.min(14, w * 0.012);
    const { c1, c2 } = segment(p0, p1, p2, p3, jit);
    d +=
      `C${c1.x.toFixed(1)} ${c1.y.toFixed(1)} ` +
      `${c2.x.toFixed(1)} ${c2.y.toFixed(1)} ` +
      `${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    let prev = p1;
    for (let q = 1; q <= 12; q += 1) {
      const cur = at(p1, c1, c2, p2, q / 12);
      len += Math.hypot(cur.x - prev.x, cur.y - prev.y);
      prev = cur;
    }
    lenAt.push(len);
  }

  const frac = mark.map((i) => (len > 0 ? lenAt[i] / len : 0));
  return { d, frac };
}

/** Ширина окна, за которое номер проявляется полностью. */
const WIN = 0.055;

export default function Route({ steps }: { steps: Step[] }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const dimRef = useRef<SVGPathElement>(null);
  const litRef = useRef<SVGPathElement>(null);
  const gapsRef = useRef<SVGPathElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const svg = svgRef.current;
    const lit = litRef.current;
    const sc = scroller();
    if (!root || !svg || !lit || !sc) return;

    let items: HTMLElement[] = [];
    let frac: number[] = [];
    let start = 0;
    let span = 1;

    const measure = () => {
      /* Геометрия снимается ЗДЕСЬ и только здесь. */
      items = Array.from(root.querySelectorAll<HTMLElement>('.rstep'));
      if (items.length !== 5) return;

      /* ⚠️ ГУТЕР ВЫСТАВЛЯЕТСЯ ПЕРВЫМ, ДО ЧТЕНИЯ ЦЕНТРОВ. Он меняет
         отступ шага, от него зависит перенос строк, а от переносов —
         высота шага. Померив центры до гутера, мы клали точки маршрута
         по вчерашней раскладке. Он зависит только от ширины, поэтому
         посчитать его можно заранее. */
      const w0 = Math.max(1, Math.round(root.getBoundingClientRect().width));
      const narrow0 = w0 < NARROW;
      const maxAx = Math.max(...ANCHOR_X.map((f) => w0 * (narrow0 ? f * 0.72 : f)));
      root.style.setProperty('--gutter', `${(maxAx + Math.min(46, w0 * 0.03)).toFixed(0)}px`);

      const shift = sc.getBoundingClientRect().top - sc.scrollTop;
      const box = root.getBoundingClientRect();
      const w = Math.max(1, Math.round(box.width));
      const h = Math.max(1, Math.round(box.height));

      const ys = items.map((el) => {
        const r = el.getBoundingClientRect();
        // точка стоит на центре НОМЕРА, а не всего шага: описание длиннее
        // заголовка, и центр строки уезжал бы вниз от цифры
        const num = el.querySelector<HTMLElement>('.rstep__num');
        const nr = num ? num.getBoundingClientRect() : r;
        return nr.top - box.top + nr.height / 2;
      });

      const built = buildPath(w, h, ys, w < NARROW);
      frac = built.frac;
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      dimRef.current?.setAttribute('d', built.d);
      gapsRef.current?.setAttribute('d', built.d);
      lit.setAttribute('d', built.d);

      // точки на линии — ровно там, где стоят номера
      for (let i = 0; i < items.length; i += 1) {
        items[i].style.setProperty('--dot-x', `${(ANCHOR_X[i] * (w < NARROW ? 0.72 : 1) * w).toFixed(1)}px`);
        items[i].style.setProperty('--dot-y', `${ys[i].toFixed(1)}px`);
      }

      const top = box.top - shift;
      /* Ход подсветки: начинается, когда блок вошёл в кадр на четверть,
         и кончается, когда его низ дошёл до трети экрана снизу. */
      const vh = sc.clientHeight;
      start = top - vh * 0.72;
      span = Math.max(1, h + vh * 0.72 - vh * 0.34);
    };

    const put = (p: number) => {
      lit.setAttribute('stroke-dashoffset', (1 - p).toFixed(4));
      for (let i = 0; i < items.length; i += 1) {
        const n0 = (p - frac[i]) / WIN;
        const n = n0 <= 0 ? 0 : n0 >= 1 ? 1 : n0;
        items[i].style.setProperty('--n', n.toFixed(3));
      }
    };

    measure();

    /* При «уменьшить движение» линия подсвечена целиком, номера и шаги
       видны сразу: подписки просто не заводится. */
    if (prefersReducedMotion()) {
      const still = () => {
        measure();
        put(1);
      };
      still();
      return onLayoutChange(still);
    }

    /* Демпфер — только на касаниях: на точном указателе позицию уже ведёт
       Lenis, и второе сглаживание поверх него — это та самая тяжесть.
       На касаниях позиция приходит ступенями инерции, и без демпфера
       подсветка шла бы рывками. Тот же приём, что у формы вордмарка. */
    const damp = !finePointer();
    let target = 0;
    let cur = NaN;
    let raf = 0;
    let prev = 0;

    const tick = (now: number) => {
      raf = 0;
      const dt = Math.min(64, now - prev);
      prev = now;
      cur += (target - cur) * (1 - Math.exp(-dt / MORPH_DAMP_TOUCH_MS));
      if (Math.abs(target - cur) < 1e-4) cur = target;
      put(cur);
      if (cur !== target) raf = requestAnimationFrame(tick);
    };

    const read = (y: number) => {
      const p0 = (y - start) / span;
      const p = p0 < 0 ? 0 : p0 > 1 ? 1 : p0;
      if (!damp) {
        put(p);
        return;
      }
      target = p;
      if (Number.isNaN(cur)) {
        cur = p;
        put(p);
        return;
      }
      if (cur === target || raf) return;
      prev = performance.now();
      raf = requestAnimationFrame(tick);
    };

    const offLayout = onLayoutChange(measure);
    const offScroll = onScrollY(read);
    return () => {
      offLayout();
      offScroll();
      if (raf) cancelAnimationFrame(raf);
      root.style.removeProperty('--gutter');
      for (const el of items) {
        el.style.removeProperty('--n');
        el.style.removeProperty('--dot-x');
        el.style.removeProperty('--dot-y');
      }
    };
  }, [steps]);

  return (
    <div ref={rootRef} className="route">
      <svg ref={svgRef} className="route__svg" aria-hidden="true" preserveAspectRatio="none">
        <path ref={dimRef} className="route__dim" />
        <path ref={litRef} className="route__lit" pathLength="1" strokeDasharray="1 1" strokeDashoffset="0" />
        {/* Противофазный пунктир в цвет фона: он и делает яркую линию
            прерывистой, не стоя при этом ничего. */}
        <path ref={gapsRef} className="route__gaps" />
      </svg>

      <ol className="route__list">
        {steps.map((s, i) => (
          <li key={s.t} className="rstep">
            <span className="rstep__dot" aria-hidden="true" />
            <span className="rstep__num tnum" aria-hidden="true">
              {String(i + 1).padStart(2, '0')}
            </span>
            <span className="rstep__body">
              <span className="rstep__t">
                <span className="sr-only">Шаг {i + 1}. </span>
                {s.t}
              </span>
              <span className="rstep__d">{s.d}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

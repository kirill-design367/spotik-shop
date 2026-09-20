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

/**
 * РЕЛЬЕФ ШАГОВ (двадцать первая итерация).
 *
 * Шаги больше не стоят колонкой. У каждого своё смещение по горизонтали,
 * свой отбой сверху и свой кегль, и ни один ряд не идёт по возрастанию
 * или по убыванию — только вразнобой. Ровная колонка читалась как
 * список; рельеф читается как рельеф, а оправдывает разброс маршрут:
 * линия проходит через все пять точек и связывает их.
 *
 * Все три таблицы — ПЯТЬ ЧИСЕЛ НА ПЯТЬ ШАГОВ, и разбирать их нужно
 * вместе: смещение задаёт, где стоит точка маршрута, отбой — сколько
 * воздуха до предыдущего шага, кегль — вес шага в кадре.
 */
/** Доли ширины, на которых стоят точки маршрута — они же отступ шага. */
const STEP_X = [0.055, 0.3, 0.1, 0.44, 0.17];
/** На узком экране разброс МЕЛЬЧЕ, но остаётся: ровная колонка там тоже не годится. */
const STEP_X_NARROW = 0.52;
/** Дополнительный отбой сверху, в долях ширины блока (первому не нужен). */
const STEP_GAP = [0, 0.075, 0.125, 0.06, 0.105];
/** Множитель кегля. Крупных два — третий и первый, остальные мельче. */
const STEP_SIZE = [1.12, 0.78, 1.32, 0.74, 0.96];
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

type Built = { d: string; frac: number[]; yTab: number[]; fTab: number[] };

/**
 * Собирает путь через заданные точки и считает, на какой доле длины
 * они стоят.
 *
 * ⚠️ ПЕТЛЯ ГУЛЯЕТ ТОЛЬКО В ПОЛОСЕ МЕЖДУ ШАГАМИ, и это не украшение.
 * Пока шаги стояли колонкой у левого края, вправо было уходить некуда
 * и некому мешать. С рельефом текст занимает всю ширину, и петля,
 * поставленная по ДОЛЯМ ПЕРЕГОНА, резала абзац поперёк — ровно как
 * в девятнадцатой итерации резала заголовок. Поэтому дальняя точка
 * петли ставится по ФАКТИЧЕСКИМ коробкам шагов: ниже низа предыдущего
 * и выше верха следующего. Из самой точки линия уходит ВНИЗ вдоль
 * левого поля шага (текст начинается правее точки на отступ),
 * и в следующую входит так же — сверху вдоль поля.
 */
function buildPath(
  w: number,
  h: number,
  ys: number[],
  boxes: { top: number; bottom: number }[],
  narrow: boolean,
): Built {
  const k = narrow ? 0.46 : 1; // петли мельче на узком экране
  const ax = STEP_X.map((f) => w * (narrow ? f * STEP_X_NARROW : f));
  const anchors: Pt[] = ys.map((y, i) => ({ x: ax[i], y }));

  const pts: Pt[] = [];
  const mark: number[] = []; // индексы точек маршрута внутри pts

  // заход сверху и выход вниз: линия начинается выше первой точки
  const lead = Math.max(28, (ys[1] - ys[0]) * 0.55);
  pts.push({ x: anchors[0].x + w * 0.045 * k, y: Math.max(2, ys[0] - lead) });

  for (let i = 0; i < anchors.length; i += 1) {
    if (i > 0) {
      const a = anchors[i - 1];
      const b = anchors[i];
      const g = i - 1;
      const ts = LOOP_T[g];
      const near = w * NEAR_X[g] * k;
      const far = a.x + (w * LOOP_X[g] - a.x) * k;

      /* Полоса, свободная от текста: от низа предыдущей коробки
         до верха следующей. Если шаги сошлись вплотную (узкий экран,
         длинный перенос), полоса вырождается — тогда берём середину
         перегона, как раньше. */
      let b0 = boxes[i - 1].bottom + 8;
      let b1 = boxes[i].top - 8;
      if (b1 - b0 < 24) {
        b0 = a.y + (b.y - a.y) * 0.3;
        b1 = a.y + (b.y - a.y) * 0.7;
      }
      const mid = b0 + (b1 - b0) * ts[1];

      /* Первая точка — почти под своей: линия обязана выйти из шага
         ВНИЗ, а не вбок. Последняя — над следующей, по той же причине. */
      pts.push({ x: a.x + near * 0.14, y: Math.min(b0, mid) });
      pts.push({ x: far, y: mid });
      pts.push({ x: b.x - near * 0.1, y: Math.max(b1, mid) });
    }
    mark.push(pts.length);
    pts.push(anchors[i]);
  }
  /* Хвост уходит ВНИЗ вдоль поля последнего шага и только потом вбок:
     прежний вылет на 0.3 ширины резал его описание поперёк. */
  const tail = Math.max(40, (ys[4] - ys[3]) * 0.4);
  pts.push({
    x: anchors[4].x + w * 0.05 * k,
    y: Math.min(h - 2, Math.max(boxes[4].bottom + 10, ys[4] + tail)),
  });

  // ── сборка пути и длин ────────────────────────────────────────────────
  let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  const lenAt: number[] = [0];
  const ys2: number[] = [pts[0].y];
  const ls2: number[] = [0];
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
      /* Таблица «высота → доля длины». Высота идёт СТРОГО ВВЕРХ:
         петля местами поднимается, и по немонотонной таблице не искать.
         ⚠️ Просто нарастающего максимума мало: на подъёме появлялись
         участки с ОДИНАКОВОЙ высотой, а на них подсветка стояла,
         пока страница ехала, — замер ловил это как ступеньки (2 кадра
         из 34 на мобильной). Микрошаг убирает площадки и за шестьсот
         отсчётов набирает меньше пикселя. */
      const prevY = ys2[ys2.length - 1];
      ys2.push(prevY === undefined ? cur.y : Math.max(prevY + 1e-3, cur.y));
      ls2.push(len);
    }
    lenAt.push(len);
  }

  const frac = mark.map((i) => (len > 0 ? lenAt[i] / len : 0));
  const fTab = len > 0 ? ls2.map((v) => v / len) : ls2.map(() => 0);
  return { d, frac, yTab: ys2, fTab };
}

/**
 * Доля длины пути на заданной высоте внутри блока.
 *
 * ⚠️ ПОДСВЕТКА ИДЁТ ЗА ЛИНИЕЙ ОТСЧЁТА, А НЕ ЗА ДОЛЕЙ ПРОКРУТКИ, и это
 * не украшение. Длина пути растёт неравномерно: там, где петля уходит
 * далеко вправо, на тот же пиксель высоты приходится вдвое больше
 * линии. Линейная связь «доля блока → доля длины» поэтому отставала
 * от того места экрана, где человек читает, и пятый шаг загорался,
 * когда блок уже уходил вверх. Теперь подсвечено ровно то, что выше
 * линии отсчёта, и скорость линии равна скорости страницы.
 */
function fracAtY(b: Built, y: number): number {
  const { yTab, fTab } = b;
  if (!yTab.length) return 0;
  if (y <= yTab[0]) return 0;
  if (y >= yTab[yTab.length - 1]) return 1;
  let lo = 0;
  let hi = yTab.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (yTab[mid] <= y) lo = mid;
    else hi = mid;
  }
  const dy = yTab[hi] - yTab[lo];
  const t = dy > 0 ? (y - yTab[lo]) / dy : 0;
  return fTab[lo] + (fTab[hi] - fTab[lo]) * t;
}

/**
 * Ширина окна, за которое номер проявляется полностью.
 *
 * ⚠️ У ПОСЛЕДНЕГО ШАГА ОКНО УЗКОЕ, И ЭТО ОБЯЗАТЕЛЬНО. После пятой точки
 * хвоста осталось меньше пяти процентов длины, и при общем окне номер
 * «05» доходил только до 0.73 яркости — на конце хода он просто
 * не успевал загореться. Окно каждого шага обрезается тем, что осталось
 * до конца пути.
 */
const WIN = 0.055;

/**
 * ЛИНИЯ ОТСЧЁТА — 78 % ВЫСОТЫ ЭКРАНА, то есть заметно ниже середины.
 * Шаг загорается, пока он ещё в нижней половине кадра, а не когда
 * доехал до середины; к моменту, когда блок уходит вверх, маршрут
 * пройден целиком. Прежние 0.72/0.34 задавали не линию, а два края
 * хода, и хвост маршрута доигрывал уже за нижней границей блока.
 */
const REF_Y = 0.78;

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
    let wins: number[] = [];
    let built: Built | null = null;
    let top = 0;
    let vh = 1;

    const measure = () => {
      /* Геометрия снимается ЗДЕСЬ и только здесь. */
      items = Array.from(root.querySelectorAll<HTMLElement>('.rstep'));
      if (items.length !== 5) return;

      /* ⚠️ РЕЛЬЕФ ВЫСТАВЛЯЕТСЯ ПЕРВЫМ, ДО ЧТЕНИЯ ЦЕНТРОВ. Смещение,
         отбой и кегль меняют раскладку шага: от них зависят переносы
         строк, а от переносов — высота. Померив центры до них, мы
         клали бы точки маршрута по вчерашней раскладке. Зависят они
         только от ширины, поэтому считаются заранее. */
      const w0 = Math.max(1, Math.round(root.getBoundingClientRect().width));
      const narrow0 = w0 < NARROW;
      const pad = Math.min(46, w0 * 0.03);
      const right = Math.max(24, w0 * 0.04);
      for (let i = 0; i < items.length; i += 1) {
        const ax0 = w0 * (narrow0 ? STEP_X[i] * STEP_X_NARROW : STEP_X[i]);
        const sx = ax0 + pad;
        items[i].style.setProperty('--sx', `${sx.toFixed(1)}px`);
        items[i].style.setProperty('--sg', `${(STEP_GAP[i] * Math.min(w0, 1200)).toFixed(0)}px`);
        items[i].style.setProperty('--ss', STEP_SIZE[i].toFixed(2));
        items[i].style.setProperty('--sw', `${Math.max(180, w0 - sx - right).toFixed(0)}px`);
      }

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

      /* ⚠️ КОРОБКА ШАГА СЧИТАЕТСЯ ПО СОДЕРЖИМОМУ, А НЕ ПО САМОМУ ШАГУ.
         Шаги в потоке стоят вплотную: между боксами лежит только
         внешний отбой, и на узком экране это десять пикселей — полоса
         вырождалась, петля уходила в запасную ветку и резала абзац.
         По содержимому в ту же полосу попадают ещё и оба внутренних
         поля, и её хватает везде. */
      const boxes = items.map((el) => {
        let top = Infinity;
        let bottom = -Infinity;
        for (const kid of el.querySelectorAll<HTMLElement>('.rstep__num, .rstep__body')) {
          const r = kid.getBoundingClientRect();
          if (r.height < 1) continue;
          top = Math.min(top, r.top - box.top);
          bottom = Math.max(bottom, r.bottom - box.top);
        }
        const r = el.getBoundingClientRect();
        return Number.isFinite(top)
          ? { top, bottom }
          : { top: r.top - box.top, bottom: r.bottom - box.top };
      });

      built = buildPath(w, h, ys, boxes, w < NARROW);
      frac = built.frac;
      wins = frac.map((f) => Math.max(0.012, Math.min(WIN, (1 - f) * 0.6)));
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      dimRef.current?.setAttribute('d', built.d);
      gapsRef.current?.setAttribute('d', built.d);
      lit.setAttribute('d', built.d);

      // точки на линии — ровно там, где стоят номера
      for (let i = 0; i < items.length; i += 1) {
        items[i].style.setProperty(
          '--dot-x',
          `${(STEP_X[i] * (w < NARROW ? STEP_X_NARROW : 1) * w).toFixed(1)}px`,
        );
        items[i].style.setProperty('--dot-y', `${ys[i].toFixed(1)}px`);
      }

      /* Дальше ход подсветки считается не долей блока, а линией
         отсчёта: нужны только верх блока на странице и высота экрана. */
      top = box.top - shift;
      vh = sc.clientHeight;
    };

    const put = (p: number) => {
      /* ⚠️ ШЕСТЬ ЗНАКОВ, А НЕ ЧЕТЫРЕ. На хвосте хода демпфер подходит
         к единице шагами около 3·10⁻⁵, и при четырёх знаках соседние
         кадры печатались ОДИНАКОВО — сторож честно читал это как
         «скролл ехал, подсветка стояла» (5 кадров из 35 на мобильной).
         Стояла не подсветка, а наше округление. */
      lit.setAttribute('stroke-dashoffset', (1 - p).toFixed(6));
      for (let i = 0; i < items.length; i += 1) {
        const n0 = (p - frac[i]) / wins[i];
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
      if (!built) return;
      /* Линия отсчёта в системе координат блока — и сразу доля длины
         пути на этой высоте. */
      const p = fracAtY(built, y + vh * REF_Y - top);
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
      for (const el of items) {
        for (const prop of ['--n', '--dot-x', '--dot-y', '--sx', '--sg', '--ss', '--sw']) {
          el.style.removeProperty(prop);
        }
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

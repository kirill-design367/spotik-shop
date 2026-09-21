'use client';

import { useEffect, useRef } from 'react';
import { MORPH_DAMP_TOUCH_MS, finePointer, onLayoutChange, onScrollY, scroller } from '@/lib/scroll';
import { prefersReducedMotion } from '@/lib/motion';

export type Step = { t: string; d: string };

/**
 * БЛОК ПОРЯДКА — МАРШРУТ, А НЕ СХЕМА.
 *
 * По блоку идёт прерывистая зелёная линия с белым ядром. Она петляет
 * попеременно вправо и влево, УХОДЯ ЗА КРАЙ ЭКРАНА и возвращаясь.
 * По мере прокрутки линия загорается сверху вниз — как прокладываемый
 * путь; прокрутил назад — гаснет обратно. Пять точек маршрута стоят
 * РОВНО НА ЦИФРАХ: линия входит в номер сверху и выходит снизу.
 *
 * ── ДВАДЦАТЬ ТРЕТЬЯ ИТЕРАЦИЯ: ЧТО ИМЕННО ПЕРЕДЕЛАНО ──────────────────────
 *   • пройденная часть снова ПУНКТИРНАЯ — прерывистость идёт по всей
 *     линии, а не только по непройденной;
 *   • шаги встали ПОПЕРЕМЕННО слева и справа: прежде все пять жались
 *     к левому краю, и линия вместе с ними;
 *   • линия проходит СКВОЗЬ номера, а не слева от них;
 *   • по ленте бегут огни — «течение энергии», а не ровная обводка;
 *   • номер загорается, только когда фронт до него дошёл; чуть раньше
 *     допускается слабое «подготовительное» свечение.
 *
 * ── ФРОНТ — ГОРИЗОНТАЛЬНАЯ ЛИНИЯ, И ИМЕННО ЭТО ВСЁ УПРОЩАЕТ ──────────────
 * ⚠️ ПОДСВЕТКА БОЛЬШЕ НЕ ОБРЕЗАЕТСЯ ПО ДЛИНЕ ПУТИ. Обрезка длиной
 * (`stroke-dasharray` в долях `pathLength`) занимала единственный
 * дашараей элемента — значит пунктира у пройденной части быть
 * не могло в принципе.
 *
 * Выход из этого: по построению путь СПУСКАЕТСЯ — у каждого перегона
 * и вертикаль, и обе дуги идут строго вниз. Значит «пройдено» —
 * это в точности «выше линии отсчёта», а линия отсчёта горизонтальна.
 * Такую границу рисует обычный вертикальный градиент: выше фронта
 * непрозрачный, ниже — пустой. Дашарей при этом свободен и держит
 * пунктир, одинаковый на всей линии.
 *
 * В кадре от этого четыре записи атрибута (по две ординаты на два
 * градиента) вместо одной и ни одного чтения геометрии.
 *
 * ── КРИВАЯ ВЫПИСЫВАЕТСЯ ЯВНО ──────────────────────────────────────────────
 * Ни сплайна по набору точек, ни «дрожи пера»: у каждого перегона
 * ровно четыре куска — вертикаль из номера вниз, широкая дуга
 * к вершине петли за краем экрана, дуга обратно и вертикаль в номер
 * сверху. Касательная ВЕРТИКАЛЬНА во всех четырёх стыках, поэтому
 * изломов нет по построению.
 *
 * ⚠️ ВЫСОТА ВЕРШИНЫ ПЕТЛИ ДЕЛИТ ПОЛОСУ ПО ГОРИЗОНТАЛЬНОМУ ПУТИ.
 * Плечи у дуг разной длины: до вершины бывает вчетверо дальше, чем
 * обратно. Если отдать обеим половину высоты, длинная дуга ляжет
 * почти горизонтально, а короткая встанет колом — ровно это и
 * читалось как «угловато». Вершина ставится на долю полосы, равную
 * доле горизонтального пути, и наклон у обеих дуг получается один.
 *
 * ── БЕЗ СКРИПТА И ПРИ «УМЕНЬШИТЬ ДВИЖЕНИЕ» ────────────────────────────────
 * Номера и шаги лежат в разметке и по умолчанию видны целиком
 * (`--n: 1` задаёт CSS). Линия — декорация: её `d` собирается
 * из геометрии, и без скрипта её просто нет.
 */

/** Сторона, на которой стоит шаг: путь обязан ходить и влево, и вправо. */
const STEP_SIDE = [0, 1, 0, 1, 0];
/** Отступ номера от СВОЕЙ стороны блока, доли ширины — рельеф. */
const STEP_OFF = [0.055, 0.04, 0.125, 0.065, 0.15];
/** На узком экране разброс мельче: там и ширины меньше. */
const STEP_OFF_NARROW = 0.45;
/**
 * Отбой сверху, доли ширины блока.
 *
 * ⚠️ ОН ЖЕ ЗАДАЁТ РАЗМАХ ДУГИ. Перегон — это вся высота, на которой
 * линия успевает уйти за край экрана и вернуться: чем он короче,
 * тем площе дуга. Прежние 0.06…0.125 давали на 1920 полосу в 250 px
 * при горизонтальном пути в две тысячи — отсюда и «угловато».
 */
const STEP_GAP = [0, 0.22, 0.25, 0.2, 0.24];
/** Множитель кегля. Вразнобой: ни по возрастанию, ни по убыванию. */
const STEP_SIZE = [1.12, 0.78, 1.32, 0.74, 0.96];
/** Насколько вершина петли заходит за край экрана, доля выноса холста. */
const LOOP_OUT = 0.55;
/** На узком экране вынос холста меньше, но за край петля уходит всё равно. */
const NARROW = 720;
/** Воздух между текстом шага и местом, где линия начинает уходить вбок. */
const CLEAR = 26;

type Pt = { x: number; y: number };
type Seg = { c1: Pt; c2: Pt; p2: Pt };
/**
 * `pts` и `cum` — ломаная по всему пути и длина вдоль неё. Нужны
 * ТОЛЬКО бегущим огням: по ним вырезается короткий кусок ленты.
 */
type Built = {
  d: string;
  /** Лента, разрезанная на куски по вершинам петель: `ds[k]` — путь
   *  куска, `cy0`/`cy1` — его ординаты, `cat` — длина от начала пути
   *  до его начала (из неё берётся фаза пунктира). */
  ds: string[];
  cy0: number[];
  cy1: number[];
  cat: number[];
  top: number;
  bot: number;
  pts: Pt[];
  cum: number[];
  len: number;
};

/**
 * НА СКОЛЬКО КУСКОВ РЕЖЕТСЯ ЛЕНТА.
 *
 * Фронт стоит в ОДНОМ куске, и только он перерисовывается в кадре:
 * куски выше горят сплошным цветом, куски ниже не рисуются вовсе.
 * Значит цена кадра — площадь одного куска, и чем их больше, тем
 * она меньше. Двадцать четыре дают на десктопе кусок высотой
 * около 170 px, на мобильной — около 290 при экране 851.
 */
const CHUNKS = 24;
/**
 * ГДЕ МОЖНО РЕЗАТЬ — РЕШАЕТ ПУНКТИР, И ЭТО НЕ ПРИДИРКА.
 *
 * ⚠️ На стыке двух кусков сходятся два КРУГЛЫХ КОНЦА штриха, и
 * у полупрозрачных ореолов они складываются: 0.09 поверх 0.09 —
 * это уже 0.17, то есть по ленте идут узелки. Но если рез попал
 * в ПРОПУСК между штрихами, на стыке не рисует никто: предыдущий
 * кусок закончил штрих раньше, следующий начнёт позже, а фаза
 * у них общая. Пропуск 24 px, круглый конец самой широкой обводки
 * выступает на 6.5 px с каждой стороны — безопасна середина
 * пропуска, то есть длина `≡ 38` по модулю периода.
 */
const CUT_PHASE = 38;

/** Ближайший к `s` рез, попадающий в середину пропуска пунктира. */
function cutAt(s: number, len: number): number {
  const v = Math.round((s - CUT_PHASE) / DASH) * DASH + CUT_PHASE;
  return Math.min(len, Math.max(0, v));
}

/** Сколько огней бежит по ленте, длина каждого и период круга. */
const GLINTS = 4;
const GLINT_LEN = 52;
const GLINT_T = 7200;
/** Кадр огней: 30 в секунду. Быстрее не нужно, медленнее видно шаг. */
const GLINT_MS = 1000 / 30;
/**
 * Сколько огни стоят после последнего события прокрутки.
 *
 * ⚠️ ТОТ ЖЕ РЫЧАГ, ЧТО У СЦЕНЫ КАРТОЧЕК (Р-54, Р-71). В кадре
 * прокрутки страница и так перерисовывает половину экрана, и четыре
 * лишних пути поверх неё — чистая добавка. Собственное движение
 * ленты смотрят в покое; во время жеста смотрят на движение
 * страницы. 260 мс, а не 200: жест пальцем идёт не сплошным потоком
 * событий, и на паузе внутри жеста огни успевали шевельнуться прямо
 * посреди прокрутки.
 */
const GLINT_HOLD = 260;
/** Период пунктира ленты. Ровно тот же, что в CSS: штрих плюс пропуск. */
const DASH = 50;

/** Точка на ломаной по длине вдоль неё. */
function ptAt(pts: Pt[], cum: number[], s: number): Pt {
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const span = cum[hi] - cum[lo];
  const t = span > 0 ? (s - cum[lo]) / span : 0;
  return { x: pts[lo].x + (pts[hi].x - pts[lo].x) * t, y: pts[lo].y + (pts[hi].y - pts[lo].y) * t };
}

/** То же, но строкой для атрибута `d`. */
function atLen(pts: Pt[], cum: number[], s: number): string {
  const p = ptAt(pts, cum, s);
  return `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
}

/**
 * Собирает путь через точки шагов.
 *
 * `ax` — измеренные центры НОМЕРОВ: линия обязана проходить сквозь
 * цифру, а не рядом с ней, поэтому точка маршрута и есть центр номера.
 */
function buildPath(
  h: number,
  bleed: number,
  over: number,
  vw: number,
  ax: number[],
  ys: number[],
  boxes: { top: number; bottom: number }[],
): Built {
  const a = ax.map((x, i) => ({ x: x + bleed, y: ys[i] }));
  /* Края экрана в системе координат холста и вершины петель за ними. */
  const outR = over + vw + over * LOOP_OUT;
  const outL = over - over * LOOP_OUT;

  const start: Pt = { x: a[0].x, y: Math.max(2, boxes[0].top - 46) };
  let d = `M${start.x.toFixed(1)} ${start.y.toFixed(1)}`;
  /* Ломаная копится параллельно: огням нужен не путь, а точки на нём. */
  const pts: Pt[] = [start];
  const cum: number[] = [0];
  let at: Pt = start;
  const sample = (p1: Pt, s: Seg) => {
    /* ⚠️ ШАГ ПО ДУГЕ, А НЕ ПО ПАРАМЕТРУ. Перегоны разной длины:
       вертикаль из номера — полсотни пикселей, дуга за край экрана —
       две тысячи. При постоянном числе отсчётов на кубик точки
       на дуге стояли в полутора сотнях пикселей друг от друга,
       и огонь длиной в полсотни не попадал НИ НА ОДНУ — путь
       у него выходил пустым. Число отсчётов берётся от длины
       контрольной ломаной. */
    const est =
      Math.hypot(s.c1.x - p1.x, s.c1.y - p1.y) +
      Math.hypot(s.c2.x - s.c1.x, s.c2.y - s.c1.y) +
      Math.hypot(s.p2.x - s.c2.x, s.p2.y - s.c2.y);
    const n = Math.max(6, Math.min(260, Math.round(est / 9)));
    for (let q = 1; q <= n; q += 1) {
      const t = q / n;
      const u = 1 - t;
      const w0 = u * u * u;
      const w1 = 3 * u * u * t;
      const w2 = 3 * u * t * t;
      const w3 = t * t * t;
      const pt = {
        x: w0 * p1.x + w1 * s.c1.x + w2 * s.c2.x + w3 * s.p2.x,
        y: w0 * p1.y + w1 * s.c1.y + w2 * s.c2.y + w3 * s.p2.y,
      };
      cum.push(cum[cum.length - 1] + Math.hypot(pt.x - pts[pts.length - 1].x, pt.y - pts[pts.length - 1].y));
      pts.push(pt);
    }
  };
  const put = (s: Seg) => {
    d +=
      `C${s.c1.x.toFixed(1)} ${s.c1.y.toFixed(1)} ` +
      `${s.c2.x.toFixed(1)} ${s.c2.y.toFixed(1)} ` +
      `${s.p2.x.toFixed(1)} ${s.p2.y.toFixed(1)}`;
    sample(at, s);
    at = s.p2;
  };
  /** Прямая вертикаль: все четыре точки на одной абсциссе. */
  const run = (x: number, y0: number, y1: number) =>
    put({ c1: { x, y: y0 + (y1 - y0) * 0.4 }, c2: { x, y: y0 + (y1 - y0) * 0.8 }, p2: { x, y: y1 } });

  run(a[0].x, start.y, a[0].y);

  for (let i = 1; i < a.length; i += 1) {
    const p = a[i - 1];
    const q = a[i];
    /* Вершина петли — за тем краем, к которому идём: тогда выходы
       за края чередуются сами, вслед за сторонами шагов. */
    const far = STEP_SIDE[i] ? outR : outL;

    /* ⚠️ ВБОК ЛИНИЯ УХОДИТ ТОЛЬКО НИЖЕ ТЕКСТА. Вертикальная касательная
       задаёт лишь НАПРАВЛЕНИЕ выхода: уже к трети дуги по горизонтали
       пройдено больше двадцати процентов. Поэтому из номера идёт
       отдельный ПРЯМОЙ участок до низа своего содержимого, и только
       там линия начинает уходить вбок; в следующий номер входит так же. */
    let g1 = boxes[i - 1].bottom + CLEAR;
    let g2 = boxes[i].top - CLEAR;
    if (g2 - g1 < 60) {
      const c = (boxes[i - 1].bottom + boxes[i].top) / 2;
      g1 = c - 30;
      g2 = c + 30;
    }
    g1 = Math.min(Math.max(g1, p.y + 20), q.y - 60);
    g2 = Math.min(Math.max(g2, g1 + 60), q.y - 20);

    /* Доля полосы у каждой дуги равна её доле горизонтального пути —
       тогда наклон у обеих один и перелома на вершине не видно. */
    const l1 = Math.abs(far - p.x);
    const l2 = Math.abs(far - q.x);
    const band = g2 - g1;
    const share = Math.min(0.82, Math.max(0.18, l1 / Math.max(1, l1 + l2)));
    const ym = g1 + band * share;
    const h1 = band * share;
    const h2 = band * (1 - share);

    run(p.x, p.y, g1);
    put({ c1: { x: p.x, y: g1 + h1 * 0.62 }, c2: { x: far, y: ym - h1 * 0.58 }, p2: { x: far, y: ym } });
    put({ c1: { x: far, y: ym + h2 * 0.58 }, c2: { x: q.x, y: g2 - h2 * 0.62 }, p2: { x: q.x, y: g2 } });
    run(q.x, g2, q.y);
  }

  /* Хвост уходит вниз вдоль поля последнего шага и слегка вбок. */
  const last = a[a.length - 1];
  const tailY = Math.min(h - 2, Math.max(boxes[4].bottom + CLEAR, last.y + 110));
  const tail = Math.max(40, tailY - last.y);
  put({
    c1: { x: last.x, y: last.y + tail * 0.5 },
    c2: { x: last.x + (STEP_SIDE[4] ? 1 : -1) * 70, y: tailY - tail * 0.28 },
    p2: { x: last.x + (STEP_SIDE[4] ? 1 : -1) * 110, y: tailY },
  });

  const len = cum[cum.length - 1];

  /* ── ЛЕНТА РЕЖЕТСЯ НА КУСКИ ПО ЛОМАНОЙ ───────────────────────
     Куски вырезаются из той же ломаной, что и огни: шаг отсчётов
     около девяти пикселей, и на дуге радиусом в три сотни хорда
     отходит от кривой на три сотых пикселя. Непройденная часть
     остаётся ОДНИМ гладким путём — она статична. */
  const ds: string[] = [];
  const cy0: number[] = [];
  const cy1: number[] = [];
  const cat: number[] = [];
  let from = 0;
  for (let k = 0; k < CHUNKS; k += 1) {
    const to = k === CHUNKS - 1 ? len : cutAt(((k + 1) * len) / CHUNKS, len);
    if (to <= from) {
      ds.push('');
      cy0.push(0);
      cy1.push(0);
      cat.push(0);
      continue;
    }
    const a = ptAt(pts, cum, from);
    const b = ptAt(pts, cum, to);
    let dd = `M${a.x.toFixed(1)} ${a.y.toFixed(1)}`;
    for (let i = 0; i < pts.length; i += 1) {
      if (cum[i] <= from || cum[i] >= to) continue;
      dd += `L${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`;
    }
    dd += `L${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    ds.push(dd);
    cy0.push(a.y);
    cy1.push(b.y);
    cat.push(from);
    from = to;
  }

  return { d, ds, cy0, cy1, cat, top: start.y, bot: tailY, pts, cum, len };
}

/**
 * Окно, за которое номер разгорается ПОСЛЕ прихода фронта, и окно
 * слабого «подготовительного» свечения ДО него. Оба в пикселях блока:
 * фронт теперь горизонтален, и мерить долями длины больше нечего.
 */
const WIN = 54;
const PRE = 120;
const PRE_MAX = 0.2;
/** Мягкая кромка самого фронта. */
const EDGE = 30;

/**
 * ЛИНИЯ ОТСЧЁТА — 78 % ВЫСОТЫ ЭКРАНА, то есть заметно ниже середины.
 * Шаг загорается, пока он ещё в нижней половине кадра; к моменту,
 * когда блок уходит вверх, маршрут пройден целиком.
 */
const REF_Y = 0.78;

export default function Route({ steps }: { steps: Step[] }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const glintRef = useRef<SVGGElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const svg = svgRef.current;
    const sc = scroller();
    if (!root || !svg || !sc) return;

    const gLit = svg.querySelector<SVGLinearGradientElement>('#route-lit');
    const gCore = svg.querySelector<SVGLinearGradientElement>('#route-core');
    const dimEl = svg.querySelector<SVGPathElement>('.route__dim');
    const chunkEls = Array.from(svg.querySelectorAll<SVGGElement>('.route__chunk'));
    if (!gLit || !gCore || !dimEl || chunkEls.length !== CHUNKS) return;
    /* Состояние куска: 0 — не дошли, 1 — на фронте, 2 — пройден.
       Классы переставляются ТОЛЬКО на смене состояния: каждая
       перестановка — перерисовка этого куска. */
    const state: number[] = new Array(CHUNKS).fill(-1);

    let items: HTMLElement[] = [];
    let ys: number[] = [];
    let built: Built | null = null;
    let top = 0;
    let vh = 1;

    const measure = () => {
      /* Геометрия снимается ЗДЕСЬ и только здесь. */
      items = Array.from(root.querySelectorAll<HTMLElement>('.rstep'));
      if (items.length !== 5) return;

      /* ⚠️ РЕЛЬЕФ ВЫСТАВЛЯЕТСЯ ПЕРВЫМ, ДО ЧТЕНИЯ ЦЕНТРОВ. Сторона,
         отступ, отбой и кегль меняют раскладку шага: от них зависят
         переносы строк, а от переносов — высота. Померив центры
         до них, мы клали бы точки маршрута по вчерашней раскладке. */
      const w0 = Math.max(1, Math.round(root.getBoundingClientRect().width));
      const narrow0 = w0 < NARROW;
      const edge = Math.max(18, Math.min(40, w0 * 0.025));
      for (let i = 0; i < items.length; i += 1) {
        const off = w0 * (narrow0 ? STEP_OFF[i] * STEP_OFF_NARROW : STEP_OFF[i]);
        items[i].dataset.side = STEP_SIDE[i] ? 'r' : 'l';
        items[i].style.setProperty('--sx', `${off.toFixed(1)}px`);
        const sg = i === 0 ? 0 : Math.max(narrow0 ? 130 : 150, STEP_GAP[i] * Math.min(w0, 1300));
        items[i].style.setProperty('--sg', `${sg.toFixed(0)}px`);
        items[i].style.setProperty('--ss', STEP_SIZE[i].toFixed(2));
        items[i].style.setProperty('--sw', `${Math.max(180, w0 - off - edge).toFixed(0)}px`);
      }

      const shift = sc.getBoundingClientRect().top - sc.scrollTop;
      const box = root.getBoundingClientRect();
      const w = Math.max(1, Math.round(box.width));
      const h = Math.max(1, Math.round(box.height));

      /* Точка маршрута — ЦЕНТР НОМЕРА, обе координаты: линия обязана
         проходить сквозь цифру, а не мимо неё. */
      const ax: number[] = [];
      ys = items.map((el) => {
        const num = el.querySelector<HTMLElement>('.rstep__num');
        const nr = (num ?? el).getBoundingClientRect();
        ax.push(nr.left - box.left + nr.width / 2);
        return nr.top - box.top + nr.height / 2;
      });

      /* Коробка шага считается ПО СОДЕРЖИМОМУ, а не по самому шагу:
         боксы стоят вплотную, между ними только внешний отбой. */
      const boxes = items.map((el) => {
        let t = Infinity;
        let b = -Infinity;
        for (const kid of el.querySelectorAll<HTMLElement>('.rstep__num, .rstep__body')) {
          const r = kid.getBoundingClientRect();
          if (r.height < 1) continue;
          t = Math.min(t, r.top - box.top);
          b = Math.max(b, r.bottom - box.top);
        }
        const r = el.getBoundingClientRect();
        return Number.isFinite(t) ? { top: t, bottom: b } : { top: r.top - box.top, bottom: r.bottom - box.top };
      });

      /* Холст шире блока: петля обязана уйти ЗА КРАЙ ЭКРАНА
         и вернуться, а блок лежит внутри полей страницы. */
      const vw = Math.max(1, sc.clientWidth);
      const over = Math.max(56, Math.min(200, vw * (w < NARROW ? 0.2 : 0.13)));
      const bleed = Math.max(0, (vw - w) / 2) + over;
      const W = w + bleed * 2;
      root.style.setProperty('--bleed', `${bleed.toFixed(1)}px`);

      built = buildPath(h, bleed, over, vw, ax, ys, boxes);
      svg.setAttribute('viewBox', `0 0 ${W.toFixed(1)} ${h}`);
      /* Непройденная часть — ОДИН путь: он статичен и не перерисуется
         ни разу, поэтому резать его незачем. */
      dimEl.setAttribute('d', built.d);
      for (let k = 0; k < CHUNKS; k += 1) {
        /* ⚠️ ФАЗА ПУНКТИРА У КУСКА — ЕГО ДЛИНА ОТ НАЧАЛА ПУТИ. Без неё
           каждый кусок начинал бы штрих заново, и на стыке пунктир
           разъезжался бы с непройденной частью. Та же арифметика,
           что у огней, и ровно она делает рез невидимым. */
        const off = (built.cat[k] % DASH).toFixed(1);
        for (const el of chunkEls[k].querySelectorAll('path')) {
          el.setAttribute('d', built.ds[k]);
          el.setAttribute('stroke-dashoffset', off);
        }
      }
      state.fill(-1);

      for (let i = 0; i < items.length; i += 1) {
        items[i].style.setProperty('--dot-x', `${ax[i].toFixed(1)}px`);
        items[i].style.setProperty('--dot-y', `${ys[i].toFixed(1)}px`);
      }

      top = box.top - shift;
      vh = sc.clientHeight;
    };

    /** Кладёт фронт на высоту `y` внутри блока. */
    const put = (y: number) => {
      /* ⚠️ ГРАДИЕНТ ДЕРЖИТ ТОЛЬКО ТОТ КУСОК, ГДЕ СТОИТ ФРОНТ, И В ЭТОМ
         ВЕСЬ СМЫСЛ РЕЗА. Пока пара ординат была общей на всю ленту,
         её перезапись перерисовывала стек обводок размером с блок:
         33 % кадров дороже 16.9 мс на 2560 и полтора десятка длинных
         задач. Теперь кусок выше фронта горит СПЛОШНЫМ цветом
         и градиента не знает, кусок ниже не рисуется вовсе, а пишется
         только средний — то есть перерисовывается площадь одного
         куска. Классы переставляются лишь на смене состояния. */
      if (built) {
        const lo = y - EDGE;
        for (let k = 0; k < CHUNKS; k += 1) {
          const st = built.cy1[k] <= lo ? 2 : built.cy0[k] >= y ? 0 : 1;
          if (state[k] === st) continue;
          state[k] = st;
          const cl = chunkEls[k].classList;
          cl.toggle('route__chunk--on', st === 2);
          cl.toggle('route__chunk--at', st === 1);
        }
      }
      gLit.setAttribute('y1', (y - EDGE).toFixed(1));
      gLit.setAttribute('y2', y.toFixed(1));
      gCore.setAttribute('y1', (y - EDGE).toFixed(1));
      gCore.setAttribute('y2', y.toFixed(1));
      if (built) {
        const p = (y - built.top) / Math.max(1, built.bot - built.top);
        root.style.setProperty('--lit', (p < 0 ? 0 : p > 1 ? 1 : p).toFixed(6));
      }
      for (let i = 0; i < items.length; i += 1) {
        /* Номер загорается ТОЛЬКО когда фронт до него дошёл. Слабое
           свечение перед приходом разрешено постановкой отдельно —
           и оно именно слабое: пятая часть яркости. */
        const after = (y - ys[i]) / WIN;
        const n = after <= 0 ? 0 : after >= 1 ? 1 : after;
        const before = (y - (ys[i] - PRE)) / PRE;
        const pre = before <= 0 ? 0 : before >= 1 ? 1 : before;
        const v = Math.max(n, pre * PRE_MAX);
        items[i].style.setProperty('--n', v.toFixed(3));
      }
    };

    measure();

    /* При «уменьшить движение» линия подсвечена целиком, номера
       и шаги видны сразу: подписки просто не заводится. */
    if (prefersReducedMotion()) {
      const stand = () => {
        measure();
        put((built?.bot ?? 0) + 1000);
      };
      stand();
      return onLayoutChange(stand);
    }

    /* Демпфер — только на касаниях: на точном указателе позицию уже
       ведёт Lenis, и второе сглаживание поверх него — та самая тяжесть. */
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
      if (Math.abs(target - cur) < 0.02) cur = target;
      put(cur);
      if (cur !== target) raf = requestAnimationFrame(tick);
    };

    let scrolledAt = 0;

    const read = (y: number) => {
      scrolledAt = performance.now();
      if (!built) return;
      /* Линия отсчёта в системе координат блока — она же и есть фронт. */
      const line = y + vh * REF_Y - top;
      if (!damp) {
        put(line);
        return;
      }
      target = line;
      if (Number.isNaN(cur)) {
        cur = line;
        put(line);
        return;
      }
      if (cur === target || raf) return;
      prev = performance.now();
      raf = requestAnimationFrame(tick);
    };

    /* ── БЕГУЩИЕ ОГНИ ─────────────────────────────────────────────
       ⚠️ ОНИ НЕ ДВИЖУТСЯ ФАЗОЙ ПУНКТИРА, И ЭТО ЗАМЕР. Первый заход
       был проще некуда: шестая обводка того же пути с редким длинным
       штрихом и `stroke-dashoffset` на CSS-анимации. Браузер при этом
       перерисовывает ВЕСЬ путь — а он размером с блок, — и на 2560
       это давало 87 % кадров дороже 16.9 мс против 0.0 % без огней.

       Теперь огней ЧЕТЫРЕ, и каждый — отдельный короткий путь
       в полсотни пикселей, вырезанный из ломаной. Область
       перерисовки у него своя и крошечная. Градиент фронта тот же,
       поэтому в непройденной части огней нет по построению. */
    const glints = glintRef.current
      ? Array.from(glintRef.current.querySelectorAll<SVGPathElement>('path'))
      : [];
    let graf = 0;
    let gprev = 0;
    const burn = (now: number) => {
      graf = 0;
      if (!built || !glints.length) return;
      if (now - gprev >= GLINT_MS && now - scrolledAt >= GLINT_HOLD) {
        gprev = now;
        const { pts, cum, len } = built;
        for (let k = 0; k < glints.length; k += 1) {
          const s0 = (((now / GLINT_T + k / GLINTS) % 1) + 1) % 1;
          const from = s0 * (len - GLINT_LEN);
          const to = from + GLINT_LEN;
          /* Концы огня ставятся ТОЧНО, а не по ближайшему отсчёту:
             иначе длина огня гуляла бы на шаг ломаной, и он мигал бы
             на неровных участках. */
          let d2 = `M${atLen(pts, cum, from)}`;
          for (let i = 0; i < pts.length; i += 1) {
            if (cum[i] <= from || cum[i] >= to) continue;
            d2 += `L${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`;
          }
          d2 += `L${atLen(pts, cum, to)}`;
          glints[k].setAttribute('d', d2);
          /* ⚠️ ФАЗА ПУНКТИРА У ОГНЯ — ТА ЖЕ, ЧТО У ЛЕНТЫ. Огонь
             сплошным отрезком засвечивал бы пропуски между штрихами,
             и прерывистость на нём пропадала. Смещение равно длине
             от начала пути: тогда штрихи огня ложатся ровно на штрихи
             ленты. Хватает остатка от периода — число меньше и
             читается. */
          glints[k].setAttribute('stroke-dashoffset', (from % DASH).toFixed(1));
        }
      }
      graf = requestAnimationFrame(burn);
    };

    /* Гасим огни, когда блок ушёл с экрана: закон 11. */
    const io = new IntersectionObserver(
      (es) => {
        const on = es.some((e) => e.isIntersecting);
        if (on) {
          root.setAttribute('data-live', '');
          if (!graf) {
            gprev = 0;
            graf = requestAnimationFrame(burn);
          }
        } else {
          root.removeAttribute('data-live');
          if (graf) cancelAnimationFrame(graf);
          graf = 0;
          for (const g of glints) g.removeAttribute('d');
        }
      },
      { rootMargin: '10% 0px' },
    );
    io.observe(root);

    const offLayout = onLayoutChange(measure);
    const offScroll = onScrollY(read);
    return () => {
      io.disconnect();
      offLayout();
      offScroll();
      if (raf) cancelAnimationFrame(raf);
      if (graf) cancelAnimationFrame(graf);
      root.removeAttribute('data-live');
      root.style.removeProperty('--bleed');
      root.style.removeProperty('--lit');
      for (const el of items) {
        delete el.dataset.side;
        for (const prop of ['--n', '--dot-x', '--dot-y', '--sx', '--sg', '--ss', '--sw']) {
          el.style.removeProperty(prop);
        }
      }
    };
  }, [steps]);

  return (
    <div ref={rootRef} className="route">
      <svg ref={svgRef} className="route__svg" aria-hidden="true" preserveAspectRatio="none">
        <defs>
          {/* ФРОНТ — ОБЫЧНЫЙ ВЕРТИКАЛЬНЫЙ ГРАДИЕНТ. Выше него непрозрачно,
              ниже пусто; в кадре меняются только две ординаты. Дашарей
              при этом свободен и держит пунктир на всей линии.

              Пара одна на всю ленту, но ссылается на неё РОВНО ОДИН
              кусок — тот, где фронт сейчас стоит. Поэтому перезапись
              ординат перерисовывает его одного. */}
          <linearGradient id="route-lit" className="route__g-lit" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="-9999" y2="-9998">
            <stop offset="0" stopOpacity="1" />
            <stop offset="1" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="route-core" className="route__g-core" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="-9999" y2="-9998">
            <stop offset="0" stopOpacity="1" />
            <stop offset="1" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Непройденная часть: еле различимый пунктир того же шага —
            дашарей общий, поэтому штрихи ЗАГОРАЮТСЯ на своих местах.
            Это ОДИН гладкий путь: он статичен и не перерисовывается. */}
        <path className="route__dim" />
        {/* Пройденная часть — светодиод: три ореола и почти белое ядро,
            и так на каждом куске ленты. Рез приходится на середину
            пропуска пунктира, поэтому стыка не видно по построению. */}
        {Array.from({ length: CHUNKS }, (_, k) => (
          <g key={k} className="route__chunk">
            <path className="route__halo route__halo--3" />
            <path className="route__halo route__halo--2" />
            <path className="route__halo route__halo--1" />
            <path className="route__core" />
          </g>
        ))}
        {/* БЕГУЩИЕ ОГНИ. Четыре коротких куска ленты, которые едут
            по ней по кругу: отсюда «неравномерная яркость вдоль пути»
            и её собственное движение. Каждый — свой элемент, потому
            что перерисовывается область его собственного размера,
            а не весь блок. */}
        <g ref={glintRef} className="route__glints">
          <path className="route__glint" />
          <path className="route__glint" />
          <path className="route__glint" />
          <path className="route__glint" />
        </g>
      </svg>

      <ol className="route__list">
        {steps.map((s, i) => (
          <li key={s.t} className="rstep">
            <span className="rstep__dot" aria-hidden="true" />
            <span className="rstep__num tnum" aria-hidden="true">
              {i + 1}
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

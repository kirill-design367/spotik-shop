/**
 * ВОРДМАРК-СКОБКИ: математика сжатия.
 *
 * Приём разобран покадрово на референсе (замеры арт-директора, 1920×1080):
 *   • высота прописной падает с 770 до 450 px  → в 1.711 раза
 *   • горизонтальные штрихи худеют со 123 до 43 px → в 2.860 раза
 *   • вертикальные штрихи НЕ меняются вовсе     → ровно 1.000
 *   • ширина слова постоянна: всегда во всю ширину, всегда обрезано краями
 *
 * Отсюда следует, что это НЕ CSS-трансформ: при scaleY отношение штрихов
 * сохранялось бы, а оно меняется втрое относительно высоты. Значит,
 * анимируются оси вариативного шрифта.
 *
 * Roboto Flex несёт 13 осей, среди них параметрические оси Font Bureau:
 *   YTUC — высота прописных            (528…760)
 *   YOPQ — толщина ГОРИЗОНТАЛЬНЫХ штрихов, «y-opaque» (25…135)
 *   XOPQ — толщина ВЕРТИКАЛЬНЫХ штрихов,  «x-opaque» (27…175)
 *   wdth — ширина                       (25…151)
 * Это ровно тот набор, который описывают замеры.
 *
 * ── ВЫВОД ЧИСЕЛ ────────────────────────────────────────────────────────────
 * S(t) — кегль, Wem(t) — ширина слова в em. Ширина на экране постоянна и равна
 * TARGET, значит S(t) = TARGET / Wem(t). Пусть r = S(0)/S(1) = Wem(1)/Wem(0).
 *
 *   высота   : r · YTUC₀/YTUC₁ = 1.711
 *   горизонт : r · YOPQ₀/YOPQ₁ = 2.860
 *   вертикаль: r · XOPQ₀/XOPQ₁ = 1.000
 *
 * Ось YTUC даёт максимум 760/528 = 1.4394. Берём её целиком, тогда
 *   r = 1.711 / 1.4394 = 1.1888
 * кегль падает в 1.19 раза, а ширину слова добирает ось wdth — ровно как
 * в замере: «ширина растёт, чтобы слово продолжало упираться в края».
 *   YOPQ₁ = YOPQ₀ · r / 2.860   горизонтали худеют быстрее высоты
 *   XOPQ₁ = XOPQ₀ · r           вертикали компенсируют падение кегля и стоят
 *
 * ── ЧТО ИЗМЕРЕНО В БРАУЗЕРЕ (scripts/measure-axes.mjs) ─────────────────────
 * • YTUC вообще не влияет на ширину слова: 1.8103 em при всех значениях
 *   от 528 до 760. Высота и ширина ортогональны — это и позволяет решать
 *   их по отдельности.
 * • XOPQ влияет на ширину сильно (1.298 em при 27 → 2.502 em при 167),
 *   поэтому wdth сжатого состояния не считается формулой, а НАХОДИТСЯ
 *   БИНАРНЫМ ПОИСКОМ по фактическому замеру, уже с учётом нового XOPQ.
 * • При wdth = 46 на 1920×1080 высота прописной выходит 777 px —
 *   то есть замер референса (770 px) воспроизводится осями почти точно.
 */

export const WORD = 'SPOTIK';

/** Замеры референса. Правятся только здесь. */
export const REFERENCE = {
  capRatio: 770 / 450, //  1.7111 — падение высоты прописных
  horizontalRatio: 123 / 43, //  2.8605 — утоньшение горизонтальных штрихов
  verticalRatio: 1, //  вертикальные не меняются
  capAt1920: 770,
} as const;

export type Axes = {
  wght: number;
  wdth: number;
  opsz: number;
  YTUC: number;
  YOPQ: number;
  XOPQ: number;
  XTRA: number;
  GRAD: number;
};

/** Границы осей, прочитанные из таблицы fvar бинарника (scripts/font-audit.py). */
export const AXIS_RANGE: Record<keyof Axes, readonly [number, number]> = {
  wght: [100, 1000],
  wdth: [25, 151],
  opsz: [8, 144],
  YTUC: [528, 760],
  YOPQ: [25, 135],
  XOPQ: [27, 175],
  XTRA: [323, 603],
  GRAD: [-200, 150],
};

const clampAxis = (k: keyof Axes, v: number) => {
  const [lo, hi] = AXIS_RANGE[k];
  return v < lo ? lo : v > hi ? hi : v;
};

/**
 * Раскрытое состояние без ширины — её находит калибровка.
 *
 * Шесть литер во всю ширину задают ширину ОДНОЙ литеры жёстко: vw/6.
 * Значит, пропорцией знака управляет единственная ось — wdth. Чем она уже,
 * тем крупнее кегль при той же ширине слова и тем выше прописные.
 * Поэтому wdth не задаётся breakpoint'ами, а РЕШАЕТСЯ: берём самые высокие
 * литеры, какие ещё помещаются в отведённую композицией высоту.
 */
export function openAxesSeed(): Axes {
  return {
    wght: 700,
    wdth: AXIS_RANGE.wdth[0], // стартовая точка поиска: самый узкий рез
    opsz: 144,
    YTUC: AXIS_RANGE.YTUC[1], // 760
    YOPQ: 132,
    XOPQ: 92,
    XTRA: 468,
    GRAD: 0,
  };
}

/** Во сколько раз падает кегль: 1.711 / (760/528). */
export const SIZE_RATIO = REFERENCE.capRatio / (AXIS_RANGE.YTUC[1] / AXIS_RANGE.YTUC[0]);

/**
 * Сжатое состояние. Значения НЕ выведены формулой, а найдены итерациями
 * по растру — scripts/solve-axes.mjs рисует слово и меряет пиксели.
 *
 * Почему не формулой: связь «значение оси → толщина штриха в пикселях»
 * у Roboto Flex нелинейна. XOPQ подмешивается в горизонтали, wdth влияет
 * на обе толщины, а кегль каждый раз пересчитывается под постоянную ширину
 * слова. Формула даёт первое приближение, дальше решает замер.
 *
 * Что показал замер:
 *  • YOPQ упирается в минимум 25 и в одиночку даёт утоньшение горизонталей
 *    только в 2.656 раза при нужных 2.860;
 *  • недостающее берёт ось GRAD — она меняет толщину штрихов, не трогая
 *    метрики, поэтому ширина слова не едет;
 *  • GRAD худит и вертикали тоже, их возвращает на место XOPQ.
 *
 * Итог схождения (1920×1080, замер по растру):
 *    высота прописной   683 → 399 px   ×1.712  при цели ×1.711
 *    горизонтальный штрих 170 → 60 px  ×2.857  при цели ×2.860
 *    вертикальный штрих  141 → 141 px  ×1.000  при цели ×1.000
 * Дальше упирается в целочисленность пикселя: горизонталь меряется
 * величиной около 60 px, шаг в один пиксель — это уже ±1.7% отношения.
 */
export const TIGHT_SOLVED = {
  /** Множитель XOPQ относительно раскрытого состояния. */
  XOPQ_FACTOR: 1.3565,
  /** Абсолютное значение GRAD в сжатом состоянии. */
  GRAD: -70.5,
} as const;

export function tightAxesSeed(open: Axes): Axes {
  return {
    wght: open.wght,
    opsz: open.opsz,
    XTRA: open.XTRA,
    YTUC: AXIS_RANGE.YTUC[0], // 528 — весь ход оси высоты прописных
    YOPQ: AXIS_RANGE.YOPQ[0], // 25  — весь ход оси горизонтальных штрихов
    XOPQ: clampAxis('XOPQ', open.XOPQ * TIGHT_SOLVED.XOPQ_FACTOR),
    GRAD: TIGHT_SOLVED.GRAD,
    wdth: open.wdth, // стартовая точка бинарного поиска
  };
}

export const AXIS_KEYS: (keyof Axes)[] = ['wght', 'wdth', 'opsz', 'YTUC', 'YOPQ', 'XOPQ', 'XTRA', 'GRAD'];

export function lerpAxes(a: Axes, b: Axes, t: number): Axes {
  const out = {} as Axes;
  for (let i = 0; i < AXIS_KEYS.length; i += 1) {
    const k = AXIS_KEYS[i];
    out[k] = a[k] + (b[k] - a[k]) * t;
  }
  return out;
}

/** Строка для CSS font-variation-settings. */
export function axesToCss(a: Axes): string {
  return (
    `"wght" ${a.wght.toFixed(1)},"wdth" ${a.wdth.toFixed(2)},"opsz" ${a.opsz.toFixed(1)},` +
    `"YTUC" ${a.YTUC.toFixed(1)},"YOPQ" ${a.YOPQ.toFixed(2)},"XOPQ" ${a.XOPQ.toFixed(2)},` +
    `"XTRA" ${a.XTRA.toFixed(1)},"GRAD" ${a.GRAD.toFixed(1)}`
  );
}

/**
 * Насколько слово шире вьюпорта. Первая и последняя литеры обязаны уйти
 * за экран — это не смягчается ни на одном размере.
 * 1.16 при шести литерах срезает примерно по половине литеры с каждой стороны.
 */
export const OVERSCAN = 1.16;

/** Смягчение прогресса: сжатие начинается спокойно и доходит до края решительно. */
export function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

/* ────────────────────────────────────────────────────────────────────────────
 * КАЛИБРОВКА
 *
 * Кегль подбирается расчётом, а не на глаз. Но мерить ширину текста каждый
 * кадр нельзя — это forced reflow. Поэтому один раз при монтировании и на
 * ресайзе строится таблица «прогресс → ширина слова в em», а в кадре кегль
 * берётся из неё интерполяцией. Ноль измерений в кадре.
 * ────────────────────────────────────────────────────────────────────────── */

const MEASURE_PX = 400; // крупный кегль замера — меньше вклад округлений
export const LUT_STEPS = 65;

export type Calibration = {
  open: Axes;
  tight: Axes;
  /** Ширина слова в em в узлах таблицы (по уже смягчённому прогрессу). */
  emWidth: Float64Array;
  /** Положение базовой линии в долях кегля — нужно для точной привязки по вертикали. */
  baselineRatio: number;
  /** Фактически достигнутое отношение кеглей; должно совпасть с SIZE_RATIO. */
  actualSizeRatio: number;
  viewportWidth: number;
  /**
   * Влезли ли прописные в отведённую высоту. false означает окно настолько
   * низкое, что даже предельный wdth не помогает: слово надо обрезать
   * сверху и снизу, а не пускать его на текст.
   */
  capFits: boolean;
  /** Высота, отведённая композицией. */
  maxCap: number;
};

type Probe = { host: HTMLElement; span: HTMLSpanElement; strut: HTMLSpanElement };

function makeProbe(host: HTMLElement): Probe {
  const span = document.createElement('span');
  span.setAttribute('aria-hidden', 'true');
  span.style.cssText = [
    'position:absolute',
    'left:-200vw',
    'top:0',
    'visibility:hidden',
    'pointer-events:none',
    'white-space:pre',
    'display:inline-block',
    'letter-spacing:0',
    'font-family:var(--font-wordmark)',
    'font-synthesis:none',
    `font-size:${MEASURE_PX}px`,
    'line-height:1',
    'contain:layout style',
  ].join(';');
  span.textContent = WORD;
  // нулевой распорке браузер ставит низ ровно на базовую линию
  const strut = document.createElement('span');
  strut.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
  span.appendChild(strut);
  host.appendChild(span);
  return { host, span, strut };
}

function measureEm(p: Probe, axes: Axes): number {
  p.span.style.fontVariationSettings = axesToCss(axes);
  return p.span.getBoundingClientRect().width / MEASURE_PX;
}

/**
 * Находит wdth сжатого состояния так, чтобы ширина слова выросла ровно
 * в SIZE_RATIO раз, и строит таблицу ширин. Вызывается вне кадра.
 */
export function calibrate(host: HTMLElement, viewportWidth: number, maxCap: number): Calibration {
  const p = makeProbe(host);

  // ── шаг 1: найти самые высокие литеры, какие ещё влезают в отведённую высоту
  // Слово всегда во всю ширину, поэтому высота прописной однозначно зависит
  // от wdth: cap(wdth) = vw · OVERSCAN / Wem(wdth) · YTUC/1000, монотонно
  // убывает. Ищем минимальный wdth, при котором cap ещё не превышает maxCap.
  const seed = openAxesSeed();
  const target1 = viewportWidth * OVERSCAN;
  const capAt = (wdth: number) =>
    (target1 / measureEm(p, { ...seed, wdth })) * (seed.YTUC / 1000);

  let openWidth = AXIS_RANGE.wdth[0];
  let capFits = true;
  if (maxCap > 0 && capAt(openWidth) > maxCap) {
    // Цель достижима не всегда: на очень низком и широком окне даже самый
    // широкий рез даёт прописные выше, чем отведено. Тогда берём предельный
    // wdth и сообщаем наружу, что слово не влезло — слой обрежет его сверху
    // и снизу вместо того, чтобы наехать на текст хиро.
    if (capAt(AXIS_RANGE.wdth[1]) > maxCap) {
      openWidth = AXIS_RANGE.wdth[1];
      capFits = false;
    } else {
      let a = AXIS_RANGE.wdth[0];
      let b = AXIS_RANGE.wdth[1];
      for (let i = 0; i < 26; i += 1) {
        const mid = (a + b) / 2;
        if (capAt(mid) > maxCap) a = mid;
        else b = mid;
      }
      openWidth = b;
    }
  }

  const open: Axes = { ...seed, wdth: openWidth };
  const openEm = measureEm(p, open);
  const target = openEm * SIZE_RATIO;

  // ── шаг 2: ширина слова монотонно растёт с wdth — годится бинарный поиск
  const tightSeed = tightAxesSeed(open);
  let lo = AXIS_RANGE.wdth[0];
  let hi = AXIS_RANGE.wdth[1];
  let best = tightSeed.wdth;
  for (let i = 0; i < 28; i += 1) {
    const mid = (lo + hi) / 2;
    const em = measureEm(p, { ...tightSeed, wdth: mid });
    best = mid;
    if (Math.abs(em - target) / target < 1e-6) break;
    if (em < target) lo = mid;
    else hi = mid;
  }

  const tight: Axes = { ...tightSeed, wdth: clampAxis('wdth', best) };
  const tightEm = measureEm(p, tight);

  const emWidth = new Float64Array(LUT_STEPS);
  for (let i = 0; i < LUT_STEPS; i += 1) {
    const t = i / (LUT_STEPS - 1);
    emWidth[i] = measureEm(p, lerpAxes(open, tight, ease(t)));
  }

  // базовая линия: низ нулевой распорки относительно верха строки
  measureEm(p, open);
  const box = p.span.getBoundingClientRect();
  const baselineRatio = (p.strut.getBoundingClientRect().bottom - box.top) / MEASURE_PX;

  p.span.remove();

  return {
    open,
    tight,
    emWidth,
    baselineRatio,
    actualSizeRatio: tightEm / openEm,
    viewportWidth,
    capFits,
    maxCap,
  };
}

/** Линейная выборка из таблицы ширин — без единого измерения в кадре. */
export function emWidthAt(cal: Calibration, t: number): number {
  const x = (t < 0 ? 0 : t > 1 ? 1 : t) * (LUT_STEPS - 1);
  const i = x | 0;
  if (i >= LUT_STEPS - 1) return cal.emWidth[LUT_STEPS - 1];
  const f = x - i;
  return cal.emWidth[i] + (cal.emWidth[i + 1] - cal.emWidth[i]) * f;
}

export type Frame = {
  fontSize: number;
  axes: Axes;
  /** Высота прописной в px — по ней идёт вертикальная привязка. */
  capHeight: number;
  /** Смещение базовой линии от верха строки в px. */
  baseline: number;
};

/** Состояние вордмарка на прогрессе t. Чистая арифметика, ни одного чтения DOM. */
export function frameAt(cal: Calibration, t: number, viewportWidth: number): Frame {
  const e = ease(t);
  const axes = lerpAxes(cal.open, cal.tight, e);
  const fontSize = (viewportWidth * OVERSCAN) / emWidthAt(cal, t);
  return {
    fontSize,
    axes,
    capHeight: (fontSize * axes.YTUC) / 1000,
    baseline: fontSize * cal.baselineRatio,
  };
}

/**
 * Трекинг-доводка. Таблица интерполируется линейно, поэтому между узлами
 * остаётся погрешность в доли процента. Замерять её в кадре нельзя, зато
 * можно один раз после остановки скролла: считаем невязку и размазываем
 * её по межбуквенным просветам.
 */
export function trackingCorrection(actualWidth: number, targetWidth: number): number {
  if (!actualWidth || !Number.isFinite(actualWidth)) return 0;
  const delta = targetWidth - actualWidth;
  if (Math.abs(delta) < 0.25) return 0; // меньше четверти пикселя не трогаем
  return delta / WORD.length;
}

/**
 * ВОЛНА НА КАРТОЧКАХ ТАРИФА. CANVAS 2D, ОДИН ЦИКЛ НА ВСЕ ЧЕТЫРЕ.
 *
 * Это та самая волна, которую придумали для хиро и не поставили
 * (третья итерация сняла её как спорящую с вордмарком). Всё, что было
 * про неё выяснено замером, здесь сохранено дословно — см. Р-4 и Р-59.
 *
 * ── ЧЕТЫРЕ УСЛОВИЯ ПОСТАНОВКИ И КАК ОНИ ВЫПОЛНЕНЫ ─────────────────────────
 *
 * 1. ПЛОТНОСТЬ. Не одна линия, а стопка тонких контуров, наслоённых
 *    со смещением и затуханием: каждый идёт на своей доле s от центра
 *    до полной огибающей, и стопка целиком читается как ткань.
 *    Свечение набирается НАЛОЖЕНИЕМ — ни одной тени, ни одного блюра
 *    и ни одного фильтра: на сотне линий это убило бы кадр.
 *
 * 2. ФОРМА ОТ РЕАЛЬНОГО ЗВУКА. Ординаты берутся из `WAVEFORM` — пиковой
 *    огибающей настоящего сигнала (`scripts/build-waveform.py`), лежащей
 *    в коде числами. Ни аудиофайла, ни запросов в рантайме. Синусоиды нет.
 *
 * 3. ОТКЛИК НА КУРСОР — ЛОКАЛЬНЫЙ. Под указателем дорожка ЕДЕТ и слегка
 *    вздувается, остальная стопка стоит. «Вся разом» не дрожит никогда:
 *    множитель `loc` считается по столбцу ОДИН раз за кадр (не внутри
 *    каждого контура — на этом обожглись в Р-4) и гасится гауссианой.
 *
 * 4. НА КАСАНИЯХ — МЕДЛЕННОЕ СОБСТВЕННОЕ ДВИЖЕНИЕ. Указателя там нет,
 *    поэтому едет вся дорожка, но медленно и с пониженной частотой.
 *
 * ── МАСШТАБ ХОЛСТА ТОЛЬКО ЦЕЛЫЙ ───────────────────────────────────────────
 * Замер третьей итерации (Р-4): 124 контура при масштабе 1 стоят ровно
 * столько же, сколько сорок и сколько ноль, а МЕНЬШАЯ площадь при дробном
 * масштабе даёт вдвое худший кадр — дело в передискретизации поверхности,
 * а не в числе линий. Поэтому буфер холста совпадает с его CSS-размером
 * один в один, и плотность резать не приходится.
 *
 * ── ЦИКЛ ОДИН И ГАСНЕТ В ПОКОЕ ────────────────────────────────────────────
 * Рисуется только то, что (а) на экране и (б) чем-то занято: откликом
 * под указателем или собственным ходом. На точном указателе в покое
 * не заказывается ни одного кадра — закон 11 цел. Собственный ход
 * вдобавок СТОИТ, пока страница едет: перерисовывать четыре карточки
 * одновременно с ходом страницы — это потерянные кадры на ровном месте
 * (тот же рычаг, что был у объёма, Р-54).
 */
import { WAVEFORM, WAVEFORM_LENGTH } from '@/lib/waveform.data';
import { onScrollY } from '@/lib/scroll';

/** Интерполированная выборка из огибающей с заворотом по кольцу. */
function sample(i: number): number {
  const n = WAVEFORM_LENGTH;
  let x = i % n;
  if (x < 0) x += n;
  const a = x | 0;
  const b = a + 1 === n ? 0 : a + 1;
  return WAVEFORM[a] + (WAVEFORM[b] - WAVEFORM[a]) * (x - a);
}

/**
 * Сколько корзин огибающей укладывается в ширину карточки.
 *
 * ЗАВИСИТ ОТ ШИРИНЫ, и это не украшение. Карточка на 390 выходит 170 px,
 * на 2560 — больше тысячи; при постоянном числе корзин на узкой волна
 * превращалась в частокол, а на широкой — в редкие мазки, и waveform
 * переставал узнаваться и там, и там. Держим примерно постоянную
 * ПЛОТНОСТЬ: корзина на 4…11 px, а точек на корзину не меньше двух,
 * иначе форма начинает лесенкой врать.
 */
function spanFor(w: number) {
  return Math.max(38, Math.min(78, w / 11));
}
/** Сдвиг чтения между крайними контурами — он и даёт объём. */
const SHEAR = 2.2;
/** Ширина «оживления» под курсором: чем больше, тем у́же пятно. */
const K_LOCAL = 30;
/** Скорость проезда дорожки ПОД КУРСОРОМ, корзин в секунду. */
const LOCAL_RATE = 30;
/** Насколько пятно поднимает амплитуду. */
const LOCAL_LIFT = 0.55;
/** Собственный ход на касаниях, корзин в секунду. */
const DRIFT_RATE = 3.4;
/** Кадр собственного хода: 20 кадров в секунду вместо 60. */
const DRIFT_MS = 50;
/**
 * ⚠️ ФАЗЫ СОБСТВЕННОГО ХОДА РАЗВЕДЕНЫ, И ЭТО ЗАМЕР, А НЕ КРАСОТА.
 * В среде без видеоускорителя перерисовка карточки стоит около 4 мс
 * на 1920, и четыре карточки, обновившиеся в одном кадре, съедают
 * бюджет целиком. Разведённые по фазе, они обновляются по очереди:
 * в кадре шевелится РОВНО ОДНА. На глаз разницы нет — каждая идёт
 * всё те же 20 кадров в секунду.
 */
const DRIFT_STAGGER = DRIFT_MS / 4;
/** Демпфер присутствия указателя: волна просыпается и засыпает плавно. */
const TAU = 150;
/** Порог схождения демпфера. */
const EPS = 0.002;
/** Пауза после последнего события прокрутки, мс. */
const SCROLL_IDLE = 220;

type State = {
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  lines: number;
  points: number;
  xs: Float32Array;
  fxs: Float32Array;
  loc: Float32Array;
  /** сдвиг чтения: у каждой карточки свой, иначе четыре одинаковых волны */
  seed: number;
  /** цель и текущее значение присутствия указателя, 0…1 */
  pt: number;
  pc: number;
  /** доля ширины, где сейчас указатель */
  px: number;
  /** накопленный локальный ход и собственный ход */
  swirl: number;
  drift: number;
  driftOn: boolean;
  visible: boolean;
  live: boolean;
  last: number;
};

const waves = new Set<State>();
let raf = 0;
let prev = 0;

/* ── СТОРОЖ ПРОКРУТКИ ────────────────────────────────────────────────────
   Пока страница едет, собственный ход стоит. Отписка — по последнему
   слоту: слушатель один на всю страницу. */
let scrolling = false;
let idleTimer = 0;
let offScroll: (() => void) | null = null;

function watchScroll() {
  if (offScroll) return;
  offScroll = onScrollY(() => {
    scrolling = true;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      idleTimer = 0;
      scrolling = false;
      pump();
    }, SCROLL_IDLE);
  });
}

function unwatchScroll() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = 0;
  scrolling = false;
  offScroll?.();
  offScroll = null;
}

/** Плотность стопки. Линий на телефоне меньше — но их всё равно десятки. */
function tuning(w: number, coarse: boolean) {
  const points = Math.round(Math.max(96, Math.min(180, w / 4)));
  if (coarse) return { lines: 54, points: Math.min(points, 108) };
  return { lines: 96, points };
}

function layout(s: State) {
  const w = Math.max(1, Math.round(s.host.clientWidth));
  const h = Math.max(1, Math.round(s.host.clientHeight));
  const coarse = s.driftOn;
  const t = tuning(w, coarse);
  s.w = w;
  s.h = h;
  s.lines = t.lines;
  if (t.points !== s.points) {
    s.points = t.points;
    s.xs = new Float32Array(t.points);
    s.fxs = new Float32Array(t.points);
    s.loc = new Float32Array(t.points);
  }
  for (let p = 0; p < s.points; p += 1) {
    s.fxs[p] = p / (s.points - 1);
    s.xs[p] = s.fxs[p] * w;
  }
  // масштаб РОВНО единица: дробный включает передискретизацию всей
  // поверхности каждый кадр и стоит дороже всей отрисовки (Р-4)
  if (s.canvas.width !== w || s.canvas.height !== h) {
    s.canvas.width = w;
    s.canvas.height = h;
  }
  s.ctx.lineCap = 'butt';
  s.ctx.lineJoin = 'round';
  s.ctx.lineWidth = 1;
}

function draw(s: State) {
  const { ctx, w, h, points, lines } = s;
  if (w < 2 || h < 2) return;
  ctx.clearRect(0, 0, w, h);

  /* Вклад «оживления» считается ПО СТОЛБЦУ и один раз за кадр. Внутри
     цикла контуров это было бы то же самое, умноженное на сотню. */
  const live = s.pc;
  if (live > EPS) {
    for (let p = 0; p < points; p += 1) {
      const d = s.fxs[p] - s.px;
      s.loc[p] = Math.exp(-(d * d) * K_LOCAL) * live;
    }
  } else if (s.loc[0] !== 0 || s.loc[points >> 1] !== 0) {
    s.loc.fill(0);
  }

  const cy = h * 0.44;
  const base = h * 0.012;
  const amp = h * 0.33;
  const head = s.seed + s.drift;
  const span = spanFor(w);

  ctx.strokeStyle = '#1DB954';

  for (let i = 0; i < lines; i += 1) {
    const u = i / (lines - 1);
    const s2 = (u - 0.5) * 2; // −1 … +1
    const as = s2 < 0 ? -s2 : s2;

    /* Затухание ПО СТОПКЕ. Наружные контуры несут полную огибающую
       и держат верхнюю кромку, внутренние сходятся к оси и набирают
       плотность наложением — отсюда и ткань, и узнаваемый силуэт
       дорожки. Обратный порядок (ярче в центре) давал ровно ту ошибку,
       на которой первый заход и сорвался: огибающая пропадала,
       а сдвиг между контурами читался как регулярные диагонали. */
    const alpha = 0.026 + 0.040 * as * as;
    ctx.globalAlpha = alpha;
    ctx.beginPath();

    const shear = s2 * SHEAR + head;
    for (let p = 0; p < points; p += 1) {
      const k = s.loc[p];
      const v = sample(shear + s.fxs[p] * span + k * s.swirl);
      const y = cy + s2 * (base + amp * v * (1 + LOCAL_LIFT * k));
      if (p === 0) ctx.moveTo(s.xs[p], y);
      else ctx.lineTo(s.xs[p], y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function tick(now: number) {
  raf = 0;
  const dt = Math.min(64, prev ? now - prev : 16);
  prev = now;
  let busy = false;

  for (const s of waves) {
    if (!s.live || !s.visible) continue;
    let move = false;

    if (s.driftOn && !scrolling) {
      s.drift += (DRIFT_RATE * dt) / 1000;
      move = true;
    }

    /* Доля пути от ФАКТИЧЕСКОГО Δt: иначе на 30 fps отклик смягчается
       вдвое сильнее, чем на 60 (Р-44). */
    const k = 1 - Math.exp(-dt / TAU);
    if (Math.abs(s.pt - s.pc) > EPS) {
      s.pc += (s.pt - s.pc) * k;
      move = true;
    } else if (s.pc !== s.pt) {
      s.pc = s.pt;
      move = true;
    }
    // пока указатель в карточке, дорожка под ним едет
    if (s.pc > EPS) {
      s.swirl += (LOCAL_RATE * dt) / 1000;
      move = true;
    }

    if (!move) continue;
    busy = true;
    /* Собственный ход идёт с пониженной частотой: на касаниях едут все
       видимые карточки сразу, и лишние кадры там стоят дороже, чем
       видны. Отклик под курсором — всегда полная частота: он за рукой. */
    const gap = s.pc <= EPS && s.driftOn ? DRIFT_MS : 0;
    if (now - s.last < gap) continue;
    s.last = now;
    draw(s);
  }

  if (busy) raf = requestAnimationFrame(tick);
  else prev = 0;
}

function pump() {
  if (raf) return;
  prev = 0;
  raf = requestAnimationFrame(tick);
}

export type WaveHandle = {
  relayout: () => void;
  /** доля ширины 0…1, либо null — указатель ушёл */
  setPointer: (x: number | null) => void;
  setVisible: (on: boolean) => void;
  dispose: () => void;
};

export function attachWave(
  host: HTMLElement,
  { seed, drift }: { seed: number; drift: boolean },
): WaveHandle | null {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;display:block;width:100%;height:100%';
  const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
  if (!ctx) return null;
  host.appendChild(canvas);

  const s: State = {
    host,
    canvas,
    ctx,
    w: 0,
    h: 0,
    lines: 0,
    points: 0,
    xs: new Float32Array(0),
    fxs: new Float32Array(0),
    loc: new Float32Array(0),
    /* Отрезок берётся из ГРОМКОЙ части дорожки: в начале сигнала лежит
       тихое вступление, и на нём волна читалась бы как прямая. */
    seed: 140 + ((seed * 137) % 760),
    pt: 0,
    pc: 0,
    px: 0.5,
    swirl: 0,
    drift: 0,
    driftOn: drift,
    visible: true,
    live: true,
    /* Фаза собственного хода: карточки обновляются по очереди,
       а не все в одном кадре. См. DRIFT_STAGGER. */
    last: performance.now() - (waves.size % 4) * DRIFT_STAGGER,
  };
  waves.add(s);
  watchScroll();
  layout(s);
  draw(s);
  if (drift) pump();

  return {
    relayout() {
      if (!s.live) return;
      layout(s);
      draw(s);
    },
    setPointer(x) {
      if (!s.live) return;
      if (x === null) {
        s.pt = 0;
      } else {
        s.pt = 1;
        s.px = x;
      }
      pump();
    },
    setVisible(on) {
      s.visible = on;
      if (on) pump();
    },
    dispose() {
      if (!s.live) return;
      s.live = false;
      waves.delete(s);
      canvas.remove();
      if (!waves.size) {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        unwatchScroll();
      }
    },
  };
}

import { prefersReducedMotion } from '@/lib/motion';
import { onLayoutChange, onScrollY } from '@/lib/scroll';
import type { Cell, Stage } from '@/components/three/cards';

/**
 * ВОДИТЕЛЬ ОБЪЁМНЫХ КАРТОЧЕК.
 *
 * Сцена живёт в `components/three/cards.ts` и тянется ДИНАМИЧЕСКИМ
 * импортом: three.js не должен появляться в первом экране. Здесь —
 * всё, что знает про страницу: когда поднимать контекст, где стоят
 * ячейки, куда смотрит указатель и что сейчас выбрано.
 *
 * ── ОДИН ИСТОЧНИК ПОЛОЖЕНИЯ НА ПЛИТУ И НА ТЕКСТ ───────────────────────────
 * Название и цена остаются HTML и лежат ПОВЕРХ холста. Значит наклон
 * обязан быть у них общий с плитой, иначе текст отклеится. Поэтому
 * цикл один: он считает поворот и подъём, кладёт их в сцену и тут же
 * пишет теми же числами CSS-переменные карточки. Перспектива у CSS
 * и у камеры одна и та же величина (`--cam`), а начало отсчёта у обеих —
 * центр сетки, поэтому текст едет ровно по грани.
 *
 * ── ДЫХАНИЕ ЖИВЁТ В СЦЕНЕ ─────────────────────────────────────────────────
 * ⚠️ Геометрическое дыхание ВСЕЙ карточки на CSS было снято замером
 * в двадцать первой итерации: четыре дышащие карточки на 1920 давали
 * 95 % кадров дороже бюджета (Р-62). Внутри сцены оно стоит других
 * денег — это поворот меша, а не перерисовка содержимого, — и потому
 * вернулось. У каждой карточки свой период и своя фаза.
 *
 * ── ТРИ РЫЧАГА ЦЕНЫ, И ВСЕ ТРИ ЗАМЕРЕНЫ ───────────────────────────────────
 *   1. Пока идёт только дыхание, кадр рисуется 24 раза в секунду.
 *      Оборот медленный, разницы с 60 не видно, а площадь заливки
 *      в программном растеризаторе — главная статья расхода.
 *   2. Пока страница едет, сцена СТОИТ и не рисуется вовсе. Тот же
 *      рычаг, что снимал цену объёма в девятнадцатой итерации (Р-54).
 *   3. Цикл гаснет, когда блок ушёл с экрана. Закон 11.
 */

/** Амплитуда наклона за указателем, градусы. «Лёгкий, не аттракцион». */
const AMP = 4.2;
/** Постоянная времени демпфера наклона — та же, что у формы вордмарка. */
const TAU = 110;
/** Демпфер подсветки: она не должна щёлкать при выборе. */
const TAU_GLOW = 240;

/** Дыхание: амплитуды и собственные периоды каждой карточки. */
const BR_ROT = 0.42;
const BR_Z = 4.2;
const BR_T = [7.3, 9.4, 8.1, 10.6];
const BR_PH = [0, 1.9, 3.7, 5.2];

/** Подъём выбранной и вдавливание нажатой, пиксели сцены. */
const LIFT = 20;
const PRESS = -9;

/** Сила ореола: в покое, под курсором, у выбранной. */
const GLOW_REST = 0.36;
const GLOW_HOVER = 0.52;
const GLOW_SEL = 1;

/**
 * Кадр в покое — 8 в секунду.
 *
 * ⚠️ ЭТО НЕ СКУПОСТЬ, А АРИФМЕТИКА ДЫХАНИЯ. Амплитуда 0.42° при
 * периоде 7…10 с двигает кромку плиты примерно на 2.4 px за половину
 * цикла, то есть на 0.06 px за восьмушку секунды: ступенек такого
 * размера не бывает видно. А кадр сцены в программном растеризаторе
 * стоит 25 мс, и на 60 кадрах в секунду это была бы половина потока.
 */
const IDLE_MS = 1000 / 8;
/**
 * Кадр под указателем — 30 в секунду.
 *
 * ⚠️ ПОТОЛОК ЗДЕСЬ ОБЯЗАТЕЛЕН, И ЭТО ЗАМЕР. Без него сцена рисуется
 * на каждом кадре страницы, а её кадр в программном растеризаторе
 * стоит 17 мс на 1920 и 33 на 2560 — то есть 100 % кадров дороже
 * бюджета при медиане 33.4 и 49.9 мс. Доля дорогих кадров РАВНА
 * частоте сцены, поделённой на 60: другого способа её сбить нет,
 * пока один кадр дороже бюджета целиком. Демпфер наклона идёт
 * от фактического Δt (τ = 110 мс), поэтому на 30 кадрах он сходится
 * ровно так же, как на 60. Тот же рычаг, что у вращения в Р-54.
 */
const ACTIVE_MS = 1000 / 30;
/**
 * Сколько сцена стоит после последнего события прокрутки.
 *
 * ⚠️ 260 мс, А НЕ 200: жест пальцем идёт не сплошным потоком событий,
 * и на паузе внутри жеста сцена успевала нарисовать кадр прямо посреди
 * прокрутки. На мобильном профиле это давало по полтораста миллисекунд
 * длинной задачи в блоке тарифов.
 */
const SCROLL_HOLD = 260;

const DEG = Math.PI / 180;

type Card = {
  el: HTMLElement;
  /* цель и текущее: наклон в градусах, подъём и подсветка */
  trx: number;
  try_: number;
  tlz: number;
  tgl: number;
  tgo: number;
  rx: number;
  ry: number;
  lz: number;
  gl: number;
  go: number;
  /* лампа глянца — в пикселях холста */
  lx: number;
  ly: number;
  sel: number;
};

const EPS = 0.0015;
const EPS_PX = 0.12;

export function attachCards(root: HTMLElement, canvas: HTMLCanvasElement): () => void {
  const els = Array.from(root.querySelectorAll<HTMLElement>('.card'));
  if (!els.length) return () => {};

  const still = prefersReducedMotion();
  const cards: Card[] = els.map((el) => ({
    el,
    trx: 0,
    try_: 0,
    tlz: 0,
    tgl: 0,
    tgo: GLOW_REST,
    rx: 0,
    ry: 0,
    lz: 0,
    gl: 0,
    go: GLOW_REST,
    lx: 0,
    ly: 0,
    sel: 0,
  }));
  const byEl = new Map(cards.map((c) => [c.el, c]));

  let stage: Stage | null = null;
  let mod: typeof import('@/components/three/cards') | null = null;
  let dead = false;
  let raf = 0;
  let last = 0;
  let visible = false;
  let scrolledAt = 0;
  let dirty = true;
  let nextAt = 0;

  // ── геометрия ────────────────────────────────────────────────────────────
  const measure = () => {
    if (!stage || !mod) return;
    /* ⚠️ ВЫНОС ХОЛСТА ЗАДАЁТ СЦЕНА, А НЕ CSS. Тем же числом считается
       спад ореола: разойдись они — ореол обрежется краем холста
       прямой линией. Ставим переменную ДО чтения бокса, иначе
       померим вчерашний габарит. */
    root.style.setProperty('--glow-pad', `${mod.HALO}px`);
    const box = canvas.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) return;
    const w = Math.round(box.width);
    const h = Math.round(box.height);
    stage.resize(w, h);
    const cr = els[0].getBoundingClientRect();
    const radius = parseFloat(getComputedStyle(els[0]).borderTopLeftRadius) || 18;
    const cells: Cell[] = els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height, r: radius };
    });
    stage.layout(cells, mod.THICK(cr.width));
    /* Перспектива у CSS ровно та же, что у камеры: иначе текст
       и плита поедут по разным матрицам. */
    root.style.setProperty('--cam', `${stage.dist.toFixed(0)}px`);
    dirty = true;
    /* ⚠️ ПРИ «УМЕНЬШИТЬ ДВИЖЕНИЕ» ЦИКЛА НЕТ, И ПЕРЕРИСОВАТЬ НЕКОМУ.
       Смена раскладки чистит буфер: без этой строки после поворота
       экрана холст остался бы пустым. */
    if (still) drawOnce();
  };

  /** Один кадр без цикла: для «уменьшить движение» и для первой отрисовки. */
  const drawOnce = () => {
    if (!stage) return;
    for (let i = 0; i < cards.length; i += 1) {
      stage.pose(i, 0, 0, cards[i].lz);
      stage.light(i, 0, 0, 0);
      stage.glow(i, cards[i].go, cards[i].sel);
      paintDom(cards[i], 0, 0, cards[i].lz);
    }
    stage.render();
  };

  // ── кадр ─────────────────────────────────────────────────────────────────
  const paintDom = (c: Card, rx: number, ry: number, tz: number) => {
    const s = c.el.style;
    s.setProperty('--rx', rx.toFixed(3));
    s.setProperty('--ry', ry.toFixed(3));
    s.setProperty('--tz', tz.toFixed(2));
  };

  const settled = (c: Card) =>
    Math.abs(c.trx - c.rx) < EPS &&
    Math.abs(c.try_ - c.ry) < EPS &&
    Math.abs(c.tlz - c.lz) < EPS_PX &&
    Math.abs(c.tgl - c.gl) < EPS &&
    Math.abs(c.tgo - c.go) < EPS;

  const tick = (now: number) => {
    raf = 0;
    if (dead || !stage) return;
    if (!visible) return;

    /* Пока страница едет, сцена стоит: в кадре прокрутки ей делать
       нечего, а перерисовка холста — самая дорогая статья. */
    if (now - scrolledAt < SCROLL_HOLD) {
      pump();
      return;
    }

    /* ⚠️ ПОТОЛОК ЧАСТОТЫ СТОИТ ДО ДЕМПФЕРА, А НЕ ПОСЛЕ. Доля пути
       считается от фактического Δt, и это Δt обязано мериться
       от предыдущего ПРОСЧИТАННОГО кадра: демпфируй каждый кадр
       страницы, а `last` двигай только при отрисовке — и наклон
       начнёт сходиться втрое быстрее заданного. */
    if (now < nextAt && !dirty) {
      pump();
      return;
    }

    const dt = last ? Math.min(64, now - last) : 16.7;
    last = now;
    const k = 1 - Math.exp(-dt / TAU);
    const kg = 1 - Math.exp(-dt / TAU_GLOW);
    let moving = false;
    for (const c of cards) {
      if (!settled(c)) {
        c.rx += (c.trx - c.rx) * k;
        c.ry += (c.try_ - c.ry) * k;
        c.lz += (c.tlz - c.lz) * k;
        c.gl += (c.tgl - c.gl) * k;
        c.go += (c.tgo - c.go) * kg;
        moving = true;
      }
    }

    nextAt = now + (moving ? ACTIVE_MS : IDLE_MS);
    dirty = false;

    const t = now / 1000;
    for (let i = 0; i < cards.length; i += 1) {
      const c = cards[i];
      const w = (Math.PI * 2) / BR_T[i % BR_T.length];
      const ph = BR_PH[i % BR_PH.length];
      const brx = still ? 0 : Math.sin(t * w + ph) * BR_ROT;
      const bry = still ? 0 : Math.sin(t * w * 0.77 + ph * 1.6) * BR_ROT;
      const brz = still ? 0 : Math.sin(t * w * 0.63 + ph * 0.7) * BR_Z;
      const rx = c.rx + brx;
      const ry = c.ry + bry;
      const tz = c.lz + brz;
      stage.pose(i, -rx * DEG, ry * DEG, tz);
      stage.light(i, c.lx, c.ly, c.gl);
      stage.glow(i, c.go, c.sel);
      /* В DOM уезжают ТЕ ЖЕ числа, включая дыхание: текст обязан ехать
         вместе с гранью, на которой он лежит. */
      paintDom(c, rx, ry, tz);
    }
    stage.render();
    pump();
  };

  const pump = () => {
    if (!raf && visible && !dead) raf = requestAnimationFrame(tick);
  };

  const wake = () => {
    dirty = true;
    pump();
  };

  // ── указатель ────────────────────────────────────────────────────────────
  const pressed = new Set<Card>();

  const aim = (c: Card, x: number, y: number) => {
    const r = c.el.getBoundingClientRect();
    const box = canvas.getBoundingClientRect();
    const nx = (x - r.left) / r.width;
    const ny = (y - r.top) / r.height;
    c.lx = x - box.left;
    c.ly = y - box.top;
    /* Карточка тянется К УКАЗАТЕЛЮ: курсор у верхней кромки — верх
       выходит к зрителю, дальняя кромка уходит и сужается. */
    c.trx = (0.5 - ny) * 2 * -AMP;
    c.try_ = (nx - 0.5) * 2 * AMP;
    c.tgl = 1;
    c.tgo = c.sel ? GLOW_SEL : GLOW_HOVER;
    wake();
  };

  const release = (c: Card) => {
    c.trx = 0;
    c.try_ = 0;
    c.tgl = 0;
    c.tgo = c.sel ? GLOW_SEL : GLOW_REST;
    wake();
  };

  const find = (e: Event) =>
    byEl.get((e.target as HTMLElement | null)?.closest<HTMLElement>('.card') as HTMLElement);

  const onMove = (e: PointerEvent) => {
    const c = find(e);
    if (!c || still) return;
    /* На касаниях наклон ведёт ПАЛЕЦ, и только пока он на экране:
       «наведения» там нет, а жест по карточке чаще всего прокрутка. */
    if (e.pointerType !== 'mouse' && !pressed.has(c)) return;
    aim(c, e.clientX, e.clientY);
  };
  const onDown = (e: PointerEvent) => {
    const c = find(e);
    if (!c) return;
    c.tlz = PRESS;
    if (e.pointerType !== 'mouse') {
      pressed.add(c);
      if (!still) aim(c, e.clientX, e.clientY);
    }
    wake();
  };
  const onUp = (e: PointerEvent) => {
    const c = find(e);
    if (!c) return;
    pressed.delete(c);
    c.tlz = c.sel ? LIFT : 0;
    if (e.pointerType !== 'mouse' && !still) release(c);
    wake();
  };
  const onOut = (e: PointerEvent) => {
    const c = find(e);
    if (!c) return;
    pressed.delete(c);
    c.tlz = c.sel ? LIFT : 0;
    if (!still) release(c);
    wake();
  };

  /* Выбор приходит из React через aria-checked — слушаем атрибут, а не
     заводим второй источник правды. */
  const syncSel = () => {
    for (const c of cards) {
      const on = c.el.getAttribute('aria-checked') === 'true';
      c.sel = on ? 1 : 0;
      c.tlz = pressed.has(c) ? PRESS : on ? LIFT : 0;
      c.tgo = on ? GLOW_SEL : c.tgl > 0.5 ? GLOW_HOVER : GLOW_REST;
      if (still) {
        c.go = c.tgo;
        c.lz = c.tlz;
      }
    }
    if (still) drawOnce();
    else wake();
  };
  const mo = new MutationObserver(syncSel);

  root.addEventListener('pointermove', onMove, { passive: true });
  root.addEventListener('pointerdown', onDown, { passive: true });
  root.addEventListener('pointerup', onUp, { passive: true });
  root.addEventListener('pointercancel', onOut, { passive: true });
  root.addEventListener('pointerleave', onOut, { passive: true });

  // ── жизненный цикл контекста ─────────────────────────────────────────────
  let offLayout: (() => void) | null = null;
  let offScroll: (() => void) | null = null;

  const boot = async () => {
    if (mod || dead) return;
    mod = await import('@/components/three/cards');
    if (dead) return;
    stage = mod.createStage(canvas, cards.length);
    if (!stage) return;
    measure();
    syncSel();
    for (const c of cards) {
      c.go = c.tgo;
      c.lz = c.tlz;
    }
    await stage.warm();
    if (dead || !stage) return;
    /* Плита появилась — CSS-подложка карточки больше не нужна. */
    root.setAttribute('data-gl', '');
    mo.observe(root, { attributes: true, subtree: true, attributeFilter: ['aria-checked'] });
    offLayout = onLayoutChange(measure);
    if (still) {
      /* При «уменьшить движение» сцена рисуется один раз и стоит. */
      drawOnce();
      return;
    }
    offScroll = onScrollY(() => {
      scrolledAt = performance.now();
    });
    visible = live;
    wake();
  };

  /* Три порога, и они разведены намеренно: дальний качает модуль
     и не трогает видеокарту, средний поднимает контекст и собирает
     программы, пока блок ещё за кадром, ближний только пускает цикл. */
  let live = false;
  const ioFar = new IntersectionObserver(
    (es) => {
      if (es.some((e) => e.isIntersecting)) {
        ioFar.disconnect();
        void boot();
      }
    },
    { rootMargin: '700px 0px' },
  );
  const ioLive = new IntersectionObserver(
    (es) => {
      live = es.some((e) => e.isIntersecting);
      visible = live && !!stage && !still;
      if (visible) {
        last = 0;
        nextAt = 0;
        dirty = true;
        pump();
      }
    },
    { rootMargin: '80px 0px' },
  );
  ioFar.observe(root);
  ioLive.observe(root);

  return () => {
    dead = true;
    visible = false;
    ioFar.disconnect();
    ioLive.disconnect();
    mo.disconnect();
    offLayout?.();
    offScroll?.();
    if (raf) cancelAnimationFrame(raf);
    root.removeEventListener('pointermove', onMove);
    root.removeEventListener('pointerdown', onDown);
    root.removeEventListener('pointerup', onUp);
    root.removeEventListener('pointercancel', onOut);
    root.removeEventListener('pointerleave', onOut);
    root.removeAttribute('data-gl');
    root.style.removeProperty('--cam');
    root.style.removeProperty('--glow-pad');
    for (const c of cards) {
      for (const p of ['--rx', '--ry', '--tz']) c.el.style.removeProperty(p);
    }
    stage?.dispose();
    stage = null;
  };
}

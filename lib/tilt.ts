import { prefersReducedMotion } from '@/lib/motion';

/**
 * ОБЪЁМ КАРТОЧКИ ТАРИФА — ОДНИМИ ТРАНСФОРМАМИ, БЕЗ WEBGL.
 *
 * Двадцать первая итерация. Three.js из проекта выброшен и возврату
 * не подлежит, а объём требуется. Он собирается из четырёх вещей,
 * и ни одна из них не стоит ни одного пересчёта раскладки:
 *
 *   1. НАКЛОН С ПЕРСПЕКТИВОЙ. Карточка поворачивается вокруг двух осей
 *      за указателем. Именно поворот, а не сдвиг: `perspective()` стоит
 *      первой в списке трансформов самой карточки, поэтому дальняя
 *      кромка честно уходит и сужается.
 *   2. СОДЕРЖИМОЕ НА СВОЕЙ ГЛУБИНЕ. Волна лежит в плоскости карточки,
 *      название с ценой подняты над ней на `translateZ`. При наклоне
 *      они смещаются относительно фона сами — это параллакс, и считать
 *      его не нужно вовсе: за него отвечает та же матрица.
 *   3. БЛИК НА КРОМКЕ ЗА КУРСОРОМ. Пятно света лежит ПОД кольцом кромки
 *      и ездит трансформом. Ни градиента в кадре, ни перекраски:
 *      пятно нарисовано один раз, в кадре меняется только его место.
 * ТИХОЕ ДВИЖЕНИЕ В ПОКОЕ СЮДА НЕ ВХОДИТ. Оно живёт внутри карточки —
 * медленно едет сама звуковая дорожка (`components/wave/engine.ts`).
 * Геометрическое дыхание всей карточки было сделано первым заходом
 * и снято замером: в среде без видеоускорителя сдвиг карточки
 * перерисовывает её содержимое целиком, и четыре карточки на 1920
 * стоили 95 % кадров дороже бюджета. См. Р-62.
 *
 * ДЕМПФЕР ТОТ ЖЕ, ЧТО У ФОРМЫ ВОРДМАРКА: доля пути считается от
 * фактического Δt через 1 − exp(−Δt/τ), иначе на 30 fps наклон
 * смягчался бы вдвое сильнее, чем на 60 (Р-44).
 *
 * ЦИКЛ ГАСНЕТ В ПОКОЕ: пока цель совпадает с текущим значением,
 * не заказывается ни одного кадра. Закон 11 цел.
 */

/** Амплитуда наклона карточки, градусы. «Лёгкий, не аттракцион». */
const AMP = 4.2;
/** Постоянная времени демпфера наклона. */
const TAU = 110;

type Card = {
  el: HTMLElement;
  /* цель и текущее значение: наклон в градусах, блик в пикселях бокса */
  trx: number;
  try_: number;
  tgl: number;
  tgx: number;
  tgy: number;
  rx: number;
  ry: number;
  gl: number;
  gx: number;
  gy: number;
};

/* Порог схождения: отдельный для градусов и для пикселей блика. */
const EPS = 0.002;
const EPS_PX = 0.2;

export function attachTilt(root: HTMLElement): () => void {
  if (prefersReducedMotion()) return () => {};

  const cards: Card[] = Array.from(root.querySelectorAll<HTMLElement>('.card')).map((el) => ({
    el,
    trx: 0,
    try_: 0,
    tgl: 0,
    tgx: 0,
    tgy: 0,
    rx: 0,
    ry: 0,
    gl: 0,
    gx: 0,
    gy: 0,
  }));
  if (!cards.length) return () => {};

  const byEl = new Map(cards.map((c) => [c.el, c]));
  let raf = 0;
  let last = 0;

  const paint = (c: Card) => {
    const s = c.el.style;
    s.setProperty('--rx', c.rx.toFixed(3));
    s.setProperty('--ry', c.ry.toFixed(3));
    s.setProperty('--gl', c.gl.toFixed(3));
    s.setProperty('--gx', c.gx.toFixed(1));
    s.setProperty('--gy', c.gy.toFixed(1));
  };

  const settled = (c: Card) =>
    Math.abs(c.trx - c.rx) < EPS &&
    Math.abs(c.try_ - c.ry) < EPS &&
    Math.abs(c.tgl - c.gl) < EPS &&
    Math.abs(c.tgx - c.gx) < EPS_PX &&
    Math.abs(c.tgy - c.gy) < EPS_PX;

  const tick = (now: number) => {
    raf = 0;
    const dt = last ? Math.min(64, now - last) : 16.7;
    last = now;
    const k = 1 - Math.exp(-dt / TAU);
    let alive = false;
    for (const c of cards) {
      if (settled(c)) continue;
      c.rx += (c.trx - c.rx) * k;
      c.ry += (c.try_ - c.ry) * k;
      c.gl += (c.tgl - c.gl) * k;
      c.gx += (c.tgx - c.gx) * k;
      c.gy += (c.tgy - c.gy) * k;
      paint(c);
      alive = true;
    }
    if (alive) pump();
    else last = 0;
  };

  const pump = () => {
    if (!raf) raf = requestAnimationFrame(tick);
  };

  /** Цель наклона по положению указателя внутри бокса карточки. */
  const aim = (c: Card, x: number, y: number) => {
    const r = c.el.getBoundingClientRect();
    const nx = (x - r.left) / r.width;
    const ny = (y - r.top) / r.height;
    /* Блик ездит В ПИКСЕЛЯХ бокса: проценты в `translate` считаются
       от размера САМОГО пятна, а оно квадратное — по вертикали доля
       уехала бы во столько раз, во сколько карточка не квадрат. */
    c.tgx = x - r.left;
    c.tgy = y - r.top;
    /* Карточка тянется К УКАЗАТЕЛЮ: курсор у верхней кромки — верх
       выходит к зрителю, дальняя кромка уходит и сужается. */
    c.trx = (0.5 - ny) * 2 * -AMP;
    c.try_ = (nx - 0.5) * 2 * AMP;
    c.tgl = 1;
    pump();
  };

  const release = (c: Card) => {
    c.trx = 0;
    c.try_ = 0;
    c.tgl = 0;
    pump();
  };

  const onMove = (e: PointerEvent) => {
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('.card');
    const c = el ? byEl.get(el) : undefined;
    if (!c) return;
    /* На касаниях наклон ведёт ПАЛЕЦ, и только пока он на экране:
       «наведения» там нет, а жест по карточке чаще всего прокрутка. */
    if (e.pointerType !== 'mouse' && !pressed.has(c)) return;
    aim(c, e.clientX, e.clientY);
  };

  const pressed = new Set<Card>();

  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('.card');
    const c = el ? byEl.get(el) : undefined;
    if (!c) return;
    pressed.add(c);
    aim(c, e.clientX, e.clientY);
  };

  const onUp = (e: PointerEvent) => {
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('.card');
    const c = el ? byEl.get(el) : undefined;
    if (!c) return;
    pressed.delete(c);
    if (e.pointerType !== 'mouse') release(c);
  };

  const onOut = (e: PointerEvent) => {
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('.card');
    const c = el ? byEl.get(el) : undefined;
    if (c) {
      pressed.delete(c);
      release(c);
    }
  };

  root.addEventListener('pointermove', onMove, { passive: true });
  root.addEventListener('pointerdown', onDown, { passive: true });
  root.addEventListener('pointerup', onUp, { passive: true });
  root.addEventListener('pointercancel', onOut, { passive: true });
  root.addEventListener('pointerleave', onOut, { passive: true });

  return () => {
    root.removeEventListener('pointermove', onMove);
    root.removeEventListener('pointerdown', onDown);
    root.removeEventListener('pointerup', onUp);
    root.removeEventListener('pointercancel', onOut);
    root.removeEventListener('pointerleave', onOut);
    if (raf) cancelAnimationFrame(raf);
    for (const c of cards) {
      for (const p of ['--rx', '--ry', '--gl', '--gx', '--gy']) c.el.style.removeProperty(p);
    }
  };
}

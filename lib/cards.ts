/**
 * КАРТОЧКИ ТАРИФА — ГОЛОГРАФИЧЕСКАЯ КЛУБНАЯ КАРТА.
 *
 * Постановка двадцать четвёртой итерации: «Каждая карточка —
 * премиальная карта доступа, как дорогая клубная или металлическая
 * банковская. Наклон в перспективе с пружинной доводкой,
 * голографическая фольга, блик за курсором. На CSS, без WebGL.
 * Края, скругления и текст обязаны быть идеально чёткими на любом
 * dpr — ради этого мы и уходим с three.js».
 *
 * ── ЧТО ЗДЕСЬ ДЕЛАЕТ JS И ЧЕГО ОН НЕ ДЕЛАЕТ ──────────────────────────────
 * Он пишет ШЕСТЬ ЧИСЕЛ на карточку и ТРИ на её ореол. Всё остальное —
 * фольга, блик, поверхность, кромка, свет по контуру — выводится
 * из них прямо в CSS через `calc()`. В кадре нет ни одного чтения
 * геометрии и ни одной записи, кроме custom properties:
 *
 *     --rx, --ry   наклон в градусах;
 *     --tz         подъём в пикселях (выбранная выше, нажатая ниже);
 *     --px, --py   блик — точка под указателем, В ПИКСЕЛЯХ бокса;
 *     --spot       сила блика 0…1.
 *
 * ⚠️ ФОЛЬГА НЕ ПИШЕТСЯ ОТСЮДА ВОВСЕ. Её сдвиг и угол — функция
 * наклона, и считает их CSS: `calc(50% + var(--ry) * 2.2%)`. Два
 * источника одного числа разъехались бы на первом же кадре, где одно
 * уже пересчиталось, а второе ещё нет (то же правило, что у текстов
 * под вордмарком, Р-22).
 *
 * ── ПРУЖИНА, А НЕ ЭКСПОНЕНТА ──────────────────────────────────────────────
 * Доводка наклона задана постановкой как пружинная. Экспоненциальный
 * демпфер (Р-44) подходит к цели снизу и никогда её не переходит;
 * пружина с ζ < 1 даёт лёгкий перелёт, и именно он читается как вес
 * предмета. Интегрируется полунеявным Эйлером, шаг берётся
 * от ФАКТИЧЕСКОГО Δt и ограничен сверху — иначе на редком кадре
 * система разойдётся.
 *
 * ── ЦЕНА: ТРИ РЫЧАГА, ВСЕ ИЗ ПРОШЛЫХ ИТЕРАЦИЙ ─────────────────────────────
 * В контейнере нет видеоускорителя, слои не промотируются, и сдвиг
 * карточки перерисовывает её целиком (замер Р-62: четыре дышащие
 * карточки на 1920 — 95 % кадров дороже бюджета). Рычаги те же, что
 * сняли цену сцене в Р-71, и ни один не режет приём:
 *
 *   1. ПОТОЛОК ЧАСТОТЫ. Восемь кадров в секунду в покое, тридцать —
 *      пока пружина сходится. Дыхание двигает кромку на сотые доли
 *      пикселя за восьмушку секунды.
 *   2. ОЧЕРЕДЬ. У каждой карточки свой слот внутри восьмушки: в кадре
 *      шевелится ОДНА, а не четыре. Именно на четырёх разом Р-62
 *      и получил свои 95 %.
 *   3. НА ПРОКРУТКЕ ВСЁ СТОИТ. Страница и так перерисовывает половину
 *      экрана; собственное движение карт смотрят в покое (Р-54).
 *
 * И четвёртый, общий: цикл гаснет, когда блок ушёл с экрана (закон 11).
 *
 * ⚠️ `will-change: transform` СЮДА НЕ СТАВИТЬ. Он не помогает в среде
 * без ускорителя (замерено в Р-62), а на живой машине промотирует
 * карточку в слой — и текст на ней растрируется ОДИН раз, без учёта
 * поворота. Ровно то, из-за чего мы ушли с WebGL: «края, скругления
 * и текст обязаны быть чёткими».
 */
import { onLayoutChange, onScrollY } from './scroll';
import { prefersReducedMotion } from './motion';

/** Пружина наклона: жёсткость и демпфирование. ζ < 1 — лёгкий перелёт. */
const OMEGA = 13.5;
const ZETA = 0.58;
/** Наибольший шаг интегрирования: выше него пружина расходится. */
const DT_MAX = 1 / 28;
/** Амплитуда наклона за указателем, градусы. */
const AMP_X = 7.2;
const AMP_Y = 9.4;
/** Подъём выбранной и вдавливание нажатой, пиксели. */
const LIFT = 24;
const PRESS = -11;
/** Дыхание: амплитуда по углу и по глубине. */
const BR_ROT = 0.5;
const BR_Z = 4.2;
/** У каждой карты свой период и своя фаза — «будто в невесомости». */
const BR_T = [7.3, 9.4, 8.1, 10.6];
const BR_PH = [0, 1.9, 3.7, 5.2];
/** Кадр в покое и кадр, пока пружина сходится. */
const IDLE_MS = 1000 / 8;
const ACTIVE_MS = 1000 / 30;
/** Сколько карты стоят после последнего события прокрутки. */
const SCROLL_HOLD = 260;

type Card = {
  el: HTMLElement;
  aura: HTMLElement | null;
  i: number;
  /* текущее, скорость, цель */
  rx: number;
  ry: number;
  tz: number;
  vx: number;
  vy: number;
  vz: number;
  gx: number;
  gy: number;
  gz: number;
  /* блик */
  px: number;
  py: number;
  sp: number;
  gsp: number;
  /* очередь кадров */
  next: number;
  last: number;
  /* что уже записано: повторная запись — лишняя перерисовка */
  wx: number;
  wy: number;
  wz: number;
  ax: number;
  ay: number;
  az: number;
  wp: number;
  wq: number;
  ws: number;
};

export function attachCards(root: HTMLElement): () => void {
  const els = Array.from(root.querySelectorAll<HTMLElement>('.card'));
  const auras = Array.from(root.querySelectorAll<HTMLElement>('.cards__aura'));
  if (!els.length) return () => {};

  const cards: Card[] = els.map((el, i) => ({
    el,
    aura: auras[i] ?? null,
    i,
    rx: 0, ry: 0, tz: 0,
    vx: 0, vy: 0, vz: 0,
    gx: 0, gy: 0, gz: 0,
    px: 0, py: 0, sp: 0, gsp: 0,
    next: 0, last: 0,
    wx: NaN, wy: NaN, wz: NaN,
    ax: NaN, ay: NaN, az: NaN,
    wp: NaN, wq: NaN, ws: NaN,
  }));

  /**
   * Пишет позу. Карта получает ПРУЖИНУ ПЛЮС ДЫХАНИЕ, ореол — только
   * пружину.
   *
   * ⚠️ И ЭТО НЕ РАССОГЛАСОВАНИЕ, А ЗАМЕР. Ореол — стопка из десяти
   * колец, и суммарная площадь его заливок больше самой карты:
   * каждое кольцо закрашивается от кромки наружу на свой spread.
   * Пока он повторял и дыхание, в покое перерисовывались ВОСЕМЬ
   * объектов вместо четырёх. Дыхание при этом двигает силуэт
   * на 1…2 px, а свет вокруг него мягкий на три десятка пикселей —
   * такого расхождения не видно. Наклон и подъём ореол повторяет
   * как раньше: там сдвиг уже заметный.
   */
  const write = (c: Card, bx: number, by: number, bz: number) => {
    const rx = c.rx + bx;
    const ry = c.ry + by;
    const tz = c.tz + bz;
    if (c.wx !== rx || c.wy !== ry || c.wz !== tz) {
      c.wx = rx;
      c.wy = ry;
      c.wz = tz;
      c.el.style.setProperty('--rx', rx.toFixed(3));
      c.el.style.setProperty('--ry', ry.toFixed(3));
      c.el.style.setProperty('--tz', tz.toFixed(2));
    }
    if (c.aura && (c.ax !== c.rx || c.ay !== c.ry || c.az !== c.tz)) {
      c.ax = c.rx;
      c.ay = c.ry;
      c.az = c.tz;
      c.aura.style.setProperty('--rx', c.rx.toFixed(3));
      c.aura.style.setProperty('--ry', c.ry.toFixed(3));
      c.aura.style.setProperty('--tz', c.tz.toFixed(2));
    }
    /* ⚠️ БЛИК КЭШИРУЕТСЯ ТАК ЖЕ, КАК ПОЗА. Запись `--px/--py/--spot`
       перерисовывает ВСЮ стопку фона плиты — четыре слоя со
       смешиванием; в покое эти три числа не меняются, и писать их
       восемь раз в секунду незачем. */
    if (c.wp !== c.px || c.wq !== c.py || c.ws !== c.sp) {
      c.wp = c.px;
      c.wq = c.py;
      c.ws = c.sp;
      c.el.style.setProperty('--px', c.px.toFixed(1));
      c.el.style.setProperty('--py', c.py.toFixed(1));
      c.el.style.setProperty('--spot', c.sp.toFixed(3));
    }
  };

  /* ── БЕЗ ДВИЖЕНИЯ ──────────────────────────────────────────────────
     «При `prefers-reduced-motion`: наклона и дыхания нет, отлив стоит
     в одном положении». Значит и цикла заводить не нужно: карта
     остаётся такой, какой её рисует CSS по умолчанию. */
  if (prefersReducedMotion()) return () => {};

  let raf = 0;
  let t0 = 0;
  let scrolledAt = 0;
  let onScreen = false;

  const lift = (c: Card) => {
    const sel = c.el.getAttribute('aria-checked') === 'true';
    const down = c.el.hasAttribute('data-press');
    return (sel ? LIFT : 0) + (down ? PRESS : 0);
  };

  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    if (!t0) t0 = now;
    /* На прокрутке карты СТОЯТ: страница и так перерисовывает
       половину экрана, а собственное движение смотрят в покое. */
    if (now - scrolledAt < SCROLL_HOLD) {
      for (const c of cards) {
        c.next = now + IDLE_MS;
        c.last = 0;
      }
      return;
    }
    const t = (now - t0) / 1000;
    for (const c of cards) {
      if (now < c.next) continue;
      c.gz = lift(c);
      const busy =
        Math.abs(c.gx - c.rx) > 0.004 ||
        Math.abs(c.gy - c.ry) > 0.004 ||
        Math.abs(c.gz - c.tz) > 0.02 ||
        Math.abs(c.vx) > 0.004 ||
        Math.abs(c.vy) > 0.004 ||
        Math.abs(c.vz) > 0.02 ||
        Math.abs(c.gsp - c.sp) > 0.004;
      /* ⚠️ ПОТОЛОК СТОИТ ДО ИНТЕГРАТОРА, А Δt СЧИТАЕТСЯ ОТ ПРЕДЫДУЩЕГО
         ПРОСЧИТАННОГО КАДРА. Считай Δt от кадра страницы — и пружина
         сойдётся во столько раз быстрее заданного, во сколько опущен
         потолок (Р-71). */
      const dt = Math.min(DT_MAX, c.last ? (now - c.last) / 1000 : 1 / 60);
      c.last = now;
      c.next = now + (busy ? ACTIVE_MS : IDLE_MS);

      /* Пружина: a = −2ζω·v − ω²·(x − цель). */
      const k = OMEGA * OMEGA;
      const d = 2 * ZETA * OMEGA;
      c.vx += (-d * c.vx - k * (c.rx - c.gx)) * dt;
      c.vy += (-d * c.vy - k * (c.ry - c.gy)) * dt;
      c.vz += (-d * c.vz - k * (c.tz - c.gz)) * dt;
      c.rx += c.vx * dt;
      c.ry += c.vy * dt;
      c.tz += c.vz * dt;
      c.sp += (c.gsp - c.sp) * (1 - Math.exp(-dt / 0.14));

      /* Дыхание — аналитическое, а не интегрируемое: на восьми кадрах
         в секунду численный ход давно бы уплыл. */
      const ph = (t / BR_T[c.i % BR_T.length]) * Math.PI * 2 + BR_PH[c.i % BR_PH.length];
      const bx = Math.sin(ph) * BR_ROT;
      const by = Math.cos(ph * 0.73) * BR_ROT;
      const bz = Math.sin(ph * 0.61) * BR_Z;

      /* Дыхание НЕ входит в состояние пружины: иначе она тянула бы
         его обратно к нулю и амплитуда съедалась бы демпфированием.
         Поэтому оно и передаётся отдельными слагаемыми. */
      write(c, bx, by, bz);
    }
  };

  const start = () => {
    if (raf || !onScreen) return;
    t0 = 0;
    for (const c of cards) {
      c.last = 0;
      /* ⚠️ У КАЖДОЙ КАРТЫ СВОЙ СЛОТ ВНУТРИ ВОСЬМУШКИ. В кадре
         шевелится одна: именно на четырёх разом Р-62 получил свои
         95 % кадров дороже бюджета. */
      c.next = performance.now() + (c.i * IDLE_MS) / cards.length;
    }
    raf = requestAnimationFrame(tick);
  };
  const stop = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  /* ── УКАЗАТЕЛЬ ─────────────────────────────────────────────────────
     Прямоугольник читается В ОБРАБОТЧИКЕ СОБЫТИЯ, а не в кадре:
     событий указателя браузер отдаёт не больше одного на кадр,
     и чтение здесь не встаёт после записи атрибутов. */
  const aim = (c: Card, e: PointerEvent) => {
    const r = c.el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return;
    const u = (e.clientX - r.left) / r.width;
    const v = (e.clientY - r.top) / r.height;
    c.gy = (u - 0.5) * 2 * AMP_Y;
    c.gx = -(v - 0.5) * 2 * AMP_X;
    /* Блик — в ПИКСЕЛЯХ бокса: доля считалась бы от размера самого
       пятна, а оно круглое, и по вертикали уехала бы (Р-62). */
    c.px = e.clientX - r.left;
    c.py = e.clientY - r.top;
    c.gsp = 1;
    c.next = 0;
  };
  const rest = (c: Card) => {
    c.gx = 0;
    c.gy = 0;
    c.gsp = 0;
    c.next = 0;
  };

  const offs: (() => void)[] = [];
  for (const c of cards) {
    const move = (e: PointerEvent) => aim(c, e);
    const leave = () => rest(c);
    const down = (e: PointerEvent) => {
      c.el.setAttribute('data-press', '');
      aim(c, e);
    };
    const up = () => {
      c.el.removeAttribute('data-press');
      c.next = 0;
    };
    /* На касаниях карта идёт за пальцем, пока он на экране, и
       возвращается, когда его убрали. На точном указателе — то же
       самое движением мыши. */
    c.el.addEventListener('pointermove', move);
    c.el.addEventListener('pointerdown', down);
    c.el.addEventListener('pointerup', up);
    c.el.addEventListener('pointercancel', up);
    c.el.addEventListener('pointerleave', leave);
    offs.push(() => {
      c.el.removeEventListener('pointermove', move);
      c.el.removeEventListener('pointerdown', down);
      c.el.removeEventListener('pointerup', up);
      c.el.removeEventListener('pointercancel', up);
      c.el.removeEventListener('pointerleave', leave);
    });
  }

  const io = new IntersectionObserver(
    (es) => {
      onScreen = es.some((e) => e.isIntersecting);
      if (onScreen) start();
      else stop();
    },
    { rootMargin: '15% 0px' },
  );
  io.observe(root);

  const offScroll = onScrollY(() => {
    scrolledAt = performance.now();
  });
  const offLayout = onLayoutChange(() => {
    for (const c of cards) c.next = 0;
  });

  return () => {
    io.disconnect();
    stop();
    offScroll();
    offLayout();
    for (const off of offs) off();
    for (const c of cards) {
      c.el.removeAttribute('data-press');
      for (const p of ['--rx', '--ry', '--tz', '--px', '--py', '--spot']) {
        c.el.style.removeProperty(p);
        c.aura?.style.removeProperty(p);
      }
      c.wx = NaN;
      c.ax = NaN;
      c.wp = NaN;
    }
  };
}

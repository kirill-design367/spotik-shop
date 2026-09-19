'use client';

import { prefersReducedMotion } from './motion';
import {
  MORPH_TRAVEL,
  WM_INK_TIGHT,
  FOOTER_BOTTOM_GAP,
} from './wordmark';

/**
 * ПОЗИЦИЯ СТРАНИЦЫ — НАТИВНАЯ. СГЛАЖИВАЕТСЯ ТОЛЬКО ФОРМА.
 *
 * Это разные вещи, и пятнадцатая итерация их развела. Позиция прокрутки
 * идёт от руки и системы, без посредников и без выбега. Прогресс морфа —
 * наша величина, и он догоняет цель экспоненциально за 80…150 мс
 * (MORPH_DAMP_MS ниже). Отсюда лёгкий скролл И форма без ступенек.
 *
 * Тринадцатая итерация ещё держала Lenis на точном указателе и ScrollTrigger
 * как измеритель. Четырнадцатая сняла обоих, и вот почему.
 *
 * ── LENIS ДАВАЛ РОВНО ТО, НА ЧТО ЖАЛОВАЛСЯ АРТ-ДИРЕКТОР ────────────────────
 * Он не «сглаживал картинку», он ДВИГАЛ ПОЗИЦИЮ ПРОКРУТКИ по своей кривой:
 * колесо задавало цель, а страница шла к ней за 1.05 с. Морф честно читает
 * фактическую позицию — значит форма шла не за рукой, а за анимацией Lenis.
 * На быстром движении вверх-вниз это и есть «слово подвисает и догоняет»,
 * а на медленном — «скролл идёт тяжело».
 *
 * ЗАМЕРЕНО, 1920×1080, точный указатель (verify-lag.mjs): после последнего
 * события колеса страница ехала ещё 933 мс и 354 px, и всё это время форма
 * менялась — рука уже стоит, а слово догоняет. Тот же ввод давал 235
 * подвижных кадров вместо 64. На касаниях Lenis не поднимался с одиннадцатой
 * итерации, поэтому там оба замера совпадали — и это ровно объясняет,
 * почему дефект виден на десктопе. Стало 0 мс и 0 px.
 *
 * ── SCROLLTRIGGER КАДРА НЕ СТОИЛ, И ЭТО ВАЖНО ЗАПИСАТЬ ─────────────────────
 * Ожидание было такое: он слушает scroll, но применяет обновление СВОИМ
 * тикером, то есть в rAF, — значит форма отстаёт на кадр. ЗАМЕР ЭТОГО
 * НЕ ПОДТВЕРДИЛ: на той же сборке с выключенным Lenis отставание 0 кадров
 * и расхождение с эталоном 0.000 единицы (verify-lag.mjs). Причина простая:
 * rAF-колбэки выполняются ДО отрисовки того же кадра, так что запись,
 * сделанная в rAF, попадает в тот же нарисованный кадр, что и позиция.
 *
 * Снят он поэтому не ради кадра, а вместе с gsap: критический путь
 * 618.9 → 490.6 КБ. Цель хода по-прежнему считается ПРЯМО В ОБРАБОТЧИКЕ
 * scroll — в том же кадре и до отрисовки; между целью и формой стоит
 * демпфер, и это единственная задержка, какая тут есть, — намеренная
 * и заданная числом.
 *
 * Границы хода считаются ОДИН РАЗ (measure) и пересчитываются только когда
 * меняется раскладка. В кадре не читается ни одной величины геометрии —
 * только деление и вызов подписчика.
 */

export function scroller(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.getElementById('scroller');
}

/** Текущая позиция прокрутки — из контейнера, если он есть. */
export function scrollPos(): number {
  const el = scroller();
  if (el) return el.scrollTop;
  return typeof window === 'undefined' ? 0 : window.scrollY;
}

/** Элемент, на котором слушать событие scroll. */
export function scrollSource(): HTMLElement | Window {
  return scroller() ?? window;
}

type Reader = (y: number) => void;

/* Один слушатель scroll на всю страницу и один список подписчиков:
   так порядок вызовов детерминирован, а событие обрабатывается ровно раз. */
const readers: Reader[] = [];
const layouts: Array<() => void> = [];
let attached = false;
let queued = false;

function fire() {
  const y = scrollPos();
  for (let i = 0; i < readers.length; i += 1) readers[i](y);
}

/**
 * Пересчёт границ. Раскладка меняется и после первого кадра: приехали
 * шрифты и переверстались абзацы, раскрылся ответ в блоке вопросов, встала
 * 3D-сцена. Пересчёт откладывается на кадр и не чаще кадра — звать его
 * прямо из ResizeObserver значит делать сотню принудительных рефлоу
 * на каждый кадр перетаскивания окна.
 */
function relayout() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    for (let i = 0; i < layouts.length; i += 1) layouts[i]();
    fire();
  });
}

function attach() {
  if (attached || typeof window === 'undefined') return;
  attached = true;
  // passive: браузеру не нужно ждать наш обработчик, чтобы прокрутить
  scrollSource().addEventListener('scroll', fire, { passive: true });
  window.addEventListener('resize', relayout);
  const sc = scroller();
  if (sc && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(relayout).observe(sc.firstElementChild ?? sc);
  }
}

/** Поднять слушатели. Идемпотентно. */
export function bootScroll(): () => void {
  attach();
  return () => {};
}

/** Подписка на позицию прокрутки. Вызывается В ОБРАБОТЧИКЕ scroll. */
export function onScrollY(fn: Reader): () => void {
  attach();
  readers.push(fn);
  fn(scrollPos());
  return () => {
    const i = readers.indexOf(fn);
    if (i >= 0) readers.splice(i, 1);
  };
}

/** Подписка на изменение раскладки: здесь и только здесь читают геометрию. */
export function onLayoutChange(fn: () => void): () => void {
  attach();
  layouts.push(fn);
  return () => {
    const i = layouts.indexOf(fn);
    if (i >= 0) layouts.splice(i, 1);
  };
}

export type ProgressMode = 'hero' | 'footer';

/**
 * ДЕМПФИРОВАНИЕ ПРОГРЕССА МОРФА — И ТОЛЬКО ЕГО.
 *
 * Различать надо две вещи, и в четырнадцатой итерации я их не различил,
 * сняв заодно и вторую.
 *
 *   ПОЗИЦИЯ СТРАНИЦЫ двигаться по чужой кривой не должна: Lenis тянул её
 *   ещё 933 мс и 354 px после последнего колеса, и это и есть тяжесть.
 *   Позиция остаётся нативной, выбег ноль.
 *
 *   ПРОГРЕСС ФОРМЫ — величина наша, и её можно вести к цели плавно.
 *   Страница при этом едет мгновенно: демпфируется не ввод, а один
 *   скаляр 0…1, из которого строится форма.
 *
 * Сглаживание экспоненциальное и НЕЗАВИСИМОЕ ОТ ЧАСТОТЫ КАДРОВ:
 * доля пути за кадр считается как 1 − exp(−Δt / τ), поэтому при
 * пропущенном кадре форма не отстаёт, а проходит ровно столько,
 * сколько должна была за это время. Простое `cur += (t − cur) × k`
 * с постоянным k этим свойством не обладает и на 30 fps смягчает вдвое
 * сильнее, чем на 60.
 *
 * τ = 40 мс: 63 % пути за 40 мс, 86 % за 80, 95 % за 120, 99 % за 184.
 * Ориентир арт-директора — «за 80…150 мс», и 95 % за 120 мс в него ложатся.
 *
 * ⚠️ ФУТЕР НЕ ДЕМПФИРУЕТСЯ, и это не забывчивость. Там рост обязан идти
 * один к одному с прокруткой: низ чернил стоит на месте не креплением,
 * а КАК СЛЕДСТВИЕ равенства скоростей (Р-33). Любое отставание формы
 * от позиции мгновенно превращается в пустоту под словом ровно
 * на τ × скорость — при 3000 px/с это 120 px зияния. Поэтому там связь
 * остаётся жёсткой.
 */
export const MORPH_DAMP_MS = 40;
/* Порог схождения: 1e-4 прогресса — это 0.01 единицы формы при размахе
   в сотню, то есть заведомо ниже кванта растра. */
const DAMP_EPS = 1e-4;

/**
 * Прогресс хода, 0…1. Механика у хиро и у футера РАЗНАЯ, и это не разнобой,
 * а два разных приёма.
 *
 * ── ХИРО: ПРИЛИПАНИЕ ────────────────────────────────────────────────────────
 * Секция прилипает нативным `position: sticky`. Ход равен MORPH_TRAVEL
 * экрана, и на столько же длиннее сама секция, поэтому прогресс доходит
 * до единицы ровно тогда, когда сцена отлипает.
 *
 * ── ФУТЕР: ПРИЛИПАНИЯ НЕТ ВООБЩЕ ───────────────────────────────────────────
 * Секция едет обычным скроллом, слово едет вместе с ней и одновременно
 * растёт — один пиксель прокрутки даёт один пиксель прироста высоты чернил.
 * Ход не задаётся числом, он ВЫВОДИТСЯ: это разница между раскрытой
 * и сжатой высотой слова, то есть высота слоя × (1 − WM_INK_TIGHT).
 * Конец хода — нижний край слоя пришёл на линию низа (FOOTER_BOTTOM_GAP
 * от нижнего края экрана); начало — тот же край на ход ниже.
 * Расстояние между ними тождественно равно ходу, поэтому связь «пиксель
 * в пиксель» получается сама, без единого коэффициента, и БЕЗ ОКРУГЛЕНИЯ:
 * округление до целого сбивает её на 0.08 %.
 */
export function onScrollProgress(
  sectionId: string,
  mode: ProgressMode,
  cb: (p: number) => void,
  layer?: HTMLElement | null,
): () => void {
  const sc = scroller();
  const el = document.getElementById(sectionId);
  if (!sc || !el) return () => {};
  const trigger = mode === 'footer' ? layer ?? el : el;

  let start = 0;
  let span = 1;

  const measure = () => {
    const base = sc.getBoundingClientRect().top - sc.scrollTop;
    const r = trigger.getBoundingClientRect();
    const top = r.top - base;
    if (mode === 'hero') {
      start = top;
      span = sc.clientHeight * MORPH_TRAVEL;
    } else {
      span = r.height * (1 - WM_INK_TIGHT);
      start = top + r.height - (sc.clientHeight - FOOTER_BOTTOM_GAP) - span;
    }
  };

  /* Демпфер. Живёт только у хиро; у футера read() зовёт cb напрямую. */
  const damp = mode === 'hero';
  let target = 0;
  let cur = NaN;
  let raf = 0;
  let prev = 0;

  /*
   * Цикл догона. Заводится ТОЛЬКО когда цель разошлась с текущим
   * значением, и гаснет, как только они сошлись, — в покое ни одного
   * кадра не заказывается.
   *
   * Правило Р-18 («не заказывать кадр внутри обработчика прогресса»)
   * этим не нарушается: там речь о том, чтобы не ОТКЛАДЫВАТЬ отрисовку
   * уже известного значения на следующий кадр — защёлка проглатывала
   * каждое второе обновление. Здесь значение в момент события ещё
   * не известно: оно рождается в самом цикле и берёт всегда САМУЮ
   * свежую цель. Ни одно обновление не теряется.
   */
  const tick = (now: number) => {
    raf = 0;
    // потолок на Δt: после переключения вкладки кадр приходит через
    // секунды, и без потолка форма прыгнула бы к цели разом
    const dt = Math.min(64, now - prev);
    prev = now;
    cur += (target - cur) * (1 - Math.exp(-dt / MORPH_DAMP_MS));
    if (Math.abs(target - cur) < DAMP_EPS) cur = target;
    cb(cur);
    if (cur !== target) raf = requestAnimationFrame(tick);
  };

  const read = (y: number) => {
    const p0 = span > 0 ? (y - start) / span : 0;
    const p = p0 < 0 ? 0 : p0 > 1 ? 1 : p0;
    if (!damp) {
      cb(p);
      return;
    }
    target = p;
    // первое значение берётся как есть: догонять на монтировании нечего
    if (Number.isNaN(cur)) {
      cur = p;
      cb(cur);
      return;
    }
    if (cur === target || raf) return;
    prev = performance.now();
    raf = requestAnimationFrame(tick);
  };

  measure();
  const offLayout = onLayoutChange(measure);
  const offScroll = onScrollY(read);
  return () => {
    offLayout();
    offScroll();
    if (raf) cancelAnimationFrame(raf);
  };
}

/**
 * Прокрутка к секции — для кнопки «Выбрать тариф» и пунктов меню.
 *
 * Считаем СМЕЩЕНИЕ ВНУТРИ КОНТЕЙНЕРА, а не зовём scrollIntoView: последний
 * при вложенной прокрутке норовит подвинуть заодно и документ, а документ
 * у нас обязан стоять — иначе панель Safari снова начнёт сворачиваться.
 */
export function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const sc = scroller();
  const behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth';
  if (sc) {
    const top = sc.scrollTop + el.getBoundingClientRect().top - sc.getBoundingClientRect().top;
    sc.scrollTo({ top, behavior });
    return;
  }
  el.scrollIntoView({ behavior, block: 'start' });
}

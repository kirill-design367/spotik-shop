'use client';

import { prefersReducedMotion } from './motion';
import {
  MORPH_TRAVEL,
  WM_INK_TIGHT,
  FOOTER_BOTTOM_GAP,
} from './wordmark';

/**
 * ПРОКРУТКА: НАТИВНАЯ, БЕЗ СГЛАЖИВАНИЯ И БЕЗ ПОСРЕДНИКОВ.
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
 * 618.9 → 490.6 КБ. Здесь прогресс считается ПРЯМО В ОБРАБОТЧИКЕ scroll —
 * в том же кадре и до отрисовки, то есть отставание ноль по построению,
 * и замер это подтверждает.
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

  const read = (y: number) => {
    const p = span > 0 ? (y - start) / span : 0;
    cb(p < 0 ? 0 : p > 1 ? 1 : p);
  };

  measure();
  const offLayout = onLayoutChange(measure);
  const offScroll = onScrollY(read);
  return () => {
    offLayout();
    offScroll();
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

'use client';

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { prefersReducedMotion } from './motion';
import { MORPH_TRAVEL } from './wordmark';

// Плагин регистрируется на уровне модуля: эффект вордмарка выполняется
// раньше, чем эффект провайдера, и к моменту создания триггера
// ScrollTrigger уже обязан быть зарегистрирован.
if (typeof window !== 'undefined') gsap.registerPlugin(ScrollTrigger);

let lenis: Lenis | null = null;
let booted = false;
let refreshQueued = false;

/**
 * Связка Lenis + GSAP ScrollTrigger.
 *
 * Порядок здесь не косметический:
 *  1) ScrollTrigger регистрируется до создания любых триггеров;
 *  2) Lenis отдаёт свой scroll в ScrollTrigger.update — иначе триггеры
 *     отстают от сглаженной позиции на кадр и пины «плывут»;
 *  3) rAF Lenis'а вешается на тикер GSAP, а не на собственный
 *     requestAnimationFrame — два независимых цикла дают дрожание;
 *  4) lagSmoothing(0): при просадке GSAP иначе «проглатывает» время и
 *     scrub-прогресс прыгает.
 */
export function bootScroll(): () => void {
  if (booted) return () => {};
  booted = true;

  /**
   * Пересчёт триггеров при изменении высоты документа.
   *
   * ScrollTrigger считает границы один раз и сам за высотой страницы
   * не следит. А она меняется постоянно и после первого кадра: раскрылся
   * ответ в блоке вопросов, приехал текстовый шрифт и переверстались
   * абзацы, встала 3D-сцена. Без пересчёта нижняя скобка отвязывается
   * от футера и начинает разрастаться не там, где нужно.
   */
  const ro = new ResizeObserver(() => {
    // refresh дорогой, поэтому не чаще кадра и не в самом кадре
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => {
      refreshQueued = false;
      ScrollTrigger.refresh();
    });
  });
  ro.observe(document.body);

  const reduced = prefersReducedMotion();

  if (!reduced) {
    lenis = new Lenis({
      duration: 1.05,
      easing: (t: number) => 1 - Math.pow(1 - t, 3),
      smoothWheel: true,
      syncTouch: false, // на тачах родная инерция ощущается честнее и дешевле
      touchMultiplier: 1.4,
    });

    /*
     * ПОДХВАТИТЬ ТЕКУЩУЮ ПОЗИЦИЮ, А НЕ ТЯНУТЬ СТРАНИЦУ НАЗАД.
     *
     * До гидратации Lenis не существует, и колесо крутит страницу нативно.
     * Он рождается уже на прокрученной странице, но берёт свою цель один раз
     * при создании — а нативные события продолжают приходить и в кадрах между
     * созданием и первым тиком. Дальше Lenis доводит страницу до СВОЕЙ цели,
     * и это выглядит как откат назад. Замерено на холодной загрузке при
     * замедленном процессоре: скачок −24 px по скроллу и −7.56 px по форме.
     *
     * Поэтому цель пересинхронизируется с фактической позицией: сразу
     * и ещё раз на первом тике, когда нативные события уже улеглись.
     */
    const sync = () => lenis?.scrollTo(window.scrollY, { immediate: true, force: true });
    sync();
    let synced = false;

    lenis.on('scroll', ScrollTrigger.update);
    const raf = (time: number) => {
      if (!synced) { synced = true; sync(); }
      lenis?.raf(time * 1000);
    };
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);

    return () => {
      ro.disconnect();
      gsap.ticker.remove(raf);
      lenis?.destroy();
      lenis = null;
      booted = false;
    };
  }

  return () => {
    ro.disconnect();
    booted = false;
  };
}

export type ProgressMode = 'hero' | 'footer';

/**
 * Прогресс залипания секции, 0…1.
 *
 * Пина ScrollTrigger здесь нет намеренно: прилипание делает нативный
 * position: sticky, поэтому нет пин-спейсера, нет пересчётов на refresh
 * и нет рывков на тач-устройствах. ScrollTrigger остаётся только
 * измерителем — он не двигает вёрстку, а лишь отдаёт число 0…1.
 *
 * Ход НЕ равен экрану: он равен MORPH_TRAVEL от высоты экрана (0.55).
 * Раньше слово сжималось ровно экран прокрутки, и это читалось как
 * сопротивление — человек крутил колесо, а страница стояла. Теперь слово
 * досжимается вдвое быстрее, а секция хиро на столько же короче, поэтому
 * прогресс доходит до единицы ровно тогда, когда секция отлипает: дожатие
 * гарантировано, паузы после него нет.
 *
 * Хиро: 0 в начале страницы, 1 через MORPH_TRAVEL экрана.
 * Футер: зеркально — 0 когда его верх коснулся верха экрана, 1 через
 * тот же ход; дальше секция держит раскрытое слово, пока выезжают
 * реквизиты.
 */
export function onScrollProgress(
  sectionId: string,
  mode: ProgressMode,
  cb: (p: number) => void,
): () => void {
  const el = document.getElementById(sectionId);
  if (!el) return () => {};

  /*
   * Плавный скролл поднимается ПЕРЕД первым триггером, а не после.
   *
   * Эффекты React выполняются снизу вверх: эффект вордмарка (лист) идёт
   * раньше эффекта провайдера (корень). Значит триггер рождался, а Lenis
   * ещё нет, и в этом окне колесо крутило страницу нативными рывками —
   * на замедленном процессоре форма шла скачками по 6…8 px вместо
   * 0.1…0.4 px. Вызов идемпотентен: провайдер позже получит пустышку.
   */
  bootScroll();

  const st = ScrollTrigger.create({
    trigger: el,
    start: 'top top',
    // ход в пикселях, а не «до низа секции»: так он один и тот же
    // у хиро и футера и не зависит от того, какой длины сама секция
    end: () => `+=${Math.round(window.innerHeight * MORPH_TRAVEL)}`,
    onUpdate: (self) => cb(self.progress),
    onRefresh: (self) => cb(self.progress),
  });

  return () => st.kill();
}

/** Плавная прокрутка к секции — для кнопки «Выбрать тариф» и навигации. */
export function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  if (lenis) lenis.scrollTo(el, { offset: 0, duration: 1.1 });
  else el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
}

export function refreshScroll() {
  ScrollTrigger.refresh();
}

'use client';

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { prefersReducedMotion } from './motion';

// Плагин регистрируется на уровне модуля: эффект вордмарка выполняется
// раньше, чем эффект провайдера, и к моменту создания триггера
// ScrollTrigger уже обязан быть зарегистрирован.
if (typeof window !== 'undefined') gsap.registerPlugin(ScrollTrigger);

let lenis: Lenis | null = null;
let booted = false;

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

  const reduced = prefersReducedMotion();

  if (!reduced) {
    lenis = new Lenis({
      duration: 1.05,
      easing: (t: number) => 1 - Math.pow(1 - t, 3),
      smoothWheel: true,
      syncTouch: false, // на тачах родная инерция ощущается честнее и дешевле
      touchMultiplier: 1.4,
    });
    lenis.on('scroll', ScrollTrigger.update);
    const raf = (time: number) => lenis?.raf(time * 1000);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);

    return () => {
      gsap.ticker.remove(raf);
      lenis?.destroy();
      lenis = null;
      booted = false;
    };
  }

  return () => {
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
 * Хиро: 0 в начале страницы, 1 когда секция высотой 200svh дошла низом
 * до низа экрана, то есть ровно через один экран прокрутки.
 * Футер: зеркально — 0 когда его верх коснулся верха экрана, 1 в самом низу.
 */
export function onScrollProgress(
  sectionId: string,
  mode: ProgressMode,
  cb: (p: number) => void,
): () => void {
  const el = document.getElementById(sectionId);
  if (!el) return () => {};

  const st = ScrollTrigger.create({
    trigger: el,
    // хиро: от верха страницы до момента, когда секция полностью ушла вверх
    // футер: от появления его верха снизу до упора страницы
    start: 'top top',
    end: 'bottom bottom',
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

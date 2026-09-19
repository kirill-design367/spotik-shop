'use client';

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { prefersReducedMotion } from './motion';
import { MORPH_TRAVEL, WM_INK_TIGHT, FOOTER_BOTTOM_GAP } from './wordmark';

// Плагин регистрируется на уровне модуля: эффект вордмарка выполняется
// раньше, чем эффект провайдера, и к моменту создания триггера
// ScrollTrigger уже обязан быть зарегистрирован.
if (typeof window !== 'undefined') gsap.registerPlugin(ScrollTrigger);

let lenis: Lenis | null = null;
let booted = false;
let refreshQueued = false;

/**
 * ПРОКРУЧИВАЕТСЯ КОНТЕЙНЕР, А НЕ ДОКУМЕНТ.
 *
 * Панель Safari на iPhone сворачивается только под движение самого
 * документа. Поэтому документ стоит (html и body в экран, overflow: hidden),
 * а едет `#scroller`. Отсюда три следствия, и все три учтены ниже:
 * ScrollTrigger обязан знать про этот контейнер, Lenis обязан вешаться
 * на него же, а позиция читается из `scrollTop`, а не из `window.scrollY`.
 *
 * Функция терпима к отсутствию контейнера: на 404 и в тестах разметки
 * его может не быть, и тогда всё честно падает обратно на документ.
 */
export function scroller(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.getElementById('scroller');
}

/** Текущая позиция прокрутки — из контейнера, если он есть. */
export function scrollPos(): number {
  const el = scroller();
  return el ? el.scrollTop : window.scrollY;
}

/** Элемент, на котором слушать событие scroll. */
export function scrollSource(): HTMLElement | Window {
  return scroller() ?? window;
}

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

  /* ScrollTrigger по умолчанию меряет документ. Указатель на контейнер
     ставится ОДИН РАЗ и ДО создания любого триггера — иначе часть
     триггеров родится с документом, часть с контейнером, и границы
     разъедутся. */
  const sc = scroller();
  if (sc) ScrollTrigger.defaults({ scroller: sc });

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
  /*
   * НА КАСАНИЯХ LENIS НЕ ПОДНИМАЕТСЯ ВОВСЕ.
   *
   * У системы своя инерция, и она идёт мимо главного потока. Lenis же
   * вешает на touchstart/touchmove слушатели с passive: false — браузер
   * обязан дождаться JS, прежде чем прокрутить, — и каждый кадр сверяет
   * позицию. Замерено на мобильном профиле: пока палец ведёт, страница
   * стоит на 21 кадре из 39, то есть едет через кадр. Это и есть та самая
   * рваность, которой на десктопе нет.
   *
   * Признак — тип указателя, а не ширина окна: узкое окно на десктопе
   * плавный скролл заслуживает, телефон в альбомной ориентации — нет.
   */
  const coarse = window.matchMedia('(pointer: coarse)').matches;

  if (!reduced && !coarse) {
    lenis = new Lenis({
      duration: 1.05,
      easing: (t: number) => 1 - Math.pow(1 - t, 3),
      smoothWheel: true,
      // касаний здесь не бывает по построению: на них Lenis не создаётся
      syncTouch: false,
      /* Lenis вешается на КОНТЕЙНЕР. Без этого он продолжал бы двигать
         документ, который у нас неподвижен, и колесо перестало бы
         работать вовсе. */
      ...(sc
        ? {
            wrapper: sc,
            /* content — ОДИН элемент, охватывающий всю страницу целиком.
               Первый ребёнок здесь не годится: это <main>, а футер лежит
               рядом с ним, и предел прокрутки вышел бы короче страницы. */
            content: sc.querySelector<HTMLElement>('.scroller__inner') ?? sc,
          }
        : {}),
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
    const sync = () => lenis?.scrollTo(scrollPos(), { immediate: true, force: true });
    sync();

    /*
     * ВНЕШНИЙ СДВИГ СКРОЛЛА ПОДХВАТЫВАЕТСЯ, А НЕ ОТКАТЫВАЕТСЯ.
     *
     * Колесо, крутнутое до рождения Lenis, применяется компоновщиком
     * АСИНХРОННО: Lenis успевает прочитать позицию до того, как прокрутка
     * доехала, и дальше честно тянет страницу к своей — уже устаревшей —
     * цели. Человек видит, как страница уезжает на 26 px и возвращается
     * обратно, а слово повторяет это движение туда и назад.
     *
     * Одноразовой пересинхронизации на первом тике не хватало: прокрутка
     * доезжала позже неё. Поэтому сверка идёт каждый кадр и стоит одно
     * сравнение: если позиция изменилась НЕ рукой Lenis, его цель
     * переставляется на фактическую. Своей анимации это не мешает —
     * после lenis.raf позиция и есть то, что он поставил сам.
     */
    let applied = scrollPos();

    lenis.on('scroll', ScrollTrigger.update);
    const raf = (time: number) => {
      if (Math.abs(scrollPos() - applied) > 0.5) sync();
      lenis?.raf(time * 1000);
      applied = scrollPos();
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
 * Прогресс хода, 0…1. Механика у хиро и у футера РАЗНАЯ, и это не разнобой,
 * а два разных приёма.
 *
 * ── ХИРО: ПРИЛИПАНИЕ ────────────────────────────────────────────────────────
 * Секция прилипает нативным `position: sticky`, а ScrollTrigger только меряет:
 * пина нет, значит нет пин-спейсера, пересчётов на refresh и рывков на тачах.
 * Ход равен MORPH_TRAVEL экрана (0.55), и на столько же длиннее сама секция,
 * поэтому прогресс доходит до единицы ровно тогда, когда сцена отлипает.
 *
 * ── ФУТЕР: ПРИЛИПАНИЯ НЕТ ВООБЩЕ ───────────────────────────────────────────
 * Секция едет обычным скроллом, слово едет вместе с ней и одновременно
 * растёт — один пиксель прокрутки даёт один пиксель прироста высоты чернил.
 * Верх чернил уходит вверх вместе со страницей, а низ за счёт роста остаётся
 * на месте: неподвижный низ здесь не крепление, а СЛЕДСТВИЕ равенства
 * скоростей. Отсюда же отсутствие пауз и мёртвых кадров — страница
 * не останавливается ни на кадр.
 *
 * Ход не задаётся числом, он ВЫВОДИТСЯ: это разница между раскрытой и сжатой
 * высотой слова, то есть высота слоя × (1 − WM_INK_TIGHT). Триггером служит
 * сам слой слова, а не секция:
 *
 *   конец  — нижний край слоя пришёл на линию низа (FOOTER_BOTTOM_GAP
 *            от нижнего края экрана). В этот момент чернила заполняют слой
 *            целиком, то есть слово раскрыто ровно здесь;
 *   начало — тот же край на ход НИЖЕ, за нижним краем экрана.
 *
 * Расстояние между ними тождественно равно ходу, поэтому связь «пиксель
 * в пиксель» получается сама, без единого коэффициента.
 */
export function onScrollProgress(
  sectionId: string,
  mode: ProgressMode,
  cb: (p: number) => void,
  layer?: HTMLElement | null,
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

  const trigger = mode === 'footer' ? layer ?? el : el;
  /**
   * Ход роста в пикселях: разница раскрытой и сжатой высоты чернил.
   * БЕЗ ОКРУГЛЕНИЯ: округление до целого сбивает связь «пиксель в пиксель»
   * на 0.08 %, и за весь ход низ чернил успевает уехать на четверть пикселя.
   */
  const travel = () =>
    trigger.getBoundingClientRect().height * (1 - WM_INK_TIGHT);

  const st = ScrollTrigger.create({
    trigger,
    start:
      mode === 'hero'
        ? 'top top'
        : () => `bottom bottom+=${(travel() - FOOTER_BOTTOM_GAP).toFixed(3)}`,
    end:
      mode === 'hero'
        ? // ход в пикселях, а не «до низа секции»: так он не зависит
          // от того, какой длины сама секция
          () => `+=${Math.round(window.innerHeight * MORPH_TRAVEL)}`
        : () => `bottom bottom-=${FOOTER_BOTTOM_GAP}`,
    onUpdate: (self) => cb(self.progress),
    onRefresh: (self) => cb(self.progress),
  });

  return () => st.kill();
}

/**
 * Плавная прокрутка к секции — для кнопки «Выбрать тариф» и пунктов меню.
 *
 * Считаем СМЕЩЕНИЕ ВНУТРИ КОНТЕЙНЕРА, а не зовём scrollIntoView: последний
 * при вложенной прокрутке норовит подвинуть заодно и документ, а документ
 * у нас обязан стоять — иначе панель Safari снова начнёт сворачиваться.
 */
export function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const sc = scroller();
  if (lenis) {
    lenis.scrollTo(el, { offset: 0, duration: 1.1 });
    return;
  }
  if (sc) {
    const top = sc.scrollTop + el.getBoundingClientRect().top - sc.getBoundingClientRect().top;
    sc.scrollTo({ top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    return;
  }
  el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
}

export function refreshScroll() {
  ScrollTrigger.refresh();
}

'use client';

import { useEffect, useRef } from 'react';
import {
  WORD,
  axesToCss,
  calibrate,
  frameAt,
  trackingCorrection,
  OVERSCAN,
  type Calibration,
} from '@/lib/wordmark';
import { waveBus } from '@/lib/wavebus';
import { onScrollProgress } from '@/lib/scroll';
import { prefersReducedMotion } from '@/lib/motion';

type Props = {
  /** hero — слово сжимается и уезжает вверх. footer — зеркально разрастается снизу вверх. */
  mode: 'hero' | 'footer';
  /** Элемент, чей проход мимо вьюпорта задаёт прогресс. */
  sectionId: string;
  /**
   * Селектор блока, который делит вертикаль с вордмарком. Его высота
   * вычитается из доступной, и слово берёт ровно ту высоту прописных,
   * какая ещё влезает — вместо того чтобы наезжать на текст.
   */
  reserveSelector: string;
  /** Запас между словом и этим блоком, px. */
  reserveGap?: number;
};

/**
 * Вордмарк-скобки.
 *
 * Слово SPOTIK открывает страницу и закрывает её — это один механизм,
 * а не два эффекта. Внизу оно возвращается зеркально, с инверсией цвета,
 * и при скролле разрастается снизу вверх.
 *
 * ── РИСК И КАК ОН СНЯТ ─────────────────────────────────────────────────────
 * Анимация font-variation-settings пересчитывает лейаут каждый кадр. Поэтому:
 *   • вордмарк живёт в собственном контейнере с contain: layout paint style;
 *   • текст внутри вынут из потока (position: absolute), так что изменение
 *     кегля не может поднять реф­лоу наружу — высота контейнера фиксирована;
 *   • в этом контейнере не анимируется больше НИЧЕГО;
 *   • в кадре нет ни одного чтения геометрии: ширина слова берётся из
 *     таблицы, построенной при монтировании (см. lib/wordmark.ts);
 *   • пишем ровно три свойства: fontSize, fontVariationSettings, transform.
 */
export default function Wordmark({ mode, sectionId, reserveSelector, reserveGap = 24 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const text = textRef.current;
    if (!wrap || !text) return;

    let cal: Calibration | null = null;
    let vw = 0;
    let bandTop = 0; // --wm-top: где в слое начинается верх прописных
    let wrapHeight = 0;
    let progress = mode === 'hero' ? 0 : 1;
    let queued = false;
    let idleTimer: number | undefined;
    let disposed = false;

    /** Применить кадр. Только записи в стиль, ни одного чтения. */
    const paint = () => {
      queued = false;
      if (!cal || disposed) return;
      // hero: 0 → 1 (раскрыт → сжат).  footer: зеркально, 1 → 0.
      const t = mode === 'hero' ? progress : 1 - progress;
      const f = frameAt(cal, t, vw);

      text.style.fontSize = `${f.fontSize.toFixed(2)}px`;
      text.style.fontVariationSettings = axesToCss(f.axes);

      // Привязка по вертикали — по ВЕРХУ ПРОПИСНЫХ, а не по строчному боксу:
      // бокс строки равен кеглю и при сжатии съезжал бы, а верх литер обязан
      // стоять там, где его поставил макет.
      //   y = bandTop − (baseline − capHeight)
      // В хиро слово вдобавок уезжает вверх и обрезается краем вьюпорта.
      // В футере оно держится низом и разрастается снизу вверх — зеркально.
      if (mode === 'hero') {
        const drift = -(bandTop + f.capHeight) * 0.42 * t * t;
        text.style.transform = `translate3d(-50%,${(bandTop - (f.baseline - f.capHeight) + drift).toFixed(2)}px,0)`;
      } else {
        text.style.transform = `translate3d(-50%,${(wrapHeight - f.baseline).toFixed(2)}px,0)`;
      }

      // Волна и вордмарк — одна система: сжимаясь, слово отдаёт энергию в волну.
      if (mode === 'hero') waveBus.compression = t;
      else waveBus.footer = 1 - t;

      // Трекинг-доводка: невязку таблицы добираем ПОСЛЕ остановки скролла,
      // чтобы ни одного forced reflow не случилось в движении.
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        if (disposed) return;
        text.style.letterSpacing = '0px';
        const actual = text.getBoundingClientRect().width;
        const fix = trackingCorrection(actual, vw * OVERSCAN);
        if (fix) text.style.letterSpacing = `${fix.toFixed(3)}px`;
      }, 140);
    };

    const request = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(paint);
    };

    const recalibrate = () => {
      if (disposed) return;
      vw = window.innerWidth;
      text.style.letterSpacing = '0px';
      // единственные чтения геометрии — и все вне кадра
      bandTop = parseFloat(getComputedStyle(wrap).getPropertyValue('--wm-top')) || 0;
      const host = wrap.parentElement;
      const reserve = host?.querySelector<HTMLElement>(reserveSelector);
      const available =
        (host?.clientHeight ?? window.innerHeight) -
        (mode === 'hero' ? bandTop : 0) -
        (reserve?.offsetHeight ?? 0) -
        reserveGap;
      cal = calibrate(wrap, vw, Math.max(80, available));
      // Высота слоя фиксируется под раскрытое состояние и дальше не меняется,
      // поэтому смена кегля физически не может протечь рефлоу наружу.
      const open = frameAt(cal, 0, vw);
      // Если прописные не влезли даже при предельном wdth, слой получает
      // отведённую высоту, а не фактическую: contain: paint обрежет слово
      // сверху и снизу. Это честнее, чем наехать на текст хиро.
      const layerCap = cal.capFits ? open.capHeight : cal.maxCap;
      wrap.style.setProperty('--wm-cap', `${layerCap.toFixed(1)}px`);
      wrapHeight = wrap.clientHeight;
      paint();
    };

    // Калибруем строго после того, как готов ИМЕННО шрифт вордмарка.
    // document.fonts.ready ждал бы и текстовые сабсеты тоже, а они к приёму
    // отношения не имеют и только оттягивают появление главного элемента.
    let ro: ResizeObserver | undefined;
    let pending = 0;
    const start = () => {
      if (disposed) return;
      recalibrate();
      wrap.dataset.ready = '1';
      let lastW = window.innerWidth;
      let lastReserve = 0;

      /**
       * Пересчёт откладывается на следующий кадр и склеивается.
       * Калибровка делает под сотню замеров ширины, то есть столько же
       * принудительных рефлоу; звать её прямо из ResizeObserver значит
       * делать это на каждый кадр перетаскивания окна.
       *
       * Следим не только за шириной окна, но и за высотой соседнего блока:
       * текстовый шрифт приезжает позже шрифта вордмарка, абзацы
       * переверстываются, и доступная слову высота меняется уже после
       * первой калибровки.
       */
      const schedule = () => {
        if (pending || disposed) return;
        pending = requestAnimationFrame(() => {
          pending = 0;
          const reserve = wrap.parentElement?.querySelector<HTMLElement>(reserveSelector)?.offsetHeight ?? 0;
          // схлопывание адресной строки на мобильном меняет высоту, но не ширину
          if (window.innerWidth === lastW && Math.abs(reserve - lastReserve) < 2) return;
          lastW = window.innerWidth;
          lastReserve = reserve;
          recalibrate();
        });
      };

      lastReserve = wrap.parentElement?.querySelector<HTMLElement>(reserveSelector)?.offsetHeight ?? 0;
      ro = new ResizeObserver(schedule);
      ro.observe(document.documentElement);
      const reserveEl = wrap.parentElement?.querySelector<HTMLElement>(reserveSelector);
      if (reserveEl) ro.observe(reserveEl);
    };

    if (document.fonts?.load) {
      document.fonts.load("1000px 'Spotik Wordmark'", WORD).then(start).catch(start);
    } else {
      start();
    }

    // При «уменьшить движение» слово стоит в раскрытом состоянии и не
    // реагирует на скролл. Раньше прогресс просто выставлялся числом,
    // а подписка на скролл тут же его перезатирала — то есть учёт настройки
    // существовал только на бумаге. Теперь подписки просто нет.
    const reduced = prefersReducedMotion();
    if (reduced) progress = mode === 'hero' ? 0 : 1;
    const offScroll = reduced
      ? () => {}
      : onScrollProgress(sectionId, mode, (p) => {
          progress = p;
          request();
        });

    return () => {
      disposed = true;
      offScroll();
      ro?.disconnect();
      if (pending) cancelAnimationFrame(pending);
      window.clearTimeout(idleTimer);
    };
  }, [mode, sectionId, reserveSelector, reserveGap]);

  return (
    <div
      ref={wrapRef}
      className={`wm wm--${mode}`}
      // aria-hidden: слово дублирует заголовок страницы, скринридеру оно лишнее
      aria-hidden="true"
    >
      <span ref={textRef} className="wm__text">
        {WORD}
      </span>
    </div>
  );
}

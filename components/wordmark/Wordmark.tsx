'use client';

import { useEffect, useRef } from 'react';
import {
  buildPath,
  capAt,
  VIEW_BOX,
  OVERSCAN,
  WM_WIDTH,
  WM_BOX_HEIGHT,
  WM_BOX_TOP,
  WM_CAP_OPEN,
  LAYER_HEIGHT_VW,
  CAP_TOP_VW,
} from '@/lib/wordmark';
import { waveBus } from '@/lib/wavebus';
import { onScrollProgress } from '@/lib/scroll';

type Props = {
  /** hero — слово сжимается и уезжает вверх. footer — зеркально разрастается снизу вверх. */
  mode: 'hero' | 'footer';
  /** Элемент, чей проход мимо вьюпорта задаёт прогресс. */
  sectionId: string;
  /**
   * Селектор блока, который делит вертикаль с вордмарком. Его высота
   * вычитается из доступной: если слово не влезает, весь слой получает
   * общий вертикальный поджим.
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
 * ── ЧТО ПРОИСХОДИТ В КАДРЕ ──────────────────────────────────────────────────
 * Ровно две записи: атрибут d у пути и transform у слоя. Ни одного чтения
 * геометрии, ни одной аллокации — буфер точек выделен один раз в lib/wordmark.
 * Морф — интерполяция координат контуров; трансформ отвечает только
 * за положение на экране и формы не касается.
 *
 * ── ПОЧЕМУ РАЗМЕР ЗАДАН В РАЗМЕТКЕ, А НЕ В JS ───────────────────────────────
 * Слой получает размер прямо в серверной разметке, в долях ширины вьюпорта.
 * Поэтому слово нарисовано уже в первом кадре, до гидратации и без ожидания
 * шрифта: нет ни сдвига макета, ни задержки главного элемента страницы.
 * JS вмешивается, только если слову не хватает высоты (низкое широкое окно) —
 * тогда он ставит общий поджим, одинаковый для обоих состояний, поэтому все
 * три целевых соотношения сохраняются.
 */
export default function Wordmark({ mode, sectionId, reserveSelector, reserveGap = 24 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const svg = svgRef.current;
    const path = pathRef.current;
    if (!wrap || !svg || !path) return;

    let progress = mode === 'hero' ? 0 : 1;
    let queued = false;
    let disposed = false;
    let bandTop = 0;
    let layerH = 0;

    const paint = () => {
      queued = false;
      if (disposed) return;
      // hero: 0 → 1 (раскрыт → сжат).  footer: зеркально, 1 → 0.
      const t = mode === 'hero' ? progress : 1 - progress;

      path.setAttribute('d', buildPath(t));

      // Привязка по вертикали. В хиро слой стоит верхом прописных там, где
      // его поставил макет, и уезжает вверх. В футере он держится низом
      // и разрастается снизу вверх — зеркально.
      if (mode === 'hero') {
        const capPx = (capAt(t) / WM_BOX_HEIGHT) * layerH;
        const drift = -(bandTop + capPx) * 0.42 * t * t;
        svg.style.transform = `translate3d(-50%,${drift.toFixed(2)}px,0)`;
      }

      // Волна и вордмарк — одна система: сжимаясь, слово отдаёт энергию в волну.
      if (mode === 'hero') waveBus.compression = t;
      else waveBus.footer = 1 - t;
    };

    const request = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(paint);
    };

    /** Размер слоя. Считается вне кадра: при монтировании и на ресайзе. */
    const layout = () => {
      if (disposed) return;
      const vw = window.innerWidth;
      const target = vw * OVERSCAN;
      const k = target / WM_WIDTH;

      bandTop = parseFloat(getComputedStyle(wrap).getPropertyValue('--wm-top')) || 0;

      const host = wrap.parentElement;
      const reserve = host?.querySelector<HTMLElement>(reserveSelector)?.offsetHeight ?? 0;
      const available = Math.max(
        60,
        (host?.clientHeight ?? window.innerHeight) -
          (mode === 'hero' ? bandTop : 0) -
          reserve -
          reserveGap,
      );

      const naturalCap = WM_CAP_OPEN * k;
      // Поджим ОДИН для обоих состояний, поэтому отношения высоты прописных,
      // штрихов и ширины не меняются — двигается только абсолютная пропорция.
      const squeeze = naturalCap > available ? available / naturalCap : 1;
      layerH = WM_BOX_HEIGHT * k * squeeze;

      svg.style.width = `${target.toFixed(2)}px`;
      svg.style.height = `${layerH.toFixed(2)}px`;
      const capTopOffset = ((-WM_CAP_OPEN - WM_BOX_TOP) / WM_BOX_HEIGHT) * layerH;
      svg.style.top = mode === 'hero' ? `${(bandTop - capTopOffset).toFixed(2)}px` : 'auto';
      svg.style.bottom = mode === 'footer' ? '0px' : 'auto';

      wrap.style.setProperty('--wm-cap', `${((WM_CAP_OPEN / WM_BOX_HEIGHT) * layerH).toFixed(1)}px`);
      wrap.style.height = `${(layerH + (mode === 'hero' ? bandTop : 0)).toFixed(1)}px`;
      paint();
    };

    layout();

    let pending = 0;
    const schedule = () => {
      if (pending || disposed) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        layout();
      });
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(document.documentElement);
    const reserveEl = wrap.parentElement?.querySelector<HTMLElement>(reserveSelector);
    if (reserveEl) ro.observe(reserveEl);

    /**
     * При «уменьшить движение» слово стоит в раскрытом состоянии и на скролл
     * не реагирует — подписки просто нет. Настройку слушаем вживую: в CSS она
     * живёт медиазапросом, и если прочитать её один раз, вёрстка и логика
     * разъедутся при переключении на лету.
     */
    let off: () => void = () => {};
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => {
      off();
      if (mq.matches) {
        progress = mode === 'hero' ? 0 : 1;
        off = () => {};
        request();
      } else {
        off = onScrollProgress(sectionId, mode, (p) => {
          progress = p;
          request();
        });
      }
    };
    sync();
    mq.addEventListener('change', sync);

    return () => {
      disposed = true;
      off();
      mq.removeEventListener('change', sync);
      ro.disconnect();
      if (pending) cancelAnimationFrame(pending);
    };
  }, [mode, sectionId, reserveSelector, reserveGap]);

  return (
    <div
      ref={wrapRef}
      className={`wm wm--${mode}`}
      // aria-hidden: слово дублирует заголовок страницы, скринридеру оно лишнее
      aria-hidden="true"
    >
      <svg
        ref={svgRef}
        className="wm__svg"
        viewBox={VIEW_BOX}
        preserveAspectRatio="none"
        focusable="false"
        // Размер И ПОЛОЖЕНИЕ в долях ширины вьюпорта прямо в разметке: слово
        // нарисовано уже в первом кадре, без JavaScript и без ожидания чего бы
        // то ни было, и потом никуда не переезжает — иначе это сдвиг макета.
        style={{
          width: `${OVERSCAN * 100}vw`,
          height: `${LAYER_HEIGHT_VW * 100}vw`,
          ...(mode === 'hero'
            ? { top: `calc(var(--wm-top) - ${CAP_TOP_VW.toFixed(4)}vw)` }
            : { bottom: 0 }),
        }}
      >
        <path ref={pathRef} d={buildPath(0)} />
      </svg>
    </div>
  );
}

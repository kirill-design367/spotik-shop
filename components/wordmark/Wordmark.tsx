'use client';

import { useEffect, useRef } from 'react';
import {
  buildPath,
  bottomAt,
  capAt,
  VIEW_BOX,
  WM_WIDTH,
  WM_BOX_HEIGHT,
  WM_CAP_OPEN,
  WM_INSET,
  LAYER_WIDTH_VW,
  LAYER_HEIGHT_VW,
  BOX_RATIO_MAX,
} from '@/lib/wordmark';
import { onScrollProgress } from '@/lib/scroll';

type Props = {
  /** hero — слово сжимается вниз от неподвижного верха. footer — зеркально. */
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
 * а не два эффекта. Внизу оно возвращается зеркально, с инверсией цвета.
 *
 * ── ЧТО ПРОИСХОДИТ В КАДРЕ ──────────────────────────────────────────────────
 * В хиро — РОВНО ОДНА запись: атрибут d у пути. Трансформа нет вообще:
 * верх чернил обязан стоять на месте, а он уже стоит по построению данных
 * (у обоих состояний верх на y = 0, и это одна и та же точка контура).
 * Двигать слой нечем и незачем.
 *
 * В футере слово прижато НИЗОМ и растёт вверх — это зеркало того же правила.
 * Низ чернил на промежуточном кадре считается интерполяцией двух чисел
 * (самая нижняя точка у обоих состояний одна и та же, сборка это проверяет),
 * и слой сдвигается трансформом. Трансформ отвечает только за положение,
 * формы он не касается: форма целиком в атрибуте d.
 *
 * Чтений геометрии DOM в кадре нет, аллокаций нет — буфер точек выделен
 * один раз в lib/wordmark.
 *
 * ── ПОЧЕМУ РАЗМЕР ЗАДАН В РАЗМЕТКЕ ──────────────────────────────────────────
 * Слой получает размер и положение прямо в серверной разметке, в долях
 * ширины вьюпорта. Поэтому слово нарисовано уже в первом кадре, до гидратации
 * и без ожидания шрифта: ни сдвига макета, ни задержки главного элемента.
 * JS вмешивается, только если слову не хватает высоты (низкое широкое окно) —
 * тогда он ставит общий поджим, одинаковый для обоих состояний, поэтому все
 * целевые соотношения сохраняются.
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
    let painted = NaN;
    let disposed = false;
    let layerH = 0;

    /**
     * Рисуем СРАЗУ, а не через requestAnimationFrame.
     *
     * Это не микрооптимизация, это была причина рывков. Прогресс приходит
     * из ScrollTrigger, который дёргает Lenis, который висит на тикере GSAP,
     * а тикер GSAP — это уже requestAnimationFrame. Если из него заказать
     * ЕЩЁ один кадр, рисование уедет на следующий, а пока оно там ждёт,
     * защёлка «кадр уже заказан» проглотит следующее обновление. В итоге
     * форма меняется через кадр: страница идёт 60 fps, а морф 30.
     *
     * Замер до правки: на 463 подвижных кадрах 249 раз скролл ехал,
     * а форма стояла, и пары (Δскролл, Δвысота) шли строго через одну:
     * 1/0, 1/0, 1/−0.002, 1/0, 1/−0.005, 1/0…
     *
     * Здесь ни одного чтения геометрии, только запись атрибута, поэтому
     * синхронная отрисовка внутри обработчика ничего не выталкивает
     * в принудительный рефлоу.
     */
    const paint = () => {
      if (disposed) return;
      // hero: 0 → 1 (раскрыт → сжат).  footer: зеркально, 1 → 0.
      const t = mode === 'hero' ? progress : 1 - progress;
      if (t === painted) return;
      painted = t;

      path.setAttribute('d', buildPath(t));

      if (mode === 'footer') {
        // Прижать НИЗ чернил к низу слоя: слово растёт вверх.
        const shift = ((WM_BOX_HEIGHT - bottomAt(t)) / WM_BOX_HEIGHT) * layerH;
        svg.style.transform = `translate3d(0,${shift.toFixed(2)}px,0)`;
      }
    };

    /** Размер слоя. Считается вне кадра: при монтировании и на ресайзе. */
    const layout = () => {
      if (disposed) return;
      const vw = window.innerWidth;
      const target = vw * LAYER_WIDTH_VW;

      const cs = getComputedStyle(wrap);
      const bandTop = parseFloat(cs.getPropertyValue('--wm-top')) || 0;
      const boxRatio = parseFloat(cs.getPropertyValue('--wm-box')) || BOX_RATIO_MAX;

      const host = wrap.parentElement;
      const reserve = host?.querySelector<HTMLElement>(reserveSelector)?.offsetHeight ?? 0;
      const available = Math.max(
        60,
        (host?.clientHeight ?? window.innerHeight) -
          (mode === 'hero' ? bandTop : 0) -
          reserve -
          reserveGap,
      );

      // Слой забирает всю свободную высоту, но не вытягивается сверх предела.
      // Растяжение и поджим ОДИНАКОВЫ для обоих состояний, поэтому отношения
      // высоты прописной и штрихов не меняются — двигается только пропорция
      // знака целиком. Ширина литер вообще не участвует: она в x.
      layerH = Math.min(available, target * boxRatio);

      svg.style.width = `${target.toFixed(2)}px`;
      svg.style.height = `${layerH.toFixed(2)}px`;
      svg.style.left = `${(vw * WM_INSET).toFixed(2)}px`;
      svg.style.top = mode === 'hero' ? `${bandTop.toFixed(2)}px` : 'auto';
      svg.style.bottom = mode === 'footer' ? '0px' : 'auto';

      wrap.style.setProperty('--wm-cap', `${((WM_CAP_OPEN / WM_BOX_HEIGHT) * layerH).toFixed(1)}px`);
      wrap.style.height = `${(layerH + (mode === 'hero' ? bandTop : 0)).toFixed(1)}px`;
      // размер слоя изменился — трансформ футера надо пересчитать даже
      // при том же прогрессе, поэтому защёлку сбрасываем
      painted = NaN;
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
        paint();
      } else {
        off = onScrollProgress(sectionId, mode, (p) => {
          progress = p;
          paint();
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
        // Размер и положение в долях ширины вьюпорта прямо в разметке: слово
        // нарисовано уже в первом кадре и потом никуда не переезжает.
        style={{
          width: `${LAYER_WIDTH_VW * 100}vw`,
          height: `${LAYER_HEIGHT_VW * 100}vw`,
          left: `${WM_INSET * 100}vw`,
          ...(mode === 'hero' ? { top: 'var(--wm-top)' } : { bottom: 0 }),
        }}
      >
        <path ref={pathRef} d={buildPath(mode === 'hero' ? 0 : 1)} />
      </svg>
    </div>
  );
}

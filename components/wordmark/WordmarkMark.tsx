import { buildPaths, VIEW_BOX_INK, LAYER_WIDTH, WM_INSET } from '@/lib/wordmark';

/**
 * СЛОВО БЕЗ МЕХАНИКИ — раскрытое состояние, один раз и навсегда.
 *
 * Нужно там, где вордмарк работает знаком, а не приёмом: внизу накладки
 * меню. Скроллу оно не подчиняется, поэтому здесь нет ни триггера,
 * ни эффектов — только те же запечённые контуры, что в хиро и футере.
 * Закон 1 соблюдён: слово нигде не набирается шрифтом.
 *
 * Высоту задаёт --wm-h у родителя, как и у остальных двух.
 */
export default function WordmarkMark({ className = '' }: { className?: string }) {
  const d = buildPaths(0);
  return (
    <div
      className={`wm wm--mark ${className}`.trim()}
      aria-hidden="true"
      /* высота задаётся явно: без неё svg берёт пропорцию из viewBox
         и вырастает во всю ширину слоя */
      style={{ height: 'var(--wm-h)' }}
    >
      <svg
        className="wm__svg"
        viewBox={VIEW_BOX_INK}
        preserveAspectRatio="none"
        focusable="false"
        style={{ width: `${LAYER_WIDTH * 100}cqw`, marginLeft: `${WM_INSET * 100}cqw` }}
      >
        {d.map((path, i) => (
          <path key={i} d={path} />
        ))}
      </svg>
    </div>
  );
}

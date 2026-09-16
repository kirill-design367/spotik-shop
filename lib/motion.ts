/** Уважение к системной настройке «уменьшить движение». */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function onReducedMotionChange(cb: (v: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  const h = () => cb(mq.matches);
  mq.addEventListener('change', h);
  return () => mq.removeEventListener('change', h);
}

/** Грубая, но честная оценка «слабого» устройства — чтобы выбрать плотность волны. */
export function deviceTier(): 'low' | 'mid' | 'high' {
  if (typeof navigator === 'undefined') return 'mid';
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  const narrow = typeof window !== 'undefined' && window.innerWidth < 768;
  if (cores <= 4 || mem <= 4) return narrow ? 'low' : 'mid';
  if (cores >= 8 && mem >= 8) return 'high';
  return 'mid';
}

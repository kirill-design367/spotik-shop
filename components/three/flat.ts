/**
 * ПЛОСКИЙ СЛОЙ ВМЕСТО 3D — для касаний.
 *
 * На телефоне объём стоит слишком дорого, и дорого не там, где думали:
 * замер (CLAUDE.md, Р-34) показал 3.6 с главного потока на первой
 * отрисовке — компиляция шейдера, — плюс 544 КБ разбора самого three.js
 * ровно на подходе к блоку тарифов. Это и рвало скролл.
 *
 * Поэтому на касаниях three.js не грузится вообще, а слот рисует ту же
 * звуковую дорожку плоско: столбики из той же огибающей WAVEFORM, те же
 * два цвета. Приём страницы («страница — одна дорожка») сохраняется,
 * габариты слота не меняются ни на пиксель, а цена кадра — доли
 * миллисекунды на 2D-канвасе.
 */
import { WAVEFORM, WAVEFORM_LENGTH } from '@/lib/waveform.data';
import type { SceneKind } from './types';

const GREEN = '#1DB954';
const DARK = '#2A2A2A';

/** Рисует плоскую дорожку в слоте и возвращает функцию перерисовки. */
export function attachFlat(
  host: HTMLElement,
  { kind, seed }: { kind: SceneKind; seed: number },
): { draw: () => void; dispose: () => void } {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;display:block;width:100%;height:100%';
  host.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const cols = kind === 'card' ? 48 : 26;
  const offset = kind === 'card' ? (seed * 137) % WAVEFORM_LENGTH : 220;
  const stride = kind === 'card' ? 7 : 31;

  const draw = () => {
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(host.clientWidth * dpr));
    const h = Math.max(1, Math.round(host.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.clearRect(0, 0, w, h);

    // поля слота: столбики не упираются в края
    const padX = w * 0.08;
    const padY = h * 0.14;
    const inner = w - padX * 2;
    const step = inner / cols;
    const bar = Math.max(1, step * 0.52);
    const base = h - padY;
    const top = padY;

    for (let c = 0; c < cols; c += 1) {
      const v = WAVEFORM[(offset + c * stride) % WAVEFORM_LENGTH];
      const bh = Math.max(1, (base - top) * (0.08 + v * 0.92));
      ctx.fillStyle = v > 0.6 ? GREEN : DARK;
      ctx.fillRect(Math.round(padX + c * step), Math.round(base - bh), Math.round(bar), Math.round(bh));
    }

    /* У сертификата под дорожкой лежит плита — тот же предмет, что
       и в объёме, только силуэтом: зелёный торец и тёмное поле. */
    if (kind === 'gift') {
      ctx.fillStyle = GREEN;
      ctx.fillRect(Math.round(padX), Math.round(base + h * 0.02), Math.round(inner), Math.max(2, Math.round(h * 0.035)));
    }
  };

  draw();

  return {
    draw,
    dispose: () => {
      canvas.remove();
    },
  };
}

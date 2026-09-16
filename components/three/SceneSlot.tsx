'use client';

import { useEffect, useRef, useState } from 'react';
import type { SceneKind } from './types';
import type { SlotHandle } from './stage';

/**
 * Слот под 3D-объект.
 *
 * Three.js разрешён только в блоке тарифов и блоке сертификата — и не должен
 * попадать в первый экран ни байтом. Поэтому:
 *   • сам модуль сцены тянется динамическим import() — он живёт в отдельном
 *     асинхронном чанке, которого нет в бандле главной страницы;
 *   • все слоты страницы делят ОДИН WebGL-контекст (см. three/stage.ts):
 *     четыре независимых контекста браузер начал бы убивать по старшинству,
 *     ломая не тот блок, по которому скроллят;
 *   • импорт запускается не при монтировании, а по IntersectionObserver
 *     с большим rootMargin: сеть греется заранее, GPU занимается позже;
 *   • габариты слота заданы в CSS через aspect-ratio, поэтому появление
 *     сцены не сдвигает макет;
 *   • под сценой лежит плоский запасной слой: нет WebGL, медленная сеть,
 *     потерянный контекст — во всех случаях в макете не дыра.
 *
 * Анимации в этой итерации нет. Сцена рисует один кадр и останавливается,
 * рубильник цикла лежит готовым в SlotHandle.setLoop.
 */
export default function SceneSlot({
  kind,
  seed,
  label,
  className = '',
}: {
  kind: SceneKind;
  seed: number;
  label: string;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'idle' | 'ready' | 'unavailable'>('idle');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let handle: SlotHandle | null = null;
    let dead = false;
    let mod: typeof import('./stage') | null = null;

    // наблюдатель 1: далеко на подходе — только прогреваем сеть
    const warm = new IntersectionObserver(
      async (entries) => {
        if (!entries[0].isIntersecting || mod) return;
        warm.disconnect();
        try {
          mod = await import('./stage');
        } catch {
          if (!dead) setState('unavailable');
        }
      },
      { rootMargin: '900px 0px' },
    );

    // наблюдатель 2: блок почти на экране — занимаем GPU
    const mount = new IntersectionObserver(
      async (entries) => {
        if (!entries[0].isIntersecting || handle || dead) return;
        mount.disconnect();
        try {
          mod = mod ?? (await import('./stage'));
          if (dead) return;
          handle = await mod.attachSlot(host, { kind, seed });
          if (dead) {
            handle.dispose();
            handle = null;
            return;
          }
          setState('ready');
        } catch {
          if (!dead) setState('unavailable');
        }
      },
      { rootMargin: '150px 0px' },
    );

    warm.observe(host);
    mount.observe(host);

    const ro = new ResizeObserver(() => handle?.draw());
    ro.observe(host);

    return () => {
      dead = true;
      warm.disconnect();
      mount.disconnect();
      ro.disconnect();
      handle?.dispose();
    };
  }, [kind, seed]);

  return (
    <div
      ref={hostRef}
      className={`scene-slot ${className}`.trim()}
      role="img"
      aria-label={label}
      data-state={state}
    >
      {state !== 'ready' ? (
        <span className="scene-slot__fallback" aria-hidden="true">
          {state === 'unavailable' ? 'объём недоступен' : ''}
        </span>
      ) : null}
    </div>
  );
}

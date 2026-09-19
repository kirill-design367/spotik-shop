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
 *     потерянный контекст — во всех случаях в макете не дыра;
 *   • НА КАСАНИЯХ 3D НЕ ПОДНИМАЕТСЯ ВОВСЕ. Замер на мобильном профиле
 *     (CLAUDE.md, Р-34): первая отрисовка объёма стоит 3.6 с главного
 *     потока плюс 544 КБ разбора three.js, и приходится это ровно
 *     на подход к блоку тарифов — то есть на скролл. Телефон получает
 *     ту же дорожку плоско, за доли миллисекунды, и модуль объёма
 *     не качает вообще.
 *
 * Анимации в этой итерации нет. Сцена рисует один кадр и останавливается,
 * рубильник цикла лежит готовым в SlotHandle.setLoop.
 */
export default function SceneSlot({
  kind,
  seed,
  label,
  className = '',
  mountMargin = '150px 0px',
}: {
  kind: SceneKind;
  seed: number;
  label: string;
  className?: string;
  /**
   * Запас, на котором поднимается КОНТЕКСТ. В блоке 3 он обязан быть
   * нулевым: контекст WebGL не должен подниматься до того, как блок
   * вошёл в кадр. Прогрев модуля идёт отдельным наблюдателем и раньше —
   * он контекста не создаёт.
   */
  mountMargin?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'idle' | 'ready' | 'flat' | 'unavailable'>('idle');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    /* Касания — плоский слой и никакого WebGL. Признак берётся по типу
       указателя, а не по ширине окна: узкое окно на десктопе объём
       потянет, а телефон в альбомной ориентации — нет.

       Модуль плоского слоя тоже тянется динамически: в нём лежит огибающая
       (1024 числа, 7 КБ), и в первом экране ей делать нечего. */
    if (window.matchMedia('(pointer: coarse)').matches) {
      let flat: { draw: () => void; dispose: () => void } | null = null;
      let gone = false;
      const rof = new ResizeObserver(() => flat?.draw());
      const near = new IntersectionObserver(
        async (entries) => {
          if (!entries[0].isIntersecting || flat || gone) return;
          near.disconnect();
          const { attachFlat } = await import('./flat');
          if (gone) return;
          flat = attachFlat(host, { kind, seed });
          setState('flat');
        },
        { rootMargin: '400px 0px' },
      );
      near.observe(host);
      rof.observe(host);
      return () => {
        gone = true;
        near.disconnect();
        rof.disconnect();
        flat?.dispose();
      };
    }

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
      { rootMargin: mountMargin },
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
  }, [kind, seed, mountMargin]);

  return (
    <div
      ref={hostRef}
      className={`scene-slot ${className}`.trim()}
      role="img"
      aria-label={label}
      data-state={state}
    >
      {state !== 'ready' && state !== 'flat' ? (
        <span className="scene-slot__fallback" aria-hidden="true">
          {state === 'unavailable' ? 'объём недоступен' : ''}
        </span>
      ) : null}
    </div>
  );
}

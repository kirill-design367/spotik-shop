'use client';

import { useEffect, useRef, useState } from 'react';
import type { SceneKind } from './types';
import type { SlotHandle } from './stage';
import { prefersReducedMotion } from '@/lib/motion';

/**
 * Слот под 3D-объект карточки.
 *
 * Three.js не должен попадать в первый экран ни байтом, поэтому:
 *   • модуль сцены тянется динамическим import() и живёт в отдельном
 *     асинхронном чанке, которого нет в бандле главной страницы;
 *   • все слоты страницы делят ОДИН WebGL-контекст (three/stage.ts);
 *   • габариты слота заданы в CSS через aspect-ratio, поэтому появление
 *     сцены не сдвигает макет;
 *   • под сценой лежит плоский запасной слой: нет WebGL, медленная сеть,
 *     потерянный контекст — во всех случаях в макете не дыра.
 *
 * ── ТРИ НАБЛЮДАТЕЛЯ, И У КАЖДОГО СВОЯ РАБОТА ──────────────────────────────
 *   ДАЛЬНИЙ  (warm)    качает модуль. Контекста не создаёт, GPU не трогает.
 *   СРЕДНИЙ  (mount)   поднимает контекст и КОМПИЛИРУЕТ программу, пока
 *                      блок ещё за кадром. Это и есть защита от рывка:
 *                      компиляция синхронна, и попасть она должна
 *                      не на прокрутку, а на паузу перед ней.
 *   БЛИЖНИЙ  (show)    говорит циклу, что слот на экране. Вне экрана
 *                      цикл его не трогает вовсе — ни одного кадра.
 *
 * ── ОБЪЁМ РАБОТАЕТ И НА КАСАНИЯХ ──────────────────────────────────────────
 * До девятнадцатой итерации на касаниях он не поднимался вовсе: замер
 * (Р-34) показывал 3.6 с главного потока на первой отрисовке. Цена сидела
 * в компиляции БОЛЬШОЙ PBR-программы, и она снята материалом (Р-54):
 * света в сцене нет, объём запечён в вершинные цвета. Мобильная
 * композиция по ТЗ главная, и без приёма она остаться не могла.
 *
 * ── УКАЗАТЕЛЬ ВЕДЁТ И КАРТОЧКУ, И ПРЕДМЕТ ─────────────────────────────────
 * Слушатели вешаются на КАРТОЧКУ (ближайший предок с `data-tilt`), а не
 * на сам слот: наклоняется вся карточка, и целиться в маленький слот
 * было бы неверно. Карточку двигает CSS-трансформ по двум переменным —
 * это компоновщик и ноль работы в кадре; предмет внутри доворачивается
 * в самой сцене, поэтому объём не выглядит наклеенной картинкой.
 * React в этом не участвует: ни одного перерендера на движение мыши.
 */
export default function SceneSlot({
  kind,
  seed,
  label,
  className = '',
  mountMargin = '500px 0px',
}: {
  kind: SceneKind;
  seed: number;
  label: string;
  className?: string;
  /**
   * Запас, на котором поднимается КОНТЕКСТ и идёт компиляция. Он обязан
   * быть больше нуля: компилировать надо, пока блок за кадром.
   */
  mountMargin?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'idle' | 'ready' | 'flat' | 'unavailable'>('idle');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const reduced = prefersReducedMotion();
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const card = host.closest<HTMLElement>('[data-tilt]');

    let handle: SlotHandle | null = null;
    let flat: { draw: () => void; dispose: () => void } | null = null;
    let dead = false;
    let mod: typeof import('./stage') | null = null;

    /* Запасной плоский слой. Поднимается только если объём не завёлся:
       нет WebGL, не доехал чанк, потерян контекст. */
    const fallback = async () => {
      if (dead || flat) return;
      const { attachFlat } = await import('./flat');
      if (dead) return;
      flat = attachFlat(host, { kind, seed });
      setState('flat');
    };

    // наблюдатель 1: далеко на подходе — только прогреваем сеть
    const warm = new IntersectionObserver(
      async (entries) => {
        if (!entries[0].isIntersecting || mod) return;
        warm.disconnect();
        try {
          mod = await import('./stage');
        } catch {
          fallback();
        }
      },
      { rootMargin: '1200px 0px' },
    );

    // наблюдатель 2: блок ещё за кадром — поднимаем контекст и компилируем
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
          /* Собственное вращение — только на касаниях и только когда
             движение разрешено. */
          handle.setVisible(false);
          if (coarse && !reduced) handle.setSpin(true);
          setState('ready');
        } catch {
          fallback();
        }
      },
      { rootMargin: mountMargin },
    );

    // наблюдатель 3: слот в кадре — цикл может его трогать
    const show = new IntersectionObserver(
      (entries) => handle?.setVisible(entries[0].isIntersecting),
      { rootMargin: '0px' },
    );

    warm.observe(host);
    mount.observe(host);
    show.observe(host);

    const ro = new ResizeObserver(() => {
      handle?.draw();
      flat?.draw();
    });
    ro.observe(host);

    /* Наклон под указателем. Пишем две переменные на карточку (её двигает
       CSS) и отдаём те же числа в сцену (она доворачивает предмет).
       Чтений геометрии в обработчике одно — прямоугольник карточки,
       и оно не соседствует с записью в тот же элемент. */
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || !card) return;
      const r = card.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 2 - 1;
      const y = ((e.clientY - r.top) / r.height) * 2 - 1;
      card.style.setProperty('--tilt-x', x.toFixed(3));
      card.style.setProperty('--tilt-y', y.toFixed(3));
      handle?.setPointer(x, -y);
    };
    const leave = () => {
      if (!card) return;
      card.style.setProperty('--tilt-x', '0');
      card.style.setProperty('--tilt-y', '0');
      handle?.setPointer(null, null);
    };
    if (card && !reduced && !coarse) {
      card.addEventListener('pointermove', move);
      card.addEventListener('pointerleave', leave);
    }

    return () => {
      dead = true;
      warm.disconnect();
      mount.disconnect();
      show.disconnect();
      ro.disconnect();
      if (card) {
        card.removeEventListener('pointermove', move);
        card.removeEventListener('pointerleave', leave);
      }
      handle?.dispose();
      flat?.dispose();
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

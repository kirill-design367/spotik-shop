'use client';

import { useEffect, useRef } from 'react';
import type { WaveHandle } from './engine';
import { prefersReducedMotion } from '@/lib/motion';

/**
 * Слой волны в карточке тарифа.
 *
 * Модуль волны тянется ДИНАМИЧЕСКИМ импортом: в нём лежит огибающая
 * на 7 КБ, и в первом экране ей делать нечего. Габариты слоя задаёт
 * сама карточка (слой абсолютный во весь её бокс), поэтому появление
 * волны не двигает раскладку ни на пиксель.
 *
 * Слушатели указателя висят на КАРТОЧКЕ (ближайший предок
 * с `data-wave`), а не на канвасе: волна обязана оживать под курсором
 * везде в карточке, а не только там, где нет текста. React в этом
 * не участвует — ни одного перерендера на движение мыши.
 *
 * СОБСТВЕННЫЙ ХОД ВОЛНЫ ИДЁТ НА ВСЕХ ВВОДАХ (двадцать первая итерация).
 * Это и есть «тихое собственное движение в покое» из постановки:
 * дышит не карточка, а дорожка внутри неё. Геометрическое дыхание
 * самой карточки пришлось снять — замер показал, что в среде без
 * видеоускорителя сдвиг четырёх карточек перерисовывает 1.1 Мпикс
 * каждый кадр. Разбор и числа — в Р-62.
 *
 * При «уменьшить движение» рисуется ровно один кадр и больше ничего:
 * ни цикла, ни слушателей.
 */
export default function CardWave({ seed, className = '' }: { seed: number; className?: string }) {
  const hostRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const reduced = prefersReducedMotion();
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const card = host.closest<HTMLElement>('[data-wave]') ?? host;

    let handle: WaveHandle | null = null;
    let dead = false;

    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || !handle) return;
      const r = card.getBoundingClientRect();
      handle.setPointer((e.clientX - r.left) / r.width);
    };
    const leave = () => handle?.setPointer(null);

    /* Слот поднимается ЗА КАДР до подхода: первая отрисовка стопки
       стоит долю миллисекунды, но пусть и она не попадает в прокрутку. */
    const mount = new IntersectionObserver(
      async (entries) => {
        if (!entries[0].isIntersecting || handle || dead) return;
        mount.disconnect();
        const { attachWave } = await import('./engine');
        if (dead) return;
        handle = attachWave(host, { seed, drift: !reduced });
        if (!handle) return;
        handle.setVisible(false);
        show.observe(host);
        if (!reduced && !coarse) {
          card.addEventListener('pointermove', move);
          card.addEventListener('pointerleave', leave);
        }
      },
      { rootMargin: '400px 0px' },
    );

    // вне экрана цикл слой не трогает вовсе — ни одного кадра
    const show = new IntersectionObserver(
      (entries) => handle?.setVisible(!reduced && entries[0].isIntersecting),
      { rootMargin: '0px' },
    );

    mount.observe(host);

    const ro = new ResizeObserver(() => handle?.relayout());
    ro.observe(host);

    return () => {
      dead = true;
      mount.disconnect();
      show.disconnect();
      ro.disconnect();
      card.removeEventListener('pointermove', move);
      card.removeEventListener('pointerleave', leave);
      handle?.dispose();
    };
  }, [seed]);

  /* Именно span: слой лежит внутри <button>, а блочным элементам
     там не место — модель содержимого кнопки только строчная. */
  return <span ref={hostRef} className={`wave ${className}`.trim()} aria-hidden="true" />;
}

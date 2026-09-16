'use client';

import { useEffect, useRef } from 'react';

/**
 * Шкала дорожки.
 *
 * Страница читается как один трек: тонкая линия слева показывает позицию,
 * рядом идёт таймкод. Это не абстрактный «индикатор скролла», а предметная
 * деталь из мира, к которому продукт относится.
 *
 * Считается в том же rAF, что и всё остальное, и трогает только transform
 * и textContent — ни одного чтения геометрии в кадре.
 */
const TOTAL_SECONDS = 146; // столько длится дорожка, чья огибающая лежит в волне

export default function Playhead() {
  const rootRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const fill = fillRef.current;
    const label = timeRef.current;
    if (!root || !fill || !label) return;

    let raf = 0;
    let running = false;
    let last = -1;
    let height = 0;
    let docH = 1;

    const measure = () => {
      height = window.innerHeight;
      docH = Math.max(1, document.documentElement.scrollHeight - height);
    };
    measure();

    // Высота документа меняется не только на ресайзе: раскрылся ответ
    // в блоке вопросов, приехал шрифт, встала 3D-сцена. Без пересчёта
    // таймкод начинает врать. Наблюдатель дешевле, чем мерить в кадре.
    const ro = new ResizeObserver(measure);
    ro.observe(document.documentElement);

    const fmt = (s: number) => {
      const m = Math.floor(s / 60);
      const r = Math.floor(s % 60);
      return `${m}:${String(r).padStart(2, '0')}`;
    };
    const total = fmt(TOTAL_SECONDS);

    const tick = () => {
      const p = Math.min(1, Math.max(0, window.scrollY / docH));
      if (Math.abs(p - last) > 0.0008) {
        last = p;
        fill.style.transform = `scaleY(${p.toFixed(4)})`;
        label.textContent = `${fmt(p * TOTAL_SECONDS)} / ${total}`;
        // в хиро шкала молчит: тонкая линия поперёк вордмарка читается
        // как царапина, а не как элемент интерфейса
        const on = window.scrollY > height * 0.6 ? '1' : '0';
        if (root.dataset.on !== on) root.dataset.on = on;
      }
      if (running) raf = requestAnimationFrame(tick);
    };

    // Шкала скрыта до 768 px и не нужна при «уменьшить движение».
    // Гонять ради неё кадр там, где её не видно, — чистая трата батареи.
    const mqWide = window.matchMedia('(min-width: 768px)');
    const mqMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => {
      const want = mqWide.matches && !mqMotion.matches;
      if (want === running) return;
      running = want;
      if (want) raf = requestAnimationFrame(tick);
      else cancelAnimationFrame(raf);
    };
    sync();
    mqWide.addEventListener('change', sync);
    mqMotion.addEventListener('change', sync);

    window.addEventListener('resize', measure, { passive: true });
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      mqWide.removeEventListener('change', sync);
      mqMotion.removeEventListener('change', sync);
      window.removeEventListener('resize', measure);
    };
  }, []);

  return (
    <div className="playhead" ref={rootRef} data-on="0" aria-hidden="true">
      <div className="playhead__track">
        <div className="playhead__fill" ref={fillRef} />
      </div>
      <div className="playhead__time" ref={timeRef}>
        0:00 / 2:26
      </div>
    </div>
  );
}

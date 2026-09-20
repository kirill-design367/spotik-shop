'use client';

import { useEffect, useRef } from 'react';
import { onLayoutChange, onScrollY, scroller } from '@/lib/scroll';
import { prefersReducedMotion } from '@/lib/motion';

/**
 * БЛОК ПОРЯДКА — ТИХОЕ СЕРОЕ ПОЛЕ, ЕДУЩЕЕ ЗА ШАГАМИ.
 *
 * ⚠️ БЕЛАЯ ПАНЕЛЬ И ДИАГРАММА СНЯТЫ АРТ-ДИРЕКТОРОМ В ДЕВЯТНАДЦАТОЙ
 * ИТЕРАЦИИ: «наляписто, непонятно куда смотреть, и диаграмма здесь
 * ни к месту». Вместе с белым полем ушла и инверсия — над серым она
 * не читается, а серым поле обязано быть, чтобы блок звучал тихо.
 * Объём уехал в карточки тарифов, здесь не осталось ничего.
 *
 * Что осталось от приёма: поле едет за прокруткой и отмечает место,
 * где сейчас читают. Активный шаг там же — белый и полной
 * непрозрачности, соседние приглушены, переход плавный. Механика веса
 * ровно та же, что в блоке вопросов (Р-52): вес 0…1 от расстояния
 * до линии отсчёта, с полкой посередине, и двигает он только
 * `opacity` — то есть считает его компоновщик.
 *
 * ── ПОЛЕ РАСТВОРЯЕТСЯ ПО КРАЯМ ────────────────────────────────────────────
 * Резкой границы у него нет: это градиент, который сходит в фон сверху
 * и снизу. Прямоугольник с чёткой кромкой читался бы как плашка,
 * а нужно «слабо различимое поле».
 *
 * ── ЧТО СЧИТАЕТСЯ В КАДРЕ ──────────────────────────────────────────────────
 * Один трансформ поля и пять записей переменной. Ни одного чтения
 * геометрии: центры шагов сняты один раз при раскладке.
 */
export type Step = { t: string; d: string };

/** Линия отсчёта в экране, ширина зоны затухания и полка. */
const REF = 0.46;
const BAND = 0.9;
const PLATEAU = 0.5;

export default function Steps({ steps }: { steps: Step[] }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const panel = panelRef.current;
    const sc = scroller();
    if (!root || !panel || !sc) return;

    let items: HTMLElement[] = [];
    let mids: number[] = [];
    let band = 1;
    let top = 0;
    let travel = 0;
    let half = 0;

    const measure = () => {
      /* Геометрия снимается ЗДЕСЬ и только здесь. */
      const shift = sc.getBoundingClientRect().top - sc.scrollTop;
      const r = root.getBoundingClientRect();
      top = r.top - shift;
      half = panel.offsetHeight / 2;
      travel = Math.max(0, r.height - panel.offsetHeight);
      items = Array.from(root.querySelectorAll<HTMLElement>('.step'));
      mids = items.map((el) => {
        const b = el.getBoundingClientRect();
        return b.top - shift + b.height / 2;
      });
      const step =
        mids.length > 1 ? (mids[mids.length - 1] - mids[0]) / (mids.length - 1) : sc.clientHeight;
      band = Math.max(1, step * BAND);
    };

    let last = -1;
    const put = (y: number) => {
      if (y === last) return;
      last = y;
      panel.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`;
    };

    measure();

    /* При «уменьшить движение» поле стоит посередине списка, а шаги все
       на полной яркости: вес по умолчанию равен единице, и задаёт это
       CSS — подписки здесь просто не заводится. */
    if (prefersReducedMotion()) {
      const still = () => {
        measure();
        put(travel / 2);
      };
      still();
      return onLayoutChange(still);
    }

    const read = (y: number) => {
      const line = y + sc.clientHeight * REF;
      const p = line - top - half;
      put(p < 0 ? 0 : p > travel ? travel : p);
      for (let i = 0; i < items.length; i += 1) {
        const raw = 1 - Math.abs(mids[i] - line) / band;
        const w = raw <= 0 ? 0 : raw >= PLATEAU ? 1 : raw / PLATEAU;
        items[i].style.setProperty('--w', w.toFixed(3));
      }
    };

    const offLayout = onLayoutChange(measure);
    const offScroll = onScrollY(read);
    return () => {
      offLayout();
      offScroll();
      for (const el of items) el.style.removeProperty('--w');
    };
  }, [steps]);

  return (
    <div ref={rootRef} className="steps">
      {/* Поле лежит ПОД списком и ничего не рисует, кроме себя. */}
      <div ref={panelRef} className="steps__panel" aria-hidden="true" />

      <ol className="steps__list">
        {steps.map((s, i) => (
          <li key={s.t} className="step">
            <p className="step__n tnum">{String(i + 1).padStart(2, '0')}</p>
            <h3 className="step__t">{s.t}</h3>
            <p className="step__d">{s.d}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

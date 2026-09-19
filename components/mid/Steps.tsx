'use client';

import { useEffect, useId, useRef } from 'react';
import SceneSlot from '@/components/three/SceneSlot';
import { onLayoutChange, onScrollY, scroller } from '@/lib/scroll';
import { prefersReducedMotion } from '@/lib/motion';
import { glyphShapes } from '@/lib/inkshape';

/**
 * БЛОК 3 — ПРОЯВЛЯЮЩАЯСЯ ПАНЕЛЬ С ИНВЕРСИЕЙ.
 *
 * Список шагов идёт колонкой, а ЗА НИМ по мере прокрутки едет панель.
 * Шаг, оказавшийся над панелью, инвертируется и становится заметнее;
 * соседние, которых панель касается кромкой, инвертируются ЧАСТИЧНО —
 * ровно по фактическому перекрытию, попиксельно.
 *
 * ── ИНВЕРСИЯ ТЕМ ЖЕ МЕХАНИЗМОМ, ЧТО В ШАПКЕ ────────────────────────────────
 * Никаких списков «где что лежит»: на этом мы обожглись три итерации
 * подряд (Р-47). Слой берёт СВОЙ СОБСТВЕННЫЙ ФОН и прогоняет его через
 * ахроматическую выворотку, обрезанную по форме чернил шагов. Что под
 * ним — белое поле панели, тёмный объём дорожки или фон страницы —
 * он не спрашивает:
 *
 *     белое поле панели  #FFFFFF → #000000   21.0:1
 *     тёмный объём       #2A2A2A → #FFFFFF
 *
 * Живой текст при этом остаётся на месте и красится `--dim`. Вне панели
 * видно именно его — это и есть «приглушённые». Над панелью поверх него
 * ложится выворотка, и она его полностью накрывает: по сглаженной кромке
 * чёрного глифа #B3B3B3 на белом читается как обычное сглаживание.
 *
 * ── ПОЧЕМУ СЛОЙ РАЗМЕРОМ С ПАНЕЛЬ, А НЕ СО ВЕСЬ СПИСОК ─────────────────────
 * `backdrop-filter` стоит пропорционально площади, а фон под ним меняется
 * на каждом кадре прокрутки — панель едет. Слой во весь список был бы
 * тысячей пикселей высоты вместо двухсот. Поэтому слой едет ВМЕСТЕ
 * с панелью, а его обрезка компенсирует это обратным трансформом
 * НА САМОМ `clipPath` (так можно, Р-43): фигура остаётся стоять
 * на чернилах, а площадь фильтра равна панели.
 *
 * В кадре отсюда уходит РОВНО ТРИ ЗАПИСИ и ни одного чтения геометрии:
 * трансформ панели, трансформ слоя и обратный трансформ обрезки.
 *
 * ── ЗАПАСНОЙ ВАРИАНТ ───────────────────────────────────────────────────────
 * Белым поле панели становится ТОЛЬКО когда выворотка поддержана И фигура
 * собрана. Иначе панель остаётся `--surface`, и приглушённый текст на ней
 * читается как обычно: 7.7:1.
 */
export type Step = { t: string; d: string };

/** Где в экране стоит точка отсчёта хода панели. */
const REF = 0.5;

export default function Steps({ steps }: { steps: Step[] }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inkRef = useRef<HTMLDivElement>(null);
  const clipRef = useRef<SVGClipPathElement>(null);
  const clipId = `how-c-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`;

  useEffect(() => {
    const root = rootRef.current;
    const panel = panelRef.current;
    const ink = inkRef.current;
    const clip = clipRef.current;
    const sc = scroller();
    if (!root || !panel || !ink || !clip || !sc) return;

    let start = 0;
    let span = 1;
    let travel = 0;

    const build = () => {
      /* Геометрия снимается ЗДЕСЬ и только здесь: в кадре прокрутки
         ни одного чтения. */
      const base = sc.getBoundingClientRect().top - sc.scrollTop;
      const r = root.getBoundingClientRect();
      const ph = panel.offsetHeight;
      travel = Math.max(0, r.height - ph);
      start = r.top - base - sc.clientHeight * REF;
      span = Math.max(1, r.height);

      /* Фигура чернил — по всем шагам разом, в системе координат списка.
         По словам: у описаний по сотне знаков, и политерно это были бы
         тысячи узлов ради точности, которой внутри слова взяться неоткуда. */
      const shapes: SVGTextElement[] = [];
      for (const el of root.querySelectorAll<HTMLElement>('.step__n, .step__t, .step__d')) {
        shapes.push(...glyphShapes(el, r.left, r.top, 'word'));
      }
      clip.replaceChildren(...shapes);
      root.toggleAttribute('data-ink', shapes.length > 0);
    };

    let last = -1;
    const put = (y: number) => {
      if (y === last) return;
      last = y;
      const t = `translate3d(0, ${y.toFixed(2)}px, 0)`;
      panel.style.transform = t;
      ink.style.transform = t;
      /* Обратный сдвиг обрезки: слой едет, фигура стоит. */
      clip.setAttribute('transform', `translate(0, ${(-y).toFixed(2)})`);
    };

    build();
    const offLayout = onLayoutChange(build);
    document.fonts?.ready.then(build).catch(() => {});

    /* При «уменьшить движение» панель не едет вовсе — она просто стоит
       посередине списка. Инверсия от этого не страдает: она и так
       считается по положению, а не по времени. */
    if (prefersReducedMotion()) {
      const still = () => put(travel / 2);
      still();
      const offStill = onLayoutChange(still);
      return () => {
        offLayout();
        offStill();
      };
    }

    const read = (y: number) => {
      const p0 = (y - start) / span;
      put((p0 < 0 ? 0 : p0 > 1 ? 1 : p0) * travel);
    };
    const offScroll = onScrollY(read);
    return () => {
      offLayout();
      offScroll();
    };
  }, [steps]);

  return (
    <div ref={rootRef} className="steps">
      {/* Панель лежит ПОД списком: она проявляется за ним, а не поверх. */}
      <div ref={panelRef} className="steps__panel" aria-hidden="true">
        <SceneSlot
          kind="gift"
          seed={7}
          label="Звуковая дорожка Spotik Shop в объёме"
          className="steps__slot"
          mountMargin="0px"
        />
      </div>

      <ol className="steps__list">
        {steps.map((s, i) => (
          <li key={s.t} className="step">
            <p className="step__n tnum">{String(i + 1).padStart(2, '0')}</p>
            <h3 className="step__t">{s.t}</h3>
            <p className="step__d">{s.d}</p>
          </li>
        ))}
      </ol>

      {/* Слой выворотки. Едет вместе с панелью и ничего не знает о том,
          что под ним лежит. */}
      <div
        ref={inkRef}
        className="steps__ink"
        aria-hidden="true"
        style={{ clipPath: `url(#${clipId})` }}
      />
      <svg className="steps__clip" aria-hidden="true" focusable="false">
        <clipPath ref={clipRef} id={clipId} clipPathUnits="userSpaceOnUse" />
      </svg>
    </div>
  );
}

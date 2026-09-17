'use client';

import { useEffect, useRef } from 'react';
import {
  buildPaths,
  buildPathsE,
  bottomAtE,
  footRise,
  ease,
  easeFooter,
  VIEW_BOX,
  WM_BOX_HEIGHT,
  WM_VIEW_HEIGHT,
  WM_OVERSHOOT,
  WM_INSET,
  VIEW_OVER_INK,
  PAD_OVER_INK,
  LAYER_WIDTH,
} from '@/lib/wordmark';
import { onScrollProgress } from '@/lib/scroll';

type Props = {
  /** hero — слово сплющивается вниз от неподвижного верха. footer — зеркально. */
  mode: 'hero' | 'footer';
  /** Элемент, чей проход мимо вьюпорта задаёт прогресс. */
  sectionId: string;
  /**
   * Блок, который едет за нижней кромкой чернил. Сдвиг считается из той же
   * величины и в том же кадре, что и форма, поэтому отстать или обогнать
   * слово он не может физически.
   */
  followSelector?: string;
};

const LETTERS = ['S', 'P', 'O', 'T', 'I', 'K'];

/** Вход играет один раз за загрузку страницы, а не за монтирование. */
let entrancePlayed = false;

/**
 * Вордмарк-скобки.
 *
 * Слово SPOTIK открывает страницу и закрывает её — это один механизм,
 * а не два эффекта. Внизу оно возвращается зеркально, с инверсией цвета.
 *
 * ── ПОЧЕМУ ШЕСТЬ ГРУПП, А НЕ ОДИН ПУТЬ ─────────────────────────────────────
 * Каждая литера лежит в своей группе, потому что вход двигает их по одной.
 * На форму это не влияет: точки те же и в том же порядке, команды просто
 * разложены по шести путям. Морф по-прежнему целиком в атрибутах d —
 * трансформ входа живёт отдельно и только на время входа.
 *
 * ── ЧТО ПРОИСХОДИТ В КАДРЕ ──────────────────────────────────────────────────
 * В хиро — шесть записей атрибута d, и всё. Трансформа нет: НЕПОДВИЖЕН ВЕРХ
 * чернил, а он стоит по построению данных (у обоих состояний верх на y = 0),
 * двигать слой нечем и незачем.
 *
 * В футере всё зеркально: неподвижен НИЗ, слово растёт вверх. Данные
 * по-прежнему выровнены по верху, поэтому низ приходится прижимать —
 * одна запись transform на кадр, сдвиг долей собственной высоты слоя.
 * Форма при этом целиком остаётся в атрибуте d: трансформ двигает слой,
 * а не меняет его. Величина сдвига берётся из той же bottomAtE(e), что
 * и форма, и в том же вызове — разъехаться им негде.
 *
 * Ни одного чтения геометрии DOM, ни одной аллокации: буферы выделены
 * один раз в lib/wordmark. Рисуем СРАЗУ, без лишнего requestAnimationFrame —
 * обработчик прогресса уже выполняется внутри кадра, и лишний заказ терял
 * бы каждый второй (см. CLAUDE.md, Р-18).
 *
 * ── РАЗМЕР И ПОЛОЖЕНИЕ ─────────────────────────────────────────────────────
 * Слой стоит В ПОТОКЕ, сразу после навигации, и высоту берёт из CSS в долях
 * высоты хиро. Поэтому верх чернил — это низ навигации плюс поле, и никакой
 * JS для этого не нужен: ни чтения, ни записи, ни сдвига макета.
 */
export default function Wordmark({ mode, sectionId, followSelector }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pathsRef = useRef<(SVGPathElement | null)[]>([]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const svg = svgRef.current;
    const paths = pathsRef.current;
    if (!wrap || !svg || paths.length !== LETTERS.length) return;

    const follow = followSelector
      ? wrap.parentElement?.querySelector<HTMLElement>(followSelector) ?? null
      : null;
    // data-open живёт на сцене футера: по нему выезжает мелкий текст
    const stage =
      mode === 'footer' ? wrap.closest<HTMLElement>('.footer__stage') : null;

    let progress = mode === 'hero' ? 0 : 1;
    let painted = NaN;
    let opened = '';
    let disposed = false;

    const paint = () => {
      if (disposed) return;
      // hero: 0 → 1 (раскрыт → сжат).  footer: зеркально, 1 → 0.
      const t = mode === 'hero' ? progress : 1 - progress;
      if (t === painted) return;
      painted = t;

      // Смягчение у хиро и футера разное (см. lib/wordmark, easeFooter),
      // поэтому считается один раз здесь и дальше идёт готовым числом:
      // форма и прижим низа обязаны брать его из одного места.
      const e = mode === 'hero' ? ease(t) : easeFooter(t);

      const d = buildPathsE(e);
      for (let i = 0; i < d.length; i += 1) paths[i]!.setAttribute('d', d[i]);

      if (mode === 'footer') {
        // Прижать НИЗ чернил к низу слоя: слово растёт ВВЕРХ от своей линии.
        // Доля от собственной высоты слоя, поэтому пиксели знать не нужно.
        const shift = ((WM_BOX_HEIGHT - bottomAtE(e)) / WM_VIEW_HEIGHT) * 100;
        svg.style.transform = `translate3d(0,${shift.toFixed(5)}%,0)`;
      }

      if (stage) {
        // Мелкий текст под словом выезжает только когда слово разошлось
        // до конца. Атрибут пишем лишь на переходе, а не каждый кадр.
        const open = t <= 0.002 ? '1' : '0';
        if (open !== opened) {
          opened = open;
          stage.dataset.open = open;
        }
      }

      if (follow) {
        // Тексты прицеплены к нижней кромке чернил. Высота слоя известна
        // CSS как --wm-h, поэтому сдвиг выражается долей от неё, и читать
        // геометрию из JS по-прежнему не нужно ни разу.
        follow.style.transform =
          `translate3d(0,calc(var(--wm-h) * ${footRise(t).toFixed(5)}),0)`;
      }
    };

    paint();

    /**
     * При «уменьшить движение» слово стоит в раскрытом состоянии и на скролл
     * не реагирует — подписки просто нет. Настройку слушаем вживую: в CSS она
     * живёт медиазапросом, и если прочитать её один раз, вёрстка и логика
     * разъедутся при переключении на лету.
     */
    let off: () => void = () => {};
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => {
      off();
      if (mq.matches) {
        progress = mode === 'hero' ? 0 : 1;
        off = () => {};
        paint();
      } else {
        off = onScrollProgress(sectionId, mode, (p) => {
          progress = p;
          paint();
        });
      }
    };
    sync();
    mq.addEventListener('change', sync);

    return () => {
      disposed = true;
      off();
      mq.removeEventListener('change', sync);
    };
  }, [mode, sectionId, followSelector]);

  /**
   * Вход букв. Сама анимация — на CSS, поэтому она играет и без JS,
   * и её не нужно синхронизировать с кадром. JS отвечает только за конец:
   * ставит data-entered, и правило анимации перестаёт применяться —
   * трансформы литер становятся тождественными (transform: none), а не
   * «нулевыми, но всё ещё анимированными».
   *
   * Конец наступает по одной из двух причин, что раньше:
   *   • вход доиграл;
   *   • человек тронул скролл — тогда вход обрывается немедленно,
   *     и морф получает чистое состояние. Два движения одновременно
   *     не идут.
   */
  useEffect(() => {
    if (mode !== 'hero') return;
    const wrap = wrapRef.current;
    const stage = wrap?.closest<HTMLElement>('.hero__stage');
    if (!stage) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || entrancePlayed) {
      stage.dataset.entered = '1';
      return;
    }

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      entrancePlayed = true;
      stage.dataset.entered = '1';
      window.removeEventListener('scroll', finish);
      window.removeEventListener('wheel', finish);
      window.removeEventListener('touchstart', finish);
      clearTimeout(timer);
    };
    // длительность берём из CSS, чтобы число жило в одном месте
    const cs = getComputedStyle(stage);
    const total = (parseFloat(cs.getPropertyValue('--wm-enter-total')) || 1.1) * 1000;
    const timer = window.setTimeout(finish, total + 80);
    window.addEventListener('scroll', finish, { passive: true, once: true });
    window.addEventListener('wheel', finish, { passive: true, once: true });
    window.addEventListener('touchstart', finish, { passive: true, once: true });
    return () => {
      window.removeEventListener('scroll', finish);
      window.removeEventListener('wheel', finish);
      window.removeEventListener('touchstart', finish);
      clearTimeout(timer);
    };
  }, [mode]);

  // Оба слоя рисуются в раскрытом состоянии: это то, что человек видит
  // в покое, и то, что останется, если скрипт не доедет.
  const initial = buildPaths(0);

  return (
    <div
      ref={wrapRef}
      className={`wm wm--${mode}`}
      // aria-hidden: слово дублирует заголовок страницы, скринридеру оно лишнее
      aria-hidden="true"
      // В хиро слой высотой во всю рамку: поле сверху нужно подскоку букв.
      // В футере входа нет, и слово обязано идти вровень с верхом блока,
      // поэтому слой ровно по чернилам, а поле уводится отрицательным
      // полем самого SVG.
      style={{
        height:
          mode === 'hero'
            ? `calc(var(--wm-h) * ${VIEW_OVER_INK.toFixed(5)})`
            : 'var(--wm-h)',
      }}
    >
      <svg
        ref={svgRef}
        className="wm__svg"
        viewBox={VIEW_BOX}
        preserveAspectRatio="none"
        focusable="false"
        style={{
          // cqw, а не vw: единица контейнерного запроса меряет ОБЛАСТЬ
          // СОДЕРЖИМОГО, без полосы прокрутки. В vw правый отступ съедался
          // полосой и уходил в минус — литеру K обрезало.
          width: `${LAYER_WIDTH * 100}cqw`,
          marginLeft: `${WM_INSET * 100}cqw`,
          ...(mode === 'footer'
            ? {
                height: `calc(var(--wm-h) * ${VIEW_OVER_INK.toFixed(5)})`,
                marginTop: `calc(var(--wm-h) * ${(-PAD_OVER_INK).toFixed(5)})`,
              }
            : null),
          // величины входа — в единицах контура, их же понимает transform
          // внутри SVG, поэтому перелёт задан ровно в долях высоты прописной
          ['--wm-drop' as string]: `${WM_BOX_HEIGHT.toFixed(3)}px`,
          ['--wm-over' as string]: `${WM_OVERSHOOT.toFixed(3)}px`,
        }}
      >
        {LETTERS.map((ch, i) => (
          <g key={ch} className="wm__letter" style={{ ['--i' as string]: i }}>
            <path ref={(el) => { pathsRef.current[i] = el; }} d={initial[i]} />
          </g>
        ))}
      </svg>
    </div>
  );
}


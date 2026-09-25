'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { attachCards } from '@/lib/cards';
import { PERIODS, formatPrice } from '@/lib/plans';

/**
 * ВЫБОР ТАРИФА И СРОКА — ПЛАШКИ СРОКА И РЯД КАРТ.
 *
 * ⚠️ ОДИН КОМПОНЕНТ НА ЛЕНДИНГ И НА СТРАНИЦУ СЕРТИФИКАТОВ,
 * И ЭТО ПОСТАНОВКА ТРИДЦАТЬ ДЕВЯТОЙ ИТЕРАЦИИ: «Приведи его к виду
 * тарифов на главной. Тариф выбирается такими же карточками… Срок —
 * такими же небольшими пилюлями». Собери мы вторую копию карт
 * на странице сертификатов — кайма, перелив, свет за картой
 * и раскладка на телефоне разошлись бы с лендингом на первой же
 * правке, а правок у карты за пятнадцать итераций было шесть.
 *
 *     .seg           плашки срока: «1 мес · 3 мес · 6 мес · 12 мес»
 *     .cards
 *       .cards__slot     ячейка, ничего не рисует и НЕ создаёт
 *                        контекста наложения (Р-68, Р-123)
 *         .cards__glow   размытый свет ЗА картой, слоем 0
 *         .card          наклон в перспективе, слой 1
 *
 * ── СКРЫТОЕ СОЧЕТАНИЕ ТАРИФ × СРОК ИСЧЕЗАЕТ ─────────────────────────────
 * ⚠️ И ИСЧЕЗАЕТ ОНО ПЛАВНО, А НЕ ПЕРЕСТРОЕНИЕМ. Постановка: «его
 * карточка плавно исчезает, а оставшиеся плавно съезжаются к центру;
 * при переключении обратно карточки плавно расходятся и дают ему
 * место». Значит карту нельзя ПРОСТО НЕ РИСОВАТЬ: снятый из разметки
 * узел не анимируется ничем. Она остаётся в разметке, а ячейка
 * получает `data-off` — дальше всё делает CSS.
 *
 * ⚠️ И РАДИ ЭТОГО СЕТКА СТАЛА FLEX. У `grid-auto-flow: column`
 * ширина колонок задаётся ОДНИМ значением на все (`grid-auto-columns`),
 * и схлопнуть одну ячейку, не тронув остальные, нечем. У флекса
 * ширина каждой — свой `flex-grow`, и он анимируется: у скрытой он
 * едет к нулю, а соседи забирают освободившееся место сами, без
 * единой строки в кадре. Промежуток снимается отрицательным полем
 * той же ячейки — иначе на месте исчезнувшей карты остался бы
 * двойной воздух.
 *
 * ⚠️ СКРЫТАЯ КАРТА ВЫВЕДЕНА ИЗ ОБХОДА `inert`. Она физически
 * в разметке, и без этого таб заходил бы в невидимую кнопку.
 *
 * ⚠️ ВЫБОР МЯГКО ПЕРЕХОДИТ НА ПЕРВЫЙ ДОСТУПНЫЙ, и решает это ОДНО
 * место — обработчик срока здесь. Раздай мы это по двум страницам,
 * одна из них однажды осталась бы с выбранным тарифом, которого
 * на экране нет.
 */
export type KartaTarifa = {
  id: string;
  name: string;
  short: string;
  /** Только те сроки, на которые тариф вообще оформляется. */
  ceny: { period: number; rub: number; byloRub?: number; doDaty?: string }[];
};

export default function VyborTarifa({
  tarify,
  planId,
  period,
  vybrat,
  podpisSroka = 'Срок подписки',
  podpisTarifa = 'Тариф',
  poyavlenie = false,
}: {
  tarify: KartaTarifa[];
  planId: string;
  period: number;
  /** Тариф и срок меняются ОДНИМ ходом: они связаны. */
  vybrat: (planId: string, period: number) => void;
  podpisSroka?: string;
  podpisTarifa?: string;
  /**
   * ⚠️ ПОЯВЛЕНИЕ СТРОК В КАДРЕ ЕСТЬ ТОЛЬКО НА ЛЕНДИНГЕ, И КЛАСС `rv`
   * ПРОСИТСЯ ЯВНО. Скрытое состояние живёт под `[data-rv]` на `<html>`,
   * а атрибут ставится на КАЖДОЙ странице сайта; показывает элементы
   * обратно наблюдатель `RevealRoot`, и он смонтирован только
   * на лендинге. Поставь `rv` без него — на странице сертификатов
   * карты остались бы невидимыми навсегда.
   */
  poyavlenie?: boolean;
}) {
  /** Какая плашка сейчас переворачивается. Снимается по концу хода. */
  const [flip, setFlip] = useState<number | null>(null);
  const statusId = useId();
  const cardsRef = useRef<HTMLDivElement>(null);

  /* Наклон, дыхание и подъём. React в движении не участвует вовсе:
     ни одного перерендера на указатель. Набор карт постоянен —
     скрытые остаются в разметке, — поэтому подписка одна на всё
     время жизни блока. */
  useEffect(() => {
    const root = cardsRef.current;
    return root ? attachCards(root) : undefined;
  }, []);

  const est = (t: KartaTarifa, p: number) => t.ceny.some((c) => c.period === p);
  /* ⚠️ СРОК, КОТОРОГО НЕТ НИ У ОДНОГО ТАРИФА, НЕ ПРЕДЛАГАЕТСЯ ВОВСЕ.
     Иначе на нём открывалась бы пустая сетка — «скрытое сочетание
     исчезает с сайта» это тоже. */
  const sroki = PERIODS.filter((p) => tarify.some((t) => est(t, p.key)));
  const vidnye = tarify.filter((t) => est(t, period));
  const tarif = vidnye.find((t) => t.id === planId) ?? vidnye[0];

  const naSrok = (p: number) => {
    const dostupny = tarify.filter((t) => est(t, p));
    /* Выбранный тариф на новом сроке не оформляется — выбор мягко
       переходит на первый доступный. */
    const id = dostupny.some((t) => t.id === planId) ? planId : (dostupny[0]?.id ?? planId);
    vybrat(id, p);
  };

  /**
   * Стрелки внутри radiogroup. Без них roving tabindex делает только
   * хуже: в группу можно войти табом, а переключить выбор уже нечем.
   *
   * ⚠️ ФОКУС ИДЁТ ТОЛЬКО ПО ВИДИМЫМ. Скрытые карты лежат в той же
   * группе, и `[role="radio"]` без уточнения привёл бы фокус
   * в исчезнувшую.
   */
  const rove = (
    e: React.KeyboardEvent,
    count: number,
    current: number,
    apply: (i: number) => void,
    sel: string,
  ) => {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
    if (!keys.includes(e.key) || count < 2) return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    const next = (current + dir + count) % count;
    apply(next);
    (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(sel)[next]?.focus();
  };

  const announce = (() => {
    if (!tarif) return 'На этот срок ничего не оформляется';
    const p = PERIODS.find((x) => x.key === period);
    const c = tarif.ceny.find((x) => x.period === period);
    return `${p?.label ?? `${period} мес`}, тариф «${tarif.name}»: ${
      c ? `${formatPrice(c.rub)} рублей` : 'на этот срок не оформляется'
    }`;
  })();

  return (
    <>
      <div
        className={`seg seg--center${poyavlenie ? ' rv' : ''}`}
        role="radiogroup"
        aria-label={podpisSroka}
        onKeyDown={(e) =>
          rove(
            e,
            sroki.length,
            sroki.findIndex((p) => p.key === period),
            (i) => naSrok(sroki[i].key),
            '[role="radio"]',
          )
        }
      >
        {sroki.map((p) => (
          <button
            key={p.key}
            type="button"
            role="radio"
            aria-checked={period === p.key}
            tabIndex={period === p.key ? 0 : -1}
            className="seg__btn"
            /* Переворот заводит АТРИБУТ, а снимает его конец самой
               анимации: у `:active` ход кончился бы вместе
               с отпусканием пальца, то есть на середине. */
            data-flip={flip === p.key ? '' : undefined}
            onAnimationEnd={() => setFlip((f) => (f === p.key ? null : f))}
            onClick={() => {
              setFlip(p.key);
              naSrok(p.key);
            }}
          >
            <span className="seg__t">{p.short}</span>
          </button>
        ))}
      </div>

      <p id={statusId} role="status" aria-atomic="true" className="sr-only">
        {announce}
      </p>

      <div
        ref={cardsRef}
        className={`cards${poyavlenie ? ' rv' : ''}`}
        role="radiogroup"
        aria-label={podpisTarifa}
        onKeyDown={(e) =>
          rove(
            e,
            vidnye.length,
            vidnye.findIndex((t) => t.id === tarif?.id),
            (i) => vybrat(vidnye[i].id, period),
            '.cards__slot:not([data-off]) [role="radio"]',
          )
        }
      >
        {tarify.map((t) => {
          const c = t.ceny.find((x) => x.period === period);
          const skryt = !c;
          return (
            /* ⚠️ ОБЁРТКА НИЧЕГО НЕ РИСУЕТ И НЕ СОЗДАЁТ КОНТЕКСТА
               НАЛОЖЕНИЯ. Ей нужна ровно одна вещь — `position:
               relative`, чтобы свет внутри неё встал по кромке
               карты. Дай ей `isolation` или `z-index` — и свет
               соседа снова ляжет поверх чужой карты (Р-68). */
            <span
              key={t.id}
              className="cards__slot"
              data-off={skryt ? '' : undefined}
              /* ⚠️ `inert` ИМЕННО БУЛЕВЫМ, А НЕ ПУСТОЙ СТРОКОЙ: React 19
                 знает это свойство и пустую строку отдаёт как «выключено».
                 Поймано сторожем — атрибута в разметке не появлялось. */
              inert={skryt || undefined}
            >
              <span className="cards__glow" aria-hidden="true" />
              <button
                type="button"
                role="radio"
                aria-checked={!skryt && tarif?.id === t.id}
                tabIndex={!skryt && tarif?.id === t.id ? 0 : -1}
                className="card"
                onClick={() => vybrat(t.id, period)}
              >
                {/* КАЙМА ИДЁТ ПЕРВОЙ, ПЛИТА ПОВЕРХ НЕЁ И НА ПИКСЕЛЬ УЖЕ:
                    видимой остаётся ровно рамка в один пиксель. Так кайму
                    рисует обычная заливка, а не маска — маска внутри карты
                    заставляла бы перерисовывать её целиком (Р-62). */}
                <span className="card__edge" aria-hidden="true" />
                <span className="card__plate" aria-hidden="true" />
                <span className="card__face">
                  <span className="card__name">{t.short}</span>
                  <span className="card__price tnum">
                    {/* ⚠️ СТАРАЯ ЦЕНА СТОИТ НАД НОВОЙ И ЗАЧЁРКНУТА,
                        а срок скидки — рядом с новой. Иначе «до 30.09»
                        читается как срок тарифа, а не скидки. */}
                    {c?.byloRub ? <s className="card__bylo">{formatPrice(c.byloRub)} ₽</s> : null}
                    <b>{c ? `${formatPrice(c.rub)} ₽` : '—'}</b>
                    <span className="card__per">
                      за {period} мес{c?.doDaty ? ` · до ${c.doDaty}` : ''}
                    </span>
                  </span>
                </span>
              </button>
            </span>
          );
        })}
      </div>
    </>
  );
}

'use client';

import { useEffect, useId, useRef, useState } from 'react';
import SectionHead from './SectionHead';
import { attachCards } from '@/lib/cards';
import { PERIODS, PLANS, formatPrice, savings, type Plan, type PeriodKey } from '@/lib/plans';

/**
 * ⚠️ СОСТАВ ТАРИФОВ ПО-ПРЕЖНЕМУ В `lib/plans.ts`, А ЦЕНЫ ПРИХОДЯТ
 * СВЕРХУ. Двадцать седьмая итерация перенесла цены в базу, где ими
 * управляет администратор; страница остаётся статической и получает
 * их при сборке кадра (см. `revalidate` в app/page.tsx). База
 * недоступна — приходит `undefined`, и работают прежние умолчания:
 * лендинг обязан собираться на раннере, где базы нет вовсе.
 */
export type CenyTarifov = Record<string, Partial<Record<PeriodKey, number>>>;

/**
 * БЛОК ТАРИФОВ — ЧЕТЫРЕ ГОЛОГРАФИЧЕСКИЕ КАРТЫ СЕТКОЙ ДВА НА ДВА.
 *
 * Сетка 2×2 НА ВСЕХ РАЗМЕРАХ, включая 390. Пропорция карты — ближе
 * к банковской: человек покупает доступ и получает карту.
 *
 * ── ДВАДЦАТЬ ЧЕТВЁРТАЯ ИТЕРАЦИЯ: THREE.JS СНОВА УБРАН ───────────────────
 * ⚠️ СЦЕНЫ БОЛЬШЕ НЕТ. Прежние плиты рисовал WebGL, и у них была
 * видна глазом ступенька на скруглении: сглаживание в сцене
 * пришлось выключить ради цены. Теперь карту рисует браузер —
 * кромка, скругление и текст растрируются в разрешении устройства
 * при любом наклоне и любом dpr.
 *
 *     .cards
 *       span.cards__glow — размытый свет ЗА картой, слоем 0
 *       .card            — наклон в перспективе сетки, слой 1
 *         .card__plate   — поверхность, фольга и блик: четыре слоя
 *                          ОДНОГО фона, смешанные между собой
 *         .card__face    — название, цена и срок, обычный HTML
 *
 * Наклон с пружинной доводкой, дыхание в покое и подъём выбранной
 * ведёт `lib/cards.ts`; фольгу и блик из тех же чисел выводит CSS.
 * Решение — Р-74.
 *
 * ── БЕЗ СКРИПТА И ПРИ «УМЕНЬШИТЬ ДВИЖЕНИЕ» ────────────────────────────────
 * Карта полностью нарисована CSS: без JS она просто стоит ровно,
 * с фольгой в исходном положении. Прятать нечего и подменять нечем.
 *
 * ── ВЫБОР КАРТОЧКИ ВЕДЁТ ОБЛАСТЬ ПОД СЕТКОЙ ───────────────────────────────
 * Карточки — настоящий radiogroup со стрелками на клавиатуре
 * и `aria-checked`. Под сеткой стоит выбор аккаунта и кнопка с ценой
 * ВЫБРАННОЙ карточки; у сертификата вместо выбора аккаунта строка
 * про подарок.
 *
 * Почему управление снаружи, а не в каждой карточке: четыре одинаковых
 * набора радиокнопок и четыре кнопки «Оформить» — это четыре призыва
 * к действию в одном кадре. Приём карточек держится на том, что они
 * лаконичные, и первое же управление внутри это ломает.
 */
export default function Pricing({ ceny }: { ceny?: CenyTarifov }) {
  const plans: Plan[] = ceny ? PLANS.map((p) => (ceny[p.id] ? { ...p, prices: ceny[p.id]!, pending: Object.keys(ceny[p.id]!).length ? undefined : p.pending } : p)) : PLANS;
  const [period, setPeriod] = useState<PeriodKey>(12);
  const [planId, setPlanId] = useState<string>(PLANS[0].id);
  const [account, setAccount] = useState<Record<string, 'new' | 'renew'>>({});
  /** Какая плашка сейчас переворачивается. Снимается по концу хода. */
  const [flip, setFlip] = useState<PeriodKey | null>(null);
  const statusId = useId();
  const cardsRef = useRef<HTMLDivElement>(null);

  /* Наклон, дыхание и подъём. React в движении не участвует вовсе:
     ни одного перерендера на указатель. */
  useEffect(() => {
    const root = cardsRef.current;
    return root ? attachCards(root) : undefined;
  }, []);

  const plan = plans.find((p) => p.id === planId) ?? plans[0];
  const total = plan.prices[period];
  const monthOnly = !plan.pending && !total ? plan.prices[1] : undefined;
  const acc = account[plan.id] ?? 'new';
  const save = total ? savings(plan, period) : 0;

  /**
   * Стрелки внутри radiogroup. Без них roving tabindex делает только хуже:
   * в группу можно войти табом, а переключить выбор уже нечем.
   */
  const rove = (
    e: React.KeyboardEvent,
    count: number,
    current: number,
    apply: (i: number) => void,
  ) => {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    const next = (current + dir + count) % count;
    apply(next);
    const group = e.currentTarget as HTMLElement;
    group.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  };

  const announce = (() => {
    const p = PERIODS.find((x) => x.key === period)!;
    const price = plan.pending
      ? plan.pending
      : total
        ? `${formatPrice(total)} рублей`
        : monthOnly
          ? `${formatPrice(monthOnly)} рублей за месяц, другие сроки по запросу`
          : 'на этот срок не оформляется';
    return `${p.label}, тариф «${plan.name}»: ${price}`;
  })();

  return (
    <section id="pricing" className="section section--clipx">
      <div className="shell">
        <SectionHead
          title="Выберите срок и тариф"
          lead="Цена фиксируется в момент оформления. Чем длиннее срок, тем дешевле месяц."
          quiet
          center
        />

        <div
          className="seg seg--center rv"
          role="radiogroup"
          aria-label="Срок подписки"
          onKeyDown={(e) =>
            rove(
              e,
              PERIODS.length,
              PERIODS.findIndex((p) => p.key === period),
              (i) => setPeriod(PERIODS[i].key),
            )
          }
        >
          {PERIODS.map((p) => (
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
                setPeriod(p.key);
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
          className="cards rv"
          role="radiogroup"
          aria-label="Тариф"
          onKeyDown={(e) =>
            rove(
              e,
              plans.length,
              plans.findIndex((p) => p.id === planId),
              (i) => setPlanId(plans[i].id),
            )
          }
        >
          {/* СВЕТ ЗА КАРТОЙ ЛЕЖИТ ОТДЕЛЬНЫМИ СЛОЯМИ И ИДЁТ ПЕРВЫМ.
              Внутри карты он оказался бы в её контексте наложения,
              и свет второй лёг бы поверх первой: слоты рисуются
              целиком по очереди (Р-68). Ячейку задаёт `grid-area`.

              ⚠️ ЭТОТ СЛОЙ НЕ НАКЛОНЯЕТСЯ, и JS его вообще не трогает:
              размытие обязано считаться один раз, а состояние
              (покой, наведение, выбор) слой читает из своей карты
              через `:has()` в CSS. */}
          {plans.map((p, i) => (
            <span key={`glow-${p.id}`} className="cards__glow" data-i={i} aria-hidden="true" />
          ))}

          {plans.map((p, i) => {
            const t = p.prices[period];
            const m = !p.pending && !t ? p.prices[1] : undefined;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={planId === p.id}
                tabIndex={planId === p.id ? 0 : -1}
                className="card"
                data-i={i}
                onClick={() => setPlanId(p.id)}
              >
                <span className="card__plate" aria-hidden="true" />
                <span className="card__face">
                  <span className="card__name">{p.short ?? p.name}</span>
                  <span className="card__price tnum">
                    {p.pending ? (
                      <em className="card__soon">Цена уточняется</em>
                    ) : t ? (
                      <>
                        <b>{formatPrice(t)} ₽</b>
                        <span className="card__per">за {period} мес</span>
                      </>
                    ) : (
                      <>
                        <b>{formatPrice(m!)} ₽</b>
                        <span className="card__per">за месяц</span>
                      </>
                    )}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Область под сеткой работает для ВЫБРАННОЙ карточки. */}
        <div className="order rv">
          <p className="order__plan">
            <span className="order__label">Выбрано</span>
            <b>{plan.name}</b>
            {save > 0 ? <span className="order__save tnum">экономия {formatPrice(save)} ₽</span> : null}
          </p>

          {plan.gift ? (
            /* У сертификата выбора аккаунта нет: его делает не тот,
               кто платит, а тот, кому дарят. */
            <p className="order__gift">{plan.gift}</p>
          ) : (
            <div
              role="radiogroup"
              aria-label={`Аккаунт для тарифа «${plan.name}»`}
              className="order__opts"
              onKeyDown={(e) =>
                rove(e, 2, acc === 'new' ? 0 : 1, (i) =>
                  setAccount((st) => ({ ...st, [plan.id]: i === 0 ? 'new' : 'renew' })),
                )
              }
            >
              {(
                [
                  ['new', 'Новый аккаунт'],
                  ['renew', 'Продлить существующий'],
                ] as const
              ).map(([key, title]) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={acc === key}
                  tabIndex={acc === key ? 0 : -1}
                  className="row__opt"
                  onClick={() => setAccount((s) => ({ ...s, [plan.id]: key }))}
                >
                  {title}
                </button>
              ))}
            </div>
          )}

          {/*
            ⚠️ КНОПКА ВКЛЮЧЕНА С ДВАДЦАТЬ СЕДЬМОЙ ИТЕРАЦИИ. До неё оплаты
            на сайте не было вовсе, и выключенная кнопка объясняла себя
            надписью. Теперь она ведёт на оформление заказа, а выбранные
            тариф, срок и вид аккаунта уезжают в адрес: страница
            оформления открывается уже заполненной.

            Это ССЫЛКА, а не кнопка, и выглядит она ровно так же:
            у `.btn` уже стоят `inline-flex` и `text-decoration: none`,
            поэтому разметка меняется, а кадр — нет.
          */}
          {total || monthOnly ? (
            <a
              className="btn btn--wide"
              href={`/checkout/?plan=${plan.id}&period=${total ? period : 1}${plan.gift ? '' : `&mode=${acc}`}`}
            >
              {total
                ? `Оформить за ${formatPrice(total)} ₽`
                : `Оформить на месяц за ${formatPrice(monthOnly!)} ₽`}
            </a>
          ) : (
            <button type="button" className="btn btn--wide" disabled>
              {plan.pending ? 'Оформить · цена уточняется' : 'Оформить · на этот срок не оформляется'}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

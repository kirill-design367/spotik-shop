'use client';

import { useEffect, useId, useRef, useState } from 'react';
import SectionHead from './SectionHead';
import { attachCards } from '@/lib/cards';
import { PERIODS, PLANS, formatPrice, savings, type PeriodKey } from '@/lib/plans';

/**
 * БЛОК ТАРИФОВ — ЧЕТЫРЕ ОБЪЁМНЫЕ КАРТОЧКИ СЕТКОЙ ДВА НА ДВА.
 *
 * Сетка 2×2 НА ВСЕХ РАЗМЕРАХ, включая 390 (двадцатая итерация), углы
 * скруглены — снятие прежнего правила «радиус везде 0» отдельным
 * требованием арт-директора.
 *
 * ── ДВАДЦАТЬ ТРЕТЬЯ ИТЕРАЦИЯ: НАСТОЯЩИЙ ОБЪЁМ НА THREE.JS ────────────────
 * ⚠️ КАРТОЧКА БОЛЬШЕ НЕ CSS-ПЛИТА. Прошлая была «плоской плитой
 * с рамкой, а не объёмом». Теперь это предмет в сцене: плита с
 * толщиной, фаской, материалом и светом. Разметка от этого почти
 * не изменилась:
 *
 *     .cards          — сетка; здесь же лежит ХОЛСТ на весь блок
 *       canvas.cards__gl — одна сцена на все четыре плиты
 *       .card         — кнопка-радио: наклон, подъём и ТЕКСТ
 *         .card__edge — запасная CSS-плита: видна, только пока
 *                       (или если) сцена не поднялась
 *         .card__face — название и цена, лежат НА грани
 *
 * Передняя грань каждой плиты проецируется в свою ячейку один к одному,
 * поэтому HTML-текст ложится ровно на неё, а перспектива у CSS и у
 * камеры — одна и та же величина. Механика — в `lib/cards.ts`, решение
 * в Р-71.
 *
 * ⚠️ ПОДСВЕТКА ТЕПЕРЬ ОБНИМАЕТ КОНТУР. Прежний радиальный градиент
 * за плитой лежал «лужей света снизу» — арт-директор назвал это браком.
 * Ореол считается знаковым расстоянием до скруглённого прямоугольника
 * и потому одинаков по всему периметру. Ни фильтра, ни размытия:
 * мягкость даёт сама функция спада (закон 29).
 *
 * ── БЕЗ СКРИПТА И БЕЗ WEBGL ───────────────────────────────────────────────
 * Название и цена остаются обычным HTML, а `.card__edge` рисует ту же
 * плиту средствами CSS. Сцена поднялась — CSS-подложка снимается
 * атрибутом `data-gl`. Прятать содержание безусловно нельзя, а
 * декорацию можно не рисовать: то же правило, что у маршрута.
 *
 * ── ВЫБОР КАРТОЧКИ ВЕДЁТ ОБЛАСТЬ ПОД СЕТКОЙ ───────────────────────────────
 * Карточки — настоящий radiogroup со стрелками на клавиатуре
 * и `aria-checked`, а не крашеные div. По умолчанию выбрана первая.
 * Под сеткой стоит выбор аккаунта и кнопка с ценой ВЫБРАННОЙ карточки;
 * у сертификата вместо выбора аккаунта строка про подарок.
 *
 * Почему управление снаружи, а не в каждой карточке: четыре одинаковых
 * набора радиокнопок и четыре кнопки «Оформить» — это четыре призыва
 * к действию в одном кадре. Приём карточек держится на том, что они
 * лаконичные, и первое же управление внутри это ломает.
 */
export default function Pricing() {
  const [period, setPeriod] = useState<PeriodKey>(12);
  const [planId, setPlanId] = useState<string>(PLANS[0].id);
  const [account, setAccount] = useState<Record<string, 'new' | 'renew'>>({});
  const statusId = useId();
  const cardsRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);

  /* Сцена, наклон, дыхание и подсветка. React в движении не участвует
     вовсе: ни одного перерендера на указатель. */
  useEffect(() => {
    const root = cardsRef.current;
    const gl = glRef.current;
    return root && gl ? attachCards(root, gl) : undefined;
  }, []);

  const plan = PLANS.find((p) => p.id === planId) ?? PLANS[0];
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
              onClick={() => setPeriod(p.key)}
            >
              {p.short}
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
              PLANS.length,
              PLANS.findIndex((p) => p.id === planId),
              (i) => setPlanId(PLANS[i].id),
            )
          }
        >
          {/* ХОЛСТ ОДИН НА ВЕСЬ БЛОК: живой WebGL-контекст на странице
              ровно один, и плиты стоят в нём там же, где лежат ячейки.
              Он шире сетки — ореолу нужно место за кромкой. */}
          <canvas ref={glRef} className="cards__gl" aria-hidden="true" />

          {PLANS.map((p) => {
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
                onClick={() => setPlanId(p.id)}
              >
                {/* Запасная плита средствами CSS. Пока сцена не поднялась
                    (или не может подняться вовсе), карточка выглядит как
                    в прошлой итерации; с `data-gl` слой снимается. */}
                <span className="card__edge" aria-hidden="true" />
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
            Оплата — следующий этап разработки. Кнопка, которая
            фокусируется, объявляется кнопкой и молча ничего не делает,
            хуже честно выключенной: человек решает, что сайт сломан.

            ⚠️ ПОЧЕМУ ОНА ВЫКЛЮЧЕНА, ОБЪЯСНЯЕТ ОНА САМА. Под кнопкой
            не осталось ни строки: и цена за месяц, и абзац про будущую
            оплату сняты арт-директором. Объяснение переехало в надпись —
            иначе выключенная кнопка остаётся без причины, а это худший
            из вариантов.
          */}
          <button type="button" className="btn btn--wide" disabled>
            {total
              ? `Оформить за ${formatPrice(total)} ₽ · оплата скоро`
              : monthOnly
                ? `Оформить на месяц за ${formatPrice(monthOnly)} ₽ · оплата скоро`
                : 'Оформить · оплата скоро'}
          </button>
        </div>
      </div>
    </section>
  );
}

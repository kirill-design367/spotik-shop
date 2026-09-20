'use client';

import { useId, useState } from 'react';
import SectionHead from './SectionHead';
import CardWave from '@/components/wave/CardWave';
import { PERIODS, PLANS, formatPrice, perMonth, savings, type PeriodKey } from '@/lib/plans';

/**
 * БЛОК ТАРИФОВ — ЧЕТЫРЕ КАРТОЧКИ СЕТКОЙ ДВА НА ДВА.
 *
 * Двадцатая итерация пересобрала карточки целиком:
 *
 *   • сетка 2×2 НА ВСЕХ РАЗМЕРАХ, включая 390. Столбика больше нет;
 *   • карточка несёт РОВНО ТРИ вещи: название, цену за выбранный срок
 *     и волну. Всё остальное уехало вниз блока;
 *   • объёмный отрезок дорожки снят, вместо него звуковая волна
 *     на Canvas 2D — та самая, что придумывали для хиро (Р-59);
 *   • углы скруглены: арт-директор снял правило «радиус везде 0»
 *     для карточек отдельным требованием.
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
  const noteId = useId();

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
    <section id="pricing" className="section">
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
          {PLANS.map((p) => {
            const t = p.prices[period];
            const m = !p.pending && !t ? p.prices[1] : undefined;
            return (
              /* data-wave — точка, за которую слой волны берёт указатель:
                 оживать она обязана везде в карточке, а не только там,
                 где нет текста. */
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={planId === p.id}
                tabIndex={planId === p.id ? 0 : -1}
                className="card"
                data-wave
                onClick={() => setPlanId(p.id)}
              >
                <CardWave seed={p.people * 7 + p.id.length * 31} className="card__wave" />
                <span className="card__face">
                  <span className="card__name">{p.short ?? p.name}</span>
                  <span className="card__price tnum">
                    {p.pending ? (
                      <em className="card__soon">Цена уточняется</em>
                    ) : t ? (
                      <>
                        <b>{formatPrice(t)} ₽</b>
                        <span className="card__per"> за {period} мес</span>
                      </>
                    ) : (
                      <>
                        <b>{formatPrice(m!)} ₽</b>
                        <span className="card__per"> за месяц</span>
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
          */}
          <button type="button" className="btn btn--wide" disabled aria-describedby={noteId}>
            {total
              ? `Оформить за ${formatPrice(total)} ₽`
              : monthOnly
                ? `Оформить на месяц за ${formatPrice(monthOnly)} ₽`
                : 'Оформить'}
          </button>

          {total ? (
            <p className="order__unit tnum">
              {formatPrice(perMonth(total, period))} ₽ в месяц
              {plan.people > 1
                ? ` · ${formatPrice(Math.round(total / period / plan.people))} ₽ на человека`
                : ''}
            </p>
          ) : (
            <p className="order__unit">{plan.note}</p>
          )}
        </div>

        <p id={noteId} className="plans__note rv">
          Итоговая сумма к оплате показывается до перехода к оплате. Сама оплата появится
          на следующем этапе разработки, поэтому кнопка оформления пока выключена.
        </p>
      </div>
    </section>
  );
}

'use client';

import { useId, useState } from 'react';
import SectionHead from './SectionHead';
import SceneSlot from '@/components/three/SceneSlot';
import { PERIODS, PLANS, formatPrice, perMonth, savings, type PeriodKey } from '@/lib/plans';

/**
 * БЛОК ТАРИФОВ — ОБЪЁМНЫЕ КАРТОЧКИ.
 *
 * Разворот ряда (Р-49) снят арт-директором целиком: приём не зашёл.
 * Вместо него четыре карточки, и каждая несёт свой объёмный предмет —
 * отрезок звуковой дорожки, рядов столько, на скольких человек тариф;
 * у сертификата плита с зелёным торцом. Геометрия не абстрактная:
 * это тот же материал страницы, что нумерация и огибающая в хиро.
 *
 * ── ЧТО СТОИТ КАРТОЧКА ────────────────────────────────────────────────────
 * Все четыре слота делят ОДИН WebGL-контекст, и он поднимается только
 * когда блок подходит к кадру. Компиляция программы идёт ТАМ ЖЕ, пока
 * блок ещё за кадром, а сама программа крошечная: света в сцене нет,
 * объём запечён в вершинные цвета (Р-54). Из-за этого объём работает
 * и на касаниях — там он медленно вращается сам, и крутятся только
 * карточки, которые сейчас на экране.
 *
 * ── НАКЛОН ────────────────────────────────────────────────────────────────
 * На точном указателе карточка наклоняется под курсор, а предмет внутри
 * доворачивается в сцене. Карточку двигает CSS по двум переменным —
 * это компоновщик, — и ни то, ни другое не проходит через React:
 * слушатели живут в слоте и пишут прямо в стиль. См. SceneSlot.
 *
 * Состояния интерфейса прежние: выбор срока и выбор типа аккаунта.
 * Обе группы — настоящие radiogroup со стрелками на клавиатуре
 * и aria-checked, а не крашеные div.
 */
export default function Pricing() {
  const [period, setPeriod] = useState<PeriodKey>(12);
  const [account, setAccount] = useState<Record<string, 'new' | 'renew'>>({});
  const statusId = useId();
  const noteId = useId();

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
    group.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  };

  const announce = (() => {
    const p = PERIODS.find((x) => x.key === period)!;
    // про тариф без цены на этот срок тоже надо сказать: иначе он просто
    // пропадает из объявления, и человек не понимает, куда он делся
    const parts = PLANS.map((pl) =>
      pl.pending
        ? `${pl.name} — ${pl.pending}`
        : pl.prices[period]
          ? `${pl.name} — ${formatPrice(pl.prices[period]!)} рублей`
          : `${pl.name} — на этот срок не оформляется`,
    );
    return `${p.label}: ${parts.join(', ')}`;
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

        <div className="cards">
          {PLANS.map((plan, i) => {
            const total = plan.prices[period];
            const unavailable = !plan.pending && !total;
            const acc = account[plan.id] ?? 'new';
            const save = total ? savings(plan, period) : 0;

            return (
              <div key={plan.id} className="card-wrap rv" style={{ ['--rv-d' as string]: `${i * 80}ms` }}>
                {/* data-tilt — точка, за которую слот берёт наклон: целиться
                    в маленький слот было бы неверно, наклоняется карточка. */}
                <article className="card" data-tilt data-hot={plan.hot ? '1' : undefined}>
                  <SceneSlot
                    kind={plan.gift ? 'gift' : 'card'}
                    seed={plan.gift ? 7 : plan.people}
                    label={`Тариф «${plan.name}» в объёме`}
                    className="card__slot"
                  />

                  <div className="card__body">
                    <h3 className="card__name">{plan.name}</h3>

                    <p className="card__price tnum">
                      {plan.pending ? (
                        <em>{plan.pending}</em>
                      ) : unavailable ? (
                        <>
                          <b>{formatPrice(plan.prices[1]!)} ₽</b>
                          <span> за месяц · другие сроки по запросу</span>
                        </>
                      ) : (
                        <>
                          <b>{formatPrice(total!)} ₽</b>
                          <span>
                            {' '}
                            за {period} мес · {formatPrice(perMonth(total!, period))} ₽ в месяц
                            {plan.people > 1
                              ? ` · ${formatPrice(Math.round(total! / period / plan.people))} ₽ на человека`
                              : ''}
                          </span>
                        </>
                      )}
                    </p>

                    {save > 0 ? (
                      <p className="card__save tnum">Экономия {formatPrice(save)} ₽</p>
                    ) : null}

                    <p className="card__note">{plan.note}</p>

                    <div className="card__foot">
                      {plan.gift ? (
                        /* У сертификата выбора аккаунта нет: его делает
                           не тот, кто платит, а тот, кому дарят. */
                        <p className="card__gift">{plan.gift}</p>
                      ) : (
                        <div
                          role="radiogroup"
                          aria-label={`Аккаунт для тарифа «${plan.name}»`}
                          className="card__opts"
                          onKeyDown={(e) =>
                            rove(e, 2, acc === 'new' ? 0 : 1, (i2) =>
                              setAccount((st) => ({
                                ...st,
                                [plan.id]: i2 === 0 ? 'new' : 'renew',
                              })),
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
                        фокусируется, объявляется кнопкой и молча ничего
                        не делает, хуже честно выключенной: человек решает,
                        что сайт сломан.
                      */}
                      <button
                        type="button"
                        className={`btn btn--sm btn--wide${plan.hot ? '' : ' btn--ghost'}`}
                        disabled
                        aria-describedby={noteId}
                      >
                        Оформить{unavailable ? ' на месяц' : ''}
                      </button>
                    </div>
                  </div>
                </article>
              </div>
            );
          })}
        </div>

        <p id={noteId} className="plans__note rv">
          Итоговая сумма к оплате показывается до перехода к оплате. Сама оплата появится
          на следующем этапе разработки, поэтому кнопки оформления пока выключены.
        </p>
      </div>
    </section>
  );
}

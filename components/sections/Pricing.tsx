'use client';

import { useId, useState } from 'react';
import SectionHead from './SectionHead';
import { PERIODS, PLANS, formatPrice, perMonth, savings, type PeriodKey } from '@/lib/plans';

/**
 * БЛОК 2 — ТАРИФЫ. ПРИЁМ А: РЯДЫ.
 *
 * Тариф — это не карточка, а РЯД: название очень крупно по центру, почти
 * во всю ширину, а всё остальное — мелкие строки-подписи над ним и под ним.
 * Ряды разделены линиями от края до края, и это тот же ритм дорожки, что
 * и нумерация треков.
 *
 * 3D-СЛОТА ЗДЕСЬ БОЛЬШЕ НЕТ. Объём остался только в блоке 5: три сцены
 * в блоке тарифов спорили с крупным набором, а на касаниях именно они
 * рвали скролл на подходе сюда (CLAUDE.md, Р-34).
 *
 * Состояния интерфейса сохранены полностью: выбор срока и выбор типа
 * аккаунта у каждого тарифа. Семантика нативная — обе группы это
 * role="radiogroup" с настоящими role="radio", стрелками на клавиатуре
 * и видимым фокусом. Выбор помечен не одним цветом: кружок заливается,
 * начертание тяжелеет, и стоит aria-checked.
 *
 * Место под цену зарезервировано (min-height у .row__sub): смена срока
 * не должна дёргать ряд. Цифры табличные, разряды разделены. Смена срока
 * объявляется целой фразой в role="status", без переноса фокуса.
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

  const onSegKey = (e: React.KeyboardEvent) =>
    rove(
      e,
      PERIODS.length,
      PERIODS.findIndex((p) => p.key === period),
      (i) => setPeriod(PERIODS[i].key),
    );

  const announce = (() => {
    const p = PERIODS.find((x) => x.key === period)!;
    // про тариф без цены на этот срок тоже надо сказать: иначе он просто
    // пропадает из объявления, и человек не понимает, куда он делся
    const parts = PLANS.map((pl) =>
      pl.prices[period]
        ? `${pl.name} — ${formatPrice(pl.prices[period]!)} рублей`
        : `${pl.name} — на этот срок не оформляется`,
    );
    return `${p.label}: ${parts.join(', ')}`;
  })();

  return (
    <section id="pricing" className="section">
      <div className="shell">
        <SectionHead
          num="02"
          kicker="Тарифы"
          title="Выберите срок и тариф"
          lead="Цена фиксируется в момент оформления. Чем длиннее срок, тем дешевле месяц."
          meta="3 тарифа · 4 срока · от 224 ₽ в месяц"
          quiet
          center
        />

        <div
          className="seg seg--center rv"
          role="radiogroup"
          aria-label="Срок подписки"
          onKeyDown={onSegKey}
          style={{ marginBottom: 'clamp(28px, 4vw, 44px)' }}
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
      </div>

      <div className="rows">
        {PLANS.map((plan, i) => {
          const total = plan.prices[period];
          const unavailable = !total;
          const acc = account[plan.id] ?? 'new';
          const save = total ? savings(plan, period) : 0;

          return (
            <article key={plan.id} className="row row--plan">
              <div className="row__in shell rv" style={{ ['--rv-d' as string]: `${i * 90}ms` }}>
                <p className="row__cap">
                  <span className="row__n tnum">{String(i + 1).padStart(2, '0')}</span>
                  <span>{plan.note}</span>
                  {plan.hot ? <span className="row__hot">Выгоднее всего</span> : null}
                </p>

                <h3 className="row__t">{plan.name}</h3>

                <p className="row__sub tnum" style={{ minHeight: '3em' }}>
                  {unavailable ? (
                    <>
                      Только на месяц
                      {plan.prices[1] ? ` — ${formatPrice(plan.prices[1])} ₽ за 30 дней` : ''}.
                      <br />
                      Другие сроки оформляем по запросу.
                    </>
                  ) : (
                    <>
                      {formatPrice(total)} ₽ за {period} мес · {formatPrice(perMonth(total, period))} ₽
                      в месяц
                      {plan.people > 1
                        ? ` · ${formatPrice(Math.round(total / period / plan.people))} ₽ на человека`
                        : ''}
                      <br />
                      {save > 0 ? (
                        <b>Экономия {formatPrice(save)} ₽ против помесячной оплаты</b>
                      ) : (
                        <span className="sr-only">Помесячная оплата</span>
                      )}
                    </>
                  )}
                </p>

                <fieldset className="row__ctl" style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend className="sr-only">Аккаунт для тарифа «{plan.name}»</legend>
                  <div
                    role="radiogroup"
                    aria-label={`Аккаунт для тарифа «${plan.name}»`}
                    style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center' }}
                    onKeyDown={(e) =>
                      rove(e, 2, acc === 'new' ? 0 : 1, (i2) =>
                        setAccount((st) => ({ ...st, [plan.id]: i2 === 0 ? 'new' : 'renew' })),
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

                  {/*
                    Оплата — следующий этап разработки. Кнопка, которая
                    фокусируется, объявляется кнопкой и молча ничего
                    не делает, хуже честно выключенной: человек решает,
                    что сайт сломан.
                  */}
                  <button
                    type="button"
                    className={`btn btn--sm${plan.hot ? '' : ' btn--ghost'}`}
                    disabled
                    aria-describedby={noteId}
                  >
                    Оформить{unavailable ? ' на месяц' : ''}
                  </button>
                </fieldset>
              </div>
            </article>
          );
        })}
      </div>

      <div className="shell">
        <p
          id={noteId}
          className="body-text rv"
          style={{ marginTop: 'clamp(24px, 3vw, 36px)', fontSize: 13, textAlign: 'center' }}
        >
          Итоговая сумма к оплате показывается до перехода к оплате. Сама оплата появится
          на следующем этапе разработки, поэтому кнопки оформления пока выключены.
        </p>
      </div>
    </section>
  );
}

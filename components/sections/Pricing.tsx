'use client';

import { useId, useRef, useState } from 'react';
import SectionHead from './SectionHead';
import SceneSlot from '@/components/three/SceneSlot';
import { PERIODS, PLANS, formatPrice, perMonth, savings, type PeriodKey } from '@/lib/plans';

/**
 * БЛОК 2 — ТАРИФЫ.
 *
 * Собственной анимации здесь нет: она в следующей итерации. Есть только
 * состояния интерфейса — выбор срока и выбор типа аккаунта.
 *
 * Семантика выбора нативная: обе группы это role="radiogroup" с настоящими
 * role="radio" и aria-checked, со стрелками на клавиатуре и видимым фокусом.
 * Выбранное состояние помечено не только зелёной заливкой, но и текстом
 * и aria-checked — цветом одним помечать нельзя.
 *
 * Место под цену зарезервировано (min-height у .plan__price): смена срока
 * не должна дёргать карточку. Цифры табличные, разряды разделены.
 * Смена срока объявляется целой фразой в role="status", без переноса фокуса.
 */
export default function Pricing() {
  const [period, setPeriod] = useState<PeriodKey>(12);
  const [account, setAccount] = useState<Record<string, 'new' | 'renew'>>({});
  const segRef = useRef<HTMLDivElement>(null);
  const statusId = useId();
  const noteId = useId();

  /**
   * Стрелки внутри radiogroup. Без них roving tabindex делает только хуже:
   * в группу можно войти табом, а переключить выбор уже нечем.
   */
  const rove = (e: React.KeyboardEvent, count: number, current: number, apply: (i: number) => void) => {
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
    rove(e, PERIODS.length, PERIODS.findIndex((p) => p.key === period), (i) => setPeriod(PERIODS[i].key));

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
        />

        <div
          ref={segRef}
          className="seg"
          role="radiogroup"
          aria-label="Срок подписки"
          onKeyDown={onSegKey}
          style={{ marginBottom: 28 }}
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

        <div className="plans">
          {PLANS.map((plan) => {
            const total = plan.prices[period];
            const unavailable = !total;
            const acc = account[plan.id] ?? 'new';
            const save = total ? savings(plan, period) : 0;

            return (
              <article key={plan.id} className={`plan${plan.hot ? ' plan--hot' : ''}`}>
                <div className="plan__top">
                  <div>
                    <h3 className="h-card">{plan.name}</h3>
                    <p className="body-text" style={{ fontSize: 14, marginTop: 8, maxWidth: '30ch' }}>
                      {plan.note}
                    </p>
                  </div>
                  {plan.hot ? <span className="plan__badge">Выгоднее всего</span> : null}
                </div>

                {/*
                  Слот под 3D-объект карточки. В этой итерации сцена только
                  создаётся и рисует один кадр; анимация — во второй.
                */}
                <SceneSlot kind="card" seed={plan.people} label={`Объём тарифа «${plan.name}»`} />

                <div className="plan__price">
                  {unavailable ? (
                    <>
                      <p className="plan__sum" style={{ fontSize: '1.75rem' }}>
                        Только на месяц
                      </p>
                      <p className="plan__per">
                        {plan.prices[1]
                          ? `${formatPrice(plan.prices[1])} \u20BD за 30 дней. `
                          : ''}
                        Другие сроки оформляем по запросу.
                      </p>
                      <p className="plan__save" />
                    </>
                  ) : (
                    <>
                      <p className="plan__sum tnum">
                        {formatPrice(total)} ₽<span>за {period} мес</span>
                      </p>
                      <p className="plan__per tnum">
                        {formatPrice(perMonth(total, period))} ₽ в месяц
                        {plan.people > 1 ? ` · ${formatPrice(Math.round(total / period / plan.people))} ₽ на человека` : ''}
                      </p>
                      <p className="plan__save tnum">
                        {save > 0 ? `Экономия ${formatPrice(save)} ₽ против помесячной оплаты` : ' '}
                      </p>
                    </>
                  )}
                </div>

                <fieldset
                  className="plan__choice"
                  style={{ border: 0, padding: 0, margin: 0 }}
                >
                  <legend>Аккаунт</legend>
                  <div
                    role="radiogroup"
                    aria-label={`Аккаунт для тарифа «${plan.name}»`}
                    style={{ display: 'grid', gap: 8 }}
                    onKeyDown={(e) =>
                      rove(e, 2, acc === 'new' ? 0 : 1, (i) =>
                        setAccount((st) => ({ ...st, [plan.id]: i === 0 ? 'new' : 'renew' })),
                      )
                    }
                  >
                    {(
                      [
                        ['new', 'Новый аккаунт', 'Заведём и передадим логин с паролем'],
                        ['renew', 'Продлить существующий', 'Оставите свою фонотеку и плейлисты'],
                      ] as const
                    ).map(([key, title, hint]) => (
                      <button
                        key={key}
                        type="button"
                        role="radio"
                        aria-checked={acc === key}
                        tabIndex={acc === key ? 0 : -1}
                        className="plan__opt"
                        onClick={() => setAccount((s) => ({ ...s, [plan.id]: key }))}
                      >
                        <span>
                          {title}
                          <span style={{ display: 'block', fontSize: 12, color: 'var(--dim-2)' }} aria-hidden="true">
                            {hint}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </fieldset>

                {/*
                  Оплата — следующий этап разработки. Кнопка, которая
                  фокусируется, объявляется кнопкой и молча ничего не делает,
                  хуже честно выключенной: человек решает, что сайт сломан.
                */}
                <button
                  type="button"
                  className={`btn${plan.hot ? '' : ' btn--ghost'}`}
                  style={{ marginTop: 'auto' }}
                  disabled
                  aria-describedby={noteId}
                >
                  Оформить{unavailable ? ' на месяц' : ''}
                </button>
              </article>
            );
          })}
        </div>

        <p id={noteId} className="body-text" style={{ marginTop: 24, fontSize: 13 }}>
          Итоговая сумма к оплате показывается до перехода к оплате. Сама оплата появится
          на следующем этапе разработки, поэтому кнопки оформления пока выключены.
        </p>
      </div>
    </section>
  );
}

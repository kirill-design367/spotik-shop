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

  /** Стрелки внутри radiogroup — требование клавиатурной семантики. */
  const onSegKey = (e: React.KeyboardEvent) => {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const i = PERIODS.findIndex((p) => p.key === period);
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    const next = PERIODS[(i + dir + PERIODS.length) % PERIODS.length];
    setPeriod(next.key);
    const btns = segRef.current?.querySelectorAll<HTMLButtonElement>('.seg__btn');
    btns?.[PERIODS.findIndex((p) => p.key === next.key)]?.focus();
  };

  const announce = (() => {
    const p = PERIODS.find((x) => x.key === period)!;
    const parts = PLANS.filter((pl) => pl.prices[period]).map(
      (pl) => `${pl.name} — ${formatPrice(pl.prices[period]!)} рублей`,
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
                        {formatPrice(plan.prices[1]!)} ₽ за 30 дней. Другие сроки оформляем по запросу.
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
                  <div role="radiogroup" aria-label={`Аккаунт для тарифа «${plan.name}»`} style={{ display: 'grid', gap: 8 }}>
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

                <button type="button" className={`btn${plan.hot ? '' : ' btn--ghost'}`} style={{ marginTop: 'auto' }}>
                  Оформить{unavailable ? ' на месяц' : ''}
                </button>
              </article>
            );
          })}
        </div>

        <p className="body-text" style={{ marginTop: 24, fontSize: 13 }}>
          Итоговая сумма к оплате показывается до перехода к оплате. Оплата появится на следующем этапе разработки.
        </p>
      </div>
    </section>
  );
}

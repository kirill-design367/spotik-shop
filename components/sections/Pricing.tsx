'use client';

import { useId, useRef, useState } from 'react';
import SectionHead from './SectionHead';
import Marquee from '@/components/mid/Marquee';
import {
  PERIODS,
  PERKS,
  PLANS,
  formatPrice,
  perMonth,
  savings,
  type PeriodKey,
} from '@/lib/plans';

/**
 * БЛОК 2 — ТАРИФЫ. ПРИЁМ: РАЗВОРОТ РЯДА.
 *
 * В покое четыре ряда стоят друг под другом и делят высоту блока поровну:
 * видно только название и цену за выбранный срок. Наведёшь (на касаниях —
 * тронешь) — ряд разворачивается и забирает бо́льшую часть высоты, три
 * остальных сжимаются и уступают. Внутри развёрнутого появляется то, чего
 * в покое не было: крупная цена, выбор аккаунта и кнопка.
 *
 * ── ДВИЖЕНИЕ ТОЛЬКО ТРАНСФОРМАМИ, БЕЗ ЕДИНОГО ПЕРЕСЧЁТА РАСКЛАДКИ ──────────
 * Ряды лежат АБСОЛЮТНО и наложены друг на друга: каждый ростом с полностью
 * развёрнутый, у каждого непрозрачный фон, и нижнюю часть соседа закрывает
 * следующий ряд. Видимая высота полосы — это расстояние до верха
 * следующего ряда, то есть чистая разность трансформов. Менять высоты
 * не нужно вовсе: двигается только `translate3d`, а его считает
 * компоновщик.
 *
 * Величины заданы ДОЛЯМИ высоты блока и приходят в CSS одним числом `--k`.
 * Ни одного чтения геометрии из JS здесь нет — ни при монтировании,
 * ни в кадре: сама анимация идёт переходом CSS.
 *
 *     в покое        0 · 0.25 · 0.50 · 0.75
 *     развёрнут i    ряды до него по 0.16, он сам 0.52, дальше снова 0.16
 *
 * ── ПОЧЕМУ РЯД РАЗВОРАЧИВАЕТСЯ И ПО ФОКУСУ, И ПО КЛИКУ, И ЭТО НЕ ДЕРЁТСЯ ───
 * Тап по экрану — это pointerdown → focus → click. Если и фокус, и клик
 * будут переключать состояние, тап откроет ряд и тут же его закроет.
 * Поэтому фокус ВЗВОДИТ защёлку: клик, пришедший сразу за открывающим
 * фокусом, её снимает и ничего не делает. Второй клик по тому же ряду
 * сворачивает — как и обязан вести себя раскрывающий элемент.
 */
const COLLAPSED = 0.16;
const OPEN = 1 - COLLAPSED * 3;

/** Смещения рядов долями высоты блока. Чистая арифметика, без геометрии. */
function offsets(open: number | null): number[] {
  const out: number[] = [];
  let y = 0;
  for (let i = 0; i < PLANS.length; i += 1) {
    out.push(y);
    y += open === null ? 1 / PLANS.length : i === open ? OPEN : COLLAPSED;
  }
  return out;
}

export default function Pricing() {
  const [period, setPeriod] = useState<PeriodKey>(12);
  const [account, setAccount] = useState<Record<string, 'new' | 'renew'>>({});
  const [open, setOpen] = useState<number | null>(null);
  const statusId = useId();
  const noteId = useId();
  const base = useId();
  const armed = useRef(false);

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
      pl.pending
        ? `${pl.name} — ${pl.pending}`
        : pl.prices[period]
          ? `${pl.name} — ${formatPrice(pl.prices[period]!)} рублей`
          : `${pl.name} — на этот срок не оформляется`,
    );
    return `${p.label}: ${parts.join(', ')}`;
  })();

  /* Разворот фокусом взводит защёлку — иначе идущий следом клик того же
     тапа немедленно свернул бы ряд обратно. */
  const expand = (i: number) => {
    if (open === i) return;
    armed.current = true;
    setOpen(i);
  };
  const toggle = (i: number) => {
    if (armed.current) {
      armed.current = false;
      return;
    }
    setOpen(open === i ? null : i);
  };
  /* Наведение — только мышью: у касания «наведение» приходит тем же
     событием, что и тап, и ряд разворачивался бы дважды. */
  const hover = (i: number, e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    armed.current = false;
    setOpen(i);
  };

  const ks = offsets(open);

  return (
    <section id="pricing" className="section section--plans">
      <div className="shell">
        <SectionHead
          num="02"
          kicker="Тарифы"
          title="Выберите срок и тариф"
          lead="Цена фиксируется в момент оформления. Чем длиннее срок, тем дешевле месяц."
          meta="4 тарифа · 4 срока · от 224 ₽ в месяц"
          quiet
          center
        />

        <div
          className="seg seg--center rv"
          role="radiogroup"
          aria-label="Срок подписки"
          onKeyDown={onSegKey}
          style={{ marginBottom: 'clamp(24px, 3.4vw, 40px)' }}
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

      {/* ВНИМАНИЕ: ни на .plans, ни на её предках не должно быть анимации
          на opacity. Такой элемент становится backdrop root, и фон под
          слоем бегущей строки окажется пустым — строка просто пропадёт,
          а цветовой сторож этого не увидит. См. Р-47. */}
      <div
        className="plans"
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') setOpen(null);
        }}
      >
        {PLANS.map((plan, i) => {
          const total = plan.prices[period];
          const unavailable = !plan.pending && !total;
          const acc = account[plan.id] ?? 'new';
          const save = total ? savings(plan, period) : 0;
          const isOpen = open === i;
          const bodyId = `${base}-b-${i}`;

          return (
            <article
              key={plan.id}
              className="plan"
              data-open={isOpen ? '1' : undefined}
              style={{ ['--k' as string]: ks[i] }}
              onPointerEnter={(e) => hover(i, e)}
            >
              <div className="plan__in shell">
                <button
                  type="button"
                  className="plan__head"
                  aria-expanded={isOpen}
                  aria-controls={bodyId}
                  onFocus={() => expand(i)}
                  onClick={() => toggle(i)}
                >
                  <span className="plan__name">{plan.name}</span>
                  <span className="plan__tag tnum">
                    {plan.pending
                      ? plan.pending
                      : unavailable
                        ? `только на месяц · ${formatPrice(plan.prices[1]!)} ₽`
                        : `${formatPrice(total!)} ₽ за ${period} мес`}
                    {plan.hot ? <b className="plan__hot">Выгоднее всего</b> : null}
                  </span>
                </button>

                <div className="plan__body" id={bodyId} inert={!isOpen}>
                  <p className="plan__price tnum">
                    {plan.pending ? (
                      <em>Цена появится вместе с оплатой</em>
                    ) : unavailable ? (
                      <>
                        <b>{formatPrice(plan.prices[1]!)} ₽</b> за 30 дней · другие сроки по запросу
                      </>
                    ) : (
                      <>
                        <b>{formatPrice(perMonth(total!, period))} ₽</b> в месяц
                        {plan.people > 1
                          ? ` · ${formatPrice(Math.round(total! / period / plan.people))} ₽ на человека`
                          : ''}
                        {save > 0 ? ` · экономия ${formatPrice(save)} ₽` : ''}
                      </>
                    )}
                  </p>

                  <p className="plan__note">{plan.note}</p>

                  {plan.gift ? (
                    /* У сертификата выбора аккаунта нет: его делает не тот,
                       кто платит, а тот, кому дарят. */
                    <p className="plan__gift">{plan.gift}</p>
                  ) : (
                    <div
                      role="radiogroup"
                      aria-label={`Аккаунт для тарифа «${plan.name}»`}
                      className="plan__opts"
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
                  )}

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
                </div>
              </div>
            </article>
          );
        })}

        {/* Строка идёт ПОВЕРХ рядов и частично перекрывает их чернила. */}
        <Marquee items={PERKS} />
      </div>

      <div className="shell">
        <p id={noteId} className="plans__note rv">
          Итоговая сумма к оплате показывается до перехода к оплате. Сама оплата появится
          на следующем этапе разработки, поэтому кнопки оформления пока выключены.
        </p>
      </div>
    </section>
  );
}

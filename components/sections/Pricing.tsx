'use client';

import { useEffect, useId, useRef, useState } from 'react';
import SectionHead from './SectionHead';
import { attachCards } from '@/lib/cards';
import { DARIMYE, PERIODS, PLANS, formatPrice, savings, type Plan, type PeriodKey } from '@/lib/plans';

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
 *
 * ── СЕРТИФИКАТ НА ЛЮБОЙ ТАРИФ (Р-93) ─────────────────────────────────────
 * ⚠️ У КАРТОЧКИ СЕРТИФИКАТА СВОЕЙ ЦЕНЫ НЕТ ВОВСЕ. Она показывает цену
 * ТОГО тарифа, который выбран в подарок, и меняется вместе с ним —
 * ровно как остальные карточки меняются вместе со сроком. Под сеткой
 * на её месте встаёт выбор «на одного / на двоих / на троих»;
 * ограничения те же, что у тарифов, потому что это те же тарифы
 * («на троих» — только месяц).
 */
export default function Pricing({ ceny }: { ceny?: CenyTarifov }) {
  const plans: Plan[] = ceny ? PLANS.map((p) => (ceny[p.id] ? { ...p, prices: ceny[p.id]! } : p)) : PLANS;
  const [period, setPeriod] = useState<PeriodKey>(12);
  const [planId, setPlanId] = useState<string>(PLANS[0].id);
  const [account, setAccount] = useState<Record<string, 'new' | 'renew'>>({});
  /** Какой тариф дарим. Собственной цены у сертификата нет (Р-93). */
  const [giftId, setGiftId] = useState<string>(DARIMYE[0].id);
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

  const darimye = plans.filter((p) => !p.gift);
  const vybran = plans.find((p) => p.id === planId) ?? plans[0];
  /* У сертификата цена и экономия берутся у ПОДАРЕННОГО тарифа:
     карточка сертификата своих цен не несёт вовсе. */
  const dar = darimye.find((p) => p.id === giftId) ?? darimye[0];
  const plan = vybran.gift ? dar : vybran;
  const total = plan.prices[period];
  const monthOnly = !total ? plan.prices[1] : undefined;
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
    const price = total
      ? `${formatPrice(total)} рублей`
      : monthOnly
        ? `${formatPrice(monthOnly)} рублей за месяц, другие сроки по запросу`
        : 'на этот срок не оформляется';
    const chto = vybran.gift ? `сертификат на тариф «${plan.name}»` : `тариф «${plan.name}»`;
    return `${p.label}, ${chto}: ${price}`;
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
            /* ⚠️ КАРТОЧКА СЕРТИФИКАТА ПОКАЗЫВАЕТ ЦЕНУ ПОДАРЕННОГО
               ТАРИФА: своей у неё нет вовсе (Р-93). */
            const ist = p.gift ? dar : p;
            const t = ist.prices[period];
            const m = !t ? ist.prices[1] : undefined;
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
                    {t ? (
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
            <b>{vybran.gift ? `${vybran.name} · ${plan.name}` : plan.name}</b>
            {save > 0 ? <span className="order__save tnum">экономия {formatPrice(save)} ₽</span> : null}
          </p>

          {vybran.gift ? (
            /* ⚠️ У СЕРТИФИКАТА ЗДЕСЬ ВЫБОР ТАРИФА, А НЕ АККАУНТА (Р-93).
               Аккаунт выбирает не тот, кто платит, а тот, кому дарят, —
               при активации кода. А вот НА ЧТО дарят, решает покупатель,
               и решает он это тем же способом, что и всё остальное
               в этом блоке: карточка сроков сверху, тариф здесь. */
            <>
              <div
                role="radiogroup"
                aria-label="Тариф в подарок"
                className="order__opts"
                onKeyDown={(e) =>
                  rove(
                    e,
                    darimye.length,
                    darimye.findIndex((p) => p.id === dar.id),
                    (i) => setGiftId(darimye[i].id),
                  )
                }
              >
                {darimye.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={dar.id === p.id}
                    tabIndex={dar.id === p.id ? 0 : -1}
                    className="row__opt"
                    onClick={() => setGiftId(p.id)}
                  >
                    {p.short ?? p.name}
                  </button>
                ))}
              </div>
              <p className="order__gift">{vybran.gift}</p>
            </>
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
            /* ⚠️ В АДРЕС УЕЗЖАЕТ НАСТОЯЩИЙ ТАРИФ, а сертификат — отдельным
               признаком `gift=1`. Отдельного тарифа `gift` больше нет
               ни в каталоге, ни в заказе (Р-93). */
            <a
              className="btn btn--wide"
              href={`/checkout/?plan=${plan.id}&period=${total ? period : 1}${vybran.gift ? '&gift=1' : `&mode=${acc}`}`}
            >
              {vybran.gift
                ? total
                  ? `Подарить за ${formatPrice(total)} ₽`
                  : `Подарить на месяц за ${formatPrice(monthOnly!)} ₽`
                : total
                  ? `Оформить за ${formatPrice(total)} ₽`
                  : `Оформить на месяц за ${formatPrice(monthOnly!)} ₽`}
            </a>
          ) : (
            <button type="button" className="btn btn--wide" disabled>
              Оформить · на этот срок не оформляется
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

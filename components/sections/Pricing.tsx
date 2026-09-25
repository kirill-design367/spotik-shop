'use client';

import { useEffect, useId, useRef, useState } from 'react';
import SectionHead from './SectionHead';
import { attachCards } from '@/lib/cards';
import { DARIMYE, PERIODS, formatPrice, savings, type Plan, type PeriodKey } from '@/lib/plans';

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
 * Старая цена и дата окончания скидки.
 *
 * ⚠️ ОТДЕЛЬНО ОТ ЦЕН, И ЭТО НЕ УДОБСТВО. В `ceny` лежит цена,
 * по которой платят; сложи мы их в одну структуру — каждому
 * вычислению (экономия, надпись кнопки) пришлось бы выбирать, какое
 * из двух чисел брать, и однажды кто-нибудь выбрал бы не то. Здесь
 * лежит ровно то, что рисуется зачёркнутым.
 */
export type SkidkiTarifov = Record<string, Partial<Record<PeriodKey, { bylo: number; doDaty: string }>>>;

/**
 * БЛОК ТАРИФОВ — КАРТЫ ПО ЧИСЛУ ВКЛЮЧЁННЫХ ТАРИФОВ.
 *
 * ⚠️ СЕТКИ 2×2 БОЛЬШЕ НЕТ, И СЕРТИФИКАТА В НЕЙ ТОЖЕ (тридцать шестая
 * итерация). Четвёртой карточкой стоял «Сертификат», и держалась сетка
 * ровно на нём: тарифов трое. Сертификат уехал на свою страницу
 * `/sertifikaty/`, и карточек стало столько, сколько тарифов включено
 * в админке — сейчас три, завтра может быть два. Поэтому сетка теперь
 * НЕ ЗАДАЁТ ЧИСЛО ЯЧЕЕК ВОВСЕ: на десктопе карты идут одним рядом
 * (`grid-auto-flow: column`), на телефоне — столбиком, и это ДРУГАЯ
 * карта: широкая и низкая, название слева, цена справа.
 *
 * ⚠️ СВЕТ ЗА КАРТОЙ ПЕРЕЕХАЛ В ОБЁРТКУ, И ЭТО СЛЕДСТВИЕ ТОГО ЖЕ.
 * Раньше слой света был СОСЕДОМ карты в самой сетке, а его ячейка
 * задавалась явными линиями `grid-area` по номеру — при переменном
 * числе карт и двух раскладках таких правил понадобилось бы вдвое
 * больше, и каждое пришлось бы чинить при добавлении тарифа. Теперь
 * ячейку сетки занимает обёртка `.cards__slot`, а свет лежит в ней
 * абсолютом. Запрет Р-68 при этом цел: обёртка НЕ СОЗДАЁТ контекста
 * наложения (ни `isolation`, ни `z-index`, ни трансформа), поэтому
 * все слои света по-прежнему рисуются слоем 0, а все карты слоем 1,
 * и свет соседа не может лечь поверх чужой карты.
 *
 *     .cards
 *       .cards__slot     — ячейка сетки, ничего не рисует
 *         span.cards__glow — размытый свет ЗА картой, слоем 0
 *         .card            — наклон в перспективе сетки, слой 1
 *           .card__edge    — кайма в один пиксель; у выбранной она
 *                            зелёная, и по ней идёт перелив
 *           .card__plate   — ровная тёмная поверхность
 *           .card__face    — название и цена, обычный HTML
 *
 * Наклон с пружинной доводкой, дыхание в покое и подъём выбранной
 * ведёт `lib/cards.ts`. Решение — Р-74.
 *
 * ── БЕЗ СКРИПТА И ПРИ «УМЕНЬШИТЬ ДВИЖЕНИЕ» ────────────────────────────────
 * Карта полностью нарисована CSS: без JS она просто стоит ровно.
 * Прятать нечего и подменять нечем.
 *
 * ── ВЫБОР КАРТОЧКИ ВЕДЁТ ОБЛАСТЬ ПОД СЕТКОЙ ───────────────────────────────
 * Карточки — настоящий radiogroup со стрелками на клавиатуре
 * и `aria-checked`. Под сеткой стоит выбор аккаунта и кнопка с ценой
 * ВЫБРАННОЙ карточки.
 *
 * Почему управление снаружи, а не в каждой карточке: три одинаковых
 * набора кнопок и три кнопки «Оформить» — это три призыва к действию
 * в одном кадре. Приём карточек держится на том, что они лаконичные,
 * и первое же управление внутри это ломает.
 *
 * ── СРОК ПО УМОЛЧАНИЮ — МЕСЯЦ ─────────────────────────────────────────────
 * ⚠️ БЫЛ ГОД, И ЭТО ПРАВКА ПОСТАНОВКИ. Страница открывается на самом
 * коротком сроке: человек сначала видит цену входа, а уже потом
 * выбирает срок подлиннее и видит, сколько экономит. Год по умолчанию
 * читался как «тут всё дорого».
 */
export default function Pricing({ ceny, skidki }: { ceny?: CenyTarifov; skidki?: SkidkiTarifov }) {
  /* ⚠️ ТАРИФ БЕЗ ЕДИНОЙ ЦЕНЫ В СЕТКУ НЕ ПОПАДАЕТ ВОВСЕ. Это и есть
     «столько карточек, сколько тарифов включено в админке»: выключают
     тариф там снятием всех его цен. Без этого условия карточка
     осталась бы на месте и показала бы пустую цену. */
  const vse: Plan[] = ceny ? DARIMYE.map((p) => (ceny[p.id] ? { ...p, prices: ceny[p.id]! } : p)) : DARIMYE;
  const plans: Plan[] = vse.filter((p) => Object.values(p.prices).some((v) => typeof v === 'number'));
  const [period, setPeriod] = useState<PeriodKey>(1);
  const [planId, setPlanId] = useState<string>(DARIMYE[0].id);
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
  /* Ни одного тарифа с ценой — показывать нечего, и выдумывать
     тоже нечего: сетка молчит. Случай угловой (так выглядит
     совсем пустой каталог), но он не имеет права падать. */
  if (!plan) return null;
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
          {plans.map((p) => {
            const t = p.prices[period];
            const m = !t ? p.prices[1] : undefined;
            const sk = skidki?.[p.id]?.[t ? period : 1];
            return (
              /* ⚠️ ОБЁРТКА НИЧЕГО НЕ РИСУЕТ И НЕ СОЗДАЁТ КОНТЕКСТА
                 НАЛОЖЕНИЯ. Ей нужна ровно одна вещь — `position:
                 relative`, чтобы свет внутри неё встал по кромке
                 карты. Дай ей `isolation` или `z-index` — и свет
                 соседа снова ляжет поверх чужой карты (Р-68). */
              <span key={p.id} className="cards__slot">
                <span className="cards__glow" aria-hidden="true" />
                <button
                  type="button"
                  role="radio"
                  aria-checked={planId === p.id}
                  tabIndex={planId === p.id ? 0 : -1}
                  className="card"
                  onClick={() => setPlanId(p.id)}
                >
                  {/* КАЙМА ИДЁТ ПЕРВОЙ, ПЛИТА ПОВЕРХ НЕЁ И НА ПИКСЕЛЬ УЖЕ:
                      видимой остаётся ровно рамка в один пиксель. Так кайму
                      рисует обычная заливка, а не маска — маска внутри карты
                      заставляла бы перерисовывать её целиком (Р-62). */}
                  <span className="card__edge" aria-hidden="true" />
                  <span className="card__plate" aria-hidden="true" />
                  <span className="card__face">
                    <span className="card__name">{p.short ?? p.name}</span>
                    <span className="card__price tnum">
                      {/* ⚠️ СТАРАЯ ЦЕНА СТОИТ НАД НОВОЙ И ЗАЧЁРКНУТА,
                          а срок скидки — рядом с новой. Иначе «до 30.09»
                          читается как срок тарифа, а не скидки. */}
                      {sk ? <s className="card__bylo">{formatPrice(sk.bylo)} ₽</s> : null}
                      {t ? (
                        <>
                          <b>{formatPrice(t)} ₽</b>
                          <span className="card__per">
                            за {period} мес{sk ? ` · до ${sk.doDaty}` : ''}
                          </span>
                        </>
                      ) : (
                        <>
                          <b>{formatPrice(m!)} ₽</b>
                          <span className="card__per">за месяц{sk ? ` · до ${sk.doDaty}` : ''}</span>
                        </>
                      )}
                    </span>
                  </span>
                </button>
              </span>
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

          {/* ⚠️ ВЫБОР АККАУНТА — ДВЕ КРУПНЫЕ ПЛАШКИ, А НЕ ДВА КРУЖКА
              (тридцать шестая итерация). Прежние радиокружки в 11 px
              рядом с мелкой подписью на телефоне не читались как выбор
              вовсе. Теперь это тот же элемент, что в оформлении заказа
              и при активации сертификата: выбранная — зелёная заливка,
              вторая — тёмная со светлой каймой.
              ⚠️ ФОРМА ЗДЕСЬ ПИЛЮЛЯ, А НЕ `--ui-r`, и это не расхождение
              с разделом, а закон 3: на лендинге скруглены только кнопка,
              плашка срока и карта, и плашка срока — пилюля. Третьего
              радиуса на лендинге не заводим. */}
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
                className="opt"
                onClick={() => setAccount((s) => ({ ...s, [plan.id]: key }))}
              >
                {title}
              </button>
            ))}
          </div>

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
              href={`/checkout/?plan=${plan.id}&period=${total ? period : 1}&mode=${acc}`}
            >
              {total
                ? `Оформить за ${formatPrice(total)} ₽`
                : `Оформить на месяц за ${formatPrice(monthOnly!)} ₽`}
            </a>
          ) : (
            <button type="button" className="btn btn--wide" disabled>
              Оформить · на этот срок не оформляется
            </button>
          )}

          {/* ⚠️ СЕРТИФИКАТ УШЁЛ ИЗ СЕТКИ, И ЗДЕСЬ ОСТАЁТСЯ ОДНА СТРОКА
              К НЕМУ. Совсем убрать её нельзя: сертификат — это те же
              тарифы, и человек, пришедший за подарком, обязан узнать
              о нём там, где выбирает тариф. */}
          <p className="order__gift">
            Любой тариф можно <a href="/sertifikaty/">купить в подарок</a> — сертификат
            стоит ровно столько же, а срок и число аккаунтов выбираете вы.
          </p>
        </div>
      </div>
    </section>
  );
}

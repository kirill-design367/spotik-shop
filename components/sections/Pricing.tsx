'use client';

import { useState } from 'react';
import SectionHead from './SectionHead';
import VyborTarifa, { type KartaTarifa } from '@/components/mid/VyborTarifa';
import { DARIMYE, PERIODS, formatPrice, type PeriodKey } from '@/lib/plans';

/**
 * ⚠️ СОСТАВ ТАРИФОВ ПО-ПРЕЖНЕМУ В `lib/plans.ts`, А ЦЕНЫ ПРИХОДЯТ
 * СВЕРХУ. Двадцать седьмая итерация перенесла цены в базу, где ими
 * управляет администратор; страница остаётся статической и получает
 * их при сборке кадра (см. `revalidate` в app/page.tsx). База
 * недоступна — приходит `undefined`, и работают прежние умолчания:
 * лендинг обязан собираться на раннере, где базы нет вовсе.
 *
 * ⚠️ В `ceny` ЛЕЖАТ ТОЛЬКО ТЕ СРОКИ, НА КОТОРЫЕ ТАРИФ ПРОДАЁТСЯ.
 * Выключенную в админке пару `katalog()` не отдаёт вовсе (Р-116),
 * значит «нет числа» здесь и значит «эта карта на этом сроке
 * не показывается».
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
 * в админке — сейчас три, завтра может быть два.
 *
 * ⚠️ САМИ ПЛАШКИ СРОКА И КАРТЫ ЖИВУТ В ОБЩЕМ КОМПОНЕНТЕ
 * `components/mid/VyborTarifa.tsx`: с тридцать девятой итерации тот же
 * выбор стоит на странице сертификатов, и второй копии карт у нас
 * быть не должно. Здесь остаётся ровно то, чего на сертификатах нет, —
 * область под сеткой: выбор аккаунта, кнопка и строка про подарок.
 *
 * ── БЕЗ СКРИПТА И ПРИ «УМЕНЬШИТЬ ДВИЖЕНИЕ» ────────────────────────────────
 * Карта полностью нарисована CSS: без JS она просто стоит ровно.
 * Прятать нечего и подменять нечем.
 *
 * ── СРОК ПО УМОЛЧАНИЮ — МЕСЯЦ ─────────────────────────────────────────────
 * ⚠️ БЫЛ ГОД, И ЭТО ПРАВКА ПОСТАНОВКИ. Страница открывается на самом
 * коротком сроке: человек сначала видит цену входа, а уже потом
 * выбирает срок подлиннее и видит, сколько экономит.
 */
export default function Pricing({ ceny, skidki }: { ceny?: CenyTarifov; skidki?: SkidkiTarifov }) {
  /* ⚠️ ТАРИФ БЕЗ ЕДИНОЙ ЦЕНЫ В СЕТКУ НЕ ПОПАДАЕТ ВОВСЕ. Это и есть
     «тариф, скрытый на всех сроках, не показывается нигде»: выключают
     его в админке снятием всех цен или всех ячеек доступности. */
  const tarify: KartaTarifa[] = DARIMYE.map((p) => {
    const ceny_ = ceny?.[p.id] ?? p.prices;
    return {
      id: p.id,
      name: p.name,
      short: p.short ?? p.name,
      ceny: PERIODS.flatMap((s) => {
        const rub = ceny_[s.key];
        if (typeof rub !== 'number') return [];
        const sk = skidki?.[p.id]?.[s.key];
        return [{ period: s.key as number, rub, byloRub: sk?.bylo, doDaty: sk?.doDaty }];
      }),
    };
  }).filter((t) => t.ceny.length > 0);

  const [period, setPeriod] = useState<number>(1);
  const [planId, setPlanId] = useState<string>(tarify[0]?.id ?? DARIMYE[0].id);
  const [account, setAccount] = useState<Record<string, 'new' | 'renew'>>({});

  /* Ни одного тарифа с ценой — показывать нечего, и выдумывать
     тоже нечего: сетка молчит. Случай угловой (так выглядит
     совсем пустой каталог), но он не имеет права падать. */
  if (!tarify.length) return null;

  const vidnye = tarify.filter((t) => t.ceny.some((c) => c.period === period));
  const plan = vidnye.find((t) => t.id === planId) ?? vidnye[0] ?? tarify[0];
  const cena = plan.ceny.find((c) => c.period === period);
  const acc = account[plan.id] ?? 'new';
  /* Экономия относительно помесячной оплаты того же тарифа. */
  const mes = plan.ceny.find((c) => c.period === 1)?.rub;
  const save = cena && mes && period > 1 ? mes * period - cena.rub : 0;

  const rove = (e: React.KeyboardEvent, count: number, current: number, apply: (i: number) => void) => {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    const next = (current + dir + count) % count;
    apply(next);
    const group = e.currentTarget as HTMLElement;
    group.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  };

  return (
    <section id="pricing" className="section section--clipx">
      <div className="shell">
        <SectionHead
          title="Выберите срок и тариф"
          lead="Цена фиксируется в момент оформления. Чем длиннее срок, тем дешевле месяц."
          quiet
          center
        />

        <VyborTarifa
          tarify={tarify}
          planId={plan.id}
          period={period}
          vybrat={(id, p) => {
            setPlanId(id);
            setPeriod(p);
          }}
          poyavlenie
        />

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

            ⚠️ И ЗАПАСНОГО «за месяц» У НЕЁ БОЛЬШЕ НЕТ. Раньше карта
            без цены на выбранном сроке показывала месячную — ровно
            это и было «при сроке 6 мес видна карточка „На троих“
            за 459 ₽ за месяц». Карты без цены на экране теперь нет,
            значит и цена у кнопки всегда настоящая.
          */}
          <a
            className="btn btn--wide"
            href={`/checkout/?plan=${plan.id}&period=${period}&mode=${acc}`}
          >
            Оформить за {formatPrice(cena?.rub ?? 0)} ₽
          </a>

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

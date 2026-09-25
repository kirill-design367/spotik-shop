'use client';

import { useState } from 'react';
import VyborTarifa, { type KartaTarifa } from '@/components/mid/VyborTarifa';
import { rubli } from '@/lib/server/money';
import type { TarifSCenami } from '@/lib/server/catalog';

/**
 * ПОКУПКА СЕРТИФИКАТА: тариф, срок, цена, переход к оплате.
 *
 * ⚠️ ВЫБОР ГОВОРИТ НА ЯЗЫКЕ ЛЕНДИНГА С ТРИДЦАТЬ ДЕВЯТОЙ ИТЕРАЦИИ.
 * Раньше это были два ряда одинаковых пилюль, и раздел «смотрелся
 * скучно» — прямая постановка. Теперь тариф выбирается ТЕМИ ЖЕ
 * картами (тёмная плита, свет сзади, кайма с переливом у выбранной),
 * а срок — теми же плашками, что над тарифами на главной. Карты
 * и плашки живут в общем компоненте: вторая их копия разошлась бы
 * с первой на ближайшей правке.
 *
 * ⚠️ РАДИУС КАРТЫ ЗДЕСЬ НЕ ИЗ ТОКЕНОВ РАЗДЕЛА, И ЭТО СОЗНАТЕЛЬНО.
 * Р-111 требует, чтобы в кабинете, оформлении и админке радиус брался
 * из `--ui-r`/`--ui-r-lg`/`--ui-r-pill`; карта тарифа — предмет
 * лендинга со своим `--card-r`, и приехала она сюда вместе со своим
 * языком по прямой постановке. Сторож радиусов перебирает оформление,
 * кабинет и админку, страницы сертификатов среди них нет.
 *
 * ⚠️ СОБСТВЕННОЙ ЦЕНЫ У СЕРТИФИКАТА НЕТ ВОВСЕ (закон 38). Он стоит
 * ровно столько, сколько подаренный тариф на выбранный срок, и цена
 * здесь берётся из того же каталога, что и на лендинге: второй
 * источник одной цены разошёлся бы с первым на ближайшей правке.
 * Скидка и выключенные пары приходят оттуда же — значит «на троих
 * только на месяц» и любая скидка работают здесь сами собой.
 *
 * ⚠️ В АДРЕС ОФОРМЛЕНИЯ УЕЗЖАЕТ НАСТОЯЩИЙ ТАРИФ, а сертификат —
 * отдельным признаком `gift=1`. Тарифа `gift` в каталоге нет (Р-93).
 */
export default function PodarokForm({ tarify }: { tarify: TarifSCenami[] }) {
  /* Внутри каталога всё в копейках, у карт — в рублях: карта
     печатает цену тем же `formatPrice`, что и лендинг. */
  const karty: KartaTarifa[] = tarify
    .map((t) => ({
      id: t.id,
      name: t.name,
      short: t.short,
      ceny: t.ceny.map((c) => ({
        period: c.period,
        rub: c.kop / 100,
        byloRub: c.bezSkidki ? c.bezSkidki / 100 : undefined,
        doDaty: c.doDaty,
      })),
    }))
    .filter((t) => t.ceny.length > 0);

  const [planId, setPlanId] = useState(karty[0]?.id ?? 'solo');
  /* Срок по умолчанию — самый короткий: человек сначала видит цену
     входа. Та же правка, что на лендинге. */
  const [period, setPeriod] = useState<number>(karty[0]?.ceny[0]?.period ?? 1);

  if (!karty.length) {
    return <p className="err">Тарифы пока не настроены. Загляните чуть позже.</p>;
  }

  const vidnye = karty.filter((t) => t.ceny.some((c) => c.period === period));
  const karta = vidnye.find((t) => t.id === planId) ?? vidnye[0] ?? karty[0];
  const tarif = tarify.find((t) => t.id === karta.id);
  const cena = tarif?.ceny.find((c) => c.period === period) ?? null;
  const srokSlovami = (p: number) => `${p} мес`;

  return (
    <>
      <div className="vybor-kart">
        <h2 className="vybor-kart__h">Какой тариф и на какой срок дарим</h2>
        <VyborTarifa
          tarify={karty}
          planId={karta.id}
          period={period}
          vybrat={(id, p) => {
            setPlanId(id);
            setPeriod(p);
          }}
          podpisSroka="Срок подарка"
          podpisTarifa="Тариф в подарок"
        />
        <p className="vybor-kart__z">{tarif?.note}</p>
      </div>

      <div className="panel">
        <h2 className="panel__h">К оплате</h2>
        <p className="sum">
          <span>
            Сертификат · {karta.short}, {srokSlovami(period)}
          </span>
          <span className="tnum summa" key={cena?.kop ?? 0}>{cena ? rubli(cena.kop) : '—'}</span>
        </p>
        {cena?.bezSkidki && cena.doDaty ? (
          <p className="panel__note" style={{ marginTop: 0 }}>
            Было <s className="tnum">{rubli(cena.bezSkidki)}</s> — скидка действует
            до {cena.doDaty}.
          </p>
        ) : null}
        <p className="panel__note" style={{ marginTop: 0 }}>
          После оплаты код придёт вам на почту и появится в личном кабинете. Тариф и срок
          зашиты в коде: тот, кому вы его подарите, введёт код на этой же странице, увидит,
          что подарено, и сам выберет — завести новый аккаунт или продлить свой.
        </p>
        {cena ? (
          <a className="btn btn--wide" href={`/checkout/?plan=${karta.id}&period=${period}&gift=1`}>
            Подарить за {rubli(cena.kop)}
          </a>
        ) : (
          <button type="button" className="btn btn--wide" disabled>
            На этот срок не оформляется
          </button>
        )}
      </div>
    </>
  );
}

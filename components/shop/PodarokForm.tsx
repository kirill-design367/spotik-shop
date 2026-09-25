'use client';

import { useState } from 'react';
import { rubli } from '@/lib/server/money';
import type { TarifSCenami } from '@/lib/server/catalog';

/**
 * ПОКУПКА СЕРТИФИКАТА: тариф, срок, цена, переход к оплате.
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
  const [planId, setPlanId] = useState(tarify[0]?.id ?? 'solo');
  const tarif = tarify.find((t) => t.id === planId) ?? tarify[0];
  const sroki = tarif?.ceny ?? [];
  /* Срок по умолчанию — самый короткий: человек сначала видит цену
     входа. Та же правка, что на лендинге. */
  const [period, setPeriod] = useState<number>(sroki[0]?.period ?? 1);
  const cena = sroki.find((c) => c.period === period) ?? sroki[0];

  if (!tarif) {
    return <p className="err">Тарифы пока не настроены. Загляните чуть позже.</p>;
  }

  const srokSlovami = (p: number) => (p === 1 ? '1 мес' : `${p} мес`);

  return (
    <>
      <div className="panel">
        <h2 className="panel__h">Какой тариф дарим</h2>
        <div className="pick" role="radiogroup" aria-label="Тариф в подарок">
          {tarify.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={t.id === planId}
              className="pick__btn"
              onClick={() => {
                setPlanId(t.id);
                /* ⚠️ СРОК СВЕРЯЕТСЯ С НОВЫМ ТАРИФОМ. У «на троих»
                   оформляется только месяц, и оставленный год дал бы
                   кнопку без цены. */
                const est = t.ceny.some((c) => c.period === period);
                if (!est) setPeriod(t.ceny[0]?.period ?? 1);
              }}
            >
              {t.short} · {t.people === 1 ? '1 аккаунт' : `${t.people} аккаунта`}
            </button>
          ))}
        </div>
        <p className="panel__note" style={{ marginBottom: 0 }}>{tarif.note}</p>
      </div>

      <div className="panel">
        <h2 className="panel__h">На какой срок</h2>
        <div className="pick" role="radiogroup" aria-label="Срок подарка">
          {sroki.map((c) => (
            <button
              key={c.period}
              type="button"
              role="radio"
              aria-checked={c.period === period}
              className="pick__btn"
              onClick={() => setPeriod(c.period)}
            >
              {srokSlovami(c.period)} · {rubli(c.kop)}
            </button>
          ))}
        </div>
        {cena?.bezSkidki && cena.doDaty ? (
          <p className="panel__note" style={{ marginBottom: 0 }}>
            Было <s className="tnum">{rubli(cena.bezSkidki)}</s> — скидка действует
            до {cena.doDaty}.
          </p>
        ) : null}
      </div>

      <div className="panel">
        <h2 className="panel__h">К оплате</h2>
        <p className="sum">
          <span>
            Сертификат · {tarif.short}, {srokSlovami(period)}
          </span>
          <span className="tnum">{cena ? rubli(cena.kop) : '—'}</span>
        </p>
        <p className="panel__note" style={{ marginTop: 0 }}>
          После оплаты код придёт вам на почту и появится в личном кабинете. Тариф и срок
          зашиты в коде: тот, кому вы его подарите, введёт код на этой же странице, увидит,
          что подарено, и сам выберет — завести новый аккаунт или продлить свой.
        </p>
        {cena ? (
          <a className="btn btn--wide" href={`/checkout/?plan=${tarif.id}&period=${period}&gift=1`}>
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

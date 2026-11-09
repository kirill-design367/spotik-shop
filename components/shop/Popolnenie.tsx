'use client';

import { useActionState, useState } from 'react';
import { deystviePopolnit, type Otvet } from '@/lib/server/actions-client';
import { rubli } from '@/lib/server/money';
import { VPN_OPLATA_TEKST } from '@/lib/plans';
import { useUhodNaOplatu } from './uhod';

export type SummaPodpiski = { kop: number; podpis: string };

/**
 * «ПОПОЛНИТЬ БАЛАНС» в кабинете (Р-168).
 *
 * Постановка: «быстрые кнопки на суммы подписок (текущие цены
 * тарифов) и поле для своей суммы. Оплата через Робокассу картой
 * и СБП, после подтверждения оплаты деньги зачисляются на баланс».
 *
 * ⚠️ БЫСТРАЯ КНОПКА НЕ ОТПРАВЛЯЕТ ФОРМУ, А ВПИСЫВАЕТ СУММУ В ПОЛЕ.
 * Человек видит, сколько уйдёт, и только потом жмёт «Пополнить» —
 * случайное касание кнопки суммы не должно уводить на оплату.
 *
 * ⚠️ НА РОБОКАССУ УХОДИТ БРАУЗЕР, А НЕ РОУТЕР — тот же крючок, что
 * у оформления (Р-143). Зачисляет деньги не это действие, а проверенное
 * уведомление Робокассы (закон 34).
 */
export default function Popolnenie({ summy }: { summy: SummaPodpiski[] }) {
  const [otkryto, setOtkryto] = useState(false);
  const [summa, setSumma] = useState('');
  const [otvet, popolnit, idyot] = useActionState<Otvet, FormData>(deystviePopolnit, {});
  useUhodNaOplatu(otvet.kuda);
  const uhodim = Boolean(otvet.kuda);
  const rub = Number(summa.replace(/\s+/g, ''));
  const godno = Number.isInteger(rub) && rub > 0;

  return (
    <div className="popolnenie">
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        aria-expanded={otkryto}
        onClick={() => setOtkryto((v) => !v)}
      >
        {otkryto ? 'Свернуть' : 'Пополнить баланс'}
      </button>
      <div className="vybor__varianty" data-on={otkryto ? '' : undefined}>
        <div className="vybor__nutro" {...(otkryto ? {} : { inert: '' as unknown as boolean })}>
          <form action={popolnit} className="popolnenie__forma" noValidate>
            {summy.length ? (
              <>
                <p className="field__label">На сумму подписки</p>
                <div className="pick popolnenie__summy">
                  {summy.map((s) => (
                    <button
                      key={`${s.kop}-${s.podpis}`}
                      type="button"
                      className="pick__btn popolnenie__summa"
                      aria-pressed={rub * 100 === s.kop}
                      onClick={() => setSumma(String(s.kop / 100))}
                    >
                      <span className="tnum">{rubli(s.kop)}</span>
                      <span className="popolnenie__podpis">{s.podpis}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            <div className="field">
              <label className="field__label" htmlFor="popolnenie-summa">
                Своя сумма, ₽
              </label>
              <input
                id="popolnenie-summa"
                name="summa"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="Например, 500"
                value={summa}
                onChange={(e) => setSumma(e.target.value.replace(/[^\d\s]/g, ''))}
              />
              <p className="field__hint">Целыми рублями, от 10 до 50 000 ₽. Картой или через СБП.</p>
            </div>
            {otvet.oshibka ? <p className="field__beda">{otvet.oshibka}</p> : null}
            {/* Та же подсказка про VPN, что перед оплатой заказа: банк
                обрывает 3-D Secure с зарубежного адреса (Р-108). */}
            <p className="panel__note panel__note--plate">{VPN_OPLATA_TEKST}</p>
            <button type="submit" className="btn btn--wide" disabled={idyot || uhodim || !godno}>
              {idyot || uhodim ? 'Переходим к оплате…' : godno ? `Пополнить на ${rubli(rub * 100)}` : 'Пополнить'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useActionState } from 'react';
import {
  adminSetCertDays,
  adminSetDiscount,
  adminSetPrice,
  adminToggleCell,
  type OtvetA,
} from '@/lib/server/actions-admin';
import { slovar, type Klyuch, type Yazyk } from '@/lib/admin/slova';

export type Stroka = {
  planId: string;
  planName: string;
  period: number;
  label: string;
  rub: string;
  /** Откуда взялась цена. Признак, а не слово: слово переводится. */
  iz: 'baza' | 'umolchanie' | 'net';
  /** Цена по скидке в рублях и последний её день (ГГГГ-ММ-ДД). */
  skidkaRub: string;
  skidkaDo: string;
  /** Продаётся ли эта пара на сайте. */
  prodayom: boolean;
};

/**
 * Цены и срок жизни кода сертификата.
 *
 * ⚠️ ПУСТОЕ ПОЛЕ ЗНАЧИТ «НА ЭТОТ СРОК НЕ ПРОДАЁМ», а не «ноль».
 * Так сейчас у тарифа на троих: на лендинге такой срок просто
 * не предлагается.
 *
 * ⚠️ ЦЕНЫ СЕРТИФИКАТА ЗДЕСЬ НЕТ И БЫТЬ НЕ ДОЛЖНО (Р-93). Сертификат
 * дарит один из этих же тарифов и стоит ровно столько же; отдельная
 * строка означала бы два числа на одну цену, и они разошлись бы
 * на первой же правке.
 */
export default function Prices({ rows, days, y }: { rows: Stroka[]; days: number; y: Yazyk }) {
  const t = slovar(y);
  const [p, setPrice, busy1] = useActionState<OtvetA, FormData>(adminSetPrice, {});
  const [d, setDays, busy2] = useActionState<OtvetA, FormData>(adminSetCertDays, {});
  const [sk, setSkidka, busy3] = useActionState<OtvetA, FormData>(adminSetDiscount, {});
  const [gr, setYacheyka, busy4] = useActionState<OtvetA, FormData>(adminToggleCell, {});
  const otkuda: Record<Stroka['iz'], Klyuch | null> = { baza: 'c.from_db', umolchanie: 'c.from_default', net: null };

  return (
    <>
      <h1>{t('c.h')}</h1>
      <p className="hint">{t('c.hint')}</p>
      {p.error ? <p className="err">{t(p.error)}</p> : null}
      {p.ok ? <p className="ok">{t(p.ok, p.polya)}</p> : null}

      <div className="ad__scroll">
        <table>
          <thead>
            <tr>
              <th>{t('t.plan')}</th>
              <th>{t('t.term')}</th>
              <th>{t('t.price')}</th>
              <th>{t('t.source')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.planId}-${r.period}`}>
                <td>{r.planName}</td>
                <td>{r.label}</td>
                <td>
                  <form action={setPrice} style={{ display: 'flex', gap: 8 }}>
                    <input type="hidden" name="plan" value={r.planId} />
                    <input type="hidden" name="period" value={r.period} />
                    <input type="text" name="price" inputMode="decimal" defaultValue={r.rub} style={{ width: 120 }} />
                    <button type="submit" className="btn btn--sm" disabled={busy1}>
                      {t('o.save')}
                    </button>
                  </form>
                </td>
                <td>{otkuda[r.iz] ? t(otkuda[r.iz]!) : '—'}</td>
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── СКИДКИ ──────────────────────────────────────────────────
          ⚠️ ПУСТЫЕ ОБА ПОЛЯ ЗНАЧАТ «СКИДКИ НЕТ». Отдельной кнопки
          «снять» не заводим: она означала бы третье состояние
          у величины, у которой их два. */}
      <h2>{t('c.discount_h')}</h2>
      <p className="hint">{t('c.discount_hint')}</p>
      {sk.error ? <p className="err">{t(sk.error)}</p> : null}
      {sk.ok ? <p className="ok">{t(sk.ok, sk.polya)}</p> : null}
      <div className="ad__scroll">
        <table>
          <thead>
            <tr>
              <th>{t('t.plan')}</th>
              <th>{t('t.term')}</th>
              <th>{t('c.discount')}</th>
              <th>{t('c.until')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`sk-${r.planId}-${r.period}`}>
                <td>{r.planName}</td>
                <td>{r.label}</td>
                <td colSpan={3}>
                  <form action={setSkidka} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <input type="hidden" name="plan" value={r.planId} />
                    <input type="hidden" name="period" value={r.period} />
                    <input
                      type="text"
                      name="price"
                      inputMode="decimal"
                      defaultValue={r.skidkaRub}
                      style={{ width: 120 }}
                    />
                    <input type="date" name="until" defaultValue={r.skidkaDo} />
                    <button type="submit" className="btn btn--sm" disabled={busy3}>
                      {t('o.save')}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── ЧТО ПРОДАЁМ: СЕТКА ТАРИФ × СРОК ─────────────────────────
          ⚠️ ЭТО ЗАМЕНА ЗАШИТОМУ «НА ТРОИХ ТОЛЬКО НА МЕСЯЦ». Прежде
          это следовало из того, что у тарифа задана одна цена;
          теперь то же самое выражается ячейкой, и его видно. */}
      <h2>{t('c.grid_h')}</h2>
      <p className="hint">{t('c.grid_hint')}</p>
      {gr.error ? <p className="err">{t(gr.error)}</p> : null}
      {gr.ok ? <p className="ok">{t(gr.ok, gr.polya)}</p> : null}
      <div className="ad__scroll">
        <table>
          <tbody>
            {rows.map((r) => (
              <tr key={`gr-${r.planId}-${r.period}`}>
                <td>{r.planName}</td>
                <td>{r.label}</td>
                <td>{r.prodayom ? t('c.on') : t('c.off')}</td>
                <td>
                  <form action={setYacheyka}>
                    <input type="hidden" name="plan" value={r.planId} />
                    <input type="hidden" name="period" value={r.period} />
                    <input type="hidden" name="on" value={r.prodayom ? '0' : '1'} />
                    <button type="submit" className="btn btn--ghost btn--sm" disabled={busy4}>
                      {r.prodayom ? t('c.off') : t('c.on')}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>{t('c.cert_h')}</h2>
      <p className="hint">{t('c.cert_hint')}</p>
      {d.error ? <p className="err">{t(d.error)}</p> : null}
      {d.ok ? <p className="ok">{t(d.ok, d.polya)}</p> : null}
      <form action={setDays} className="ad__form">
        <label>
          {t('c.days')}
          <input type="number" name="days" min={1} defaultValue={days} />
        </label>
        <div className="ad__actions">
          <button type="submit" className="btn btn--sm" disabled={busy2}>
            {t('o.save')}
          </button>
        </div>
      </form>
    </>
  );
}

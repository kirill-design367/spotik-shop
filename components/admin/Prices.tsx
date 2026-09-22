'use client';

import { useActionState } from 'react';
import { adminSetCertDays, adminSetPrice, type OtvetA } from '@/lib/server/actions-admin';

export type Stroka = { planId: string; planName: string; period: number; label: string; rub: string; iz: 'база' | 'умолчание' | '—' };

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
export default function Prices({ rows, days }: { rows: Stroka[]; days: number }) {
  const [p, setPrice, busy1] = useActionState<OtvetA, FormData>(adminSetPrice, {});
  const [d, setDays, busy2] = useActionState<OtvetA, FormData>(adminSetCertDays, {});

  return (
    <>
      <h1>Prices</h1>
      <p className="hint">
        Prices are in roubles for the whole term. Leave a field empty and save to stop selling
        that term — the landing hides it. A gift certificate costs exactly the same as the plan
        it carries, so it has no price of its own.
      </p>
      {p.error ? <p className="err">{p.error}</p> : null}
      {p.ok ? <p className="ok">{p.ok}</p> : null}

      <div className="ad__scroll">
        <table>
          <thead>
            <tr>
              <th>Plan</th>
              <th>Term</th>
              <th>Price, ₽</th>
              <th>Source</th>
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
                    <button type="submit" className="btn btn--sm" disabled={busy1}>Save</button>
                  </form>
                </td>
                <td>{r.iz}</td>
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Certificate validity</h2>
      <p className="hint">How long a gift code stays usable after it was bought.</p>
      {d.error ? <p className="err">{d.error}</p> : null}
      {d.ok ? <p className="ok">{d.ok}</p> : null}
      <form action={setDays} className="ad__form">
        <label>
          Days from purchase
          <input type="number" name="days" min={1} defaultValue={days} />
        </label>
        <div className="ad__actions">
          <button type="submit" className="btn btn--sm" disabled={busy2}>Save</button>
        </div>
      </form>
    </>
  );
}

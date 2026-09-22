'use client';

import { useEffect, useState } from 'react';
import type { StrokaOcheredi } from '@/lib/server/views';
import { adminTake } from '@/lib/server/actions-admin';

/**
 * Очередь заказов, которая обновляется сама.
 *
 * ⚠️ ОПРОС, А НЕ ПОТОК СОБЫТИЙ, и это выбор. Приложение на сервере
 * одно, операторов единицы, а поток событий держит открытым
 * соединение на каждого и требует своего пути через nginx. Опрос
 * раз в пятнадцать секунд стоит одного запроса и одной строки кода.
 *
 * ⚠️ ОБНОВЛЯЕТСЯ ТОЛЬКО ВИДИМАЯ ВКЛАДКА. Оператор держит админку
 * открытой весь день; фоновая вкладка опрашивала бы сервер зря.
 */
export default function Queue({ rows, me }: { rows: StrokaOcheredi[]; me: string }) {
  const [spisok, setSpisok] = useState(rows);
  const [live, setLive] = useState(true);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const r = await fetch('/api/admin/queue/', { cache: 'no-store' });
        if (!r.ok) throw new Error(String(r.status));
        const d = (await r.json()) as { rows: StrokaOcheredi[] };
        if (!stop) {
          setSpisok(d.rows);
          setLive(true);
        }
      } catch {
        if (!stop) setLive(false);
      }
    };
    const id = setInterval(tick, 15_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      stop = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);

  if (!spisok.length) return <p className="hint">Nothing to do right now. New paid orders appear here by themselves.</p>;

  return (
    <>
      <p className="ad__live">{live ? 'Live — refreshes every 15 s' : 'Connection lost, retrying…'}</p>
      <div className="ad__scroll">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Plan</th>
              <th>Accounts</th>
              <th>Term</th>
              <th>Paid</th>
              <th>State</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {spisok.map((r) => (
              <tr key={r.id} data-mine={r.operator === me ? '' : undefined}>
                <td>
                  <a href={`/admin/orders/${r.id}/`}>{r.id}</a>
                </td>
                <td>
                  {r.plan}
                  {/* ⚠️ ПОМЕТКА «ПОДАРОЧНЫЙ» ОБЯЗАТЕЛЬНА (Р-93): такой заказ
                      оплачен ЗАРАНЕЕ, покупателем сертификата, и денег
                      за ним не числится вовсе. Без пометки оператор
                      читает нулевую сумму как поломку. */}
                  {r.bySertificate ? <span className="ad__tag ad__tag--gift">gift</span> : null}
                </td>
                <td>{r.people}</td>
                <td>{r.period}</td>
                <td>{r.paidAt ? new Date(r.paidAt).toLocaleString('en-GB') : '—'}</td>
                <td>
                  {r.status === 'paid' ? (
                    <span className="ad__tag ad__tag--paid">new</span>
                  ) : (
                    <span className="ad__tag ad__tag--work">
                      {r.operator === me ? 'yours' : `taken: ${r.operator ?? '—'}`}
                    </span>
                  )}
                </td>
                <td>
                  {r.status === 'paid' ? (
                    <form action={adminTake}>
                      <input type="hidden" name="order" value={r.id} />
                      <button type="submit" className="btn btn--sm">Take</button>
                    </form>
                  ) : (
                    <a className="btn btn--ghost btn--sm" href={`/admin/orders/${r.id}/`}>Open</a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

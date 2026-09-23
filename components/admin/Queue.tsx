'use client';

import { useEffect, useState } from 'react';
import type { StrokaOcheredi } from '@/lib/server/views';
import { adminTake } from '@/lib/server/actions-admin';
import { slovar, type Yazyk } from '@/lib/admin/slova';

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
export default function Queue({ rows, me, y }: { rows: StrokaOcheredi[]; me: string; y: Yazyk }) {
  const t = slovar(y);
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

  if (!spisok.length) return <p className="hint">{t('q.empty')}</p>;

  return (
    <>
      <p className="ad__live">{live ? t('q.live') : t('q.lost')}</p>
      <div className="ad__scroll">
        <table>
          <thead>
            <tr>
              <th>{t('t.num')}</th>
              <th>{t('t.plan')}</th>
              <th>{t('t.accounts')}</th>
              <th>{t('t.term')}</th>
              <th>{t('t.paid')}</th>
              <th>{t('t.state')}</th>
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
                  {r.bySertificate ? <span className="ad__tag ad__tag--gift">{t('q.gift')}</span> : null}
                </td>
                <td>{r.people}</td>
                <td>{r.period}</td>
                <td>{r.paidAt ? new Date(r.paidAt).toLocaleString(y === 'en' ? 'en-GB' : 'ru-RU') : '—'}</td>
                <td>
                  {r.status === 'paid' ? (
                    <span className="ad__tag ad__tag--paid">{t('q.new')}</span>
                  ) : (
                    <span className="ad__tag ad__tag--work">
                      {r.operator === me ? t('q.yours') : t('q.taken', { kto: r.operator ?? '—' })}
                    </span>
                  )}
                </td>
                <td>
                  {r.status === 'paid' ? (
                    <form action={adminTake}>
                      <input type="hidden" name="order" value={r.id} />
                      <button type="submit" className="btn btn--sm">{t('q.take')}</button>
                    </form>
                  ) : (
                    <a className="btn btn--ghost btn--sm" href={`/admin/orders/${r.id}/`}>{t('q.open')}</a>
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

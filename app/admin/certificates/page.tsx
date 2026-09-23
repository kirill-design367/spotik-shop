import { redirect } from 'next/navigation';
import { ktoSotrudnik } from '@/lib/server/auth';
import { bazaEst } from '@/lib/server/db';
import { vypushchennyeSertifikaty } from '@/lib/server/views';
import { yazykSotrudnika } from '@/lib/server/yazyk';
import { slovar, type Klyuch } from '@/lib/admin/slova';

export const dynamic = 'force-dynamic';

/**
 * Выпущенные сертификаты — для администратора.
 *
 * Постановка двадцать восьмой итерации: «тариф, срок, статус, кто
 * купил, кто активировал».
 *
 * ⚠️ САМОГО КОДА ЗДЕСЬ НЕТ И БЫТЬ НЕ МОЖЕТ. В базе лежит шифротекст,
 * и читателя у него ровно два — владелец в своём кабинете и никто
 * больше (Р-87). Администратору видно четыре последних знака:
 * этого довольно, чтобы сверить сертификат с тем, что показывает
 * человек, и недостаточно, чтобы им воспользоваться.
 */
export default async function AdminCertificates() {
  const s = await ktoSotrudnik();
  const y = await yazykSotrudnika(s);
  const t = slovar(y);
  if (!bazaEst()) return <p className="err">{t('o.no_db')}</p>;
  if (!s) redirect('/admin/login/');
  if (s.role !== 'admin') return <p className="err">{t('o.only_admin')}</p>;

  const rows = await vypushchennyeSertifikaty();
  const kogda = y === 'en' ? 'en-GB' : 'ru-RU';
  const den = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(kogda) : '—');
  const sostoyanie: Record<string, Klyuch> = { used: 's.used', expired: 's.expired' };

  return (
    <>
      <h1>{t('s.h')}</h1>
      <p className="hint">{t('s.hint')}</p>

      {!rows.length ? (
        <p className="hint">{t('s.empty')}</p>
      ) : (
        <div className="ad__scroll">
          <table>
            <thead>
              <tr>
                <th>{t('t.code')}</th>
                <th>{t('t.gift')}</th>
                <th>{t('t.state')}</th>
                <th>{t('t.bought_by')}</th>
                <th>{t('t.bought')}</th>
                <th>{t('t.until')}</th>
                <th>{t('t.activated_by')}</th>
                <th>{t('t.order')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>…{r.tail}</td>
                  <td>
                    {r.plan} · {r.period}
                  </td>
                  <td>
                    <span
                      className={
                        r.status === 'used'
                          ? 'ad__tag ad__tag--work'
                          : r.status === 'expired'
                            ? 'ad__tag'
                            : 'ad__tag ad__tag--paid'
                      }
                    >
                      {t(sostoyanie[r.status] ?? 's.valid')}
                    </span>
                  </td>
                  <td>{r.buyer ?? '—'}</td>
                  <td>{den(r.boughtAt)}</td>
                  <td>{den(r.expiresAt)}</td>
                  <td>{r.activatedBy ?? '—'}</td>
                  <td>{r.orderId ? <a href={`/admin/orders/${r.orderId}/`}>{r.orderId}</a> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

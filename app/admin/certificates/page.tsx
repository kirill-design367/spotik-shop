import { redirect } from 'next/navigation';
import { ktoSotrudnik } from '@/lib/server/auth';
import { bazaEst } from '@/lib/server/db';
import { vypushchennyeSertifikaty } from '@/lib/server/views';

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
  if (!bazaEst()) return <p className="err">No database configured on this server.</p>;
  const s = await ktoSotrudnik();
  if (!s) redirect('/admin/login/');
  if (s.role !== 'admin') return <p className="err">Administrators only.</p>;

  const rows = await vypushchennyeSertifikaty();
  const den = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB') : '—');

  return (
    <>
      <h1>Gift certificates</h1>
      <p className="hint">
        A certificate carries a plan and a term and costs exactly what that plan costs. The code
        itself is stored encrypted and is visible only to the buyer, in their own cabinet — here
        you see its last four characters.
      </p>

      {!rows.length ? (
        <p className="hint">No certificates have been issued yet.</p>
      ) : (
        <div className="ad__scroll">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Gift</th>
                <th>State</th>
                <th>Bought by</th>
                <th>Bought</th>
                <th>Valid until</th>
                <th>Activated by</th>
                <th>Order</th>
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
                      {r.status}
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

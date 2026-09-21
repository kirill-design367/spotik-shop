import { redirect } from 'next/navigation';
import Queue from '@/components/admin/Queue';
import { ktoSotrudnik } from '@/lib/server/auth';
import { ochered, zakrytye } from '@/lib/server/views';
import { bazaEst } from '@/lib/server/db';
import { pochtaNastroena } from '@/lib/server/mail';
import { shifrGotov } from '@/lib/server/crypto';
import { robokassaRabotaet } from '@/lib/server/robokassa';
import { env } from '@/lib/server/env';

export const dynamic = 'force-dynamic';

/**
 * Очередь оператора плюс короткая сводка «что на сервере настроено».
 *
 * Сводка не украшение: без неё «письма не приходят» и «пароль
 * не сохраняется» выглядят как поломка кода, а на деле это
 * незаполненное окружение.
 */
export default async function AdminHome() {
  if (!bazaEst()) return <p className="err">No database configured on this server.</p>;
  const s = await ktoSotrudnik();
  if (!s) redirect('/admin/login/');

  const [rows, closed] = await Promise.all([ochered(), zakrytye(20)]);

  return (
    <>
      <h1>Order queue</h1>
      <p className="hint">Take an order to see the client data and start working on it.</p>

      <div className="ad__card">
        <h3>Server setup</h3>
        <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--dim)' }}>
          <li>Email: {pochtaNastroena() ? 'SMTP configured' : 'NOT configured — codes and letters go to the server log'}</li>
          <li>Credential encryption: {shifrGotov() ? 'key present' : 'NO KEY — passwords cannot be stored'}</li>
          <li>
            Payments:{' '}
            {robokassaRabotaet()
              ? env.rkTest
                ? 'Robokassa in TEST mode'
                : 'Robokassa live'
              : 'Robokassa not configured'}
          </li>
        </ul>
      </div>

      <Queue rows={rows} me={s.email} />

      <h2>Recently closed</h2>
      <div className="ad__scroll">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Plan</th>
              <th>Client</th>
              <th>State</th>
              <th>Closed</th>
            </tr>
          </thead>
          <tbody>
            {closed.map((r) => (
              <tr key={r.id}>
                <td>
                  <a href={`/admin/orders/${r.id}/`}>{r.id}</a>
                </td>
                <td>{r.plan}</td>
                <td>{r.client}</td>
                <td>{r.status}</td>
                <td>{new Date(r.closedAt).toLocaleString('en-GB')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

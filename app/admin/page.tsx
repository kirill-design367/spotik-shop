import { redirect } from 'next/navigation';
import Queue from '@/components/admin/Queue';
import { ktoSotrudnik } from '@/lib/server/auth';
import { ochered, zakrytye } from '@/lib/server/views';
import { bazaEst } from '@/lib/server/db';
import { pochtaNastroena } from '@/lib/server/mail';
import { shifrGotov } from '@/lib/server/crypto';
import { robokassaRabotaet } from '@/lib/server/robokassa';
import { telegramNastroen } from '@/lib/server/telegram';
import { env } from '@/lib/server/env';
import { yazykSotrudnika } from '@/lib/server/yazyk';
import { slovar, sostoyanie } from '@/lib/admin/slova';
import { imyaTarifa } from '@/lib/plans';

export const dynamic = 'force-dynamic';

/**
 * Очередь оператора плюс короткая сводка «что на сервере настроено».
 *
 * Сводка не украшение: без неё «письма не приходят» и «уведомления
 * не идут» выглядят как поломка кода, а на деле это незаполненное
 * окружение.
 */
export default async function AdminHome() {
  const s = await ktoSotrudnik();
  const y = await yazykSotrudnika(s);
  const t = slovar(y);
  if (!bazaEst()) return <p className="err">{t('o.no_db')}</p>;
  if (!s) redirect('/admin/login/');

  const [rows, closed] = await Promise.all([ochered(), zakrytye(20)]);
  const kogda = y === 'en' ? 'en-GB' : 'ru-RU';

  return (
    <>
      <h1>{t('q.h')}</h1>
      <p className="hint">{t('q.hint')}</p>

      <div className="ad__card">
        <h3>{t('q.setup')}</h3>
        <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--dim)' }}>
          <li>
            {t('q.mail')}: {pochtaNastroena() ? t('q.mail_on') : t('q.mail_off')}
          </li>
          <li>
            {t('q.crypto')}: {shifrGotov() ? t('q.crypto_on') : t('q.crypto_off')}
          </li>
          <li>
            {t('q.pay')}:{' '}
            {robokassaRabotaet() ? (env.rkTest ? t('q.pay_test') : t('q.pay_live')) : t('q.pay_off')}
          </li>
          <li>
            {t('q.tg')}: {telegramNastroen() ? t('q.tg_on') : t('q.tg_off')}
          </li>
        </ul>
      </div>

      <Queue rows={rows} me={s.email} y={y} sek={s.queueSec} />

      <h2>{t('q.closed')}</h2>
      <div className="ad__scroll">
        <table>
          <thead>
            <tr>
              <th>{t('t.num')}</th>
              <th>{t('t.plan')}</th>
              <th>{t('t.client')}</th>
              <th>{t('t.state')}</th>
              <th>{t('t.closed')}</th>
            </tr>
          </thead>
          <tbody>
            {closed.map((r) => (
              <tr key={r.id}>
                <td>
                  <a href={`/admin/orders/${r.id}/`}>{r.id}</a>
                </td>
                <td>{imyaTarifa(r.planId, y === 'en')}</td>
                <td>{r.client}</td>
                <td>{sostoyanie(t, r.status)}</td>
                <td>{new Date(r.closedAt).toLocaleString(kogda)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

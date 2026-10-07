import { redirect } from 'next/navigation';
import Queue from '@/components/admin/Queue';
import OtmenaVypolnennogo from '@/components/admin/OtmenaVypolnennogo';
import { ktoSotrudnik } from '@/lib/server/auth';
import { ochered, zakrytye } from '@/lib/server/views';
import { dostupSotrudnika } from '@/lib/server/dostup';
import { bazaEst } from '@/lib/server/db';
import { pochtaNastroena } from '@/lib/server/mail';
import { shifrGotov } from '@/lib/server/crypto';
import { robokassaRabotaet } from '@/lib/server/robokassa';
import { telegramNastroen } from '@/lib/server/telegram';
import { env } from '@/lib/server/env';
import { yazykSotrudnika } from '@/lib/server/yazyk';
import { slovar, sostoyanie } from '@/lib/admin/slova';
import { imyaTarifaIz } from '@/lib/plans';
import { imenaTarifov } from '@/lib/server/imena';
import { poMoskve } from '@/lib/admin/vremya';

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

  /* ⚠️ ПРИЗНАК РОЛИ ЕДЕТ В ВЫБОРКУ, А НЕ ТОЛЬКО В РАЗМЕТКУ: почты
     сотрудников исполнителю сервер не отдаёт вовсе (постановка сорок
     четвёртой итерации, пункт 5; то же, что с деньгами заказа, Р-148). */
  const admin = s.role === 'admin';
  /* ⚠️ ДОСТУП ЕДЕТ В ОБЕ ВЫБОРКИ (сорок шестая итерация): оператору
     не показывается вовсе ни заказ, взятый другим, ни заказ тарифа,
     которого ему не разрешили. Решает это ОДНО условие в `dostup.ts`,
     а не разметка и не две разные проверки. */
  const d = await dostupSotrudnika(s);
  const [rows, closed, imena] = await Promise.all([ochered(d), zakrytye(d, 20), imenaTarifov()]);
  const en = y === 'en';

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

      <Queue rows={rows} y={y} sek={s.queueSec} imena={imena} admin={admin} />

      <h2>{t('q.closed')}</h2>
      <div className="ad__scroll">
        <table>
          <thead>
            <tr>
              <th>{t('t.num')}</th>
              <th>{t('t.plan')}</th>
              <th>{t('t.client')}</th>
              <th>{t('t.state')}</th>
              {admin ? <th>{t('t.staff')}</th> : null}
              <th>{t('t.closed')}</th>
              {admin ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {closed.map((r) => (
              <tr key={r.id}>
                <td>
                  <a href={`/admin/orders/${r.id}/`}>{r.id}</a>
                </td>
                <td>{imyaTarifaIz(imena, r.planId, y === 'en')}</td>
                <td>{r.client}</td>
                <td>
                  {sostoyanie(t, r.status)}
                  {/* Отменён ПОСЛЕ выполнения — подпиской, а не возвратом
                      денег: это другой исход, и в списке он подписан. */}
                  {r.otmenaPodpiski ? <span className="ad__tag ad__tag--otmena">{t('sc.tag')}</span> : null}
                </td>
                {/* ⚠️ «КТО ЗАКРЫЛ» ПРИХОДИТ ИЗ ЖУРНАЛА (см. `zakrytye`).
                    Пусто — значит сотрудника в этом событии не было:
                    так выглядит заказ, отменённый самим покупателем,
                    и старый заказ, о котором в базе ничего нет. */}
                {admin ? <td>{r.staff ?? '—'}</td> : null}
                <td className="tnum">{poMoskve(r.closedAt, en)}</td>
                {/* ⚠️ «ОТКРЫТЬ» И «ОТМЕНИТЬ» — ТОЛЬКО АДМИНИСТРАТОРУ
                    (сорок девятая итерация, пункты 8 и 9: «в „Недавно
                    закрытых" у администратора в каждой строке»).
                    «Отменить» стоит лишь там, где отменять есть что:
                    у выполненного заказа на тариф без прежней отмены —
                    решает сервер (`otmenaMozhno`). */}
                {admin ? (
                  <td>
                    <div className="ad__knopki-v">
                      <a className="btn btn--ghost btn--sm" href={`/admin/orders/${r.id}/`}>
                        {t('q.open')}
                      </a>
                      {r.otmenaMozhno || r.otmenaPodpiski ? (
                        <OtmenaVypolnennogo zakaz={r.id} y={y} mozhno={r.otmenaMozhno} />
                      ) : null}
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

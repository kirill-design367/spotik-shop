'use client';

import { useActionState } from 'react';
import type { ZakazOperatoru, SlotOperatoru } from '@/lib/server/views';
import {
  adminCancel,
  adminEmailTaken,
  adminFinish,
  adminIssue,
  adminRelease,
  adminRenewDone,
  adminSendRecovery,
  adminTake,
  type OtvetA,
} from '@/lib/server/actions-admin';
import { slovar, sostoyanie, type Perevod, type Yazyk } from '@/lib/admin/slova';

/**
 * Рабочий экран оператора.
 *
 * Постановка требует «максимально пошагово и дружелюбно», поэтому
 * каждый участник — это отдельная карточка с пронумерованными
 * шагами, а не набор полей. Оператор читает сверху вниз и делает
 * ровно то, что написано.
 *
 * ⚠️ ОТМЕНА ИЗ-ЗА НЕВЕРНОГО ПАРОЛЯ НЕДОСТУПНА, ПОКА НЕ ОТПРАВЛЕНО
 * ПИСЬМО. Кнопка выключена в разметке И проверка стоит на сервере:
 * порядок жёсткий, а разметка — это то, что человек может обойти.
 *
 * ⚠️ ШАГА «КОД ДВУХФАКТОРНОЙ ПРОВЕРКИ» ЗДЕСЬ НЕТ ВОВСЕ и таймера
 * тоже: у Spotify такой проверки нет, и лишний шаг в инструкции
 * заставляет оператора искать то, чего не существует.
 */
export default function OrderWork({ z, staffId, y }: { z: ZakazOperatoru; staffId: number; y: Yazyk }) {
  const t = slovar(y);
  const moy = z.operatorId === staffId;
  const [fin, finish, busyFin] = useActionState<OtvetA, FormData>(adminFinish, {});
  const [can, cancel, busyCan] = useActionState<OtvetA, FormData>(adminCancel, {});

  const vseGotovy = z.slots.every((s) => s.gotov);
  const zakryt = z.status === 'done' || z.status === 'cancelled';
  const nuzhnoPismo = z.slots.some((s) => s.mode === 'renew' && !s.recoverySent);
  const rub = (kop: number) => (kop / 100).toFixed(2);

  return (
    <>
      <div className="ad__card">
        <h3>{t('z.h', { n: z.id })}</h3>
        <dl className="ad__kv">
          <dt>{t('t.plan')}</dt>
          <dd>
            {z.plan} · {z.period}
            {z.bySertificate ? <span className="ad__tag ad__tag--gift">{t('q.gift')}</span> : null}
          </dd>
          <dt>{t('t.client')}</dt>
          <dd>{z.clientEmail}</dd>
          <dt>{t('t.state')}</dt>
          <dd>
            {sostoyanie(t, z.status)}
            {z.operatorEmail ? ` · ${t('z.taken_by', { kto: z.operatorEmail })}` : ''}
          </dd>
          <dt>{t('z.money')}</dt>
          <dd>
            {/* ⚠️ У ПОДАРОЧНОГО ЗАКАЗА СУММА НУЛЕВАЯ, И ЭТО НОРМА (Р-93):
                деньги взяли раньше, когда покупали сертификат. */}
            {z.bySertificate
              ? t('z.money_gift')
              : t('z.money_sum', {
                  total: rub(z.totalKop),
                  balance: rub(z.balanceKop),
                  card: rub(z.moneyKop),
                })}
          </dd>
          {/* ⚠️ ОТКУДА ПРИШЁЛ ЗАКАЗ — ЭТО ДАННЫЕ, А НЕ НАДПИСЬ: имена
              меток и их значения не переводятся ни на каком языке
              админки (закон 40). Строки нет вовсе, если меток не было:
              «источник: —» на каждом прямом заходе — это шум. */}
          {z.utm.length ? (
            <>
              <dt>{t('z.utm')}</dt>
              <dd className="ad__utm">
                {z.utm.map((m) => (
                  <span key={m.imya}>
                    {m.imya}={m.znachenie}
                  </span>
                ))}
              </dd>
            </>
          ) : null}
          {z.cancelReason ? (
            <>
              <dt>{t('z.cancel_reason')}</dt>
              <dd>{z.cancelReason}</dd>
            </>
          ) : null}
        </dl>

        {z.status === 'paid' && !z.operatorId ? (
          <form action={adminTake}>
            <input type="hidden" name="order" value={z.id} />
            <button type="submit" className="btn btn--sm">
              {t('z.take')}
            </button>
          </form>
        ) : null}
        {moy && z.status === 'in_work' ? (
          <form action={adminRelease}>
            <input type="hidden" name="order" value={z.id} />
            <button type="submit" className="btn btn--ghost btn--sm">
              {t('z.release')}
            </button>
          </form>
        ) : null}
        {/* ⚠️ ЗАКРЫТЫЙ ЗАКАЗ ГОВОРИТ ОБ ЭТОМ САМ. Карточки завершения
            и отмены после закрытия пропадают вместе со своим ответом,
            и без этой строки оператор видел бы страницу без единого
            следа того, что он только что сделал. */}
        {zakryt ? <p className="ok">{z.status === 'done' ? t('z.done_note') : t('z.cancelled_note')}</p> : null}
        {z.secretsWiped ? <p className="hint">{t('z.wiped')}</p> : null}
      </div>

      {!moy && !zakryt ? <p className="hint">{t('z.take_first')}</p> : null}

      {moy ? z.slots.map((s) => <SlotCard key={s.id} z={z} s={s} n={z.slots.length} t={t} />) : null}

      {moy && !zakryt ? (
        <div className="ad__card">
          <h3>{t('z.finish')}</h3>
          {fin.error ? <p className="err">{t(fin.error)}</p> : null}
          {fin.ok ? <p className="ok">{t(fin.ok, fin.polya)}</p> : null}
          <form action={finish}>
            <input type="hidden" name="order" value={z.id} />
            <button type="submit" className="btn btn--sm" disabled={!vseGotovy || busyFin}>
              {busyFin ? t('z.closing') : t('z.finish_btn')}
            </button>
          </form>
          {!vseGotovy ? <p className="hint">{t('z.need_all')}</p> : null}
        </div>
      ) : null}

      {moy && !zakryt ? (
        <div className="ad__card">
          <h3>{t('z.cancel')}</h3>
          {can.error ? <p className="err">{t(can.error)}</p> : null}
          {can.ok ? <p className="ok">{t(can.ok, can.polya)}</p> : null}
          <form action={cancel} className="ad__form">
            <input type="hidden" name="order" value={z.id} />
            <label>
              {t('z.reason')}
              <input type="text" name="reason" placeholder={t('z.reason_ph')} />
            </label>
            <label style={{ flexDirection: 'row', alignItems: 'center', display: 'flex', gap: 8 }}>
              <input type="checkbox" name="badPassword" defaultChecked={z.slots.some((x) => x.mode === 'renew')} />
              {t('z.badpass')}
            </label>
            <div className="ad__actions">
              <button type="submit" className="btn btn--ghost btn--sm" disabled={busyCan}>
                {busyCan ? t('z.cancelling') : t('z.cancel_btn')}
              </button>
            </div>
          </form>
          {nuzhnoPismo ? <p className="hint">{t('z.need_letter')}</p> : null}
        </div>
      ) : null}
    </>
  );
}

function SlotCard({ z, s, n, t }: { z: ZakazOperatoru; s: SlotOperatoru; n: number; t: Perevod }) {
  const [iss, issue, busy1] = useActionState<OtvetA, FormData>(adminIssue, {});
  const [don, done, busy2] = useActionState<OtvetA, FormData>(adminRenewDone, {});
  const [rec, recovery, busy3] = useActionState<OtvetA, FormData>(adminSendRecovery, {});
  const [zan, zanyata, busy4] = useActionState<OtvetA, FormData>(adminEmailTaken, {});
  const zakryt = z.status === 'done' || z.status === 'cancelled';

  return (
    <div className="ad__card">
      <h3>
        {n > 1 ? t('u.account', { n: s.idx + 1 }) : ''}
        {s.mode === 'new' ? t('u.new') : t('u.renew')}
        {s.gotov ? t('u.done') : ''}
      </h3>

      {s.mode === 'renew' ? (
        <>
          <p className="hint">{t('u.renew_steps')}</p>
          <dl className="ad__kv">
            <dt>{t('t.email')}</dt>
            <dd className="ad__secret">{s.clientLogin ?? t('u.wiped')}</dd>
            <dt>{t('u.password')}</dt>
            <dd className="ad__secret">{s.clientPassword ?? t('u.wiped')}</dd>
          </dl>

          {don.error ? <p className="err">{t(don.error)}</p> : null}
          {don.ok ? <p className="ok">{t(don.ok, don.polya)}</p> : null}
          {rec.error ? <p className="err">{t(rec.error)}</p> : null}
          {rec.ok ? <p className="ok">{t(rec.ok, rec.polya)}</p> : null}

          <div className="ad__actions">
            {!s.gotov && !zakryt ? (
              <form action={done}>
                <input type="hidden" name="order" value={z.id} />
                <input type="hidden" name="slot" value={s.id} />
                <button type="submit" className="btn btn--sm" disabled={busy2}>
                  {busy2 ? t('o.saving') : t('u.renew_done')}
                </button>
              </form>
            ) : null}
            {!zakryt ? (
              <form action={recovery}>
                <input type="hidden" name="order" value={z.id} />
                <input type="hidden" name="slot" value={s.id} />
                <button type="submit" className="btn btn--ghost btn--sm" disabled={busy3 || s.recoverySent}>
                  {s.recoverySent ? t('u.recovery_sent') : busy3 ? t('u.sending') : t('u.recovery')}
                </button>
              </form>
            ) : null}
          </div>
        </>
      ) : s.clientLogin || s.clientPassword ? (
        /* НОВЫЙ ПОРЯДОК: почту и пароль дал КЛИЕНТ, оператор заводит
           аккаунт ровно на них и не вписывает ничего. */
        <>
          <p className="hint">{t('u.new_steps')}</p>
          <dl className="ad__kv">
            <dt>{t('t.email')}</dt>
            <dd className="ad__secret">{s.clientLogin ?? t('u.wiped')}</dd>
            <dt>{t('u.password')}</dt>
            <dd className="ad__secret">{s.clientPassword ?? t('u.wiped')}</dd>
          </dl>

          {don.error ? <p className="err">{t(don.error)}</p> : null}
          {don.ok ? <p className="ok">{t(don.ok, don.polya)}</p> : null}
          {zan.error ? <p className="err">{t(zan.error)}</p> : null}
          {zan.ok ? <p className="ok">{t(zan.ok, zan.polya)}</p> : null}

          <div className="ad__actions">
            {!s.gotov && !zakryt ? (
              <form action={done}>
                <input type="hidden" name="order" value={z.id} />
                <input type="hidden" name="slot" value={s.id} />
                <button type="submit" className="btn btn--sm" disabled={busy2}>
                  {busy2 ? t('o.saving') : t('u.new_done')}
                </button>
              </form>
            ) : null}
            {!zakryt ? (
              <form action={zanyata}>
                <input type="hidden" name="order" value={z.id} />
                <button type="submit" className="btn btn--ghost btn--sm" disabled={busy4}>
                  {busy4 ? t('z.cancelling') : t('u.email_taken')}
                </button>
              </form>
            ) : null}
          </div>
          {!zakryt ? <p className="hint">{t('u.email_taken_hint')}</p> : null}
        </>
      ) : (
        /* СТАРЫЙ ЗАКАЗ: доступы заводил оператор, и доделывать его
           надо тем же способом, каким он начинался. */
        <>
          <p className="hint">{t('u.new_steps_old')}</p>
          {iss.error ? <p className="err">{t(iss.error)}</p> : null}
          {iss.ok ? <p className="ok">{t(iss.ok, iss.polya)}</p> : null}
          {s.outLogin ? (
            <dl className="ad__kv">
              <dt>{t('u.login')}</dt>
              <dd className="ad__secret">{s.outLogin}</dd>
              <dt>{t('u.mailpass')}</dt>
              <dd className="ad__secret">{s.outMailPass}</dd>
              <dt>{t('u.spotpass')}</dt>
              <dd className="ad__secret">{s.outPassword}</dd>
            </dl>
          ) : null}
          {!zakryt ? (
            <form action={issue} className="ad__form">
              <input type="hidden" name="order" value={z.id} />
              <input type="hidden" name="slot" value={s.id} />
              <div className="ad__row">
                <label>
                  {t('u.login_email')}
                  <input type="text" name="login" required autoComplete="off" defaultValue={s.outLogin ?? ''} />
                </label>
                <label>
                  {t('u.mailpass')}
                  <input type="text" name="mailPass" required autoComplete="off" defaultValue={s.outMailPass ?? ''} />
                </label>
                <label>
                  {t('u.spotpass')}
                  <input
                    type="text"
                    name="spotifyPass"
                    required
                    autoComplete="off"
                    defaultValue={s.outPassword ?? ''}
                  />
                </label>
              </div>
              <div className="ad__actions">
                <button type="submit" className="btn btn--sm" disabled={busy1}>
                  {busy1 ? t('o.saving') : s.outLogin ? t('u.update_creds') : t('u.save_creds')}
                </button>
              </div>
            </form>
          ) : null}
        </>
      )}
    </div>
  );
}

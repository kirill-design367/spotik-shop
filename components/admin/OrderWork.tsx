'use client';

import { useActionState } from 'react';
import type { ZakazOperatoru, SlotOperatoru } from '@/lib/server/views';
import {
  adminCancel,
  adminFinish,
  adminIssue,
  adminRelease,
  adminRenewDone,
  adminSendRecovery,
  adminTake,
  type OtvetA,
} from '@/lib/server/actions-admin';

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
export default function OrderWork({ z, staffId }: { z: ZakazOperatoru; staffId: number }) {
  const moy = z.operatorId === staffId;
  const [fin, finish, busyFin] = useActionState<OtvetA, FormData>(adminFinish, {});
  const [can, cancel, busyCan] = useActionState<OtvetA, FormData>(adminCancel, {});

  const vseGotovy = z.slots.every((s) => s.gotov);
  const zakryt = z.status === 'done' || z.status === 'cancelled';
  const nuzhnoPismo = z.slots.some((s) => s.mode === 'renew' && !s.recoverySent);

  return (
    <>
      <div className="ad__card">
        <h3>Order #{z.id}</h3>
        <dl className="ad__kv">
          <dt>Plan</dt>
          <dd>
            {z.plan} · {z.period}
            {z.bySertificate ? <span className="ad__tag ad__tag--gift">gift</span> : null}
          </dd>
          <dt>Client</dt>
          <dd>{z.clientEmail}</dd>
          <dt>State</dt>
          <dd>
            {z.status}
            {z.operatorEmail ? ` · taken by ${z.operatorEmail}` : ''}
          </dd>
          <dt>Money</dt>
          <dd>
            {/* ⚠️ У ПОДАРОЧНОГО ЗАКАЗА СУММА НУЛЕВАЯ, И ЭТО НОРМА (Р-93):
                деньги взяли раньше, когда покупали сертификат. */}
            {z.bySertificate
              ? 'nothing is due — a gift certificate was redeemed, the money was taken when it was bought'
              : `${(z.totalKop / 100).toFixed(2)} ₽ total · ${(z.balanceKop / 100).toFixed(2)} from balance · ${(z.moneyKop / 100).toFixed(2)} by card`}
          </dd>
          {z.cancelReason ? (
            <>
              <dt>Cancelled because</dt>
              <dd>{z.cancelReason}</dd>
            </>
          ) : null}
        </dl>

        {z.status === 'paid' && !z.operatorId ? (
          <form action={adminTake}>
            <input type="hidden" name="order" value={z.id} />
            <button type="submit" className="btn btn--sm">Take this order</button>
          </form>
        ) : null}
        {moy && z.status === 'in_work' ? (
          <form action={adminRelease}>
            <input type="hidden" name="order" value={z.id} />
            <button type="submit" className="btn btn--ghost btn--sm">Put back in the queue</button>
          </form>
        ) : null}
        {/* ⚠️ ЗАКРЫТЫЙ ЗАКАЗ ГОВОРИТ ОБ ЭТОМ САМ. Карточки «Finish»
            и «Cancel» после закрытия пропадают вместе со своим
            ответом, и без этой строки оператор видел бы страницу
            без единого следа того, что он только что сделал. */}
        {zakryt ? (
          <p className="ok">
            {z.status === 'done'
              ? 'Order is closed. The client has been emailed and sees the credentials in their cabinet.'
              : 'Order is cancelled. The money is back on the client balance.'}
          </p>
        ) : null}
        {z.secretsWiped ? <p className="hint">Credentials were wiped 7 days after this order closed.</p> : null}
      </div>

      {!moy && !zakryt ? (
        <p className="hint">
          Take the order to see the client credentials. They are decrypted for the assigned
          operator only.
        </p>
      ) : null}

      {moy
        ? z.slots.map((s) => <SlotCard key={s.id} z={z} s={s} n={z.slots.length} />)
        : null}

      {moy && !zakryt ? (
        <div className="ad__card">
          <h3>Finish</h3>
          {fin.error ? <p className="err">{fin.error}</p> : null}
          {fin.ok ? <p className="ok">{fin.ok}</p> : null}
          <form action={finish}>
            <input type="hidden" name="order" value={z.id} />
            <button type="submit" className="btn btn--sm" disabled={!vseGotovy || busyFin}>
              {busyFin ? 'Closing…' : 'Mark the whole order done'}
            </button>
          </form>
          {!vseGotovy ? <p className="hint">Every participant must be done first.</p> : null}
        </div>
      ) : null}

      {moy && !zakryt ? (
        <div className="ad__card">
          <h3>Cancel and refund</h3>
          {can.error ? <p className="err">{can.error}</p> : null}
          {can.ok ? <p className="ok">{can.ok}</p> : null}
          <form action={cancel} className="ad__form">
            <input type="hidden" name="order" value={z.id} />
            <label>
              Reason (the client sees this)
              <input type="text" name="reason" placeholder="Wrong password on the existing account" />
            </label>
            <label style={{ flexDirection: 'row', alignItems: 'center', display: 'flex', gap: 8 }}>
              <input type="checkbox" name="badPassword" defaultChecked={z.slots.some((x) => x.mode === 'renew')} />
              This is the wrong-password case
            </label>
            <div className="ad__actions">
              <button type="submit" className="btn btn--ghost btn--sm" disabled={busyCan}>
                {busyCan ? 'Cancelling…' : 'Cancel order, money to client balance'}
              </button>
            </div>
          </form>
          {nuzhnoPismo ? (
            <p className="hint">
              For the wrong-password case send the recovery email first — cancelling is blocked
              until then.
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function SlotCard({ z, s, n }: { z: ZakazOperatoru; s: SlotOperatoru; n: number }) {
  const [iss, issue, busy1] = useActionState<OtvetA, FormData>(adminIssue, {});
  const [don, done, busy2] = useActionState<OtvetA, FormData>(adminRenewDone, {});
  const [rec, recovery, busy3] = useActionState<OtvetA, FormData>(adminSendRecovery, {});
  const zakryt = z.status === 'done' || z.status === 'cancelled';

  return (
    <div className="ad__card">
      <h3>
        {n > 1 ? `Account ${s.idx + 1} — ` : ''}
        {s.mode === 'new' ? 'New account' : 'Renew the client’s own account'}
        {s.gotov ? ' · done' : ''}
      </h3>

      {s.mode === 'renew' ? (
        <>
          <p className="hint">
            1. Open spotify.com and sign in with the credentials below. 2. Turn Premium on for
            the chosen term. 3. Come back and mark it done.
          </p>
          <dl className="ad__kv">
            <dt>Email</dt>
            <dd className="ad__secret">{s.clientLogin ?? '— wiped —'}</dd>
            <dt>Password</dt>
            <dd className="ad__secret">{s.clientPassword ?? '— wiped —'}</dd>
          </dl>

          {don.error ? <p className="err">{don.error}</p> : null}
          {don.ok ? <p className="ok">{don.ok}</p> : null}
          {rec.error ? <p className="err">{rec.error}</p> : null}
          {rec.ok ? <p className="ok">{rec.ok}</p> : null}

          <div className="ad__actions">
            {!s.gotov && !zakryt ? (
              <form action={done}>
                <input type="hidden" name="order" value={z.id} />
                <input type="hidden" name="slot" value={s.id} />
                <button type="submit" className="btn btn--sm" disabled={busy2}>
                  {busy2 ? 'Saving…' : 'Premium is on — mark done'}
                </button>
              </form>
            ) : null}
            {!zakryt ? (
              <form action={recovery}>
                <input type="hidden" name="order" value={z.id} />
                <input type="hidden" name="slot" value={s.id} />
                <button type="submit" className="btn btn--ghost btn--sm" disabled={busy3 || s.recoverySent}>
                  {s.recoverySent ? 'Recovery email sent' : busy3 ? 'Sending…' : 'Password does not work — email the client'}
                </button>
              </form>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <p className="hint">
            1. Create a fresh mailbox for the client. 2. Register a Spotify account on it and
            turn Premium on for the chosen term. 3. Paste all three below — the client sees them
            in their cabinet right away.
          </p>
          {iss.error ? <p className="err">{iss.error}</p> : null}
          {iss.ok ? <p className="ok">{iss.ok}</p> : null}
          {s.outLogin ? (
            <dl className="ad__kv">
              <dt>Login</dt>
              <dd className="ad__secret">{s.outLogin}</dd>
              <dt>Mailbox password</dt>
              <dd className="ad__secret">{s.outMailPass}</dd>
              <dt>Spotify password</dt>
              <dd className="ad__secret">{s.outPassword}</dd>
            </dl>
          ) : null}
          {!zakryt ? (
            <form action={issue} className="ad__form">
              <input type="hidden" name="order" value={z.id} />
              <input type="hidden" name="slot" value={s.id} />
              <div className="ad__row">
                <label>
                  Login (email)
                  <input type="text" name="login" required autoComplete="off" defaultValue={s.outLogin ?? ''} />
                </label>
                <label>
                  Mailbox password
                  <input type="text" name="mailPass" required autoComplete="off" defaultValue={s.outMailPass ?? ''} />
                </label>
                <label>
                  Spotify password
                  <input type="text" name="spotifyPass" required autoComplete="off" defaultValue={s.outPassword ?? ''} />
                </label>
              </div>
              <div className="ad__actions">
                <button type="submit" className="btn btn--sm" disabled={busy1}>
                  {busy1 ? 'Saving…' : s.outLogin ? 'Update credentials' : 'Save credentials'}
                </button>
              </div>
            </form>
          ) : null}
        </>
      )}
    </div>
  );
}

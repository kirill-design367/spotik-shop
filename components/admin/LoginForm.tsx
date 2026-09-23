'use client';

import { useActionState } from 'react';
import { adminAskCode, adminLogin, type OtvetA } from '@/lib/server/actions-admin';
import { slovar, type Yazyk } from '@/lib/admin/slova';

/**
 * Вход сотрудника: почта и одноразовый код. Механизм тот же, что
 * у клиентского кабинета, но кука ОТДЕЛЬНАЯ и список адресов свой:
 * клиентская сессия админку не открывает никогда.
 */
export default function LoginForm({ y }: { y: Yazyk }) {
  const t = slovar(y);
  const [asked, ask, busy1] = useActionState<OtvetA, FormData>(adminAskCode, {});
  const [tried, login, busy2] = useActionState<OtvetA, FormData>(adminLogin, {});
  const email = tried.email || asked.email || '';
  const step = asked.step === 'code' || tried.step === 'code';
  const error = tried.error || asked.error;

  return (
    <>
      <h1>{t('in.h')}</h1>
      <p className="hint">{t('in.hint')}</p>
      {error ? <p className="err">{t(error)}</p> : null}
      {!step ? (
        <form action={ask} className="ad__form">
          <label>
            {t('in.email')}
            <input type="email" name="email" required autoComplete="email" defaultValue={email} />
          </label>
          <div className="ad__actions">
            <button type="submit" className="btn btn--sm" disabled={busy1}>
              {busy1 ? t('in.sending') : t('in.send')}
            </button>
          </div>
        </form>
      ) : (
        <form action={login} className="ad__form">
          <input type="hidden" name="email" value={email} />
          <label>
            {t('in.code_to', { email })}
            <input type="text" name="code" required inputMode="numeric" maxLength={6} autoComplete="one-time-code" />
          </label>
          <div className="ad__actions">
            <button type="submit" className="btn btn--sm" disabled={busy2}>
              {busy2 ? t('in.checking') : t('in.enter')}
            </button>
          </div>
        </form>
      )}
    </>
  );
}

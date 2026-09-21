'use client';

import { useActionState } from 'react';
import { adminAskCode, adminLogin, type OtvetA } from '@/lib/server/actions-admin';

/**
 * Staff login: email + one-time code, same mechanism as the client
 * cabinet but a SEPARATE cookie and a separate allow-list. A client
 * session never opens the admin.
 */
export default function AdminLogin() {
  const [asked, ask, busy1] = useActionState<OtvetA, FormData>(adminAskCode, {});
  const [tried, login, busy2] = useActionState<OtvetA, FormData>(adminLogin, {});
  const email = tried.email || asked.email || '';
  const step = asked.step === 'code' || tried.step === 'code';
  const error = tried.error || asked.error;

  return (
    <>
      <h1>Sign in</h1>
      <p className="hint">Only addresses on the staff list can sign in.</p>
      {error ? <p className="err">{error}</p> : null}
      {!step ? (
        <form action={ask} className="ad__form">
          <label>
            Email
            <input type="email" name="email" required autoComplete="email" defaultValue={email} />
          </label>
          <div className="ad__actions">
            <button type="submit" className="btn btn--sm" disabled={busy1}>
              {busy1 ? 'Sending…' : 'Send code'}
            </button>
          </div>
        </form>
      ) : (
        <form action={login} className="ad__form">
          <input type="hidden" name="email" value={email} />
          <label>
            Code sent to {email}
            <input type="text" name="code" required inputMode="numeric" maxLength={6} autoComplete="one-time-code" />
          </label>
          <div className="ad__actions">
            <button type="submit" className="btn btn--sm" disabled={busy2}>
              {busy2 ? 'Checking…' : 'Sign in'}
            </button>
          </div>
        </form>
      )}
    </>
  );
}

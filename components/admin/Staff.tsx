'use client';

import { useActionState } from 'react';
import { adminAddStaff, adminDisableStaff, type OtvetA } from '@/lib/server/actions-admin';

export type Chelovek = { id: number; email: string; role: string; disabled: boolean; me: boolean };

export default function Staff({ list }: { list: Chelovek[] }) {
  const [a, add, busy] = useActionState<OtvetA, FormData>(adminAddStaff, {});
  return (
    <>
      <h1>Staff</h1>
      <p className="hint">
        Only these addresses can sign in here. Administrators see everything and manage prices
        and staff; operators take and fulfil orders.
      </p>
      {a.error ? <p className="err">{a.error}</p> : null}
      {a.ok ? <p className="ok">{a.ok}</p> : null}

      <form action={add} className="ad__form">
        <label>
          Email
          <input type="email" name="email" required />
        </label>
        <label>
          Role
          <select name="role" defaultValue="operator">
            <option value="operator">operator</option>
            <option value="admin">administrator</option>
          </select>
        </label>
        <div className="ad__actions">
          <button type="submit" className="btn btn--sm" disabled={busy}>Add or update</button>
        </div>
      </form>

      <h2>Current</h2>
      <div className="ad__scroll">
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>State</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td>{p.email}{p.me ? ' · you' : ''}</td>
                <td>{p.role}</td>
                <td>{p.disabled ? 'disabled' : 'active'}</td>
                <td>
                  {!p.disabled && !p.me ? (
                    <form action={adminDisableStaff}>
                      <input type="hidden" name="id" value={p.id} />
                      <button type="submit" className="btn btn--ghost btn--sm">Disable</button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

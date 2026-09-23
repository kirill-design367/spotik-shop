'use client';

import { useActionState } from 'react';
import { adminAddStaff, adminDisableStaff, type OtvetA } from '@/lib/server/actions-admin';
import { slovar, type Yazyk } from '@/lib/admin/slova';

export type Chelovek = { id: number; email: string; role: string; disabled: boolean; me: boolean };

export default function Staff({ list, y }: { list: Chelovek[]; y: Yazyk }) {
  const t = slovar(y);
  const [a, add, busy] = useActionState<OtvetA, FormData>(adminAddStaff, {});
  const rol = (r: string) => (r === 'admin' ? t('f.role_admin') : t('f.role_op'));
  return (
    <>
      <h1>{t('f.h')}</h1>
      <p className="hint">{t('f.hint')}</p>
      {a.error ? <p className="err">{t(a.error)}</p> : null}
      {/* ⚠️ ПОДСТАНОВКИ — ЭТО ДАННЫЕ. Роль в них приходит признаком
          (`admin`/`operator`) и переводится здесь, а адрес остаётся
          адресом на любом языке. */}
      {a.ok ? (
        <p className="ok">
          {t(a.ok, { ...a.polya, role: rol(String(a.polya?.role ?? '')) })}
        </p>
      ) : null}

      <form action={add} className="ad__form">
        <label>
          {t('t.email')}
          <input type="email" name="email" required />
        </label>
        <label>
          {t('t.role')}
          <select name="role" defaultValue="operator">
            <option value="operator">{t('f.role_op')}</option>
            <option value="admin">{t('f.role_admin')}</option>
          </select>
        </label>
        <div className="ad__actions">
          <button type="submit" className="btn btn--sm" disabled={busy}>
            {t('f.add')}
          </button>
        </div>
      </form>

      <h2>{t('f.current')}</h2>
      <div className="ad__scroll">
        <table>
          <thead>
            <tr>
              <th>{t('t.email')}</th>
              <th>{t('t.role')}</th>
              <th>{t('t.state')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.email}
                  {p.me ? t('f.you') : ''}
                </td>
                <td>{rol(p.role)}</td>
                <td>{p.disabled ? t('f.disabled') : t('f.active')}</td>
                <td>
                  {!p.disabled && !p.me ? (
                    <form action={adminDisableStaff}>
                      <input type="hidden" name="id" value={p.id} />
                      <button type="submit" className="btn btn--ghost btn--sm">
                        {t('f.disable')}
                      </button>
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

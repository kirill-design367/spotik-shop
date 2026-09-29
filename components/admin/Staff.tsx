'use client';

import { useActionState } from 'react';
import { adminAddStaff, adminDisableStaff, adminSetStaffPlans, type OtvetA } from '@/lib/server/actions-admin';
import { slovar, type Yazyk } from '@/lib/admin/slova';
import { imyaTarifaIz, type ImenaTarifov } from '@/lib/plans';

export type Chelovek = {
  id: number;
  email: string;
  role: string;
  disabled: boolean;
  me: boolean;
  /** РАЗРЕШЁННЫЕ тарифы: в базе лежат запреты, переворот — на сервере. */
  tarify: string[];
};

/**
 * Сотрудники и тарифы, которые каждому оператору можно выполнять.
 *
 * ⚠️ ГАЛОЧКИ ПРИВЯЗАНЫ К `planId`, А НЕ К НАЗВАНИЮ И НЕ К ЦЕНЕ —
 * постановка сорок шестой итерации: «Переименование тарифа, смена
 * цены, скидки, скрытие тарифа на сайте галочки не сбрасывают».
 * Название здесь только НАДПИСЬ: его переводит `imyaTarifaIz`, как
 * любую другую надпись админки (закон 40), а хранится и отправляется
 * идентификатор.
 *
 * ⚠️ ГАЛОЧКИ СТОЯТ ТОЛЬКО У ОПЕРАТОРОВ. У администратора их нет
 * не потому, что мы их спрятали, а потому, что выбирать нечего:
 * «Сам администратор может взять любой заказ всегда».
 */
export default function Staff({
  list,
  y,
  imena,
  tarify,
  nikto,
}: {
  list: Chelovek[];
  y: Yazyk;
  imena: ImenaTarifov;
  /** Все тарифы, в порядке каталога. */
  tarify: string[];
  /** Тарифы, которые не может выполнить ни один действующий оператор. */
  nikto: string[];
}) {
  const t = slovar(y);
  const [a, add, busy] = useActionState<OtvetA, FormData>(adminAddStaff, {});
  const [p, plans, plansBusy] = useActionState<OtvetA, FormData>(adminSetStaffPlans, {});
  const rol = (r: string) => (r === 'admin' ? t('f.role_admin') : t('f.role_op'));
  const imya = (id: string) => imyaTarifaIz(imena, id, y === 'en');
  const operatory = list.filter((x) => x.role === 'operator');
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
            {list.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.email}
                  {c.me ? t('f.you') : ''}
                </td>
                <td>{rol(c.role)}</td>
                <td>{c.disabled ? t('f.disabled') : t('f.active')}</td>
                <td>
                  {!c.disabled && !c.me ? (
                    <form action={adminDisableStaff}>
                      <input type="hidden" name="id" value={c.id} />
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

      {/* ── ТАРИФЫ ПО ОПЕРАТОРАМ ─────────────────────────────────── */}
      <div className="ad__card">
        <h3>{t('f.plans')}</h3>
        <p className="hint">{t('f.plans_hint')}</p>
        {p.error ? <p className="err">{t(p.error)}</p> : null}
        {p.ok ? <p className="ok">{t(p.ok, p.polya)}</p> : null}

        {/* ⚠️ ПРЕДУПРЕЖДЕНИЕ СТОИТ РЯДОМ С ГАЛОЧКАМИ, А НЕ В ЦЕНАХ:
            снимают их здесь, и здесь же видно, что снято слишком
            много. Тариф назван по имени — это надпись. */}
        {nikto.map((id) => (
          <p key={id} className="err">
            {t('f.nobody', { plan: imya(id) })}
          </p>
        ))}

        {!operatory.length ? (
          <p className="hint">{t('ss.none')}</p>
        ) : (
          <div className="ad__scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('t.email')}</th>
                  {tarify.map((id) => (
                    <th key={id}>{imya(id)}</th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {operatory.map((c) => (
                  <tr key={c.id}>
                    <td>
                      {c.email}
                      {c.disabled ? ` · ${t('f.disabled')}` : ''}
                    </td>
                    {tarify.map((id) => (
                      <td key={id}>
                        {/* Форма у каждого своя, и имя поля общее:
                            браузер шлёт столько значений `plan`,
                            сколько галочек отмечено. */}
                        <input
                          type="checkbox"
                          name="plan"
                          value={id}
                          form={`tarify-${c.id}`}
                          defaultChecked={c.tarify.includes(id)}
                          aria-label={`${c.email} · ${imya(id)}`}
                        />
                      </td>
                    ))}
                    <td>
                      <form action={plans} id={`tarify-${c.id}`}>
                        <input type="hidden" name="id" value={c.id} />
                        <button type="submit" className="btn btn--sm" disabled={plansBusy}>
                          {t('f.plans_save')}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

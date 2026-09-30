'use client';

import { useActionState, useState } from 'react';
import { adminAddStaff, adminDisableStaff, adminSetStaffPlans, type OtvetA } from '@/lib/server/actions-admin';
import { slovar, type Yazyk } from '@/lib/admin/slova';
import { imyaTarifaIz, klyuchPary, srokKratkoDlyaSotrudnika, type ImenaTarifov } from '@/lib/plans';

export type Chelovek = {
  id: number;
  email: string;
  role: string;
  disabled: boolean;
  me: boolean;
  /** РАЗРЕШЁННЫЕ пары «тариф × срок» ключами: в базе лежат запреты. */
  pary: string[];
};

/**
 * Сотрудники и пары «тариф × срок», которые каждому оператору можно
 * выполнять.
 *
 * ⚠️ ГАЛОЧКИ ПРИВЯЗАНЫ К `planId` И К СРОКУ, А НЕ К НАЗВАНИЮ И НЕ
 * К ЦЕНЕ — постановка: «Переименование, цена, скидки, скрытие на сайте
 * их не сбрасывают». Название здесь только НАДПИСЬ: его переводит
 * `imyaTarifaIz`, как любую другую надпись админки (закон 40),
 * а хранится и отправляется идентификатор со сроком.
 *
 * ⚠️ ГАЛОЧКИ СТОЯТ ТОЛЬКО У ОПЕРАТОРОВ. У администратора их нет
 * не потому, что мы их спрятали, а потому, что выбирать нечего:
 * «Сам администратор может взять любой заказ всегда».
 *
 * ⚠️ И ЭТО КАРТОЧКА НА КАЖДОГО ОПЕРАТОРА, А НЕ ОДНА ОБЩАЯ ТАБЛИЦА —
 * постановка сорок седьмой: «На телефоне таблица с двенадцатью
 * галочками не должна уезжать вбок». Двенадцать колонок в ряд
 * не помещаются на 390 ни при каком кегле, поэтому тарифы идут
 * СТРОКАМИ, а сроки — галочками в строке: вширь считается четыре
 * галочки, а не двенадцать, и таблицы с прокруткой тут нет вовсе.
 */
export default function Staff({
  list,
  y,
  imena,
  tarify,
  sroki,
  nikto,
}: {
  list: Chelovek[];
  y: Yazyk;
  imena: ImenaTarifov;
  /** Все тарифы, в порядке каталога. */
  tarify: string[];
  /** Все сроки, в порядке каталога. */
  sroki: number[];
  /** Пары, которые не может выполнить ни один действующий оператор. */
  nikto: { planId: string; period: number }[];
}) {
  const t = slovar(y);
  const [a, add, busy] = useActionState<OtvetA, FormData>(adminAddStaff, {});
  const [p, plans, plansBusy] = useActionState<OtvetA, FormData>(adminSetStaffPlans, {});
  const rol = (r: string) => (r === 'admin' ? t('f.role_admin') : t('f.role_op'));
  const imya = (id: string) => imyaTarifaIz(imena, id, y === 'en');
  const srok = (n: number) => srokKratkoDlyaSotrudnika(n, y === 'en');
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

      {/* ── ТАРИФЫ И СРОКИ ПО ОПЕРАТОРАМ ─────────────────────────── */}
      <div className="ad__card">
        <h3>{t('f.plans')}</h3>
        <p className="hint">{t('f.plans_hint')}</p>
        {p.error ? <p className="err">{t(p.error)}</p> : null}
        {p.ok ? <p className="ok">{t(p.ok, p.polya)}</p> : null}

        {/* ⚠️ ПРЕДУПРЕЖДЕНИЕ СТОИТ РЯДОМ С ГАЛОЧКАМИ, А НЕ В ЦЕНАХ:
            снимают их здесь, и здесь же видно, что снято слишком
            много. Пара названа именем тарифа и сроком — это надписи. */}
        {nikto.map((para) => (
          <p key={klyuchPary(para.planId, para.period)} className="err">
            {t('f.nobody', { plan: `${imya(para.planId)}, ${srok(para.period)}` })}
          </p>
        ))}

        {!operatory.length ? (
          <p className="hint">{t('ss.none')}</p>
        ) : (
          operatory.map((c) => (
            <KartaOperatora
              key={c.id}
              c={c}
              tarify={tarify}
              sroki={sroki}
              imya={imya}
              srok={srok}
              t={t}
              plans={plans}
              plansBusy={plansBusy}
            />
          ))
        )}
      </div>
    </>
  );
}

/**
 * Карточка одного оператора: тарифы строками, сроки галочками в строке.
 *
 * ⚠️ СОСТОЯНИЕ ЖИВОЕ, А НЕ `defaultChecked`, И БЕЗ НЕГО НЕТ ГЛАВНОГО:
 * галочка тарифа обязана показывать ЧАСТИЧНЫЙ выбор, а частичность
 * считается по сроками этой строки в ТОТ ЖЕ кадр, когда их трогают.
 * С неуправляемыми галочками пришлось бы читать DOM на каждое нажатие.
 *
 * ⚠️ У КАЖДОГО ОПЕРАТОРА СВОЙ КОМПОНЕНТ, потому что у каждого своё
 * состояние: держать его одной картой на всех значило бы перерисовывать
 * все карточки на каждое нажатие в любой из них.
 */
function KartaOperatora({
  c,
  tarify,
  sroki,
  imya,
  srok,
  t,
  plans,
  plansBusy,
}: {
  c: Chelovek;
  tarify: string[];
  sroki: number[];
  imya: (id: string) => string;
  srok: (n: number) => string;
  t: ReturnType<typeof slovar>;
  plans: (fd: FormData) => void;
  plansBusy: boolean;
}) {
  const [vybor, setVybor] = useState<Set<string>>(() => new Set(c.pary));

  const est = (planId: string, period: number) => vybor.has(klyuchPary(planId, period));
  const skolko = (planId: string) => sroki.filter((s) => est(planId, s)).length;

  const perekluchitSrok = (planId: string, period: number) =>
    setVybor((bylo) => {
      const stalo = new Set(bylo);
      const k = klyuchPary(planId, period);
      if (stalo.has(k)) stalo.delete(k);
      else stalo.add(k);
      return stalo;
    });

  /* Галочка тарифа — «выбрать все сроки этого тарифа»: отмечен хоть
     один — снимаем все, не отмечено ни одного — ставим все. */
  const perekluchitTarif = (planId: string) =>
    setVybor((bylo) => {
      const stalo = new Set(bylo);
      const vse = sroki.every((s) => bylo.has(klyuchPary(planId, s)));
      for (const s of sroki) {
        const k = klyuchPary(planId, s);
        if (vse) stalo.delete(k);
        else stalo.add(k);
      }
      return stalo;
    });

  return (
    <div className="ad__op">
      <div className="ad__op-kto">
        {c.email}
        {c.disabled ? <span className="ad__tag">{t('f.disabled')}</span> : null}
      </div>

      {/* `id` формы — опора для сторожа и для `aria`: у каждого
          оператора она своя. */}
      <form action={plans} id={`tarify-${c.id}`} className="ad__op-set">
        <input type="hidden" name="id" value={c.id} />

        {tarify.map((id) => {
          const n = skolko(id);
          const vse = n === sroki.length;
          return (
            <div key={id} className="ad__op-row">
              <label className="ad__op-plan">
                <input
                  type="checkbox"
                  /* ⚠️ `value` БЕЗ `name`: браузер такую галочку
                     не отправляет вовсе — она только переключает
                     сроки, а едут в форму сами сроки. */
                  value={id}
                  checked={vse}
                  /* ⚠️ `indeterminate` — НЕ АТРИБУТ РАЗМЕТКИ, А СВОЙСТВО
                     УЗЛА: задать его в JSX нечем, ставится оно только
                     на живом элементе. Ссылка-функция вызывается на
                     каждой отрисовке, поэтому частичность идёт
                     за состоянием сама. */
                  ref={(el) => {
                    if (el) el.indeterminate = n > 0 && !vse;
                  }}
                  onChange={() => perekluchitTarif(id)}
                />
                <span>{imya(id)}</span>
              </label>

              <div className="ad__op-sroki">
                {sroki.map((s) => (
                  <label key={s} className="ad__op-srok">
                    {/* Имя поля общее: браузер шлёт столько значений
                        `pair`, сколько галочек отмечено. */}
                    <input
                      type="checkbox"
                      name="pair"
                      value={klyuchPary(id, s)}
                      checked={est(id, s)}
                      onChange={() => perekluchitSrok(id, s)}
                      aria-label={`${c.email} · ${imya(id)} · ${srok(s)}`}
                    />
                    <span>{srok(s)}</span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}

        <div className="ad__actions">
          <button type="submit" className="btn btn--sm" disabled={plansBusy}>
            {t('f.plans_save')}
          </button>
        </div>
      </form>
    </div>
  );
}

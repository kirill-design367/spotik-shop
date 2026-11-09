/**
 * БАЗА ПРОДАЖ — все заказы с первого до последнего (Р-171).
 *
 * Постановка: «Новый раздел „Продажи", только для администратора:
 * все заказы с самого первого до последнего. В таблице: номер, дата
 * оплаты, тариф, срок, почта клиента, состояние, сотрудник, сумма,
 * промокод. Фильтры: период дат, тариф, срок, состояние. Поиск
 * по номеру заказа, почте клиента и почте аккаунта Spotify.
 * Постраничный вывод».
 *
 * ⚠️ ПОЧТА АККАУНТА SPOTIFY ИЩЕТСЯ ТОЛЬКО ЦЕЛИКОМ. Она лежит
 * шифротекстом (закон 35), и искать по куску значило бы расшифровать
 * каждый слот базы на каждый запрос. Рядом лежит ОТПЕЧАТОК почты
 * (`order_slot.login_fp`, посоленный ключом), и точное совпадение
 * ищется по нему индексом. Регистр и пробелы по краям не важны —
 * отпечаток снимается с нормализованного адреса. У слотов, заведённых
 * до тридцать четвёртой итерации, отпечатка нет вовсе: их по почте
 * аккаунта не найти. Почта КЛИЕНТА лежит открыто — она ищется
 * и по куску.
 *
 * ⚠️ ДАТА ПЕРИОДА — ДАТА ОПЛАТЫ, а у неоплаченного — дата оформления:
 * «все заказы» включают и неоплаченные, а у них даты оплаты нет.
 * Дни календарные по Москве, последний входит целиком.
 *
 * ⚠️ ТОЛЬКО АДМИНИСТРАТОРУ, и проверка стоит на странице: здесь
 * почты всех клиентов и деньги всех заказов.
 */

import { odna, zapros } from './db';
import { otpechatokPochty } from './crypto';
import type { Status } from './orders';
import { nastoyashchayaData } from '../data';

export const NA_STRANICE = 50;

export type FiltrProdazh = {
  ot: string | null;
  do: string | null;
  plan: string | null;
  period: number | null;
  /** `podpiska` — заказы, у которых отменяли подписку (Р-160). */
  status: Status | 'podpiska' | null;
  q: string;
  stranica: number;
};

export type StrokaProdazhi = {
  id: number;
  paidAt: string | null;
  createdAt: string;
  planId: string;
  period: number;
  kind: 'plan' | 'certificate';
  bySertificate: boolean;
  client: string;
  status: Status;
  otmenaPodpiski: boolean;
  staff: string | null;
  totalKop: number;
  promoKod: string | null;
};

/** Предел номера страницы: дальше страниц не бывает, а `1e300` ушло бы в SQL строкой «1e+302». */
const PREDEL_STRANIC = 100_000;

/** Невозможная дата («2026-02-31») — «без фильтра», как всё чужое здесь. */
const data = (v: string | undefined): string | null => (nastoyashchayaData(v) ? v : null);
const STATUSY: readonly string[] = ['new', 'paid', 'in_work', 'done', 'cancelled', 'podpiska'];

/** Разобрать адресную строку. Чужое значение — «без фильтра», а не отказ. */
export function ponyatFiltr(sp: Record<string, string>): FiltrProdazh {
  const period = Number(sp.srok);
  return {
    ot: data(sp.ot),
    do: data(sp.do),
    plan: /^[a-z0-9_-]{1,32}$/.test(sp.plan ?? '') ? sp.plan! : null,
    period: [1, 3, 6, 12].includes(period) ? period : null,
    status: STATUSY.includes(sp.st ?? '') ? (sp.st as FiltrProdazh['status']) : null,
    q: (sp.q ?? '').trim().slice(0, 200),
    stranica: Math.min(PREDEL_STRANIC, Math.max(1, Math.floor(Number(sp.s) || 1))),
  };
}

function uslovie(f: FiltrProdazh): { sql: string; params: unknown[] } {
  const chasti: string[] = [];
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return '$' + params.length;
  };
  const kogda = "(coalesce(o.paid_at, o.created_at) at time zone 'Europe/Moscow')::date";
  if (f.ot) chasti.push(kogda + ' >= ' + p(f.ot) + '::date');
  if (f.do) chasti.push(kogda + ' <= ' + p(f.do) + '::date');
  if (f.plan) chasti.push('o.plan_id = ' + p(f.plan));
  if (f.period) chasti.push('o.period = ' + p(f.period));
  if (f.status === 'podpiska') chasti.push('t.order_id is not null');
  else if (f.status) chasti.push('o.status = ' + p(f.status));
  if (f.q) {
    const ili: string[] = [];
    const nomer = f.q.replace(/^[№#\s]+/, '');
    if (/^\d{1,15}$/.test(nomer)) ili.push('o.id = ' + p(Number(nomer)));
    // Знаки шаблона в запросе — буквальные: «_» в адресе не значит «любой».
    const kusok = f.q.replace(/[\\%_]/g, (c) => '\\' + c);
    ili.push('u.email ilike ' + p('%' + kusok + '%'));
    if (f.q.includes('@')) {
      ili.push(
        'exists (select 1 from order_slot s where s.order_id = o.id and s.login_fp = ' +
          p(otpechatokPochty(f.q)) +
          ')',
      );
    }
    chasti.push('(' + ili.join(' or ') + ')');
  }
  return { sql: chasti.length ? 'where ' + chasti.join(' and ') : '', params };
}

/**
 * Кто «сотрудник» у строки. Закрытого — тот, кто закрыл (по журналу,
 * как в «Недавно закрытых»: `operator_id` у закрытого — остаток,
 * Р-153); заказа в работе — тот, у кого он сейчас.
 */
const SOTRUDNIK = `
  left join lateral (
    select e.staff_id from order_event e
     where e.order_id = o.id
       and e.vid = case when o.status = 'done' then 'vypolnil'
                        when t.order_id is not null then 'otmena_zaproshena'
                        else 'otmenil' end
     order by e.created_at desc, e.id desc limit 1) ev on o.status in ('done', 'cancelled')
  left join staff fs on fs.id = case when o.status in ('done', 'cancelled') then ev.staff_id else o.operator_id end`;

const IZ = `from shop_order o
    join app_user u on u.id = o.user_id
    left join sub_cancel t on t.order_id = o.id`;

export async function prodazhi(f: FiltrProdazh): Promise<{ vsego: number; stroki: StrokaProdazhi[] }> {
  const u = uslovie(f);
  const n = await odna<{ n: string }>('select count(*)::text as n ' + IZ + ' ' + u.sql, u.params);
  const vsego = Number(n?.n ?? 0);
  const otstup = (f.stranica - 1) * NA_STRANICE;
  const rows = await zapros<{
    id: string;
    paid_at: Date | null;
    created_at: Date;
    plan_id: string;
    period: number;
    kind: 'plan' | 'certificate';
    source: string;
    email: string;
    status: Status;
    otmena: boolean;
    staff: string | null;
    total_kop: string;
    promo_kod: string | null;
  }>(
    `select o.id, o.paid_at, o.created_at, o.plan_id, o.period, o.kind, o.source, u.email, o.status,
            (t.order_id is not null) as otmena, fs.email as staff, o.total_kop, o.promo_kod
       ${IZ}
       ${SOTRUDNIK}
       ${u.sql}
      order by o.id desc
      limit ${NA_STRANICE} offset ${otstup}`,
    u.params,
  );
  return {
    vsego,
    stroki: rows.map((r) => ({
      id: Number(r.id),
      paidAt: r.paid_at ? new Date(r.paid_at).toISOString() : null,
      createdAt: new Date(r.created_at).toISOString(),
      planId: r.plan_id,
      period: r.period,
      kind: r.kind,
      bySertificate: r.source === 'certificate',
      client: r.email,
      status: r.status,
      otmenaPodpiski: r.otmena,
      staff: r.staff,
      totalKop: Number(r.total_kop),
      promoKod: r.promo_kod,
    })),
  };
}

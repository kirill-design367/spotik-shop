/**
 * Выборки для кабинета и админки.
 *
 * ⚠️ РАСШИФРОВКА ЖИВЁТ ЗДЕСЬ И ТОЛЬКО ДЛЯ ДВУХ ЧИТАТЕЛЕЙ:
 * владельца заказа (его ВЫДАННЫЕ доступы) и оператора, который
 * ЭТОТ заказ взял (пароль от аккаунта клиента). Ни один другой
 * вызов открытого текста не получает — постановка двадцать седьмой
 * итерации.
 */

import { odna, zapros } from './db';
import { poprobovatRasshifrovat } from './crypto';
import { STATUS_SLOVAMI, type Rezhim, type Status } from './orders';
import { katalog, naytiTarif, podarokSlovami, srokKratko } from './catalog';
import { METKI } from './utm';

export type SlotKlientu = {
  idx: number;
  mode: Rezhim;
  gotov: boolean;
  /** Что выдал оператор. Только для mode='new' и только владельцу. */
  login: string | null;
  mailPass: string | null;
  spotifyPass: string | null;
};

export type ZakazKlientu = {
  id: number;
  kind: 'plan' | 'certificate';
  nazvanie: string;
  srok: string;
  status: Status;
  statusSlovami: string;
  totalKop: number;
  balanceKop: number;
  moneyKop: number;
  kDoplate: number;
  poSertifikatu: boolean;
  sozdan: Date;
  prichinaOtmeny: string | null;
  sekretyStyorty: boolean;
  slots: SlotKlientu[];
};

export async function moiZakazy(userId: number): Promise<ZakazKlientu[]> {
  const rows = await zapros<{
    id: string;
    kind: 'plan' | 'certificate';
    plan_id: string;
    period: number;
    status: Status;
    total_kop: string;
    balance_kop: string;
    money_kop: string;
    source: string;
    created_at: Date;
    cancel_reason: string | null;
    secrets_wiped_at: Date | null;
  }>(
    `select id, kind, plan_id, period, status, total_kop, balance_kop, money_kop, source,
            created_at, cancel_reason, secrets_wiped_at
       from shop_order where user_id = $1 order by created_at desc limit 100`,
    [userId],
  );
  if (!rows.length) return [];
  const slots = await zapros<{
    order_id: string;
    idx: number;
    mode: Rezhim;
    out_login_enc: string | null;
    out_mail_pass_enc: string | null;
    out_password_enc: string | null;
    done_at: Date | null;
  }>(
    `select order_id, idx, mode, out_login_enc, out_mail_pass_enc, out_password_enc, done_at
       from order_slot where order_id = any($1::bigint[]) order by idx`,
    [rows.map((r) => Number(r.id))],
  );
  const spisok = await katalog();

  return rows.map((r) => {
    const tarif = naytiTarif(spisok, r.plan_id);
    const svoi = slots.filter((s) => s.order_id === r.id);
    const total = Number(r.total_kop);
    const bal = Number(r.balance_kop);
    const mon = Number(r.money_kop);
    return {
      id: Number(r.id),
      kind: r.kind,
      /* ⚠️ У СЕРТИФИКАТА ТЕПЕРЬ ЕСТЬ ТАРИФ, и без него строка в кабинете
         не говорит, что именно куплено (Р-93). */
      nazvanie:
        r.kind === 'certificate'
          ? `Сертификат в подарок: ${tarif?.name ?? r.plan_id}`
          : (tarif?.name ?? r.plan_id),
      srok: srokKratko(r.period),
      status: r.status,
      statusSlovami: STATUS_SLOVAMI[r.status],
      totalKop: total,
      balanceKop: bal,
      moneyKop: mon,
      kDoplate: Math.max(0, total - bal - mon),
      poSertifikatu: r.source === 'certificate',
      sozdan: new Date(r.created_at),
      prichinaOtmeny: r.cancel_reason,
      sekretyStyorty: Boolean(r.secrets_wiped_at),
      slots: svoi.map((s) => ({
        idx: s.idx,
        mode: s.mode,
        gotov: Boolean(s.done_at),
        login: poprobovatRasshifrovat(s.out_login_enc),
        mailPass: poprobovatRasshifrovat(s.out_mail_pass_enc),
        spotifyPass: poprobovatRasshifrovat(s.out_password_enc),
      })),
    };
  });
}

export async function balans(userId: number): Promise<number> {
  const r = await odna<{ balance_kop: string }>('select balance_kop from app_user where id = $1', [userId]);
  return Number(r?.balance_kop ?? 0);
}

/* ── Админка ───────────────────────────────────────────────────── */

export type StrokaOcheredi = {
  id: number;
  plan: string;
  people: number;
  period: string;
  status: Status;
  paidAt: string | null;
  createdAt: string;
  operator: string | null;
  bySertificate: boolean;
};

export async function ochered(): Promise<StrokaOcheredi[]> {
  const rows = await zapros<{
    id: string;
    plan_id: string;
    period: number;
    status: Status;
    source: string;
    paid_at: Date | null;
    created_at: Date;
    operator: string | null;
    slots: string;
  }>(
    `select o.id, o.plan_id, o.period, o.status, o.source, o.paid_at, o.created_at,
            f.email as operator,
            (select count(*) from order_slot s where s.order_id = o.id)::text as slots
       from shop_order o
       left join staff f on f.id = o.operator_id
      where o.status in ('paid', 'in_work')
      order by o.paid_at asc nulls last, o.id asc
      limit 200`,
  );
  const spisok = await katalog();
  return rows.map((r) => ({
    id: Number(r.id),
    plan: naytiTarif(spisok, r.plan_id)?.name ?? r.plan_id,
    people: Number(r.slots),
    period: srokKratko(r.period),
    status: r.status,
    paidAt: r.paid_at ? new Date(r.paid_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
    operator: r.operator,
    bySertificate: r.source === 'certificate',
  }));
}

export type SlotOperatoru = {
  id: number;
  idx: number;
  mode: Rezhim;
  gotov: boolean;
  recoverySent: boolean;
  /** Открытый текст: только оператору, который взял ЭТОТ заказ. */
  clientLogin: string | null;
  clientPassword: string | null;
  outLogin: string | null;
  outMailPass: string | null;
  outPassword: string | null;
};

export type ZakazOperatoru = {
  id: number;
  plan: string;
  period: string;
  status: Status;
  clientEmail: string;
  operatorId: number | null;
  operatorEmail: string | null;
  bySertificate: boolean;
  totalKop: number;
  balanceKop: number;
  moneyKop: number;
  cancelReason: string | null;
  secretsWiped: boolean;
  /**
   * Откуда пришёл заказ. Пары «имя — значение» в порядке `METKI`;
   * пустых меток тут нет вовсе, поэтому пустой список означает
   * «пришёл без меток».
   *
   * ⚠️ ЭТО ДАННЫЕ, А НЕ НАДПИСЬ, и переводу они не подлежат (закон 40):
   * `utm_source=yandex` выглядит одинаково на любом языке админки.
   */
  utm: { imya: string; znachenie: string }[];
  slots: SlotOperatoru[];
};

/**
 * Карточка заказа для админки.
 *
 * `moy` — заказ взят ЭТИМ оператором. Только при `moy` наружу уходят
 * расшифрованные пароли; остальным видна структура заказа и ничего
 * больше.
 */
export async function zakazDlyaAdminki(id: number, staffId: number, admin: boolean): Promise<ZakazOperatoru | null> {
  const r = await odna<{
    id: string;
    plan_id: string;
    period: number;
    status: Status;
    source: string;
    email: string;
    operator_id: string | null;
    operator_email: string | null;
    total_kop: string;
    balance_kop: string;
    money_kop: string;
    cancel_reason: string | null;
    secrets_wiped_at: Date | null;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_term: string | null;
    utm_content: string | null;
  }>(
    `select o.id, o.plan_id, o.period, o.status, o.source, u.email,
            o.operator_id, f.email as operator_email,
            o.total_kop, o.balance_kop, o.money_kop, o.cancel_reason, o.secrets_wiped_at,
            o.utm_source, o.utm_medium, o.utm_campaign, o.utm_term, o.utm_content
       from shop_order o
       join app_user u on u.id = o.user_id
       left join staff f on f.id = o.operator_id
      where o.id = $1`,
    [id],
  );
  if (!r) return null;
  const moy = r.operator_id !== null && Number(r.operator_id) === staffId;
  const slots = await zapros<{
    id: string;
    idx: number;
    mode: Rezhim;
    in_login_enc: string | null;
    in_password_enc: string | null;
    out_login_enc: string | null;
    out_mail_pass_enc: string | null;
    out_password_enc: string | null;
    recovery_sent_at: Date | null;
    done_at: Date | null;
  }>(
    `select id, idx, mode, in_login_enc, in_password_enc, out_login_enc, out_mail_pass_enc,
            out_password_enc, recovery_sent_at, done_at
       from order_slot where order_id = $1 order by idx`,
    [id],
  );
  const spisok = await katalog();
  return {
    id: Number(r.id),
    plan: naytiTarif(spisok, r.plan_id)?.name ?? r.plan_id,
    period: srokKratko(r.period),
    status: r.status,
    clientEmail: r.email,
    operatorId: r.operator_id ? Number(r.operator_id) : null,
    operatorEmail: r.operator_email,
    bySertificate: r.source === 'certificate',
    utm: METKI.flatMap((m) => (r[m] ? [{ imya: m as string, znachenie: r[m] as string }] : [])),
    totalKop: Number(r.total_kop),
    balanceKop: Number(r.balance_kop),
    moneyKop: Number(r.money_kop),
    cancelReason: r.cancel_reason,
    secretsWiped: Boolean(r.secrets_wiped_at),
    slots: slots.map((s) => ({
      id: Number(s.id),
      idx: s.idx,
      mode: s.mode,
      gotov: Boolean(s.done_at),
      recoverySent: Boolean(s.recovery_sent_at),
      clientLogin: moy ? poprobovatRasshifrovat(s.in_login_enc) : null,
      clientPassword: moy ? poprobovatRasshifrovat(s.in_password_enc) : null,
      outLogin: moy ? poprobovatRasshifrovat(s.out_login_enc) : null,
      outMailPass: moy ? poprobovatRasshifrovat(s.out_mail_pass_enc) : null,
      outPassword: moy ? poprobovatRasshifrovat(s.out_password_enc) : null,
    })),
  };
}

export type VypushchennySertifikat = {
  id: number;
  tail: string;
  plan: string;
  period: string;
  chto: string;
  status: 'valid' | 'used' | 'expired';
  buyer: string | null;
  activatedBy: string | null;
  orderId: number | null;
  boughtAt: string;
  expiresAt: string;
  usedAt: string | null;
};

/**
 * Выпущенные сертификаты — для администратора.
 *
 * Постановка: «тариф, срок, статус, кто купил, кто активировал».
 * Кода здесь нет и быть не может: в базе лежит шифротекст, а читать
 * его вправе только владелец в своём кабинете (Р-87). Оператору
 * и администратору видно четыре последних знака — этого довольно,
 * чтобы сверить сертификат с тем, что показывает человек.
 */
export async function vypushchennyeSertifikaty(limit = 200): Promise<VypushchennySertifikat[]> {
  const rows = await zapros<{
    id: string;
    tail: string;
    plan_id: string;
    period: number;
    created_at: Date;
    expires_at: Date;
    used_at: Date | null;
    used_order_id: string | null;
    buyer: string | null;
    activator: string | null;
  }>(
    `select c.id, c.tail, c.plan_id, c.period, c.created_at, c.expires_at, c.used_at, c.used_order_id,
            b.email as buyer, a.email as activator
       from certificate c
       left join app_user b on b.id = c.buyer_id
       left join shop_order o on o.id = c.used_order_id
       left join app_user a on a.id = o.user_id
      order by c.created_at desc
      limit $1`,
    [limit],
  );
  if (!rows.length) return [];
  const spisok = await katalog();
  const teper = Date.now();
  return rows.map((r) => {
    const name = naytiTarif(spisok, r.plan_id)?.name ?? r.plan_id;
    return {
      id: Number(r.id),
      tail: r.tail,
      plan: name,
      period: srokKratko(r.period),
      chto: podarokSlovami(name, r.period),
      status: r.used_at ? 'used' : new Date(r.expires_at).getTime() < teper ? 'expired' : 'valid',
      buyer: r.buyer,
      activatedBy: r.activator,
      orderId: r.used_order_id ? Number(r.used_order_id) : null,
      boughtAt: new Date(r.created_at).toISOString(),
      expiresAt: new Date(r.expires_at).toISOString(),
      usedAt: r.used_at ? new Date(r.used_at).toISOString() : null,
    };
  });
}

export type ZakrytyyZakaz = { id: number; status: Status; closedAt: string; plan: string; client: string };

export async function zakrytye(limit = 50): Promise<ZakrytyyZakaz[]> {
  const rows = await zapros<{ id: string; status: Status; closed_at: Date; plan_id: string; email: string }>(
    `select o.id, o.status, o.closed_at, o.plan_id, u.email
       from shop_order o join app_user u on u.id = o.user_id
      where o.status in ('done', 'cancelled')
      order by o.closed_at desc limit $1`,
    [limit],
  );
  const spisok = await katalog();
  return rows.map((r) => ({
    id: Number(r.id),
    status: r.status,
    closedAt: new Date(r.closed_at).toISOString(),
    plan: naytiTarif(spisok, r.plan_id)?.name ?? r.plan_id,
    client: r.email,
  }));
}

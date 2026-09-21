/**
 * Сертификаты.
 *
 * Покупатель платит и получает КОД. Получатель вводит код на сайте,
 * входит по почте и выбирает: завести новый аккаунт или продлить свой.
 * Заказ уходит оператору без оплаты — деньги уже взяты при покупке.
 *
 * ⚠️ КОД ОДНОРАЗОВЫЙ. После активации он мёртв, и второй раз тем же
 * кодом заказ не оформить: пометка `used_at` ставится в той же
 * транзакции, что и создание заказа (см. orders.zakazPoSertifikatu).
 *
 * ⚠️ В БАЗЕ КОДА ОТКРЫТЫМ ТЕКСТОМ НЕТ. Лежат отпечаток (по нему
 * ищем) и шифротекст (по нему показываем владельцу в кабинете).
 * Унесённая база не даёт активировать ни одного сертификата.
 */

import { odna, zapros } from './db';
import { kanonKodaSertifikata, novyKodSertifikata, otpechatok, poprobovatRasshifrovat, shifrGotov, zashifrovat } from './crypto';
import { srokSertifikataDney } from './settings';
import { pismoSertifikatKuplen } from './letters';
import { srokPolno } from './catalog';
import { log } from './log';

export type Sertifikat = {
  id: number;
  kod: string | null;
  tail: string;
  period: number;
  planId: string;
  srokDo: Date;
  ispolzovan: boolean;
};

export async function vydatSertifikat(opts: {
  userId: number;
  email: string;
  period: number;
  zakaz: number;
}): Promise<void> {
  if (!shifrGotov()) {
    // Без ключа сертификат выдать нечем: код обязан лежать
    // зашифрованным, иначе его прочтёт любой, у кого есть база.
    log.error('сертификат не выдан: нет ключа шифрования', { order: opts.zakaz });
    return;
  }
  const dney = await srokSertifikataDney();
  const kod = novyKodSertifikata();
  await zapros(
    `insert into certificate (code_hash, code_enc, tail, plan_id, period, buyer_id, bought_order_id, expires_at)
     values ($1, $2, $3, 'gift', $4, $5, $6, now() + ($7 || ' days')::interval)`,
    [otpechatok(kod), zashifrovat(kod), kod.slice(-4), opts.period, opts.userId, opts.zakaz, String(dney)],
  );
  const do_ = new Date(Date.now() + dney * 86_400_000);
  await pismoSertifikatKuplen(opts.email, kod, do_, srokPolno(opts.period));
  log.info('сертификат выдан', { order: opts.zakaz, days: dney });
}

export async function moiSertifikaty(userId: number): Promise<Sertifikat[]> {
  const rows = await zapros<{
    id: string;
    code_enc: string;
    tail: string;
    period: number;
    plan_id: string;
    expires_at: Date;
    used_at: Date | null;
  }>(
    `select id, code_enc, tail, period, plan_id, expires_at, used_at
       from certificate where buyer_id = $1 order by created_at desc`,
    [userId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    kod: poprobovatRasshifrovat(r.code_enc),
    tail: r.tail,
    period: r.period,
    planId: r.plan_id,
    srokDo: new Date(r.expires_at),
    ispolzovan: Boolean(r.used_at),
  }));
}

export type NaydennyKod =
  | { ok: true; id: number; period: number; planId: string }
  | { ok: false; pochemu: 'ne_kod' | 'net' | 'ispolzovan' | 'istyok' };

export async function nayti(vvod: string): Promise<NaydennyKod> {
  const kod = kanonKodaSertifikata(vvod);
  if (!kod) return { ok: false, pochemu: 'ne_kod' };
  const r = await odna<{ id: string; period: number; plan_id: string; used_at: Date | null; expires_at: Date }>(
    'select id, period, plan_id, used_at, expires_at from certificate where code_hash = $1',
    [otpechatok(kod)],
  );
  if (!r) return { ok: false, pochemu: 'net' };
  if (r.used_at) return { ok: false, pochemu: 'ispolzovan' };
  if (new Date(r.expires_at).getTime() < Date.now()) return { ok: false, pochemu: 'istyok' };
  return { ok: true, id: Number(r.id), period: r.period, planId: r.plan_id };
}

export const POCHEMU_KOD: Record<'ne_kod' | 'net' | 'ispolzovan' | 'istyok', string> = {
  ne_kod: 'Код состоит из двенадцати знаков: SPOTIK-XXXX-XXXX-XXXX.',
  net: 'Такого сертификата нет. Проверьте код — буквы O и 0 в нём не встречаются.',
  ispolzovan: 'Этот сертификат уже активирован.',
  istyok: 'Срок действия сертификата истёк.',
};

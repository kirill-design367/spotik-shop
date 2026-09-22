/**
 * Сертификаты.
 *
 * Покупатель платит и получает КОД. Получатель вводит код на сайте,
 * входит по почте и выбирает: завести новый аккаунт или продлить свой.
 * Заказ уходит оператору без оплаты — деньги уже взяты при покупке.
 *
 * ⚠️ В КОДЕ ЗАШИТЫ ТАРИФ И СРОК (Р-93). Сертификат дарит ЛЮБОЙ тариф,
 * а не только «на одного», и стоит ровно столько, сколько этот тариф
 * на этот срок. Собственной цены у сертификата нет вовсе. Число
 * участников при активации берётся из ПОДАРЕННОГО тарифа, а не
 * из формы: иначе сертификат «на одного» оформлялся бы на троих.
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
import { katalog, naytiTarif, podarokSlovami } from './catalog';
import { log } from './log';

export type Sertifikat = {
  id: number;
  kod: string | null;
  tail: string;
  period: number;
  planId: string;
  /** Что подарено, одной строкой: «На двоих, полгода». */
  chto: string;
  srokDo: Date;
  ispolzovan: boolean;
};

export async function vydatSertifikat(opts: {
  userId: number;
  email: string;
  /** ПОДАРЕННЫЙ тариф: solo, duo, trio. Не 'gift'. */
  planId: string;
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
     values ($1, $2, $3, $4, $5, $6, $7, now() + ($8 || ' days')::interval)`,
    [otpechatok(kod), zashifrovat(kod), kod.slice(-4), opts.planId, opts.period, opts.userId, opts.zakaz, String(dney)],
  );
  const do_ = new Date(Date.now() + dney * 86_400_000);
  const tarif = naytiTarif(await katalog(), opts.planId);
  await pismoSertifikatKuplen(opts.email, kod, do_, podarokSlovami(tarif?.name ?? opts.planId, opts.period));
  log.info('сертификат выдан', { order: opts.zakaz, plan: opts.planId, period: opts.period, days: dney });
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
  if (!rows.length) return [];
  const spisok = await katalog();
  return rows.map((r) => ({
    id: Number(r.id),
    kod: poprobovatRasshifrovat(r.code_enc),
    tail: r.tail,
    period: r.period,
    planId: r.plan_id,
    chto: podarokSlovami(naytiTarif(spisok, r.plan_id)?.name ?? r.plan_id, r.period),
    srokDo: new Date(r.expires_at),
    ispolzovan: Boolean(r.used_at),
  }));
}

export type NaydennyKod =
  | { ok: true; id: number; period: number; planId: string; planName: string; mest: number; chto: string }
  | { ok: false; pochemu: 'ne_kod' | 'net' | 'ispolzovan' | 'istyok' | 'net_tarifa' };

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
  // ⚠️ ЧИСЛО МЕСТ БЕРЁТСЯ ИЗ ТАРИФА, А НЕ ИЗ ФОРМЫ. Форму человек
  // правит в браузере; сертификат «на одного» оформлялся бы на троих.
  const tarif = naytiTarif(await katalog(), r.plan_id);
  if (!tarif) return { ok: false, pochemu: 'net_tarifa' };
  return {
    ok: true,
    id: Number(r.id),
    period: r.period,
    planId: r.plan_id,
    planName: tarif.name,
    mest: tarif.people,
    chto: podarokSlovami(tarif.name, r.period),
  };
}

export const POCHEMU_KOD: Record<'ne_kod' | 'net' | 'ispolzovan' | 'istyok' | 'net_tarifa', string> = {
  ne_kod: 'Код состоит из двенадцати знаков: SPOTIK-XXXX-XXXX-XXXX.',
  net: 'Такого сертификата нет. Проверьте код — буквы O и 0 в нём не встречаются.',
  ispolzovan: 'Этот сертификат уже активирован.',
  istyok: 'Срок действия сертификата истёк.',
  net_tarifa: 'Тарифа из этого сертификата больше нет. Напишите нам — разберёмся руками.',
};

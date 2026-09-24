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

import { headers } from 'next/headers';

import { odna, zapros } from './db';
import { kanonKodaSertifikata, novyKodSertifikata, otpechatok, poprobovatRasshifrovat, shifrGotov, zashifrovat } from './crypto';
import { srokSertifikataDney } from './settings';
import { pismoSertifikatKuplen } from './letters';
import { katalog, naytiTarif, podarokSlovami } from './catalog';
import { log } from './log';
import { ktoKlient } from './auth';

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

export type Pochemu = 'ne_kod' | 'net' | 'ispolzovan' | 'istyok' | 'net_tarifa' | 'chasto_minuta' | 'chasto_chas';

export type NaydennyKod =
  | { ok: true; id: number; period: number; planId: string; planName: string; mest: number; chto: string }
  | { ok: false; pochemu: Pochemu };

/* ── Ограничение частоты ─────────────────────────────────────────── */

/**
 * ЛИМИТ НА ВВОД КОДА.
 *
 * Перебором код и так не берётся: двенадцать знаков из алфавита
 * в тридцать один — это около 59 бит. Но комментарий в `crypto.ts`
 * обещает запас «против перебора ПРИ ЖИВОМ ОГРАНИЧЕНИИ ПОПЫТОК»,
 * а ограничения не было ни одного: предпосылка не выполнялась.
 * Это гигиена, а не заплата на дыре.
 *
 * ⚠️ СЧЁТ ИДЁТ ПО ДВУМ ОСЯМ ПОРОЗНЬ — адрес и учётная запись, —
 * и хватает превышения по любой. Одной оси мало в обе стороны:
 * проверка кода открыта АНОНИМНО, то есть по учётной записи
 * у половины попыток считать нечего вовсе; а адрес у мобильного
 * оператора общий на тысячи людей, и одним адресом дело не закрыть.
 */
const V_MINUTU = 5;
const V_CHAS = 20;

/**
 * ⚠️ АДРЕС БЕРЁТСЯ ИЗ `X-Real-IP`, А НЕ ИЗ `X-Forwarded-For`.
 * Первый nginx ПЕРЕЗАПИСЫВАЕТ своим `$remote_addr`, что бы ни прислал
 * клиент; второй ДОПИСЫВАЕТ к присланному, поэтому доверять в нём
 * можно только последней записи. Заголовков нет вовсе — значит
 * до нас достучались в обход nginx, и все такие попытки идут
 * в ОДНУ общую корзину: лимит от этого строже, а не мягче.
 */
async function adresKlienta(): Promise<string> {
  const h = await headers();
  const realny = (h.get('x-real-ip') ?? '').trim();
  if (realny) return realny.slice(0, 64);
  const posledny = (h.get('x-forwarded-for') ?? '').split(',').pop()?.trim() ?? '';
  if (posledny) return posledny.slice(0, 64);
  return 'bez-adresa';
}

async function predelIscherpan(adres: string, userId: number | null): Promise<Pochemu | null> {
  const r = await odna<{ am: string; ach: string; um: string; uch: string }>(
    `select
       count(*) filter (where adres = $1 and created_at > now() - interval '1 minute')::text as am,
       count(*) filter (where adres = $1)::text as ach,
       count(*) filter (where user_id = $2 and created_at > now() - interval '1 minute')::text as um,
       count(*) filter (where user_id = $2)::text as uch
     from cert_try
    where created_at > now() - interval '1 hour'
      and (adres = $1 or ($2::bigint is not null and user_id = $2))`,
    [adres, userId],
  );
  if (!r) return null;
  if (Number(r.ach) >= V_CHAS || Number(r.uch) >= V_CHAS) return 'chasto_chas';
  if (Number(r.am) >= V_MINUTU || Number(r.um) >= V_MINUTU) return 'chasto_minuta';
  return null;
}

/**
 * Найти сертификат по введённому коду.
 *
 * ⚠️ ЛИМИТ ЖИВЁТ ЗДЕСЬ, А НЕ В СЕРВЕРНЫХ ДЕЙСТВИЯХ, и это не вкус.
 * Дверей к коду две — проверка и активация, — и обе зовут `nayti()`.
 * Поставь счётчик в действиях, и второе место однажды забудут;
 * здесь забыть его нельзя, потому что мимо этой функции кода
 * не прочитать вовсе.
 *
 * ⚠️ ЛИМИТ ПРОВЕРЯЕТСЯ ДО КАНОНИЗАЦИИ И ДО ПОХОДА В БАЗУ. Отсюда
 * следует ровно то, что просила постановка: отказ по частоте ничего
 * не говорит о самом коде — он одинаков и для выдуманного кода,
 * и для настоящего, и приходит за одно и то же время.
 */
export async function nayti(vvod: string): Promise<NaydennyKod> {
  const adres = await adresKlienta();
  const kto = await ktoKlient();
  const userId = kto?.userId ?? null;

  const chasto = await predelIscherpan(adres, userId);
  if (chasto) {
    // Адрес пишем целиком: по нему и только по нему можно закрыть
    // перебор файрволом. Почты и кода в строке нет.
    log.warn('перебор кода сертификата', { adres, user: userId ?? 0, predel: chasto });
    // ⚠️ ОТКАЗ ПО ЧАСТОТЕ САМ В СЧЁТ НЕ ИДЁТ. Пиши мы и его,
    // человек, который жмёт кнопку от досады, продлевал бы себе
    // запрет бесконечно и не выбрался бы из него никогда.
    return { ok: false, pochemu: chasto };
  }

  /** Неудача: записать попытку и назвать причину. */
  const mimo = async (pochemu: Pochemu): Promise<NaydennyKod> => {
    await zapros('insert into cert_try (adres, user_id) values ($1, $2)', [adres, userId]);
    return { ok: false, pochemu };
  };

  const kod = kanonKodaSertifikata(vvod);
  if (!kod) return mimo('ne_kod');
  const r = await odna<{ id: string; period: number; plan_id: string; used_at: Date | null; expires_at: Date }>(
    'select id, period, plan_id, used_at, expires_at from certificate where code_hash = $1',
    [otpechatok(kod)],
  );
  if (!r) return mimo('net');
  if (r.used_at) return mimo('ispolzovan');
  if (new Date(r.expires_at).getTime() < Date.now()) return mimo('istyok');
  // ⚠️ ЧИСЛО МЕСТ БЕРЁТСЯ ИЗ ТАРИФА, А НЕ ИЗ ФОРМЫ. Форму человек
  // правит в браузере; сертификат «на одного» оформлялся бы на троих.
  const tarif = naytiTarif(await katalog(), r.plan_id);
  if (!tarif) return mimo('net_tarifa');
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

export const POCHEMU_KOD: Record<Pochemu, string> = {
  ne_kod: 'Код состоит из двенадцати знаков: SPOTIK-XXXX-XXXX-XXXX.',
  net: 'Такого сертификата нет. Проверьте код — буквы O и 0 в нём не встречаются.',
  ispolzovan: 'Этот сертификат уже активирован.',
  istyok: 'Срок действия сертификата истёк.',
  net_tarifa: 'Тарифа из этого сертификата больше нет. Напишите нам — разберёмся руками.',
  // ⚠️ ОБЕ СТРОКИ НЕ ГОВОРЯТ О САМОМ КОДЕ НИЧЕГО. Они приходят
  // раньше, чем код вообще смотрят, — значит и выдуманный код,
  // и настоящий получают один и тот же ответ.
  chasto_minuta: 'Слишком много попыток. Подождите минуту и попробуйте снова.',
  chasto_chas: 'Слишком много попыток. Попробуйте через час или напишите нам — поможем руками.',
};

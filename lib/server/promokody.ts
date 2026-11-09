/**
 * Промокоды: заведение, правка, проверка, занятие активации, возврат.
 *
 * Перенесено из Нейролавки (`bot/src/db/promokody.ts`) на PostgreSQL.
 * Три вещи там были важнее всего, и все три переехали как есть (Р-167):
 *
 * 1. АКТИВАЦИИ — ЭТО СТРОКИ, А НЕ СЧЁТЧИК. «Использовано» считается
 *    по `promo_aktivaciya`, а не хранится числом рядом.
 *
 * 2. ДВОИХ НА ПОСЛЕДНЮЮ АКТИВАЦИЮ РАЗНИМАЕТ БАЗА. У активации есть
 *    НОМЕР МЕСТА от 1 до объявленного числа, на занятые места стоит
 *    частичный уникальный индекс `promo_mesto_zanyato`, и свободное
 *    место ищется и занимается ОДНИМ оператором. Сверху строка кода
 *    берётся `for update`: две активации одного кода идут по очереди,
 *    а индекс остаётся сеткой под этим замком.
 *
 * 3. ОТМЕНА ВОЗВРАЩАЕТ АКТИВАЦИЮ, НЕ СТИРАЯ ИСТОРИИ: `snyata_v`
 *    проставляется той же транзакцией, что возвращает деньги.
 *
 * ⚠️ АКТИВАЦИЯ ТРАТИТСЯ ПРИ ОФОРМЛЕНИИ ЗАКАЗА, а не при проверке кода
 * в форме. Код, сгоревший у того, кто посмотрел цену и передумал, —
 * это код, отобранный у того, кто дошёл до конца. Проверка поэтому
 * не пишет в базу ничего, кроме счётчика неудач для предела частоты.
 */

import type { PoolClient } from 'pg';
import { headers } from 'next/headers';

import { odna, zapros } from './db';
import { log } from './log';
import { kodPromo, skidkaKop, type OtkazPromo } from '../promokod';

export type Promokod = {
  kod: string;
  skidkaProc: number;
  /** День, до которого код работает включительно, `ГГГГ-ММ-ДД`. */
  doDaty: string;
  aktivaciy: number;
  otklyuchen: boolean;
  createdAt: Date;
};

export type Svodka = Promokod & {
  ispolzovano: number;
  ostalos: number;
  deystvuet: boolean;
  pochemu: 'istyok' | 'konchilis' | 'otklyuchen' | null;
};

export type Primenenie = {
  orderId: number;
  email: string;
  skidkaKop: number;
  createdAt: Date;
  snyataV: Date | null;
  status: string;
};

/** Потолок числа активаций, как в Нейролавке. */
export const PREDEL_AKTIVACIY = 10_000;

/** Алфавит придуманного кода: без 0, O, 1, I, L — их путают глазами. */
const ALFAVIT = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function pridumatKod(dlina = 8): string {
  const b = new Uint8Array(dlina);
  crypto.getRandomValues(b);
  let s = '';
  for (const n of b) s += ALFAVIT[n % ALFAVIT.length];
  return s;
}

type Stroka = {
  kod: string;
  skidka_proc: number;
  do_daty: string;
  aktivaciy: number;
  otklyuchen: boolean;
  created_at: Date;
  ispolzovano: string;
  istyok: boolean;
};

/**
 * Свод по коду. «Истёк» считается ПО МОСКВЕ: день в форме админки —
 * московский день, а часы базы стоят в UTC, и `current_date` убивал бы
 * код в три часа ночи по Москве вместо полуночи.
 */
const SVOD = `
  select p.kod, p.skidka_proc, to_char(p.do_daty, 'YYYY-MM-DD') as do_daty,
         p.aktivaciy, p.otklyuchen, p.created_at,
         (select count(*) from promo_aktivaciya a
           where a.kod = p.kod and a.snyata_v is null)::text as ispolzovano,
         (p.do_daty < (now() at time zone 'Europe/Moscow')::date) as istyok
    from promokod p`;

function svodka(r: Stroka): Svodka {
  const ispolzovano = Number(r.ispolzovano);
  const ostalos = Math.max(0, r.aktivaciy - ispolzovano);
  const pochemu = r.otklyuchen ? 'otklyuchen' : r.istyok ? 'istyok' : ostalos <= 0 ? 'konchilis' : null;
  return {
    kod: r.kod,
    skidkaProc: r.skidka_proc,
    doDaty: r.do_daty,
    aktivaciy: r.aktivaciy,
    otklyuchen: r.otklyuchen,
    createdAt: r.created_at,
    ispolzovano,
    ostalos,
    deystvuet: pochemu === null,
    pochemu,
  };
}

/** Все коды, свежие сверху. */
export async function vse(): Promise<Svodka[]> {
  const rows = await zapros<Stroka>(`${SVOD} order by p.created_at desc`);
  return rows.map(svodka);
}

export async function po(syroe: string): Promise<Svodka | null> {
  const kod = kodPromo(syroe);
  if (!kod) return null;
  const r = await odna<Stroka>(`${SVOD} where p.kod = $1`, [kod]);
  return r ? svodka(r) : null;
}

/** Кем и когда применялся. Свежие сверху; возвращённые помечены. */
export async function primeneniya(kod: string, skolko = 30): Promise<Primenenie[]> {
  const rows = await zapros<{
    order_id: string;
    email: string;
    skidka_kop: string;
    created_at: Date;
    snyata_v: Date | null;
    status: string;
  }>(
    `select a.order_id, u.email, a.skidka_kop, a.created_at, a.snyata_v, o.status
       from promo_aktivaciya a
       join app_user u on u.id = a.user_id
       join shop_order o on o.id = a.order_id
      where a.kod = $1
      order by a.id desc
      limit $2`,
    [kodPromo(kod), skolko],
  );
  return rows.map((r) => ({
    orderId: Number(r.order_id),
    email: r.email,
    skidkaKop: Number(r.skidka_kop),
    createdAt: r.created_at,
    snyataV: r.snyata_v,
    status: r.status,
  }));
}

export type OshibkaKoda = 'net_koda' | 'zanyat' | 'nevernaya_skidka' | 'net_sroka' | 'nevernye_aktivacii' | 'net' | 'malo_aktivaciy';

function proveritPolya(z: { skidkaProc: number; doDaty: string; aktivaciy: number }): OshibkaKoda | null {
  if (!Number.isInteger(z.skidkaProc) || z.skidkaProc < 1 || z.skidkaProc > 100) return 'nevernaya_skidka';
  // Потолок не от вкуса: свободное место ищется перебором номеров.
  if (!Number.isInteger(z.aktivaciy) || z.aktivaciy < 1 || z.aktivaciy > PREDEL_AKTIVACIY) return 'nevernye_aktivacii';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(z.doDaty) || Number.isNaN(Date.parse(z.doDaty))) return 'net_sroka';
  return null;
}

/**
 * Завести код. Пустое поле кода — «придумай сам»: чаще всего нужна
 * скидка, а не буквы. Совпадение с существующим — отказ: тихо
 * переписать чужой код новой скидкой нельзя, у него уже бывают
 * применения.
 */
export async function zavesti(
  z: { kod: string; skidkaProc: number; doDaty: string; aktivaciy: number },
  staffId: number,
): Promise<{ kod: string } | { oshibka: OshibkaKoda }> {
  const vvedeno = (z.kod ?? '').trim();
  const kod = vvedeno ? kodPromo(vvedeno) : pridumatKod();
  if (!kod) return { oshibka: 'net_koda' };
  const beda = proveritPolya(z);
  if (beda) return { oshibka: beda };
  const r = await zapros(
    `insert into promokod (kod, skidka_proc, do_daty, aktivaciy, staff_id)
     values ($1, $2, $3::date, $4, $5)
     on conflict (kod) do nothing
     returning kod`,
    [kod, z.skidkaProc, z.doDaty, z.aktivaciy, staffId],
  );
  if (r.length === 0) return { oshibka: 'zanyat' };
  return { kod };
}

/**
 * Изменить скидку, срок и число активаций.
 *
 * ⚠️ В НЕЙРОЛАВКЕ ПРАВКИ НЕТ — ЕЁ ПОПРОСИЛА ПОСТАНОВКА. Сам код
 * не меняется: на него ссылаются заказы. И активаций нельзя сделать
 * меньше, чем уже занято: иначе на коде висели бы активации на местах,
 * которых больше нет. Уже применённые скидки правка не трогает —
 * у каждой лежит свой снимок.
 */
export async function izmenit(
  syroe: string,
  z: { skidkaProc: number; doDaty: string; aktivaciy: number },
): Promise<{ kod: string } | { oshibka: OshibkaKoda }> {
  const kod = kodPromo(syroe);
  if (!kod) return { oshibka: 'net' };
  const beda = proveritPolya(z);
  if (beda) return { oshibka: beda };
  const s = await po(kod);
  if (!s) return { oshibka: 'net' };
  if (z.aktivaciy < s.ispolzovano) return { oshibka: 'malo_aktivaciy' };
  await zapros('update promokod set skidka_proc = $2, do_daty = $3::date, aktivaciy = $4 where kod = $1', [
    kod,
    z.skidkaProc,
    z.doDaty,
    z.aktivaciy,
  ]);
  return { kod };
}

/** Отключить или включить обратно. Удаления нет: на код ссылаются заказы. */
export async function otklyuchit(syroe: string, otklyuchen: boolean): Promise<boolean> {
  const kod = kodPromo(syroe);
  if (!kod) return false;
  const r = await zapros('update promokod set otklyuchen = $2 where kod = $1 returning kod', [kod, otklyuchen]);
  return r.length > 0;
}

export type ItogPromo =
  | { godit: true; kod: string; skidkaProc: number }
  | { godit: false; pochemu: OtkazPromo };

function itogIz(s: Svodka | null): ItogPromo {
  if (!s) return { godit: false, pochemu: 'net' };
  if (s.pochemu) return { godit: false, pochemu: s.pochemu };
  return { godit: true, kod: s.kod, skidkaProc: s.skidkaProc };
}

// ── предел частоты ────────────────────────────────────────────────

/** Те же величины, что у кода сертификата (Р-107). */
const V_MINUTU = 5;
const V_CHAS = 20;

async function adresKlienta(): Promise<string> {
  const h = await headers();
  const realny = (h.get('x-real-ip') ?? '').trim();
  if (realny) return realny.slice(0, 64);
  const posledny = (h.get('x-forwarded-for') ?? '').split(',').pop()?.trim() ?? '';
  if (posledny) return posledny.slice(0, 64);
  return 'bez-adresa';
}

async function chasto(adres: string, userId: number): Promise<boolean> {
  const r = await odna<{ am: string; ach: string; um: string; uch: string }>(
    `select
       count(*) filter (where adres = $1 and created_at > now() - interval '1 minute')::text as am,
       count(*) filter (where adres = $1)::text as ach,
       count(*) filter (where user_id = $2 and created_at > now() - interval '1 minute')::text as um,
       count(*) filter (where user_id = $2)::text as uch
     from promo_try
    where created_at > now() - interval '1 hour'
      and (adres = $1 or user_id = $2)`,
    [adres, userId],
  );
  if (!r) return false;
  return Number(r.ach) >= V_CHAS || Number(r.uch) >= V_CHAS || Number(r.am) >= V_MINUTU || Number(r.um) >= V_MINUTU;
}

/**
 * Годится ли код прямо сейчас — для формы оформления.
 *
 * ⚠️ ОТВЕТ ПРЕДВАРИТЕЛЬНЫЙ: между «форма спросила» и «человек
 * оформил» последнюю активацию может забрать другой. Настоящее решение
 * принимается при оформлении — `zanyat` внутри транзакции заказа.
 *
 * ⚠️ ПРЕДЕЛ ЧАСТОТЫ ПРОВЕРЯЕТСЯ ДО ПОИСКА, а в счёт идут только
 * неудачи — то же устройство, что у кода сертификата (Р-107): отказ
 * по частоте ничего не говорит о самом коде.
 */
export async function proverit(syroe: string, userId: number): Promise<ItogPromo> {
  const adres = await adresKlienta();
  if (await chasto(adres, userId)) {
    log.warn('перебор промокода', { adres, user: userId });
    return { godit: false, pochemu: 'chasto' };
  }
  const itog = itogIz(await po(syroe));
  if (!itog.godit) {
    await zapros('insert into promo_try (adres, user_id) values ($1, $2)', [adres, userId]);
  }
  return itog;
}

// ── внутри транзакции заказа ─────────────────────────────────────

/**
 * Занять активацию под заказ — ВНУТРИ транзакции создания заказа.
 *
 * Строка кода берётся `for update`: правка, отключение и чужая
 * активация того же кода ждут. Свободное место ищется и занимается
 * одним оператором; ноль вставленных строк значит ровно одно —
 * свободных мест нет.
 */
export async function zanyat(
  c: PoolClient,
  syroe: string,
  orderId: number,
  userId: number,
  cenaKop: number,
): Promise<{ zanyali: true; kod: string; skidkaKop: number; skidkaProc: number } | { zanyali: false; pochemu: OtkazPromo }> {
  const kod = kodPromo(syroe);
  if (!kod) return { zanyali: false, pochemu: 'net' };
  const p = (
    await c.query<{ skidka_proc: number; aktivaciy: number; otklyuchen: boolean; istyok: boolean }>(
      `select skidka_proc, aktivaciy, otklyuchen,
              (do_daty < (now() at time zone 'Europe/Moscow')::date) as istyok
         from promokod where kod = $1 for update`,
      [kod],
    )
  ).rows[0];
  if (!p) return { zanyali: false, pochemu: 'net' };
  if (p.otklyuchen) return { zanyali: false, pochemu: 'otklyuchen' };
  if (p.istyok) return { zanyali: false, pochemu: 'istyok' };
  // Цены нет — активацию не тратим: сжечь её ради нулевой скидки
  // было бы то же самое, что показать рубль вместо неизвестной цены.
  const skidka = skidkaKop(cenaKop, p.skidka_proc);
  if (skidka <= 0) return { zanyali: false, pochemu: 'net_ceny' };
  const r = await c.query(
    `insert into promo_aktivaciya (kod, mesto, order_id, user_id, skidka_kop)
     select $1, n, $2, $3, $4
       from generate_series(1, $5::int) as n
      where n not in (select mesto from promo_aktivaciya where kod = $1 and snyata_v is null)
        -- ⚠️ И ЧИСЛО ЗАНЯТЫХ — ОТДЕЛЬНЫМ УСЛОВИЕМ. После правки «активаций
        -- меньше» занятое место может стоять ВЫШЕ нового предела, а под
        -- ним остаться дырка от возвращённой активации: одним поиском
        -- свободного номера код выдал бы на одну больше объявленного.
        and (select count(*) from promo_aktivaciya where kod = $1 and snyata_v is null) < $5::int
      order by n
      limit 1
     on conflict (kod, mesto) where snyata_v is null do nothing
     returning id`,
    [kod, orderId, userId, skidka, p.aktivaciy],
  );
  if (r.rowCount === 0) return { zanyali: false, pochemu: 'konchilis' };
  return { zanyali: true, kod, skidkaKop: skidka, skidkaProc: p.skidka_proc };
}

/**
 * Вернуть активацию коду. Зовётся ИЗ ТОЙ ЖЕ транзакции, что отменяет
 * заказ: раздельно бывает «заказ отменён, активация сгорела», и узнать
 * о нём можно только от человека, которому код не подошёл второй раз.
 */
export async function vernut(c: PoolClient, orderId: number): Promise<number> {
  const r = await c.query('update promo_aktivaciya set snyata_v = now() where order_id = $1 and snyata_v is null', [
    orderId,
  ]);
  return r.rowCount ?? 0;
}

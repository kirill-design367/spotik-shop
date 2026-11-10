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
import { cookies, headers } from 'next/headers';

import { odna, zapros } from './db';
import { log } from './log';
import { KUKA_PROMO, kodPromo, skidkaKop, type OtkazPromo } from '../promokod';
import { nastoyashchayaData } from '../data';

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
  if (!nastoyashchayaData(z.doDaty)) return 'net_sroka';
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

/**
 * Сработал ли предел — и какой: минутный ждать минуту, часовой час.
 * Человеку они говорят разное, иначе «подождите минуту» врало бы
 * тому, кого держит часовой (то же разведение, что у кода
 * сертификата, Р-107).
 */
async function chasto(adres: string, userId: number): Promise<'chasto' | 'chasto_chas' | null> {
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
  if (!r) return null;
  if (Number(r.ach) >= V_CHAS || Number(r.uch) >= V_CHAS) return 'chasto_chas';
  if (Number(r.am) >= V_MINUTU || Number(r.um) >= V_MINUTU) return 'chasto';
  return null;
}

/**
 * ⚠️ ДВЕРЕЙ К КОДУ ДВЕ, И ПРЕДЕЛ СТОИТ У ОБЕИХ: «Применить» на форме
 * и само оформление заказа. Серверное действие оформления — обычная
 * точка входа, и стучаться в него можно мимо «Применить», с любым
 * кодом в скрытом поле: без предела там промокод перебирался бы без
 * счёта. Та же ошибка «двух дверей», от которой Р-107 уводит код
 * сертификата. Отказ по частоте ничего не говорит о самом коде.
 */
export async function predel(userId: number): Promise<'chasto' | 'chasto_chas' | null> {
  const adres = await adresKlienta();
  const kak = await chasto(adres, userId);
  if (kak) log.warn('перебор промокода', { adres, user: userId });
  return kak;
}

/**
 * Записать неудачу. Зовётся ВНЕ транзакции заказа: та откатывается
 * целиком, и запись, сделанная внутри неё, пропала бы вместе с ней.
 * В счёт идут только неудачи — честный путь зовёт проверку дважды
 * одним и тем же верным кодом.
 */
export async function neudacha(userId: number): Promise<void> {
  await zapros('insert into promo_try (adres, user_id) values ($1, $2)', [await adresKlienta(), userId]);
}

/**
 * Есть ли у этого человека ЖИВАЯ активация этого кода — и какая.
 *
 * ⚠️ НЕОПЛАЧЕННЫЙ ЗАКАЗ ДЕРЖИТ АКТИВАЦИЮ, И ОДНОМУ ЧЕЛОВЕКУ ТАКОЙ
 * ЗАКАЗ НА КОД — ОДИН (`uzhe`). Активация занимается при оформлении
 * (иначе её забирал бы тот, кто передумал), а неоплаченный заказ сам
 * собой не отменяется: без этого правила «Оформить» в цикле разбирало
 * бы код с ограниченным числом активаций, не заплатив ни рубля. Это то
 * же, что в Нейролавке держит один открытый заказ на человека (там
 * повтор возвращает первый заказ).
 *
 * ⚠️ А С ПЯТЬДЕСЯТ ЧЕТВЁРТОЙ ИТЕРАЦИИ ПРОМОКОД — ОДИН РАЗ НА ЧЕЛОВЕКА
 * (`ispolzovan`), постановка: живая активация на оплаченном, взятом,
 * выполненном или отменённом ПОДПИСКОЙ заказе значит «код потрачен».
 * Отменённый до выполнения заказ активацию вернул (`snyata_v`,
 * `vernut` ниже) и потому не считается: код снова годится.
 *
 * Ответ один на оба правила, и `uzhe` в нём побеждает: подсказка
 * «оплатите или отмените» полезнее, чем «уже использовали», — ровно
 * её человек и может исполнить.
 *
 * ⚠️ УНИКАЛЬНОГО ИНДЕКСА «ОДНА ЖИВАЯ АКТИВАЦИЯ НА ЧЕЛОВЕКА» НЕТ
 * НАМЕРЕННО: на боевой базе до этой итерации повторы законно бывали,
 * и индекс уронил бы миграцию. Двоих одновременных разнимает
 * `for update` строки кода в `zanyat`: вторая транзакция ждёт первую
 * и следующим запросом видит её активацию.
 */
async function svoyaAktivaciya(
  q: PoolClient | null,
  kod: string,
  userId: number,
  krome: number | null,
): Promise<'uzhe' | 'ispolzovan' | null> {
  const sql = `select bool_or(o.status = 'new') as neoplachen
                 from promo_aktivaciya a
                 join shop_order o on o.id = a.order_id
                where a.kod = $1 and a.user_id = $2 and a.snyata_v is null
                  and ($3::bigint is null or a.order_id <> $3)`;
  const p = [kod, userId, krome];
  const r = q
    ? ((await q.query<{ neoplachen: boolean | null }>(sql, p)).rows[0] ?? null)
    : await odna<{ neoplachen: boolean | null }>(sql, p);
  // Строк нет — `bool_or` отдаёт null: своей живой активации нет вовсе.
  if (!r || r.neoplachen === null) return null;
  return r.neoplachen ? 'uzhe' : 'ispolzovan';
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
  const kak = await predel(userId);
  if (kak) return { godit: false, pochemu: kak };
  const s = await po(syroe);
  /* ⚠️ ПОРЯДОК СТРОГИЙ: «уже применён» → «уже использовали» → прочее,
     ровно как в `zanyat`. Код существует, и этот человек его уже
     применял — это не перебор, и в счёт неудач такой ответ не идёт:
     иначе человек, честно жавший «Применить» на своём же коде, упёрся
     бы в «слишком много попыток». Проверяется и РАНЬШЕ «кончились»:
     последнюю активацию может держать как раз сам спрашивающий, и тогда
     «разобрали» было бы неправдой — разобрал её он. */
  if (s) {
    const svoya = await svoyaAktivaciya(null, s.kod, userId, null);
    if (svoya) return { godit: false, pochemu: svoya };
  }
  const itog = itogIz(s);
  if (!itog.godit) await neudacha(userId);
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
  /* ⚠️ «УЖЕ ПРИМЕНЁН» И «УЖЕ ИСПОЛЬЗОВАЛИ» — ПЕРВЫМИ И ПОД ЭТИМ ЖЕ
     `for update`: две транзакции одного человека на один код идут
     по очереди, и вторая видит активацию первой. Заказ, который сейчас
     создаётся, исключён — его активации ещё нет, но и считать его
     «своим прежним» было бы неправдой. */
  const svoya = await svoyaAktivaciya(c, kod, userId, orderId);
  if (svoya) return { zanyali: false, pochemu: svoya };
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

// ── код из ссылки `?promo=` ──────────────────────────────────────

/**
 * Код из промо-ссылки, если человек по ней приходил, — уже приведённый
 * к правилу кода. Пусто — ссылки не было. Зовётся страницей оформления
 * (она динамическая); лендингу `cookies()` нельзя (закон 36), там куку
 * ставит сам браузер.
 *
 * ⚠️ ЭТО НЕ ПРОВЕРКА И НЕ ПРИЗНАК «ИЗ ССЫЛКИ» ДЛЯ СЕРВЕРА. Форма
 * применяет код ТОЙ ЖЕ проверкой, что кнопка «Применить», с тем же
 * пределом частоты и тем же счётом неудач: флаг «из ссылки, не считать»
 * был бы дверью мимо предела. Один раз — держит сама форма: после первой
 * попытки она стирает куку (если код не подошёл) и убирает `promo`
 * из адреса.
 */
export async function promoIzKuki(): Promise<string> {
  try {
    return kodPromo((await cookies()).get(KUKA_PROMO)?.value);
  } catch {
    /* Куку читать неоткуда (сборка, фоновая задача) — ссылки нет. */
    return '';
  }
}

/**
 * Заказ с кодом из ссылки оформлен — кука больше не нужна. Стирается
 * только если в ней ТОТ ЖЕ код: заказ с другим кодом (человек убрал
 * код из ссылки и ввёл свой) куку не трогает, а без кода — тем более.
 */
export async function steretPromoKuku(kodZakaza: string): Promise<void> {
  const kod = kodPromo(kodZakaza);
  if (!kod) return;
  try {
    const jar = await cookies();
    if (kodPromo(jar.get(KUKA_PROMO)?.value) === kod) jar.delete(KUKA_PROMO);
  } catch {
    /* Не из запроса — стирать нечего. */
  }
}

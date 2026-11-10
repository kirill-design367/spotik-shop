/**
 * РАЗДАЧА ЗАКАЗОВ ОПЕРАТОРАМ В TELEGRAM (пятьдесят четвёртая итерация).
 *
 * Постановка: «Каждый новый оплаченный заказ автоматически назначается
 * оператору по очереди среди тех, кому в „Сотрудниках" разрешена эта
 * пара „тариф × срок"… Если оператор не взял заказ за 15 минут — заказ
 * переходит к следующему по кругу… Если круг пройден и никто не взял —
 * сообщение Льву в группу, заказ в общей очереди… Вне рабочего времени
 * заказы копятся и раздаются по кругу в 10:00».
 *
 * Состояние раздачи живёт в самой строке заказа (`shop_order.razdacha`,
 * `offer_staff_id`, `offer_until`), и ТОЛЬКО его читают видимость
 * очереди (`dostup.ts`) и взятие (`vzyatZakaz`). `order_offer` — история
 * предложений и номера личных сообщений (поправка concurrency-9):
 *   `null`        — как до раздачи: общая очередь;
 *   `zhdyot`      — копится, операторам не виден (ночь или ещё
 *                   не раздан);
 *   `predlozhen`  — предложен одному оператору до `offer_until`;
 *   `obshchaya`   — круг пройден или раздавать некому: общая очередь.
 *
 * ⚠️ НАЧАЛЬНОЕ СОСТОЯНИЕ СТАВИТСЯ ВНУТРИ ОПЛАЧИВАЮЩЕЙ ТРАНЗАКЦИИ
 * (`nachatRazdachu`, поправка concurrency-1). После коммита с `null`
 * заказ на десятки секунд стал бы виден всем разрешённым операторам —
 * пока уходят письмо и сообщение в группу, — а это ломает «заказ сразу
 * виден только ему». `zhdyot` ставится, только если есть хоть один
 * пригодный оператор; иначе сразу `obshchaya`. Поэтому без привязок
 * (CI, `verify-shop`, день выкладки) очередь ведёт себя как раньше
 * в любой час.
 *
 * ⚠️ ПОРЯДОК БЛОКИРОВОК ОДИН НА ВСЕ ПУТИ, ГДЕ ЕСТЬ ПРЕДЛОЖЕНИЕ
 * (поправка concurrency-2): СНАЧАЛА `pg_advisory_xact_lock(ZAMOK)`,
 * ЗАТЕМ `for update` строки заказа. Оплата и взятие замка не берут —
 * им выбирать оператора не нужно, и строку заказа они держат одну.
 * Отдельной «аренды» тика нет: каждая транзакция перепроверяет условия
 * под замком, и два экземпляра приложения (выкладка, второй сервер
 * сторожа) друг другу не мешают.
 *
 * ⚠️ НИ TELEGRAM, НИ ПОЧТА ПОД БЛОКИРОВКОЙ: сначала коммит, потом
 * отправка. Поход в сеть внутри транзакции держал бы замок раздачи
 * на пятнадцать секунд таймаута.
 *
 * ⚠️ ЛИЧНОЕ СООБЩЕНИЕ О ПРЕДЛОЖЕНИИ ШЛЁТСЯ НАПРЯМУЮ, А НЕ ЧЕРЕЗ ОЧЕРЕДЬ
 * (поправка concurrency-8, -6). Очередь повторяет часами, а предложение
 * живёт минуты: через час оператор получил бы живую кнопку «Take»
 * к предложению, которого давно нет. Не ушло — предложение закрывается
 * сразу (`ne_dostavleno`), и заказ идёт следующему.
 *
 * ⚠️ В ЖУРНАЛ НОМЕР ЗАКАЗА — ТОЛЬКО ПОЛЕМ (`{ order }`), никогда словами
 * «заказ №» (поправка concurrency-10: сторож ищет их по всему журналу),
 * почта сотрудника — огрызком.
 *
 * ⚠️ ОПЕРАТОР ПО-ПРЕЖНЕМУ НЕ ЗНАЕТ, ЧТО ЕСТЬ ДРУГИЕ (постановка):
 * в его личке нет ни чужих имён, ни слов «передан другому».
 */

import type { PoolClient } from 'pg';
import { bazaEst, odna, vTranzakcii, zapros } from './db';
import { env } from './env';
import { log, pochtaVZhurnal } from './log';
import { rabocheeVremya } from '@/lib/chasy';
import { vremyaNaVzyatieMinut } from './settings';
import { ispravitLichnoe, lichkaZakryta, nomerSoobshcheniya, poslatLichno, type Itog } from './telegram';
import {
  knopkaVzyat,
  tekstBolsheNePredlozhen,
  tekstNaznachen,
  tekstPereNaznachen,
  tekstPredlozheniya,
  tekstTvoy,
} from './lichka';
import { soobshchitKomande, type SobytieKomande } from './notify';
import { imenaTarifov } from './imena';
import { imyaTarifaIz, srokDlyaSotrudnika } from '@/lib/plans';

/** Замок раздачи: выбор оператора, предложение, истечение, назначение. Число — метка. */
export const ZAMOK_RAZDACHI = 54021;
/** Сторож тика: «ждёт» дольше стольких минут в рабочее время — застрял. */
const STOROZH_MINUT = 10;
/** Будильник раздачи. */
const MINUTA = 60_000;
/** Сколько раз подряд можно не доставить предложение одному заказу за один ход. */
const SHAGOV_MAX = 20;

export type SostoyanieRazdachi = 'zhdyot' | 'predlozhen' | 'obshchaya';
type Ishod = 'vzyal' | 'istyok' | 'snyat' | 'perenaznachen' | 'ne_dostavleno';

/**
 * ПРИГОДНЫЙ ОПЕРАТОР: действующий оператор с привязанным Telegram, которому
 * пара «тариф × срок» не запрещена. Параметры — $1 тариф, $2 срок.
 *
 * ⚠️ И ТОКЕН БОТА НА СЕРВЕРЕ (поправка concurrency-8): без него писать
 * некому, а «пригодный» без лички прятал бы заказы от всех молча.
 * Токен проверяется кодом, не SQL, — см. `prigodnye`.
 */
const PRIGODEN =
  `s.role = 'operator' and not s.disabled and s.tg_chat_id is not null` +
  ` and not exists (select 1 from staff_plan_off z where z.staff_id = s.id and z.plan_id = $1 and z.period = $2)`;

type Kandidat = { id: string; tg_chat_id: string; email: string };

/**
 * Пригодные операторы в порядке справедливости: первым — тот, кому
 * ДОЛЬШЕ ВСЕХ НЕ ПРЕДЛАГАЛИ НИЧЕГО (поправка concurrency-3).
 *
 * ⚠️ НЕ ГЛОБАЛЬНЫЙ КУРСОР «СЛЕДУЮЩИЙ ПО НОМЕРУ». При разных парах
 * у операторов курсор морит голодом третьего: заказы на одного и на
 * двоих по очереди гоняли бы его между первыми двумя навсегда.
 * «Дольше всех не предлагали» к парам безразлично.
 */
async function prigodnye(q: PoolClient, planId: string, period: number): Promise<Kandidat[]> {
  if (!env.telegramToken) return [];
  const r = await q.query<Kandidat>(
    `select s.id, s.tg_chat_id, s.email
       from staff s
      where ${PRIGODEN}
      order by (select max(f.created_at) from order_offer f where f.staff_id = s.id) asc nulls first, s.id`,
    [planId, period],
  );
  return r.rows;
}

/** Пригоден ли ОДИН оператор — для проверки живого предложения. */
async function prigoden(q: PoolClient, staffId: number, planId: string, period: number): Promise<boolean> {
  if (!env.telegramToken) return false;
  const r = await q.query(`select 1 from staff s where s.id = $3 and ${PRIGODEN}`, [planId, period, staffId]);
  return r.rows.length > 0;
}

/**
 * Почему предложить некому: пара никому не разрешена (`para`) — или
 * разрешена, но у разрешённых нет Telegram (`telegram`). Постановка
 * называет оба случая, и Льву нужно разное: в первом править галочки,
 * во втором — привязывать.
 */
async function pochemuNekomu(q: PoolClient | null, planId: string, period: number): Promise<'para' | 'telegram'> {
  const sql = `select 1 from staff s
                where s.role = 'operator' and not s.disabled
                  and not exists (select 1 from staff_plan_off z
                                   where z.staff_id = s.id and z.plan_id = $1 and z.period = $2)
                limit 1`;
  const est = q ? (await q.query(sql, [planId, period])).rows.length > 0 : Boolean(await odna(sql, [planId, period]));
  return est ? 'telegram' : 'para';
}

/** Событие журнала раздачи. `staffId` — КТО (оператор или назначивший администратор). */
async function sobytie(
  c: PoolClient,
  zakaz: number,
  staffId: number | null,
  vid: 'predlozhen' | 'ne_vzyal' | 'naznachil',
  komu: number | null = null,
): Promise<void> {
  await c.query('insert into order_event (order_id, staff_id, vid, komu_staff_id) values ($1, $2, $3, $4)', [
    zakaz,
    staffId,
    vid,
    komu,
  ]);
}

/* ── Начало раздачи: внутри оплачивающей транзакции ─────────────── */

/**
 * Поставить начальное состояние раздачи — В ТОЙ ЖЕ ТРАНЗАКЦИИ, где заказ
 * стал оплаченным (поправка concurrency-1). Зовут `oplatitVnutri`
 * (ResultURL, оплата с баланса, будущий заказ автопродления — он тоже
 * идёт через неё) и вставка заказа по сертификату.
 *
 * Раздаются только заказы на тариф: покупка сертификата работы
 * оператору не даёт вовсе.
 */
export async function nachatRazdachu(c: PoolClient, zakaz: number): Promise<void> {
  const r = await c.query<{ kind: string; plan_id: string; period: number }>(
    'select kind, plan_id, period from shop_order where id = $1',
    [zakaz],
  );
  const z = r.rows[0];
  if (!z || z.kind !== 'plan') return;
  const est = (await prigodnye(c, z.plan_id, Number(z.period))).length > 0;
  await c.query(
    `update shop_order set razdacha = $2, offer_staff_id = null, offer_until = null, razdacha_at = now() where id = $1`,
    [zakaz, est ? 'zhdyot' : 'obshchaya'],
  );
}

/* ── Закрытие предложения: взятие, отмена, возврат, назначение ──── */

/** Закрытое предложение: кому было, и какое сообщение у него править. */
export type ZakrytoePredlozhenie = { zakaz: number; staffId: number; chat: string | null; msg: string | null };

/**
 * Закрыть ОТКРЫТОЕ предложение заказа внутри транзакции.
 *
 * `vzyal` — номер того, кто взял заказ: если это и есть тот, кому
 * предлагали, исход `vzyal`, иначе — переданный `ishod`.
 */
async function zakrytPredlozhenie(
  c: PoolClient,
  zakaz: number,
  ishod: Ishod,
  vzyal: number | null = null,
): Promise<ZakrytoePredlozhenie | null> {
  const r = await c.query<{ staff_id: string; tg_chat_id: string | null; tg_message_id: string | null }>(
    `update order_offer
        set ishod = case when $3::bigint is not null and staff_id = $3::bigint then 'vzyal' else $2::text end,
            closed_at = now()
      where order_id = $1 and closed_at is null
      returning staff_id, tg_chat_id, tg_message_id`,
    [zakaz, ishod, vzyal],
  );
  const z = r.rows[0];
  return z ? { zakaz, staffId: Number(z.staff_id), chat: z.tg_chat_id, msg: z.tg_message_id } : null;
}

/**
 * СНЯТЬ РАЗДАЧУ С ЗАКАЗА: закрыть открытое предложение и поставить новое
 * состояние — `null` (взят, отменён, назначен) или `obshchaya` («Вернуть
 * в очередь»: заказ в общей очереди и заново не раздаётся).
 *
 * Зовётся ВНУТРИ транзакции того, кто меняет заказ, под его `for update`:
 * состояния «заказ взят, а предложение висит» быть не должно.
 */
export async function snyatRazdachu(
  c: PoolClient,
  zakaz: number,
  opts: { ishod: 'snyat' | 'perenaznachen'; vzyal?: number | null; stanet: 'obshchaya' | null },
): Promise<ZakrytoePredlozhenie | null> {
  const zp = await zakrytPredlozhenie(c, zakaz, opts.ishod, opts.vzyal ?? null);
  await c.query(
    `update shop_order
        set razdacha = $2::text, offer_staff_id = null, offer_until = null,
            razdacha_at = case when razdacha is distinct from $2::text then now() else razdacha_at end
      where id = $1`,
    [zakaz, opts.stanet],
  );
  return zp;
}

/** Правка личного сообщения — лучшим усилием, без повтора (поправка concurrency-8). */
async function pravit(chat: string | number, msg: string | number, tekst: string): Promise<void> {
  try {
    const itog = await ispravitLichnoe(chat, Number(msg), tekst);
    // «Не изменилось» — законно: бот мог поправить его раньше (нажатие «Take»).
    if (!itog.ok && !/message is not modified/i.test(itog.opisanie)) {
      log.warn('личное сообщение о предложении не поправилось', { text: itog.pochemu.slice(0, 200) });
    }
  } catch (e) {
    log.warn('личное сообщение о предложении не поправилось', { text: String((e as Error).message) });
  }
}

/**
 * После коммита: поправить сообщение закрытого предложения.
 * Взял тот, кому предлагали, — «is yours»; иначе — «no longer offered».
 */
export async function popravitZakrytoe(zp: ZakrytoePredlozhenie | null, ktoTeper: number | null): Promise<void> {
  if (!zp || !zp.chat || !zp.msg) return;
  await pravit(zp.chat, zp.msg, ktoTeper === zp.staffId ? tekstTvoy(zp.zakaz) : tekstBolsheNePredlozhen(zp.zakaz));
}

/* ── Один шаг раздачи ──────────────────────────────────────────── */

type Reshenie =
  | { kak: 'nichego' | 'zhdyot'; zakryto: ZakrytoePredlozhenie[] }
  | {
      kak: 'obshchaya';
      zakryto: ZakrytoePredlozhenie[];
      pochemu: 'para' | 'telegram' | 'nikto' | 'ne_dostavleno';
      planId: string;
      period: number;
    }
  | {
      kak: 'predlozhen';
      zakryto: ZakrytoePredlozhenie[];
      offer: number;
      staffId: number;
      email: string;
      chat: string;
      planId: string;
      period: number;
      avto: boolean;
    };

/**
 * ОДИН ШАГ РАЗДАЧИ ОДНОГО ЗАКАЗА — одна транзакция, и решает она
 * всё разом (поправка concurrency-7): истекло ли предложение, кому
 * предлагать дальше, пора ли в общую очередь или ждать утра.
 *   • кандидат есть и рабочее время — предложить;
 *   • кандидат есть, но ночь — `zhdyot` (раздача в 10:00);
 *   • в этом круге кандидатов не осталось — `obshchaya` и сообщение
 *     «никто не взял» В ЛЮБОЙ ЧАС: иначе заказ, чей последний оператор
 *     не взял его в 22:05, до утра не видел бы никто;
 *   • пригодных нет вовсе — `obshchaya` и «предложить некому».
 *
 * ⚠️ ВСЁ — ТОЛЬКО ДЛЯ СВОБОДНОГО ЗАКАЗА: `status = 'paid'` и
 * `operator_id is null` под `for update`. Взятый, отменённый или
 * назначенный (в том числе старым кодом после отката) заказ раздача
 * не трогает, а висящее на нём состояние снимает.
 */
async function reshit(zakaz: number, minut: number, rabochee: boolean): Promise<Reshenie> {
  return vTranzakcii(async (c) => {
    await c.query('select pg_advisory_xact_lock($1)', [ZAMOK_RAZDACHI]);
    const r = await c.query<{
      kind: string;
      status: string;
      operator_id: string | null;
      plan_id: string;
      period: number;
      source: string;
      razdacha: SostoyanieRazdachi | null;
      offer_staff_id: string | null;
      istyok: boolean;
    }>(
      `select kind, status, operator_id, plan_id, period, source, razdacha, offer_staff_id,
              (offer_until is null or offer_until <= now()) as istyok
         from shop_order where id = $1 for update`,
      [zakaz],
    );
    const z = r.rows[0];
    const zakryto: ZakrytoePredlozhenie[] = [];
    if (!z || z.kind !== 'plan') return { kak: 'nichego', zakryto };
    const planId = z.plan_id;
    const period = Number(z.period);

    if (z.status !== 'paid' || z.operator_id !== null) {
      if (z.razdacha === 'zhdyot' || z.razdacha === 'predlozhen') {
        const zp = await snyatRazdachu(c, zakaz, { ishod: 'snyat', stanet: null });
        if (zp) zakryto.push(zp);
      }
      return { kak: 'nichego', zakryto };
    }
    if (z.razdacha !== 'zhdyot' && z.razdacha !== 'predlozhen') return { kak: 'nichego', zakryto };

    if (z.razdacha === 'predlozhen') {
      const komu = z.offer_staff_id === null ? null : Number(z.offer_staff_id);
      /* Предложение живо, пока не истекло И оператор всё ещё пригоден:
         отвязанный, отключённый или лишённый пары оператор держать
         заказ не должен (постановка F3: «отвязка — предложения ему
         истекают на ближайшем тике»). */
      if (!z.istyok && komu !== null && (await prigoden(c, komu, planId, period))) return { kak: 'nichego', zakryto };
      const zp = await zakrytPredlozhenie(c, zakaz, 'istyok');
      if (zp) zakryto.push(zp);
      if (komu !== null) await sobytie(c, zakaz, komu, 'ne_vzyal');
    }

    const vObshchuyu = async (pochemu: 'para' | 'telegram' | 'nikto' | 'ne_dostavleno'): Promise<Reshenie> => {
      await c.query(
        `update shop_order set razdacha = 'obshchaya', offer_staff_id = null, offer_until = null, razdacha_at = now()
          where id = $1`,
        [zakaz],
      );
      return { kak: 'obshchaya', zakryto, pochemu, planId, period };
    };

    const vse = await prigodnye(c, planId, period);
    if (!vse.length) return vObshchuyu(await pochemuNekomu(c, planId, period));

    /* ⚠️ В ОДНОМ КРУГЕ ОДНОМУ ОПЕРАТОРУ ЗАКАЗ ПРЕДЛАГАЕТСЯ НЕ БОЛЬШЕ
       РАЗА. Круг у заказа один: пройден — заказ в общей очереди
       и заново не раздаётся. Номер круга хранится на будущее. */
    const k = await c.query<{ krug: number }>(
      'select coalesce(max(krug), 1) as krug from order_offer where order_id = $1',
      [zakaz],
    );
    const krug = Number(k.rows[0]?.krug ?? 1);
    const bylo = await c.query<{ staff_id: string; ishod: string | null }>(
      'select staff_id, ishod from order_offer where order_id = $1 and krug = $2',
      [zakaz, krug],
    );
    const uzhe = new Set(bylo.rows.map((x) => Number(x.staff_id)));
    const kandidaty = vse.filter((x) => !uzhe.has(Number(x.id)));
    if (!kandidaty.length) {
      const vseNeDoshli = bylo.rows.length > 0 && bylo.rows.every((x) => x.ishod === 'ne_dostavleno');
      return vObshchuyu(vseNeDoshli ? 'ne_dostavleno' : 'nikto');
    }

    if (!rabochee) {
      if (z.razdacha !== 'zhdyot') {
        await c.query(
          `update shop_order set razdacha = 'zhdyot', offer_staff_id = null, offer_until = null, razdacha_at = now()
            where id = $1`,
          [zakaz],
        );
      }
      return { kak: 'zhdyot', zakryto };
    }

    const kto = kandidaty[0]!;
    const o = await c.query<{ id: string; until: Date }>(
      `insert into order_offer (order_id, staff_id, krug, until, tg_chat_id)
       values ($1, $2, $3, now() + make_interval(mins => $4), $5)
       returning id, until`,
      [zakaz, Number(kto.id), krug, minut, kto.tg_chat_id],
    );
    await c.query(
      `update shop_order set razdacha = 'predlozhen', offer_staff_id = $2, offer_until = $3, razdacha_at = now()
        where id = $1`,
      [zakaz, Number(kto.id), o.rows[0]!.until],
    );
    await sobytie(c, zakaz, Number(kto.id), 'predlozhen');
    return {
      kak: 'predlozhen',
      zakryto,
      offer: Number(o.rows[0]!.id),
      staffId: Number(kto.id),
      email: kto.email,
      chat: kto.tg_chat_id,
      planId,
      period,
      avto: z.source === 'avto',
    };
  });
}

/** Английские тариф и срок для сообщений (Р-139). */
async function tarifISrok(planId: string, period: number): Promise<{ tarif: string; srok: string }> {
  return { tarif: imyaTarifaIz(await imenaTarifov(), planId, true), srok: srokDlyaSotrudnika(period, true) };
}

/**
 * Сообщение в служебную группу от раздачи.
 *
 * ⚠️ ПРИ `gotovo` ОНО ОТКЛАДЫВАЕТСЯ, А НЕ ОЖИДАЕТСЯ. `gotovo` —
 * сообщение «New paid order» по этому же заказу: «предложить некому»
 * не должно прийти в группу раньше самого заказа. А `posleOplaty`
 * ждёт ход раздачи ДО своего письма и сообщения (раздача первой,
 * поправка concurrency-1) — подожди раздача их в ответ, и обе стороны
 * ждали бы друг друга.
 */
async function vGruppu(s: SobytieKomande, gotovo?: Promise<unknown>): Promise<void> {
  if (!gotovo) {
    await soobshchitKomande(s);
    return;
  }
  void gotovo
    .then(() => soobshchitKomande(s))
    .catch((e) => log.error('сообщение раздачи в группу не ушло', { text: String((e as Error).message) }));
}

/** Сообщение Льву, когда заказ ушёл в общую очередь. */
async function soobshchitObObshchey(
  zakaz: number,
  r: Extract<Reshenie, { kak: 'obshchaya' }>,
  minut: number,
  gotovo?: Promise<unknown>,
): Promise<void> {
  if (r.pochemu === 'para' || r.pochemu === 'telegram') {
    await vGruppu({ vid: 'razdacha_nekomu', zakaz, ...(await tarifISrok(r.planId, r.period)), prichina: r.pochemu }, gotovo);
  } else if (r.pochemu === 'ne_dostavleno') {
    await vGruppu({ vid: 'razdacha_ne_dostavleno', zakaz }, gotovo);
  } else {
    await vGruppu({ vid: 'razdacha_nikto', zakaz, minut }, gotovo);
  }
}

/**
 * Отправить предложение в личку. `true` — ушло; иначе итог неудачи.
 *
 * ⚠️ НОМЕР СООБЩЕНИЯ ПИШЕТСЯ С ПРОВЕРКОЙ «ЕЩЁ ОТКРЫТО ЛИ». Пока
 * сообщение летело, заказ могли взять или назначить: тогда правка
 * «no longer offered» не нашла бы номера, и кнопка «Take» осталась бы
 * живой. Закрыто уже — правим сразу же.
 */
async function otpravit(zakaz: number, r: Extract<Reshenie, { kak: 'predlozhen' }>, minut: number): Promise<true | Itog> {
  const sloty = await zapros<{ mode: 'new' | 'renew' }>('select mode from order_slot where order_id = $1 order by idx', [
    zakaz,
  ]);
  const tekst = tekstPredlozheniya({
    zakaz,
    ...(await tarifISrok(r.planId, r.period)),
    akkaunty: sloty.map((s) => s.mode),
    avto: r.avto,
    minut,
  });
  const itog = await poslatLichno(r.chat, tekst, knopkaVzyat(zakaz));
  if (!itog.ok) return itog;
  log.info('заказ предложен оператору', { order: zakaz, staff: pochtaVZhurnal(r.email), adres: itog.adres });
  const nomer = nomerSoobshcheniya(itog);
  if (nomer === null) return true;
  const z = await odna<{ closed_at: Date | null; operator_id: string | null }>(
    `update order_offer f set tg_message_id = $2
       from shop_order o
      where f.id = $1 and o.id = f.order_id
     returning f.closed_at, o.operator_id`,
    [r.offer, nomer],
  );
  if (z?.closed_at) {
    await popravitZakrytoe(
      { zakaz, staffId: r.staffId, chat: r.chat, msg: String(nomer) },
      z.operator_id === null ? null : Number(z.operator_id),
    );
  }
  return true;
}

/**
 * Предложение не доставилось: закрыть его сразу (`ne_dostavleno`)
 * и вернуть заказ в «ждёт» — следующий шаг предложит его дальше.
 * 403 («бот заблокирован», «разговор не начат», «аккаунт удалён») —
 * ещё и снять привязку: писать этому оператору нельзя, и сам это
 * не пройдёт (поправка concurrency-8).
 *
 * `false` — предложение уже закрыто кем-то другим (взяли, назначили):
 * раздавать дальше нечего.
 */
async function neDostavleno(
  zakaz: number,
  r: Extract<Reshenie, { kak: 'predlozhen' }>,
  itog: Itog,
  gotovo?: Promise<unknown>,
): Promise<boolean> {
  const zakryt = lichkaZakryta(itog);
  const ishod = await vTranzakcii(async (c) => {
    await c.query('select pg_advisory_xact_lock($1)', [ZAMOK_RAZDACHI]);
    await c.query('select id from shop_order where id = $1 for update', [zakaz]);
    const z = await c.query(
      `update order_offer set ishod = 'ne_dostavleno', closed_at = now() where id = $1 and closed_at is null returning id`,
      [r.offer],
    );
    if (!z.rows.length) return { dalshe: false, otvyazan: false };
    await c.query(
      `update shop_order set razdacha = 'zhdyot', offer_staff_id = null, offer_until = null, razdacha_at = now()
        where id = $1 and razdacha = 'predlozhen' and offer_staff_id = $2`,
      [zakaz, r.staffId],
    );
    await sobytie(c, zakaz, r.staffId, 'ne_vzyal');
    let otvyazan = false;
    if (zakryt) {
      const u = await c.query(
        `update staff set tg_chat_id = null, tg_username = null, tg_imya = null, tg_privyazan_at = null
          where id = $1 and tg_chat_id = $2 returning id`,
        [r.staffId, r.chat],
      );
      otvyazan = u.rows.length > 0;
    }
    return { dalshe: true, otvyazan };
  });
  log.warn('предложение не доставлено оператору', {
    order: zakaz,
    staff: pochtaVZhurnal(r.email),
    text: itog.ok ? '' : itog.pochemu.slice(0, 200),
  });
  if (ishod.otvyazan) {
    log.warn('Telegram оператора отвязан: бот не может ему писать', { staff: pochtaVZhurnal(r.email) });
    await vGruppu({ vid: 'razdacha_otvyazan', kto: r.email }, gotovo);
  }
  return ishod.dalshe;
}

/**
 * ПРОВЕСТИ РАЗДАЧУ ЗАКАЗА: шаги, пока заказ не предложен, не ушёл
 * в общую очередь или не остался ждать утра. Недоставленное предложение
 * сразу передаётся следующему.
 *
 * `rabochee` — рабочее ли время; тик снимает его один раз на ход, чтобы
 * граница 10:00 не разошлась между раздачей и сторожем.
 */
async function provesti(zakaz: number, gotovo?: Promise<unknown>, rabochee: boolean = rabocheeVremya()): Promise<void> {
  for (let i = 0; i < SHAGOV_MAX; i++) {
    const minut = await vremyaNaVzyatieMinut();
    const r = await reshit(zakaz, minut, rabochee);
    for (const zp of r.zakryto) await popravitZakrytoe(zp, null);
    if (r.kak === 'obshchaya') {
      log.info('заказ в общей очереди', { order: zakaz, pochemu: r.pochemu });
      await soobshchitObObshchey(zakaz, r, minut, gotovo);
      return;
    }
    if (r.kak !== 'predlozhen') return;
    const ushlo = await otpravit(zakaz, r, minut);
    if (ushlo === true) return;
    if (!(await neDostavleno(zakaz, r, ushlo, gotovo))) return;
  }
  log.error('раздача заказа не сошлась за отведённые шаги', { order: zakaz });
}

/**
 * РАЗДАТЬ НОВЫЙ ЗАКАЗ — сразу после оплаты (`posleOplaty`) и после
 * заказа по сертификату. Состояние уже поставлено в оплачивающей
 * транзакции (`nachatRazdachu`):
 *   • `zhdyot` — провести раздачу;
 *   • `obshchaya` — предложить некому, и Лев узнаёт об этом сразу.
 *
 * ⚠️ НИЧЕГО НЕ БРОСАЕТ: раздача не имеет права уронить оплату (закон 39).
 * Не вышло — заказ остался в `zhdyot`, и минутный тик подхватит его.
 *
 * `gotovo` — сообщение «New paid order» ушло: сообщения раздачи
 * в группу идут после него, а сама функция его НЕ ждёт — она кончается,
 * как только ушло (или не ушло) личное сообщение. Поэтому `posleOplaty`
 * может ждать её первой.
 */
export async function razdatNovyy(zakaz: number, gotovo?: Promise<unknown>): Promise<void> {
  if (!bazaEst()) return;
  try {
    const z = await odna<{ razdacha: SostoyanieRazdachi | null; plan_id: string; period: number; bylo: boolean }>(
      `select o.razdacha, o.plan_id, o.period,
              exists (select 1 from order_offer f where f.order_id = o.id) as bylo
         from shop_order o where o.id = $1 and o.kind = 'plan'`,
      [zakaz],
    );
    if (!z) return;
    if (z.razdacha === 'obshchaya' && !z.bylo) {
      const prichina = await pochemuNekomu(null, z.plan_id, Number(z.period));
      await vGruppu(
        { vid: 'razdacha_nekomu', zakaz, ...(await tarifISrok(z.plan_id, Number(z.period))), prichina },
        gotovo,
      );
      return;
    }
    if (z.razdacha === 'zhdyot') await provesti(zakaz, gotovo);
  } catch (e) {
    log.error('раздача заказа не прошла', { order: zakaz, text: String((e as Error).message) });
  }
}

/* ── Ручное назначение (администратор) ─────────────────────────── */

export type ItogNaznacheniya = { ok: true } | { ok: false; pochemu: 'net_zakaza' | 'ne_operator' | 'uzhe' };

/**
 * НАЗНАЧИТЬ ЗАКАЗ ОПЕРАТОРУ ВРУЧНУЮ — только администратор, из карточки.
 *
 * Постановка: «Администратор может вручную переназначить заказ любому
 * оператору». Заказ `paid` или `in_work` становится `in_work` у выбранного
 * — ДАЖЕ ЕСЛИ ПАРА ЕМУ НЕ РАЗРЕШЕНА: свой заказ оператор видит всегда
 * (`dostup.ts`), и назначение — решение администратора, а не галочки.
 *
 * ⚠️ ПОД ЗАМКОМ ПРОВЕРЯЕТСЯ, ЧТО ВЫБРАННЫЙ — ДЕЙСТВУЮЩИЙ ОПЕРАТОР
 * (поправка concurrency-16): страница могла пролежать открытой, пока
 * его отключали.
 *
 * ⚠️ ТРОЕ УЗНАЮТ ОБ ЭТОМ, И НИКТО — О ДРУГИХ (поправка product-21):
 *   • тот, кому заказ был предложен, — правка «no longer offered»
 *     (или «assigned to you», если назначили ему же);
 *   • выбранный — новое сообщение «has been assigned to you»;
 *   • прежний держатель — «has been reassigned. It is no longer yours»,
 *     без имён: оператор не знает, что есть другие.
 */
export async function naznachit(zakaz: number, adminId: number, komu: number): Promise<ItogNaznacheniya> {
  const itog = await vTranzakcii(async (c) => {
    await c.query('select pg_advisory_xact_lock($1)', [ZAMOK_RAZDACHI]);
    const r = await c.query<{ status: string; operator_id: string | null; kind: string }>(
      'select status, operator_id, kind from shop_order where id = $1 for update',
      [zakaz],
    );
    const z = r.rows[0];
    if (!z || z.kind !== 'plan' || (z.status !== 'paid' && z.status !== 'in_work')) return { ok: false as const, pochemu: 'net_zakaza' as const };
    const s = await c.query<{ tg_chat_id: string | null }>(
      `select tg_chat_id from staff where id = $1 and role = 'operator' and not disabled for update`,
      [komu],
    );
    if (!s.rows.length) return { ok: false as const, pochemu: 'ne_operator' as const };
    const prezhniy = z.operator_id === null ? null : Number(z.operator_id);
    if (z.status === 'in_work' && prezhniy === komu) return { ok: false as const, pochemu: 'uzhe' as const };
    const zp = await snyatRazdachu(c, zakaz, { ishod: 'perenaznachen', stanet: null });
    await c.query(`update shop_order set status = 'in_work', operator_id = $2, taken_at = now() where id = $1`, [
      zakaz,
      komu,
    ]);
    await sobytie(c, zakaz, adminId, 'naznachil', komu);
    let chatPrezhnego: string | null = null;
    if (z.status === 'in_work' && prezhniy !== null) {
      const p = await c.query<{ tg_chat_id: string | null }>('select tg_chat_id from staff where id = $1', [prezhniy]);
      chatPrezhnego = p.rows[0]?.tg_chat_id ?? null;
    }
    return { ok: true as const, zp, chatKomu: s.rows[0]!.tg_chat_id, chatPrezhnego };
  });
  if (!itog.ok) return itog;
  log.info('заказ назначен администратором', { order: zakaz });
  /* После коммита — сообщения, лучшим усилием. Тот, кому предлагали,
     и выбранный — один человек: его сообщение о предложении становится
     сообщением о назначении, второго не нужно. */
  const zp = itog.zp;
  if (zp && zp.chat && zp.msg) {
    await pravit(zp.chat, zp.msg, zp.staffId === komu ? tekstNaznachen(zakaz) : tekstBolsheNePredlozhen(zakaz));
  }
  const odinIEtotZhe = Boolean(zp && zp.staffId === komu && zp.chat && zp.msg);
  if (itog.chatKomu && !odinIEtotZhe) await lichno(itog.chatKomu, tekstNaznachen(zakaz));
  if (itog.chatPrezhnego) await lichno(itog.chatPrezhnego, tekstPereNaznachen(zakaz));
  return { ok: true };
}

/** Личное сообщение без кнопок — лучшим усилием. */
async function lichno(chat: string, tekst: string): Promise<void> {
  try {
    const itog = await poslatLichno(chat, tekst);
    if (!itog.ok) log.warn('личное сообщение оператору не ушло', { text: itog.pochemu.slice(0, 200) });
  } catch (e) {
    log.warn('личное сообщение оператору не ушло', { text: String((e as Error).message) });
  }
}

/* ── Минутный тик ──────────────────────────────────────────────── */

let tikIdyot = false;

/**
 * ТИК РАЗДАЧИ, раз в минуту:
 *   1) каждый заказ в `zhdyot`/`predlozhen` — один ход `provesti`:
 *      истёкшее предложение (или оператор перестал быть пригодным)
 *      закрывается и идёт следующему; в рабочее время накопленное
 *      раздаётся по `paid_at`; взятый или отменённый заказ, на котором
 *      осталось состояние (откат на старый код), от него очищается;
 *   2) сторож: в рабочее время `zhdyot` дольше десяти минут после
 *      последней смены — раздача у него не сходится, и заказ уходит
 *      в общую очередь с сообщением Льву (поправка concurrency-7).
 *
 * ⚠️ ПРОШЛЫЙ ХОД ЕЩЁ ИДЁТ — НОВЫЙ ПРОПУСКАЕТСЯ: при лежащем Telegram
 * один ход тянется таймаутами дольше минуты.
 *
 * ⚠️ ТОКЕН ЗДЕСЬ НЕ ПРОВЕРЯЕТСЯ: сняли токен с живыми предложениями —
 * именно тик и выпустит их в общую очередь (пригодных без токена нет).
 */
export async function tikRazdachi(): Promise<void> {
  if (!bazaEst() || tikIdyot) return;
  tikIdyot = true;
  try {
    const rabochee = rabocheeVremya();
    const stroki = await zapros<{ id: string }>(
      `select id from shop_order
        where razdacha in ('zhdyot', 'predlozhen')
        order by paid_at asc nulls last, id asc
        limit 200`,
    );
    for (const s of stroki) {
      try {
        await provesti(Number(s.id), undefined, rabochee);
      } catch (e) {
        log.error('раздача заказа не прошла', { order: Number(s.id), text: String((e as Error).message) });
      }
    }
    if (!rabochee) return;
    const zastryali = await zapros<{ id: string }>(
      `select id from shop_order
        where razdacha = 'zhdyot' and status = 'paid' and operator_id is null
          and razdacha_at < now() - make_interval(mins => $1)
        order by paid_at asc nulls last, id asc
        limit 200`,
      [STOROZH_MINUT],
    );
    for (const s of zastryali) {
      const zakaz = Number(s.id);
      try {
        const vyshel = await vTranzakcii(async (c) => {
          await c.query('select pg_advisory_xact_lock($1)', [ZAMOK_RAZDACHI]);
          await c.query('select id from shop_order where id = $1 for update', [zakaz]);
          const u = await c.query(
            `update shop_order set razdacha = 'obshchaya', offer_staff_id = null, offer_until = null, razdacha_at = now()
              where id = $1 and razdacha = 'zhdyot' and status = 'paid' and operator_id is null
                and razdacha_at < now() - make_interval(mins => $2)
             returning id`,
            [zakaz, STOROZH_MINUT],
          );
          return u.rows.length > 0;
        });
        if (vyshel) {
          log.error('заказ застрял в раздаче и выпущен в общую очередь', { order: zakaz });
          await soobshchitKomande({ vid: 'razdacha_zastryal', zakaz });
        }
      } catch (e) {
        log.error('сторож раздачи не прошёл', { order: zakaz, text: String((e as Error).message) });
      }
    }
  } catch (e) {
    log.error('тик раздачи не прошёл', { text: String((e as Error).message) });
  } finally {
    tikIdyot = false;
  }
}

type Global = typeof globalThis & { __spotikRazdacha?: NodeJS.Timeout };

/**
 * Минутный будильник раздачи. Свой, а не общий с очередью уведомлений:
 * у очереди своя аренда строк, и смешивать их ходы незачем.
 * `unref` — чтобы не держать процесс.
 */
export function zavestiRazdachu(): void {
  const g = globalThis as Global;
  if (g.__spotikRazdacha) return;
  g.__spotikRazdacha = setInterval(() => void tikRazdachi(), MINUTA);
  g.__spotikRazdacha.unref?.();
  /* Первый ход — вскоре после старта, а не через минуту: выкладка
     перезапускает службу, и заказ, оставшийся в «ждёт» у прежнего
     процесса, не должен ждать лишнего. */
  setTimeout(() => void tikRazdachi(), 10_000).unref?.();
}

/**
 * Ждать первый ход раздачи нового заказа — но не дольше `ms`.
 *
 * ⚠️ ПОТОЛОК ОБЯЗАТЕЛЕН: `posleOplaty` зовёт ResultURL Робокассы,
 * а при лежащем Telegram каждое личное сообщение ждёт своих пятнадцати
 * секунд таймаута — и так по каждому оператору круга. В обычный день
 * Telegram отвечает за доли секунды, и личное сообщение уходит раньше
 * письма и сообщения в группу; в плохой день оплата не ждёт его дольше
 * потолка, а раздача доходит сама, своим ходом.
 */
export async function razdatNovyyPervym(zakaz: number, gotovo: Promise<unknown>, ms = 3000): Promise<void> {
  let t: NodeJS.Timeout | undefined;
  const potolok = new Promise<void>((r) => {
    t = setTimeout(r, ms);
    t.unref?.();
  });
  await Promise.race([razdatNovyy(zakaz, gotovo), potolok]);
  if (t) clearTimeout(t);
}

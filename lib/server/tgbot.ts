/**
 * Бот принимает обновления: привязка оператора и кнопка «Take».
 *
 * ⚠️ ДОЛГИЙ ОПРОС `getUpdates`, А НЕ ВЕБХУК. У домена только запись A,
 * а Telegram с российского сервера по IPv4 недоступен вовсе: входящий
 * вебхук до нас, скорее всего, не дошёл бы, а исходящий опрос идёт
 * тем же путём по IPv6, что и отправка (закон 39). Пятого маршрута
 * `/api` поэтому не заводится.
 *
 * ⚠️ ПОЛОЖЕНИЕ В ОЧЕРЕДИ (`offset`) ЛЕЖИТ В БАЗЕ, а не в памяти: оно
 * переживает перезапуск, и во время выкладки два экземпляра читают
 * одно и то же. Пишется оно ПЕРЕЗАПИСЬЮ «последний полученный + 1»,
 * никогда `greatest()`: после недели тишины Telegram начинает номера
 * со случайного числа, и «не меньше прежнего» отрезало бы всё новое
 * навсегда (поправка concurrency-5).
 *
 * ⚠️ ПОВТОРЫ ОТСЕКАЕТ ТАБЛИЦА `tg_obnovlenie`. Обновление подтверждается
 * только следующим `getUpdates`, и падение между обработкой и записью
 * offset, как и второй экземпляр, доставят его ещё раз. Каждое
 * обновление — в своём `try`: ядовитое не держит очередь, offset
 * продвигается и при ошибке.
 *
 * ⚠️ ДВА ЭКЗЕМПЛЯРА ПИНАЮТ ДРУГ ДРУГА: свежий долгий опрос обрывает
 * прежний с 409 «terminated by other getUpdates». Это не беда, а тихая
 * пауза. А 409 «webhook is active» — беда: пока у бота стоит вебхук,
 * привязка и «Take» не работают вовсе, и об этом пишется ERR. Вебхук
 * сами не снимаем — его поставил кто-то, кто, может быть, на него
 * рассчитывает (поправка concurrency-13).
 *
 * ⚠️ В ЖУРНАЛ — НЕ ЧАЩЕ РАЗА В ДЕСЯТЬ МИНУТ НА ОДНУ БЕДУ. В сторожах
 * адрес Bot API уведён на мёртвый порт, и опрос с паузой до минуты
 * дал бы строку в минуту на весь прогон.
 *
 * ⚠️ ТОКЕН ПРИВЯЗКИ В ЖУРНАЛ НЕ ПОПАДАЕТ НИКОГДА: это ключ к чужому
 * чату. Номер заказа идёт только ПОЛЕМ, а не словами «заказ №»
 * в тексте (поправка concurrency-10), почта сотрудника — огрызком.
 */

import { bazaEst, odna, vTranzakcii } from './db';
import { env } from './env';
import { log, pochtaVZhurnal } from './log';
import { otpechatok } from './crypto';
import { nastroyka, zadatNastroyku, TG_BOT, TG_OFFSET } from './settings';
import {
  ispravitLichnoe,
  otvetitNaNazhatie,
  poslatLichno,
  snyatKnopki,
  vyzovMetoda,
  type Itog,
} from './telegram';
import { OTVET, tekstTvoy, zakazIzNazhatiya } from './lichka';
import { vzyatZakaz } from './orders';
import { zapretyPar } from './dostup';
import { soobshchitKomande } from './notify';

/** Сколько секунд Telegram держит долгий опрос. */
const OPROS_SEK = 25;
/** Срок тишины сокета на опросе: больше `OPROS_SEK` с запасом на сеть. */
const OPROS_SROK_MS = 35_000;
/** Пауза после «terminated by other getUpdates». */
const PAUZA_KONFLIKT = 5_000;
/** Потолок растущей паузы при ошибках. */
const PAUZA_MAX = 60_000;
/** Одна беда — одна строка журнала за это время. */
const ZHURNAL_RAZ_V = 10 * 60_000;
/** Как часто переспрашивать имя бота, пока оно не известно. */
const IMYA_RAZ_V = 10 * 60_000;
/**
 * Замок привязки: два `/start` с одним чатом разом развели бы
 * уникальный `staff.tg_chat_id` в ошибку. Число — просто метка.
 */
const ZAMOK_PRIVYAZKI = 54020;

function spat(ms: number): Promise<void> {
  return new Promise((gotovo) => {
    const t = setTimeout(gotovo, ms);
    t.unref?.();
  });
}

const kogdaPisali = new Map<string, number>();

/** Строка в журнал не чаще раза в десять минут на один ключ. */
function redko(klyuch: string, uroven: 'warn' | 'error', tekst: string, polya?: Record<string, string | number>) {
  const teper = Date.now();
  if (teper - (kogdaPisali.get(klyuch) ?? 0) < ZHURNAL_RAZ_V) return;
  kogdaPisali.set(klyuch, teper);
  log[uroven](tekst, polya);
}

/* ── Имя бота ──────────────────────────────────────────────────── */

let imyaIzvestno = false;
let imyaSprashivali = 0;

/**
 * Имя бота для ссылки привязки `t.me/<имя>?start=<токен>`. Кладётся
 * в настройки: страницу «Сотрудники» рисует другой процесс, и ходить
 * ей самой в Telegram незачем.
 */
async function uznatImya(): Promise<void> {
  imyaSprashivali = Date.now();
  const itog = await vyzovMetoda('getMe', {});
  if (!itog.ok) {
    redko('getMe', 'warn', 'бот не назвал своё имя', { text: itog.pochemu.slice(0, 200), adres: itog.adres });
    return;
  }
  const imya = (itog.rezultat as { username?: unknown } | null)?.username;
  if (typeof imya !== 'string' || !/^[A-Za-z0-9_]{3,64}$/.test(imya)) return;
  try {
    await zadatNastroyku(TG_BOT, imya);
    imyaIzvestno = true;
    log.info('имя бота известно', { bot: imya, adres: itog.adres });
  } catch (e) {
    log.error('имя бота не записалось', { text: String((e as Error).message) });
  }
}

/* ── Обновления ────────────────────────────────────────────────── */

type Polzovatel = { id?: unknown; is_bot?: unknown; username?: unknown; first_name?: unknown };
type Chat = { id?: unknown; type?: unknown };
type Soobshchenie = { message_id?: unknown; chat?: Chat; from?: Polzovatel; text?: unknown };
type Nazhatie = { id?: unknown; from?: Polzovatel; message?: Soobshchenie; data?: unknown };
type Obnovlenie = { update_id?: unknown; message?: Soobshchenie; callback_query?: Nazhatie };

function chislo(v: unknown): number | null {
  return typeof v === 'number' && Number.isSafeInteger(v) ? v : null;
}

function korotko(v: unknown, n: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().slice(0, n);
  return s || null;
}

/** Ответ в личный чат — не дожидаясь: опрос не стоит из-за медленной отправки. */
function otvetit(chat: number, tekst: string): void {
  void poslatLichno(chat, tekst).then((itog) => {
    if (!itog.ok) redko('otvet', 'warn', 'бот не ответил в личный чат', { text: itog.pochemu.slice(0, 200) });
  });
}

type IshodPrivyazki = { kak: 'privyazan'; email: string } | { kak: 'uzhe' } | { kak: 'net' };

/**
 * Привязать чат к сотруднику по токену из ссылки.
 *
 * ⚠️ ОДНОЙ ТРАНЗАКЦИЕЙ И В ТАКОМ ПОРЯДКЕ (поправка concurrency-12):
 * токен гасится условным `update … returning` — двое с одной ссылкой
 * не пройдут оба; сотрудник обязан быть действующим ОПЕРАТОРОМ сейчас,
 * а не когда ему выдали ссылку; чат, если он был у другого, у того
 * снимается, иначе на один чат пришли бы предложения двоих.
 *
 * ⚠️ ТОКЕН, УЖЕ ПОГАШЕННЫЙ ЭТИМ ЖЕ ЧАТОМ, — СНОВА «Linked.». Повторная
 * доставка того же `/start` иначе ответила бы «ссылка недействительна»
 * сразу за «привязан», и человек решил бы, что привязка слетела.
 */
async function privyazat(token: string, chat: number, ot: Polzovatel): Promise<IshodPrivyazki> {
  const hesh = otpechatok(token);
  return vTranzakcii(async (c) => {
    await c.query('select pg_advisory_xact_lock($1)', [ZAMOK_PRIVYAZKI]);
    const r = await c.query<{ staff_id: string }>(
      `update tg_privyazka set used_at = now()
        where token_hash = $1 and used_at is null and expires_at > now()
       returning staff_id`,
      [hesh],
    );
    const zapis = r.rows[0];
    if (!zapis) {
      const uzhe = await c.query(
        `select 1 from tg_privyazka p join staff s on s.id = p.staff_id
          where p.token_hash = $1 and p.used_at is not null and s.tg_chat_id = $2`,
        [hesh, chat],
      );
      return uzhe.rows.length ? { kak: 'uzhe' } : { kak: 'net' };
    }
    const staffId = Number(zapis.staff_id);
    const kto = await c.query<{ email: string; role: string; disabled: boolean }>(
      'select email, role, disabled from staff where id = $1 for update',
      [staffId],
    );
    const s = kto.rows[0];
    if (!s || s.role !== 'operator' || s.disabled) return { kak: 'net' };
    await c.query(
      `update staff set tg_chat_id = null, tg_username = null, tg_imya = null, tg_privyazan_at = null
        where tg_chat_id = $1 and id <> $2`,
      [chat, staffId],
    );
    await c.query(
      `update staff set tg_chat_id = $2, tg_username = $3, tg_imya = $4, tg_privyazan_at = now() where id = $1`,
      [staffId, chat, korotko(ot.username, 64), korotko(ot.first_name, 64)],
    );
    // Прочие выданные ему ссылки больше не нужны.
    await c.query('delete from tg_privyazka where staff_id = $1 and used_at is null', [staffId]);
    return { kak: 'privyazan', email: s.email };
  });
}

/**
 * Сообщение боту.
 *
 * ⚠️ ТОЛЬКО ЛИЧНЫЙ ЧАТ И ТОЛЬКО САМ С СОБОЙ: `chat.type === 'private'`
 * и `chat.id === from.id`. В группе бот не отвечает вовсе — ни на
 * `/start`, ни на что другое: иначе служебный чат Льва получал бы
 * «This bot is for Spotik Shop staff.» на каждую команду.
 */
async function naSoobshchenie(m: Soobshchenie): Promise<void> {
  const chat = chislo(m.chat?.id);
  if (chat === null || m.chat?.type !== 'private') return;
  const ot = m.from ?? {};
  if (chislo(ot.id) !== chat || ot.is_bot === true) return;
  const tekst = typeof m.text === 'string' ? m.text.trim() : '';
  const komanda = /^\/start(?:@\w+)?(?:\s+(\S+))?\s*$/i.exec(tekst);
  if (!komanda) return;
  const token = komanda[1];
  if (!token) {
    otvetit(chat, OTVET.dlyaSotrudnikov);
    return;
  }
  /* Токен — 43 знака base64url (`novyToken`); чужое отсекается
     до похода в базу. */
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) {
    otvetit(chat, OTVET.nevernaya);
    return;
  }
  const ishod = await privyazat(token, chat, ot);
  if (ishod.kak === 'privyazan') log.info('Telegram привязан', { staff: pochtaVZhurnal(ishod.email) });
  else if (ishod.kak === 'net') log.info('ссылка привязки Telegram не подошла');
  otvetit(chat, ishod.kak === 'net' ? OTVET.nevernaya : OTVET.privyazan);
}

/** Правка сообщения — лучшим усилием, без повтора и не задерживая опрос. */
function pravkaVFone(obeshchanie: Promise<Itog>): void {
  void obeshchanie.then((itog) => {
    // «Не изменилось» — законный исход: раздача могла поправить его раньше.
    if (!itog.ok && !/message is not modified/i.test(itog.opisanie)) {
      redko('pravka', 'warn', 'личное сообщение не поправилось', { text: itog.pochemu.slice(0, 200) });
    }
  });
}

/**
 * Нажатие «Take».
 *
 * ⚠️ СНАЧАЛА ВЗЯТЬ, ПОТОМ ОДИН ОТВЕТ С ИТОГОМ (поправка concurrency-4).
 * Ответить на нажатие можно только раз; взятие — одна короткая
 * транзакция, а правка сообщения идёт после ответа и опрос не держит.
 *
 * ⚠️ БЕРЁТ ТОТ ЖЕ `vzyatZakaz`, ЧТО И КНОПКА В АДМИНКЕ, и с теми же
 * правами: видимость, запрещённые пары и «свободен ли заказ»
 * проверяются там, под `for update`, — второй двери к заказу бот
 * не заводит.
 *
 * ⚠️ ОТКАЗ, КОГДА ЗАКАЗ УЖЕ У ЭТОГО ЖЕ ОПЕРАТОРА, — «Taken». Так выглядит
 * повторная доставка того же нажатия, и двойное нажатие тоже: первое
 * взяло, второе отказало бы и сняло бы «is yours».
 */
async function naNazhatie(q: Nazhatie): Promise<void> {
  const id = typeof q.id === 'string' ? q.id : null;
  if (!id) return;
  const zakaz = zakazIzNazhatiya(q.data);
  const chat = chislo(q.message?.chat?.id);
  const soobshchenie = chislo(q.message?.message_id);
  if (zakaz === null) {
    // Не наша кнопка: ответ пустой, чтобы у человека погас индикатор.
    await otvetitNaNazhatie(id, '');
    return;
  }
  let tvoy = false;
  let vzyal = false;
  try {
    const kto = chislo(q.from?.id);
    const s =
      kto === null
        ? null
        : await odna<{ id: string; email: string; role: string; disabled: boolean }>(
            'select id, email, role, disabled from staff where tg_chat_id = $1',
            [kto],
          );
    if (s && s.role === 'operator' && !s.disabled) {
      const sid = Number(s.id);
      vzyal = await vzyatZakaz(zakaz, sid, await zapretyPar(sid));
      tvoy =
        vzyal ||
        Boolean(
          await odna(`select 1 from shop_order where id = $1 and status = 'in_work' and operator_id = $2`, [
            zakaz,
            sid,
          ]),
        );
      if (vzyal) {
        log.info('заказ взят из Telegram', { order: zakaz, staff: pochtaVZhurnal(s.email) });
        await soobshchitKomande({ vid: 'zakaz_vzyat', zakaz, kto: s.email });
      }
    }
  } catch (e) {
    log.error('нажатие «Take» не обработалось', { order: zakaz, text: String((e as Error).message) });
    await otvetitNaNazhatie(id, OTVET.sboy);
    return;
  }
  const otvet = await otvetitNaNazhatie(id, tvoy ? OTVET.vzyat : OTVET.nedostupen);
  if (!otvet.ok) redko('nazhatie', 'warn', 'ответ на нажатие не ушёл', { text: otvet.pochemu.slice(0, 200) });
  if (chat !== null && soobshchenie !== null) {
    pravkaVFone(tvoy ? ispravitLichnoe(chat, soobshchenie, tekstTvoy(zakaz)) : snyatKnopki(chat, soobshchenie));
  }
}

async function obrabotat(u: Obnovlenie): Promise<void> {
  if (u.message) await naSoobshchenie(u.message);
  else if (u.callback_query) await naNazhatie(u.callback_query);
}

/**
 * Один круг опроса. Возвращает итог `getUpdates` — решать про паузу
 * будет цикл.
 */
async function krug(): Promise<{ itog: Itog; skolko: number }> {
  const sohranyonnyy = await nastroyka(TG_OFFSET, '');
  const offset = Number(sohranyonnyy);
  const telo: Record<string, unknown> = { timeout: OPROS_SEK, allowed_updates: ['message', 'callback_query'] };
  if (sohranyonnyy && Number.isSafeInteger(offset)) telo.offset = offset;
  const itog = await vyzovMetoda('getUpdates', telo, OPROS_SROK_MS);
  if (!itog.ok) return { itog, skolko: 0 };
  const spisok = Array.isArray(itog.rezultat) ? (itog.rezultat as Obnovlenie[]) : [];
  for (const u of spisok) {
    const n = chislo(u.update_id);
    if (n === null) continue;
    try {
      const novoe = await odna(
        'insert into tg_obnovlenie (update_id) values ($1) on conflict do nothing returning 1',
        [n],
      );
      if (novoe) await obrabotat(u);
    } catch (e) {
      log.error('обновление бота не обработалось', { update: n, text: String((e as Error).message) });
    }
    try {
      await zadatNastroyku(TG_OFFSET, String(n + 1));
    } catch (e) {
      redko('offset', 'error', 'offset бота не записался', { text: String((e as Error).message) });
    }
  }
  return { itog, skolko: spisok.length };
}

async function krutit(): Promise<void> {
  await uznatImya();
  let pauza = 0;
  let bylaBeda = false;
  for (;;) {
    if (!imyaIzvestno && Date.now() - imyaSprashivali > IMYA_RAZ_V) await uznatImya();
    const nachalo = Date.now();
    let itog: Itog;
    let skolko = 0;
    try {
      ({ itog, skolko } = await krug());
    } catch (e) {
      itog = { ok: false, pochemu: String((e as Error).message), adres: '—', kod: 0, opisanie: '', povtorCherez: null };
    }
    if (itog.ok) {
      if (bylaBeda) log.info('бот снова получает обновления', { adres: itog.adres });
      bylaBeda = false;
      pauza = 0;
      // Сервер, вернувший пустой ответ сразу, — не повод крутиться вхолостую.
      if (!skolko && Date.now() - nachalo < 1_000) await spat(1_000);
      continue;
    }
    if (itog.kod === 409 && /terminated by other getUpdates/i.test(itog.opisanie)) {
      await spat(PAUZA_KONFLIKT);
      continue;
    }
    bylaBeda = true;
    if (itog.kod === 409 && /webhook/i.test(itog.opisanie)) {
      redko('webhook', 'error', 'у бота стоит вебхук: привязка и «Take» не работают, пока его не снимут', {
        text: itog.opisanie.slice(0, 200),
      });
      await spat(PAUZA_MAX);
      continue;
    }
    pauza = Math.min(Math.max(pauza * 2, 1_000), PAUZA_MAX);
    if (itog.povtorCherez) pauza = Math.max(pauza, Math.min(itog.povtorCherez * 1_000, 10 * PAUZA_MAX));
    redko('opros', 'warn', 'бот не получил обновлений', { text: itog.pochemu.slice(0, 200), adres: itog.adres });
    await spat(pauza);
  }
}

type Global = typeof globalThis & { __spotikBot?: boolean };

/**
 * Завести опрос. Только при заданном токене и живой базе: без токена
 * спрашивать некого, без базы негде хранить offset и привязки.
 */
export function zavestiBota(): void {
  if (!env.telegramToken || !bazaEst()) return;
  const g = globalThis as Global;
  if (g.__spotikBot) return;
  g.__spotikBot = true;
  void krutit().catch((e) => log.error('опрос бота остановился', { text: String((e as Error).message) }));
}

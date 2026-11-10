/**
 * Отправка в Telegram.
 *
 * ⚠️ ТОЛЬКО ПО IPv6, И ЭТО ГЛАВНОЕ В ЭТОМ ФАЙЛЕ. У российских
 * серверов `api.telegram.org` по IPv4 недоступен — соединение просто
 * не устанавливается, — а по IPv6 работает. Node по умолчанию ходит
 * «счастливыми глазами» (Happy Eyeballs): он пробует оба семейства
 * разом и выбирает то, что ответило первым. На нашем сервере это
 * означало бы таймаут на каждой отправке, поэтому семейство задано
 * ЯВНО, а автоподбор выключен.
 *
 * ⚠️ И АДРЕС, КУДА СОЕДИНИЛИСЬ, ВОЗВРАЩАЕТСЯ НАРУЖУ. Иначе «ушло
 * по IPv6» — это наше предположение, а не наблюдение: строка
 * в журнале называет фактический адрес, и по ней видно, какое
 * семейство сработало.
 *
 * ⚠️ ТОКЕН В ЖУРНАЛ НЕ ПОПАДАЕТ НИКОГДА. Он лежит в адресе запроса,
 * поэтому наружу отдаётся только путь метода, а сам адрес нигде
 * не печатается — ровно то же правило, что у паролей (Р-87).
 */

import { request, type RequestOptions } from 'node:https';
import { env } from './env';

/* ⚠️ У УДАЧИ ЕСТЬ ОТВЕТ, И ОН НУЖЕН С ПЯТИДЕСЯТОЙ ИТЕРАЦИИ: у
   `sendMessage` там номер сообщения, а без него бот не может потом
   удалить своё сообщение с паролем (Р-161). Разбирается он
   осторожно: Bot API обещает JSON, но сеть обещает только байты.

   ⚠️ У НЕУДАЧИ С ПЯТЬДЕСЯТ ЧЕТВЁРТОЙ ЕСТЬ КОД И ОПИСАНИЕ ПОРОЗНЬ.
   Боту, который сам принимает обновления, этого мало в одной строке:
   409 «terminated by other getUpdates» — тихая пауза, а 409 «webhook is
   active» — беда, о которой надо сказать; 403 «bot was blocked by
   the user» значит, что оператору писать больше нельзя. `kod` — HTTP-код
   ответа (ноль — ответа не было вовсе: сеть, таймаут), `opisanie` —
   `description` из тела Bot API, если он там был. */
export type Itog =
  | { ok: true; adres: string; rezultat: unknown }
  | { ok: false; pochemu: string; adres: string; kod: number; opisanie: string; povtorCherez: number | null };

export function telegramNastroen(): boolean {
  return Boolean(env.telegramToken && env.telegramChat);
}

/** Обычный срок запроса. У долгого опроса `getUpdates` свой, длиннее. */
const SROK_ZAPROSA = 15_000;

/**
 * Один вызов метода Bot API. Сеть наружу не бросает — только итог.
 *
 * ⚠️ СРОК — ПАРАМЕТР, И ЭТО НУЖНО ДОЛГОМУ ОПРОСУ. `getUpdates`
 * с `timeout: 25` держит соединение молча двадцать пять секунд,
 * и при прежних пятнадцати он обрывался бы на каждом круге. Срок
 * здесь — это время ТИШИНЫ сокета, а не всего запроса: ровно столько
 * Telegram и молчит, пока ждёт обновлений.
 */
export function vyzovMetoda(
  metod: string,
  telo: Record<string, unknown>,
  srokMs: number = SROK_ZAPROSA,
): Promise<Itog> {
  return new Promise((gotovo) => {
    const dannye = Buffer.from(JSON.stringify(telo), 'utf8');
    let adres = '—';
    const req = request(
      `${env.telegramApi}/bot${env.telegramToken}/${metod}`,
      /* ⚠️ `autoSelectFamily` В ТИПАХ NODE ЕЩЁ НЕТ, А В САМОМ NODE
         ЕСТЬ. Свойство уезжает в `net.connect` как есть, поэтому
         объект приводится к типу запроса целиком — иначе пришлось бы
         выбирать между рабочим кодом и проходящей проверкой типов. */
      {
        method: 'POST',
        /* Семейство адресов: 6 — только IPv6. Ноль означает «как
           получится» и оставлен рычагом на случай, если у сервера
           IPv6 когда-нибудь отберут. */
        family: env.telegramFamily || undefined,
        autoSelectFamily: env.telegramFamily === 0,
        timeout: srokMs,
        headers: {
          'content-type': 'application/json',
          'content-length': String(dannye.length),
        },
      } as RequestOptions,
      (res) => {
        const s = res.socket;
        adres = s?.remoteAddress ? `${s.remoteAddress} (${s.remoteFamily ?? '?'})` : '—';
        let telo2 = '';
        res.setEncoding('utf8');
        res.on('data', (k) => (telo2 += k));
        res.on('end', () => {
          if (res.statusCode === 200) {
            let rezultat: unknown = null;
            try {
              rezultat = (JSON.parse(telo2) as { result?: unknown }).result ?? null;
            } catch {
              rezultat = null;
            }
            gotovo({ ok: true, adres, rezultat });
            return;
          }
          /* Ответ Bot API может нести описание ошибки; берём его
             целиком, но коротко — в журнал уйдёт одна строка. */
          let opisanie = '';
          let povtorCherez: number | null = null;
          try {
            const j = JSON.parse(telo2) as { description?: unknown; parameters?: { retry_after?: unknown } };
            if (typeof j.description === 'string') opisanie = j.description;
            if (typeof j.parameters?.retry_after === 'number') povtorCherez = j.parameters.retry_after;
          } catch {
            opisanie = '';
          }
          gotovo({
            ok: false,
            pochemu: `HTTP ${res.statusCode}: ${telo2.slice(0, 200)}`,
            adres,
            kod: res.statusCode ?? 0,
            opisanie,
            povtorCherez,
          });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error(`таймаут ${Math.round(srokMs / 1000)} с`)));
    req.on('error', (e) =>
      gotovo({ ok: false, pochemu: String(e.message), adres, kod: 0, opisanie: '', povtorCherez: null }),
    );
    req.end(dannye);
  });
}

/** Итог «не звонили вовсе»: токена нет, и пробовать нечем. */
function bezTokena(pochemu: string): Itog {
  return { ok: false, pochemu, adres: '—', kod: 0, opisanie: '', povtorCherez: null };
}

function vyzov(metod: string, telo: Record<string, unknown>): Promise<Itog> {
  return vyzovMetoda(metod, telo, SROK_ZAPROSA);
}

/** Сообщение в служебный чат. */
export async function poslatVChat(tekst: string): Promise<Itog> {
  if (!telegramNastroen()) return bezTokena('токен или чат не заданы');
  return vyzov('sendMessage', {
    chat_id: env.telegramChat,
    text: tekst,
    disable_web_page_preview: true,
  });
}

/** Номер ушедшего сообщения из ответа `sendMessage`; `null` — разобрать не вышло. */
export function nomerSoobshcheniya(itog: Itog): number | null {
  if (!itog.ok) return null;
  const n = (itog.rezultat as { message_id?: unknown } | null)?.message_id;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/**
 * Удалить своё сообщение.
 *
 * ⚠️ BOT API НЕ ДАЁТ УДАЛЯТЬ СООБЩЕНИЯ СТАРШЕ 48 ЧАСОВ — это первое
 * ограничение в описании `deleteMessage`, и оно стоит над всеми
 * правами. Поэтому отказ здесь — не беда, а законный исход, и у него
 * есть запасной путь (`ispravitVChate`, Р-161).
 */
export async function udalitIzChata(chat: string, soobshchenie: number): Promise<Itog> {
  if (!env.telegramToken) return bezTokena('токен не задан');
  return vyzov('deleteMessage', { chat_id: chat, message_id: soobshchenie });
}

/**
 * Переписать своё сообщение — запасной путь, когда удалить нельзя.
 * Свои сообщения бот правит без срока: ограничение в 48 часов у правки
 * касается только чужих деловых сообщений.
 */
export async function ispravitVChate(chat: string, soobshchenie: number, tekst: string): Promise<Itog> {
  if (!env.telegramToken) return bezTokena('токен не задан');
  return vyzov('editMessageText', {
    chat_id: chat,
    message_id: soobshchenie,
    text: tekst,
    disable_web_page_preview: true,
  });
}

/* ── Личные сообщения оператору (пятьдесят четвёртая итерация) ──────
   Раздача заказов пишет каждому оператору в его личный чат с ботом,
   а не в служебную группу. Транспорт тот же — `vyzovMetoda`, — значит
   и правило то же: только IPv6, токен в журнал не попадает. */

export type Knopka = { text: string; callback_data: string };
/** Встроенная клавиатура под сообщением: ряды кнопок. */
export type Klaviatura = { inline_keyboard: Knopka[][] };

/**
 * Клавиатура без кнопок.
 *
 * ⚠️ СНИМАЕТСЯ КЛАВИАТУРА ЯВНЫМ ПУСТЫМ СПИСКОМ, А НЕ ПРОПУСКОМ ПОЛЯ.
 * Что пропущенное `reply_markup` в правке убирает кнопки, выведено
 * из исходников сервера Bot API, а не сказано в документации;
 * пустой `inline_keyboard` — описанная форма того же самого
 * (поправка concurrency-4).
 */
export const BEZ_KNOPOK: Klaviatura = { inline_keyboard: [] };

/** Номер чата для Bot API: в базе он `bigint`, и `pg` отдаёт его строкой. */
function nomerChata(chat: number | string): number | string {
  const n = Number(chat);
  return Number.isSafeInteger(n) ? n : String(chat);
}

/** Сообщение в личный чат, при желании — с кнопками. */
export async function poslatLichno(chat: number | string, tekst: string, klaviatura?: Klaviatura): Promise<Itog> {
  if (!env.telegramToken) return bezTokena('токен не задан');
  return vyzov('sendMessage', {
    chat_id: nomerChata(chat),
    text: tekst,
    disable_web_page_preview: true,
    ...(klaviatura ? { reply_markup: klaviatura } : {}),
  });
}

/**
 * Переписать своё личное сообщение. Клавиатура задаётся ВСЕГДА:
 * без кнопок — `BEZ_KNOPOK`, иначе прежняя кнопка «Take» осталась бы
 * под текстом «Order is yours».
 */
export async function ispravitLichnoe(
  chat: number | string,
  soobshchenie: number,
  tekst: string,
  klaviatura: Klaviatura = BEZ_KNOPOK,
): Promise<Itog> {
  if (!env.telegramToken) return bezTokena('токен не задан');
  return vyzov('editMessageText', {
    chat_id: nomerChata(chat),
    message_id: soobshchenie,
    text: tekst,
    disable_web_page_preview: true,
    reply_markup: klaviatura,
  });
}

/** Снять кнопки, не трогая текст. */
export async function snyatKnopki(chat: number | string, soobshchenie: number): Promise<Itog> {
  if (!env.telegramToken) return bezTokena('токен не задан');
  return vyzov('editMessageReplyMarkup', {
    chat_id: nomerChata(chat),
    message_id: soobshchenie,
    reply_markup: BEZ_KNOPOK,
  });
}

/**
 * Ответ на нажатие кнопки.
 *
 * ⚠️ ОТВЕЧАЕТСЯ РОВНО ОДИН РАЗ: второй ответ на то же нажатие Bot API
 * отвергает («query is too old… or query ID is invalid»), и человек
 * не увидел бы итога. Поэтому сначала дело, потом один ответ с итогом
 * (поправка concurrency-4).
 */
export async function otvetitNaNazhatie(nazhatie: string, tekst: string): Promise<Itog> {
  if (!env.telegramToken) return bezTokena('токен не задан');
  return vyzov('answerCallbackQuery', { callback_query_id: nazhatie, text: tekst.slice(0, 200) });
}

/**
 * Писать этому человеку больше нельзя: бот заблокирован, разговор
 * не начат или аккаунт удалён. Это 403 Bot API — в отличие от сбоя
 * сети, он не пройдёт сам, и привязку такого оператора надо снимать.
 */
export function lichkaZakryta(itog: Itog): boolean {
  if (itog.ok || itog.kod !== 403) return false;
  return /bot was blocked|can't initiate conversation|user is deactivated/i.test(
    itog.opisanie || itog.pochemu,
  );
}

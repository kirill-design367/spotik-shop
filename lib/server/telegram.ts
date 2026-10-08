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
   осторожно: Bot API обещает JSON, но сеть обещает только байты. */
export type Itog = { ok: true; adres: string; rezultat: unknown } | { ok: false; pochemu: string; adres: string };

export function telegramNastroen(): boolean {
  return Boolean(env.telegramToken && env.telegramChat);
}

/** Один вызов метода Bot API. Сеть наружу не бросает — только итог. */
function vyzov(metod: string, telo: Record<string, unknown>): Promise<Itog> {
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
        timeout: 15_000,
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
          gotovo({ ok: false, pochemu: `HTTP ${res.statusCode}: ${telo2.slice(0, 200)}`, adres });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('таймаут 15 с')));
    req.on('error', (e) => gotovo({ ok: false, pochemu: String(e.message), adres }));
    req.end(dannye);
  });
}

/** Сообщение в служебный чат. */
export async function poslatVChat(tekst: string): Promise<Itog> {
  if (!telegramNastroen()) return { ok: false, pochemu: 'токен или чат не заданы', adres: '—' };
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
  if (!env.telegramToken) return { ok: false, pochemu: 'токен не задан', adres: '—' };
  return vyzov('deleteMessage', { chat_id: chat, message_id: soobshchenie });
}

/**
 * Переписать своё сообщение — запасной путь, когда удалить нельзя.
 * Свои сообщения бот правит без срока: ограничение в 48 часов у правки
 * касается только чужих деловых сообщений.
 */
export async function ispravitVChate(chat: string, soobshchenie: number, tekst: string): Promise<Itog> {
  if (!env.telegramToken) return { ok: false, pochemu: 'токен не задан', adres: '—' };
  return vyzov('editMessageText', {
    chat_id: chat,
    message_id: soobshchenie,
    text: tekst,
    disable_web_page_preview: true,
  });
}

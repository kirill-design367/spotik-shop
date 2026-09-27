/**
 * Ссылка «восстановить пароль Spotify» из письма.
 *
 * Постановка сорок второй итерации: письмо ведёт на НАШУ страницу,
 * защищённую токеном со сроком жизни семь дней; на странице — почта
 * аккаунта Spotify этого заказа и одна кнопка «Скопировать почту
 * и перейти в Spotify».
 *
 * ⚠️ ТОКЕН ПРИВЯЗАН К СЛОТУ, А НЕ К ЗАКАЗУ. В заказе на двоих пароль
 * не подошёл у ОДНОГО из аккаунтов, и страница обязана показать
 * именно его почту: показав чужую, мы отправили бы человека менять
 * пароль там, где он и так работает.
 *
 * ⚠️ В БАЗЕ ЛЕЖИТ ТОЛЬКО ОТПЕЧАТОК, как у сессии и у кода
 * сертификата (Р-87): унесённая база не открывает ни одной ссылки.
 *
 * ⚠️ ЭТО ТРЕТИЙ ЧИТАТЕЛЬ ШИФРОТЕКСТА, И ОН ОГРАНИЧЕН ОДНОЙ
 * ВЕЛИЧИНОЙ. Закон 35 знал двух: владельца заказа и оператора,
 * который заказ взял. Здесь расшифровка идёт БЕЗ СЕССИИ, на силу
 * токена, — и читается РОВНО ПОЧТА, никогда пароль. Причина такая:
 * токен лежит в письме, отправленном на почту самого клиента, то есть
 * знание токена и есть подтверждение владения ящиком (ровно как
 * у кода входа); а почта аккаунта — это то, что клиент сам же и ввёл
 * в форме заказа. Пароль по токену не отдаётся никуда и никогда:
 * ни на страницу, ни в письмо, ни в журнал.
 */

import { otpechatok, novyToken, poprobovatRasshifrovat } from './crypto';
import { env } from './env';
import { odna, zapros } from './db';

/** Семь дней — ровно столько же живут шифротексты после закрытия
 *  заказа (закон 35): позже показывать было бы уже нечего. */
export const SROK_DNEY = 7;

/**
 * Завести ссылку для слота и вернуть её целиком.
 *
 * ⚠️ СТАРЫЕ ССЫЛКИ ЭТОГО ЖЕ СЛОТА СНИМАЮТСЯ. Письмо про неподошедший
 * пароль уходит на слот один раз, но оператор может вернуться шагом
 * назад и пройти его заново: две живые ссылки на один слот означали бы
 * две двери там, где нужна одна.
 */
export async function zavestiSsylku(zakaz: number, slotId: number): Promise<string> {
  const token = novyToken();
  await zapros('delete from recovery_link where slot_id = $1', [slotId]);
  await zapros(
    `insert into recovery_link (token_fp, order_id, slot_id, expires_at)
     values ($1, $2, $3, now() + ($4 || ' days')::interval)`,
    [otpechatok(token), zakaz, slotId, String(SROK_DNEY)],
  );
  return `${env.siteUrl}/vosstanovlenie/?t=${token}`;
}

export type Nayden =
  | { ok: true; pochta: string }
  | { ok: false; pochemu: 'net' | 'istyok' | 'styorto' };

/**
 * Что показать по токену.
 *
 * ⚠️ ССЫЛКА НЕ СГОРАЕТ НА ПЕРВОМ ОТКРЫТИИ, И ЭТО НАЗВАННОЕ
 * ОТСТУПЛЕНИЕ. Страница нужна человеку ровно затем, чтобы взять
 * почту и уйти в Spotify; сгори она с первого взгляда — второе
 * открытие того же письма (закрыл вкладку, вернулся через час,
 * читает с другого устройства) отдавало бы «ссылка недействительна»,
 * и это прямой путь в поддержку. Одноразовость здесь держится
 * СРОКОМ и тем, что токен свой у каждого письма, а не счётчиком
 * открытий.
 */
export async function poTokenu(token: string): Promise<Nayden> {
  const chistyy = token.trim();
  if (!chistyy) return { ok: false, pochemu: 'net' };
  const r = await odna<{ in_login_enc: string | null; istyok: boolean }>(
    `select s.in_login_enc, (l.expires_at <= now()) as istyok
       from recovery_link l join order_slot s on s.id = l.slot_id
      where l.token_fp = $1`,
    [otpechatok(chistyy)],
  );
  if (!r) return { ok: false, pochemu: 'net' };
  if (r.istyok) return { ok: false, pochemu: 'istyok' };
  const pochta = poprobovatRasshifrovat(r.in_login_enc);
  // Через семь дней после закрытия заказа шифротексты стирает уборка
  // (закон 35). Ссылка живёт столько же, но сойтись в один день они
  // могут — и тогда показывать нечего.
  if (!pochta) return { ok: false, pochemu: 'styorto' };
  return { ok: true, pochta };
}

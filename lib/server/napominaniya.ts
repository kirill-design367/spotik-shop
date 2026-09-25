/**
 * Напоминание об окончании подписки.
 *
 * Постановка тридцать четвёртой итерации: «за три дня до окончания
 * клиенту уходит письмо: подписка заканчивается такого-то числа,
 * и ссылка „Продлить“, которая открывает оформление с тарифом,
 * сроком, режимом „продлить существующий“ и подставленной почтой
 * аккаунта. Отправляется один раз на заказ; не отправляется, если
 * по этой почте уже оформлено продление; отправка идёт через уже
 * существующий будильник».
 *
 * ⚠️ ССЫЛКА НЕСЁТ НОМЕР ЗАКАЗА, А НЕ ПОЧТУ. Соблазн положить адрес
 * прямо в ссылку велик — подставлять было бы нечего. Но письмо живёт
 * в ящике вечно и пересылается кому угодно, а почта аккаунта Spotify
 * у нас лежит шифротекстом ровно затем, чтобы не гулять открытым
 * текстом. Оформление читает её САМО, у владельца заказа и через то же
 * единственное место, где расшифровка вообще разрешена (закон 35).
 *
 * ⚠️ «УЖЕ ОФОРМЛЕНО ПРОДЛЕНИЕ» ИЩЕТСЯ ПО ОТПЕЧАТКУ, А НЕ ПО ТЕКСТУ.
 * AES-GCM со случайным вектором двух одинаковых адресов одинаковыми
 * не делает, значит сравнить шифротексты нельзя вовсе. Рядом лежит
 * отпечаток, посоленный ключом (`otpechatokPochty`), — по нему
 * и ищется, ни одной строки не расшифровывая.
 *
 * ⚠️ У СТАРЫХ ЗАКАЗОВ ОТПЕЧАТКА НЕТ, и это не беда: у них нет
 * и `expires_at`, то есть в выборку они не попадают вовсе.
 */

import { bazaEst, zapros } from './db';
import { env } from './env';
import { log } from './log';
import { katalog, naytiTarif, srokPolno } from './catalog';
import { pismoSkoroKonec } from './letters';

/** За сколько дней до конца предупреждаем. */
export const ZA_DNEY = 3;

export async function napomnitObOkonchanii(): Promise<void> {
  if (!bazaEst()) return;
  try {
    const stroki = await zapros<{
      id: string;
      plan_id: string;
      period: number;
      expires_at: Date;
      email: string;
      closed_at: Date;
    }>(
      `select o.id, o.plan_id, o.period, o.expires_at, o.closed_at, u.email
         from shop_order o join app_user u on u.id = o.user_id
        where o.status = 'done'
          and o.expires_at is not null
          and o.reminded_at is null
          and o.expires_at > now()
          and o.expires_at <= now() + ($1 || ' days')::interval
        order by o.expires_at
        limit 200`,
      [String(ZA_DNEY)],
    );
    if (!stroki.length) return;
    const spisok = await katalog();

    for (const z of stroki) {
      const zakaz = Number(z.id);
      /* Продление по той же почте: любой ДРУГОЙ заказ, заведённый
         позже закрытия этого, у которого хоть один участник несёт
         тот же отпечаток почты. Отменённые в счёт не идут —
         продлением они не стали. */
      const est = await zapros<{ id: string }>(
        `select o2.id
           from order_slot s1
           join order_slot s2 on s2.login_fp = s1.login_fp
           join shop_order o2 on o2.id = s2.order_id
          where s1.order_id = $1
            and s1.login_fp is not null
            and o2.id <> $1
            and o2.created_at > $2
            and o2.status <> 'cancelled'
          limit 1`,
        [zakaz, z.closed_at],
      );
      /* ⚠️ ЗАЩЁЛКА СТАВИТСЯ В ОБОИХ СЛУЧАЯХ. Продление уже оформлено —
         письмо не нужно ни сейчас, ни через час, когда будильник
         придёт снова. */
      await zapros('update shop_order set reminded_at = now() where id = $1', [zakaz]);
      if (est.length) {
        log.info('напоминание не нужно: продление уже оформлено', { order: zakaz });
        continue;
      }
      const tarif = naytiTarif(spisok, z.plan_id);
      await pismoSkoroKonec({
        komu: z.email,
        zakaz,
        chto: `${tarif?.name ?? z.plan_id}, ${srokPolno(z.period).toLowerCase()}`,
        kogda: new Date(z.expires_at),
        ssylka: `${env.siteUrl}/checkout/?plan=${encodeURIComponent(z.plan_id)}&period=${z.period}&renew=${zakaz}`,
      });
      log.info('напоминание об окончании отправлено', { order: zakaz });
    }
  } catch (e) {
    log.error('напоминания не разослались', { text: String((e as Error).message) });
  }
}

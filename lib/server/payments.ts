/**
 * Платежи: выставление счёта и адрес, куда отправить человека.
 *
 * ⚠️ НОМЕР СЧЁТА — ЭТО `payment.id`, А НЕ НОМЕР ЗАКАЗА. Робокасса
 * не принимает повторный `InvId` никогда (ошибка 40), а заказ можно
 * оплачивать дважды: бросили оплату, вернулись, оплатили. Номер даёт
 * база своим `bigserial`, а не счётчик в памяти процесса, который
 * обнуляется на каждой выкладке.
 */

import { odna, zapros } from './db';
import { env } from './env';
import { nazvanieZakaza } from './orders';
import { katalog, naytiTarif, srokKratko } from './catalog';
import { nastroyki, robokassaRabotaet, ssylkaOplaty } from './robokassa';
import { log } from './log';
import { rubli } from './money';
import { avtoplatezhVklyuchen } from './settings';

export type Schet =
  | { ok: true; platyozh: number; adres: string; test: boolean }
  | { ok: false; pochemu: string };

export async function vystavitSchet(zakaz: number, userId: number): Promise<Schet> {
  const z = await odna<{
    id: string;
    kind: 'plan' | 'certificate';
    plan_id: string;
    period: number;
    status: string;
    total_kop: string;
    balance_kop: string;
    money_kop: string;
  }>(
    `select id, kind, plan_id, period, status, total_kop, balance_kop, money_kop
       from shop_order where id = $1 and user_id = $2`,
    [zakaz, userId],
  );
  if (!z) return { ok: false, pochemu: 'Заказа нет.' };
  if (z.status !== 'new') return { ok: false, pochemu: 'Этот заказ уже оплачен.' };

  const ostatok = Number(z.total_kop) - Number(z.balance_kop) - Number(z.money_kop);
  if (ostatok <= 0) return { ok: false, pochemu: 'Доплачивать нечего.' };
  const imitator = imitatorVklyuchyon();
  if (!robokassaRabotaet() && !imitator) {
    return {
      ok: false,
      pochemu: 'Оплата картой ещё не подключена: магазин Робокассы не настроен.',
    };
  }

  /* ⚠️ МАТЕРИНСКИЙ СЧЁТ АВТОПЛАТЕЖА — ТОЛЬКО ПРИ ПОДПИСКЕ, ЖДУЩЕЙ ОПЛАТЫ,
     И ВКЛЮЧЁННОМ ВЫКЛЮЧАТЕЛЕ (пятьдесят четвёртая итерация). Нажали
     «Не включать автоплатёж» — подписка отключена, и следующий счёт
     уходит прежней ссылкой: иначе человек, передумавший до оплаты,
     не смог бы заплатить без подписки (поправка money-8). Выключатель
     выключили — то же самое: пока он выключен, новых подписок нет.
     У имитатора `Recurring` не бывает вовсе: это не Робокасса.
     Подписка при оплате таким счётом не включится — см. `podtverditMat`. */
  const recurring =
    !imitator &&
    (await odna<{ id: string }>(`select id from avtoplatezh where order_id = $1 and status = 'zhdyot_oplaty'`, [zakaz])) !==
      null &&
    (await avtoplatezhVklyuchen());
  const n = nastroyki();
  /* ⚠️ РЕЖИМ РОБОКАССЫ ЗАПОМИНАЕТСЯ В СЧЁТЕ: тестовая мать в боевом
     режиме цепочку не начнёт — тестовые операции Робокасса не помнит
     по номеру (поправка money-17). */
  const p = await odna<{ id: string }>(
    `insert into payment (order_id, provider, amount_kop, status, recurring, test)
     values ($1, 'robokassa', $2, 'new', $3, $4) returning id`,
    [zakaz, ostatok, recurring, imitator ? true : n.test],
  );
  const platyozh = Number(p!.id);

  if (imitator) {
    // ⚠️ КЛЮЧЕЙ РОБОКАССЫ ЕЩЁ НЕТ. Счёт всё равно выставлен настоящий,
    // и подтверждает его та же дверь — просто нажатием на своей
    // странице, а не платёжной формой банка.
    log.warn('счёт выставлен ИМИТАТОРОМ: настоящей оплаты нет', { order: zakaz, payment: platyozh, amount_kop: ostatok });
    return { ok: true, platyozh, adres: `/pay/test/?payment=${platyozh}`, test: true };
  }

  const spisok = await katalog();
  const tarif = naytiTarif(spisok, z.plan_id);
  const imya = tarif?.name ?? z.plan_id;
  const nazvanie = nazvanieZakaza(imya, z.period, z.kind);
  /* ⚠️ ОПИСАНИЕ ПЛАТЕЖА ВИДИТ КЛИЕНТ НА СТРАНИЦЕ РОБОКАССЫ, поэтому
     номера заказа в нём нет (закон 48, решение по вопросу 128): тариф
     и срок — «Spotik Shop, Индивидуальный, 1 мес». В подпись описание
     не входит, номер счёта (`InvId`) по-прежнему `payment.id`. */
  const opisanie =
    z.kind === 'certificate'
      ? `Spotik Shop, сертификат, ${imya}, ${srokKratko(z.period)}`
      : `Spotik Shop, ${imya}, ${srokKratko(z.period)}`;
  const adres = ssylkaOplaty(
    n,
    platyozh,
    ostatok,
    opisanie,
    [{ name: nazvanie, sumKop: ostatok }],
    { recurring },
  );
  await zapros('update payment set external_id = $2 where id = $1', [platyozh, String(platyozh)]);
  log.info('счёт выставлен', { order: zakaz, payment: platyozh, amount_kop: ostatok, test: n.test, recurring });
  return { ok: true, platyozh, adres, test: n.test };
}

/**
 * Имитатор уведомления — пока ключей Робокассы нет.
 *
 * ⚠️ РАБОТАЕТ, ТОЛЬКО ЕСЛИ В ОКРУЖЕНИИ ЗАДАН ОТДЕЛЬНЫЙ СЕКРЕТ,
 * и на боевых ключах его там быть не должно. Это не «режим отладки
 * по флажку»: без секрета путь не существует вовсе и отвечает 404.
 */
export function imitatorVklyuchyon(): boolean {
  return Boolean(env.payFakeSecret) && !robokassaRabotaet();
}

/**
 * ПОПОЛНЕНИЕ БАЛАНСА: счёт без заказа (Р-168).
 *
 * ⚠️ СЧЁТ ЖИВЁТ В ТОЙ ЖЕ ТАБЛИЦЕ `payment`: номер счёта в Робокассе —
 * это `payment.id`, и второй источник номеров дал бы повторный
 * `InvId`, а его Робокасса не принимает никогда. Зачисляет деньги
 * та же единственная дверь — `otmetitOplachennym`, по проверенному
 * уведомлению; возврат человека на страницу успеха не зачисляет
 * ничего (закон 34).
 *
 * ⚠️ ЧЕК — ПРЕДОПЛАТА: услуги за этими деньгами ещё нет.
 */
export const POPOLNENIE_MIN_KOP = 10_00;
export const POPOLNENIE_MAX_KOP = 50_000_00;

export async function vystavitSchetPopolneniya(userId: number, summaKop: number): Promise<Schet> {
  if (!Number.isInteger(summaKop) || summaKop < POPOLNENIE_MIN_KOP || summaKop > POPOLNENIE_MAX_KOP) {
    return {
      ok: false,
      pochemu: `Сумма пополнения — от ${rubli(POPOLNENIE_MIN_KOP)} до ${rubli(POPOLNENIE_MAX_KOP)}, целыми рублями.`,
    };
  }
  const imitator = imitatorVklyuchyon();
  if (!robokassaRabotaet() && !imitator) {
    return { ok: false, pochemu: 'Оплата картой ещё не подключена: магазин Робокассы не настроен.' };
  }
  const p = await odna<{ id: string }>(
    `insert into payment (kind, user_id, order_id, provider, amount_kop, status, test)
     values ('topup', $1, null, 'robokassa', $2, 'new', $3) returning id`,
    [userId, summaKop, imitator ? true : nastroyki().test],
  );
  const platyozh = Number(p!.id);
  if (imitator) {
    log.warn('счёт пополнения выставлен ИМИТАТОРОМ: настоящей оплаты нет', { user: userId, payment: platyozh, amount_kop: summaKop });
    return { ok: true, platyozh, adres: `/pay/test/?payment=${platyozh}`, test: true };
  }
  const n = nastroyki();
  const adres = ssylkaOplaty(n, platyozh, summaKop, 'Spotik Shop, пополнение баланса', [
    { name: 'Пополнение баланса Spotik Shop', sumKop: summaKop, sposob: 'full_prepayment' },
  ]);
  await zapros('update payment set external_id = $2 where id = $1', [platyozh, String(platyozh)]);
  log.info('счёт пополнения выставлен', { user: userId, payment: platyozh, amount_kop: summaKop, test: n.test });
  return { ok: true, platyozh, adres, test: n.test };
}

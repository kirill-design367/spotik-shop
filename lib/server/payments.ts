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
import { katalog, naytiTarif } from './catalog';
import { nastroyki, robokassaRabotaet, ssylkaOplaty } from './robokassa';
import { log } from './log';

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

  const p = await odna<{ id: string }>(
    `insert into payment (order_id, provider, amount_kop, status) values ($1, 'robokassa', $2, 'new') returning id`,
    [zakaz, ostatok],
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
  const nazvanie = nazvanieZakaza(tarif?.name ?? z.plan_id, z.period, z.kind);
  const n = nastroyki();
  const adres = ssylkaOplaty(n, platyozh, ostatok, `Spotik Shop, заказ № ${zakaz}`, [
    { name: nazvanie, sumKop: ostatok },
  ]);
  await zapros('update payment set external_id = $2 where id = $1', [platyozh, String(platyozh)]);
  log.info('счёт выставлен', { order: zakaz, payment: platyozh, amount_kop: ostatok, test: n.test });
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

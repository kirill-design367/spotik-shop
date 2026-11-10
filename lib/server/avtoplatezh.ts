/**
 * АВТОПЛАТЁЖ — подписка на продление (пятьдесят четвёртая итерация).
 *
 * Постановка: «На оформлении галочка „Продлевать автоматически". Первый
 * платёж уходит с Recurring=true. Автоплатёж работает только с картой:
 * если первый платёж прошёл не картой, автоплатёж не включается, и клиент
 * видит это в кабинете».
 *
 * Здесь — жизнь подписки: заведение вместе с заказом, подтверждение
 * материнского платежа, отключение; списание, письма и разбор платежей
 * «в пути» живут в этом же модуле.
 *
 * ⚠️ ВСЁ, ЧТО МЕНЯЕТ ПОДПИСКУ, — ПОД `for update` ЕЁ СТРОКИ. Отключение
 * из кабинета, подтверждение оплаты и отправка списания берут одну и ту же
 * блокировку: иначе «Отключить», нажатое в ту секунду, когда уходит
 * запрос Recurring, не остановило бы списание (376-ФЗ, поправка money-9).
 *
 * ⚠️ ПОРЯДОК БЛОКИРОВОК ОДИН: платёж → заказ → подписка. Так берёт их
 * единственная дверь «оплачено» (`otmetitOplachennym`), и любой другой
 * путь, взявший их в обратном порядке, рано или поздно встретил бы её
 * взаимной блокировкой.
 */

import type { PoolClient } from 'pg';
import { vTranzakcii } from './db';
import { log } from './log';
import { oplachenoKartoy, sposobStrokoy, type PrichinaAvto, type StatusAvto } from '@/lib/avtoplatezh';

/**
 * Завести подписку вместе с заказом — В ТРАНЗАКЦИИ `sozdatZakaz`.
 *
 * `status` — `zhdyot_oplaty` (ждём первого платежа картой) или сразу
 * `ne_karta`, когда заказ закрыт балансом целиком: первый платёж прошёл
 * не картой, и материнского счёта у цепочки не будет.
 *
 * ⚠️ ПРЕЖНЯЯ ПОДПИСКА НА ЭТИ ЖЕ АККАУНТЫ, ЖДУЩАЯ ОПЛАТЫ, ЗАМЕНЯЕТСЯ
 * СРАЗУ. А ВКЛЮЧЁННАЯ — ТОЛЬКО КОГДА ВКЛЮЧИТСЯ НОВАЯ (`podtverditMat`).
 * Заменить действующую подписку в момент оформления значило бы, что
 * человек, бросивший оплату нового заказа, молча теряет автоплатёж,
 * который у него уже работал: неоплаченный заказ сам не отменяется
 * (Р-167), и доступ кончился бы без единого списания.
 */
export async function zavestiPodpisku(
  c: PoolClient,
  o: {
    userId: number;
    zakaz: number;
    planId: string;
    period: number;
    status: Extract<StatusAvto, 'zhdyot_oplaty' | 'ne_karta'>;
    soglasieTekst: string;
  },
): Promise<number> {
  const r = await c.query<{ id: string }>(
    `insert into avtoplatezh (user_id, order_id, plan_id, period, status, soglasie_at, soglasie_tekst)
     values ($1, $2, $3, $4, $5, now(), $6) returning id`,
    [o.userId, o.zakaz, o.planId, o.period, o.status, o.soglasieTekst],
  );
  const id = Number(r.rows[0]!.id);
  if (o.status === 'zhdyot_oplaty') await zamenitPrezhnie(c, id, ['zhdyot_oplaty']);
  log.info('автоплатёж заведён', { avto: id, order: o.zakaz, status: o.status });
  return id;
}

/**
 * Прежние подписки ТОГО ЖЕ человека на ТОТ ЖЕ набор аккаунтов —
 * в `otklyuchen/zamenena`.
 *
 * ⚠️ НАБОР СРАВНИВАЕТСЯ ЦЕЛИКОМ, ПО ОТПЕЧАТКАМ ПОЧТ (`login_fp`), а не
 * «хоть одна почта совпала» (поправка money-10): продление одного
 * аккаунта из «На двоих» не имеет права гасить подписку на оба.
 * Тариф и срок при этом не важны: человек, перешедший с месяца на год
 * на тех же аккаунтах, не должен платить и за то, и за другое.
 */
async function zamenitPrezhnie(c: PoolClient, novaya: number, statusy: StatusAvto[]): Promise<void> {
  const r = await c.query<{ id: string }>(
    `select a.id from avtoplatezh a
      where a.user_id = (select user_id from avtoplatezh where id = $1)
        and a.id <> $1
        and a.status = any($2::text[])
        and (select array_agg(s.login_fp order by s.login_fp) from order_slot s where s.order_id = a.order_id)
          = (select array_agg(s.login_fp order by s.login_fp) from order_slot s
              where s.order_id = (select order_id from avtoplatezh where id = $1))
      for update of a`,
    [novaya, statusy],
  );
  for (const x of r.rows) {
    await c.query(
      `update avtoplatezh set status = 'otklyuchen', prichina = 'zamenena', otklyuchen_at = now(), updated_at = now()
        where id = $1`,
      [x.id],
    );
    log.info('автоплатёж заменён новым', { avto: Number(x.id), novaya });
  }
}

/** Что пришло в уведомлении о способе оплаты. Поля в подпись не входят. */
export type SposobOplaty = { paymentMethod: string; incCurrLabel: string };

/**
 * Подтверждение материнского платежа — В ТРАНЗАКЦИИ `otmetitOplachennym`,
 * и только когда заказ стал оплаченным ИМЕННО ЭТИМ платежом
 * (поправка money-16): деньги, легшие на баланс, заказ не оплатили,
 * и подписку они не трогают.
 *
 *   счёт с `Recurring=true`, оплачен картой → `vklyuchen`, матерью
 *                                              становится этот счёт;
 *   с `Recurring=true`, но не картой         → `ne_karta`;
 *   без `Recurring=true`                     → `otklyuchen/bez_recurring`:
 *       выключатель выключили между оформлением и оплатой, или нажали
 *       «Не включать», или оплатили вторым счётом. Висеть в «включится
 *       после оплаты» при оплаченном заказе подписка не должна.
 *
 * ⚠️ ВЫКЛЮЧАТЕЛЬ ЗДЕСЬ НЕ СПРАШИВАЕТСЯ: платёж уже прошёл с согласием,
 * данным при включённом. Включённая подписка без выключателя ничего
 * не спишет — новые списания запрещает он сам.
 */
export async function podtverditMat(
  c: PoolClient,
  o: { zakaz: number; platyozh: number; recurring: boolean; sposob: SposobOplaty | null },
): Promise<void> {
  const r = await c.query<{ id: string; status: StatusAvto }>(
    'select id, status from avtoplatezh where order_id = $1 for update',
    [o.zakaz],
  );
  const a = r.rows[0];
  if (!a || a.status !== 'zhdyot_oplaty') return;
  const id = Number(a.id);
  const sposobStroka = o.sposob ? sposobStrokoy(o.sposob.paymentMethod, o.sposob.incCurrLabel) : null;

  if (!o.recurring) {
    await c.query(
      `update avtoplatezh set status = 'otklyuchen', prichina = 'bez_recurring', sposob = $2,
              otklyuchen_at = now(), updated_at = now()
        where id = $1`,
      [id, sposobStroka],
    );
    log.info('автоплатёж не включился: счёт был без Recurring', { avto: id, order: o.zakaz, payment: o.platyozh });
    return;
  }

  const karta = o.sposob ? oplachenoKartoy(o.sposob.paymentMethod, o.sposob.incCurrLabel) : null;
  if (karta === null) {
    // Решать не по чему — значит не карта. Уведомление настоящее
    // (подпись сошлась), поэтому это не беда, а повод посмотреть,
    // что присылает Робокасса.
    log.warn('в уведомлении нет ни PaymentMethod, ни IncCurrLabel: автоплатёж не включается', {
      avto: id,
      payment: o.platyozh,
    });
  }
  if (karta) {
    await c.query(
      `update avtoplatezh set status = 'vklyuchen', mat_payment_id = $2, sposob = $3, updated_at = now()
        where id = $1`,
      [id, o.platyozh, sposobStroka],
    );
    // Включилась новая — прежние подписки на те же аккаунты больше
    // не нужны, и действующая в том числе (см. `zavestiPodpisku`).
    await zamenitPrezhnie(c, id, ['vklyuchen', 'zhdyot_oplaty']);
    log.info('автоплатёж включён', { avto: id, order: o.zakaz, payment: o.platyozh, sposob: sposobStroka ?? '—' });
    return;
  }
  await c.query(`update avtoplatezh set status = 'ne_karta', sposob = $2, updated_at = now() where id = $1`, [
    id,
    sposobStroka,
  ]);
  log.info('автоплатёж не включился: оплата не картой', { avto: id, order: o.zakaz, sposob: sposobStroka ?? '—' });
}

/**
 * Заказ подписки отменён — подписка отключается той же транзакцией.
 * Зовут её отмена заказа (до выполнения) и отмена подписки
 * у выполненного заказа администратором.
 *
 * ⚠️ СПИСАНИЕ, УЖЕ УШЕДШЕЕ ПО ЭТОМУ ЦИКЛУ, ОТСЮДА НЕ ОТЗЫВАЕТСЯ: его
 * уведомление найдёт заказ цикла отменённым и положит деньги на баланс
 * (поправка money-2).
 */
export async function otklyuchitPoZakazu(c: PoolClient, zakaz: number): Promise<void> {
  const r = await c.query<{ id: string }>(
    `update avtoplatezh set status = 'otklyuchen', prichina = 'zakaz_otmenyon', otklyuchen_at = now(), updated_at = now()
      where order_id = $1 and status in ('zhdyot_oplaty', 'vklyuchen')
      returning id`,
    [zakaz],
  );
  if (r.rows.length) log.info('автоплатёж отключён: заказ отменён', { avto: Number(r.rows[0]!.id), order: zakaz });
}

/**
 * Отключить подписку по просьбе — из кабинета («Отключить автоплатёж»,
 * «Не включать автоплатёж»), по ссылке из письма или администратором.
 *
 * ⚠️ РАБОТАЕТ ПРИ ЛЮБОМ ПОЛОЖЕНИИ ВЫКЛЮЧАТЕЛЯ (поправка money-7):
 * отказ от подписки закон велит принимать в любой момент.
 *
 * ⚠️ ВЛАДЕЛЕЦ ПРОВЕРЯЕТСЯ ЗДЕСЬ, А НЕ НА СТРАНИЦЕ: номер подписки
 * приходит из скрытого поля формы. `userId = null` — проверку владельца
 * уже сделал вызывающий (токен из письма, администратор).
 *
 * После «Не включать» следующий счёт по этому заказу выставляется
 * без `Recurring=true` — `vystavitSchet` смотрит на статус.
 */
export async function otklyuchitPodpisku(
  id: number,
  userId: number | null,
  prichina: Extract<PrichinaAvto, 'klient' | 'admin'>,
): Promise<boolean> {
  return vTranzakcii(async (c) => {
    const r = await c.query<{ status: StatusAvto; user_id: string }>(
      'select status, user_id from avtoplatezh where id = $1 for update',
      [id],
    );
    const a = r.rows[0];
    if (!a) return false;
    if (userId !== null && Number(a.user_id) !== userId) return false;
    if (a.status !== 'zhdyot_oplaty' && a.status !== 'vklyuchen') return false;
    await c.query(
      `update avtoplatezh set status = 'otklyuchen', prichina = $2, otklyuchen_at = now(), updated_at = now()
        where id = $1`,
      [id, prichina],
    );
    log.info('автоплатёж отключён', { avto: id, kem: prichina, bylo: a.status });
    return true;
  });
}

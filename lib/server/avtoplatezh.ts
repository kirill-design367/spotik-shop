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
import { bazaEst, odna, vTranzakcii, zapros } from './db';
import { env } from './env';
import { log } from './log';
import { novyToken, otpechatok } from './crypto';
import { cenaTarifa, katalog, naytiTarif, srokPolno, type TarifSCenami } from './catalog';
import { nastroyka, zadatNastroyku, avtoplatezhVklyuchen } from './settings';
import { nastroyki, robokassaRabotaet, sprositSostoyanie, zaprositSpisanie, type Nastroyki } from './robokassa';
import { soobshchitKomande } from './notify';
import {
  pismoAvtoNeudacha,
  pismoAvtoOtklyuchen,
  pismoAvtoSkoro,
  pismoSkoroKonec,
  ssylkaProdlit,
} from './letters';
import { nazvanieZakaza, posleOplaty, zakazProdleniya } from './orders';
import { AVTO_STOP, oplachenoKartoy, sposobStrokoy, type PrichinaAvto, type StatusAvto } from '@/lib/avtoplatezh';

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

/* ══ ЧАСОВОЙ ХОД АВТОПЛАТЕЖА ═══════════════════════════════════════
 *
 * Постановка: «За 3 дня до окончания подписки — письмо: когда и какая
 * сумма будет списана, ссылка на отключение», «в день окончания
 * подписки спишется цена тарифа на этот же срок», «неудача: письмо
 * клиенту, одна повторная попытка на следующий день, после второй
 * неудачи автоплатёж отключается с письмом».
 *
 * Три прохода, каждый своим `try` (часовой будильник, `upkeep.ts`):
 *   1. разбор списаний «в пути» — ВСЕГДА, при любом положении
 *      выключателя (поправка money-7): деньги, уже взятые с карты,
 *      обязаны дойти до заказа;
 *   2. письма о списании — ворота списания (поправки money-4…6);
 *   3. сами списания: с баланса одной транзакцией, картой — двумя
 *      и запросом `Recurring` между ними под блокировкой подписки
 *      (поправки money-1, money-9).
 *
 * ⚠️ ПОРЯДОК БЛОКИРОВОК ОДИН НА ВЕСЬ САЙТ: платёж → заказ → подписка →
 * человек. Отмена заказа и отмена подписки берут заказ, потом подписку;
 * дверь «оплачено» — платёж, заказ цикла, подписку. Здесь платежа
 * в блокировках нет вовсе (его строку часовой ход меняет только
 * отдельным запросом ПОСЛЕ своей транзакции), заказ цикла берётся
 * раньше подписки.
 *
 * ⚠️ ВТОРОЙ ЭКЗЕМПЛЯР ПРИЛОЖЕНИЯ (минута выкладки) ходит тем же путём.
 * От двойной работы держит `pg_try_advisory_xact_lock` по номеру
 * подписки плюс перепроверка всех условий уже под `for update`: занято —
 * подписка пропускается до следующего часа, а не ждёт.
 */

const CHAS_MS = 3_600_000;
const SUTKI_MS = 24 * CHAS_MS;
/** Пространство ключей `pg_advisory` автоплатежа: первая половина пары. */
const ZAMOK = 5401;
/**
 * Подряд ответов Робокассы «не OK» на `Recurring` (по любым подпискам).
 * Три — глобальная остановка списаний картой (`AVTO_STOP`, поправка
 * money-3). Сбрасывается первым же OK и в момент остановки: после
 * снятия остановки в админке счёт начинается с нуля.
 */
const AVTO_NE_OK = 'avto_ne_ok';
/** Сколько ответов «не OK» подряд останавливают списания. */
const NE_OK_DO_STOPA = 3;
/** Назначение списания в запросе `Recurring` — видно в кабинете Робокассы. */
const OPISANIE_SPISANIYA = 'Spotik Shop, автопродление';

/**
 * Ссылка «Отключить автоплатёж» из письма: новый токен на тридцать дней.
 *
 * ⚠️ В БАЗУ ЛОЖИТСЯ ОТПЕЧАТОК, САМ ТОКЕН — ТОЛЬКО В ПИСЬМО (как у сессии
 * и ссылки восстановления, Р-87, Р-144). Страница — под `/cabinet`:
 * там нет счётчика Метрики, а токен лежит в адресе.
 */
export async function ssylkaOtklyuchit(c: PoolClient, avto: number): Promise<string> {
  const t = novyToken();
  await c.query(
    `insert into avto_token (token_hash, avtoplatezh_id, expires_at) values ($1, $2, now() + interval '30 days')`,
    [otpechatok(t), avto],
  );
  return `${env.siteUrl}/cabinet/avtoplatezh/?t=${encodeURIComponent(t)}`;
}

export type PodpiskaPoTokenu =
  | { ok: true; id: number; chto: string; status: StatusAvto }
  | { ok: false; pochemu: 'net' | 'istyok' };

/** Токен в адресе: то, что отдаёт `novyToken` (base64url). Иное — не наш токен. */
function tokenPohozh(t: string): boolean {
  return /^[A-Za-z0-9_-]{20,128}$/.test(t);
}

/**
 * Подписка по токену из письма — для страницы `/cabinet/avtoplatezh/`.
 *
 * ⚠️ НАРУЖУ ТОЛЬКО ТАРИФ, СРОК И СОСТОЯНИЕ: ни номера заказа (закон 48),
 * ни почты аккаунта — страница открывается без входа, а письмо могут
 * переслать.
 */
export async function podpiskaPoTokenu(t: string): Promise<PodpiskaPoTokenu> {
  if (!tokenPohozh(t)) return { ok: false, pochemu: 'net' };
  const r = await odna<{ id: string; plan_id: string; period: number; status: StatusAvto; zhiv: boolean }>(
    `select a.id, a.plan_id, a.period, a.status, (t.expires_at > now()) as zhiv
       from avto_token t join avtoplatezh a on a.id = t.avtoplatezh_id
      where t.token_hash = $1`,
    [otpechatok(t)],
  );
  if (!r) return { ok: false, pochemu: 'net' };
  if (!r.zhiv) return { ok: false, pochemu: 'istyok' };
  const tarif = naytiTarif(await katalog(), r.plan_id);
  return {
    ok: true,
    id: Number(r.id),
    chto: `${tarif?.name ?? r.plan_id}, ${srokPolno(r.period).toLowerCase()}`,
    status: r.status,
  };
}

/**
 * Отключить по токену из письма. ⚠️ ТОЛЬКО ИЗ POST-ДЕЙСТВИЯ: ссылку
 * из письма открывают и сканеры почты, и GET страницы не меняет ничего.
 * Работает при любом положении выключателя (поправка money-7).
 */
export async function otklyuchitPoTokenu(t: string): Promise<boolean> {
  const p = await podpiskaPoTokenu(t);
  if (!p.ok) return false;
  return otklyuchitPodpisku(p.id, null, 'klient');
}

/** Что узнали о подписке под блокировкой: всё, что нужно ходу. */
type Podpiska = {
  id: number;
  user_id: number;
  order_id: number;
  plan_id: string;
  period: number;
  status: StatusAvto;
  mat_payment_id: number | null;
  neudach: number;
  platezh_v_puti: number | null;
  napomnil_za_cikl: string | null;
  napomnil_summa_kop: number | null;
  /** Письмо этого цикла ушло не меньше суток назад. */
  vorota: boolean;
  /** Повтор не назначен или его время пришло. */
  pora: boolean;
  o_status: string;
  expires_at: Date | null;
  closed_at: Date | null;
  /** Московская дата окончания — «дата цикла», `ГГГГ-ММ-ДД`. */
  den: string | null;
  segodnya: string;
  vchera: string;
  /**
   * Самая поздняя из дат цикла (окончание, письмо, назначенный повтор)
   * старше позавчерашнего дня — цикл брошен (см. `pismoOdnoy`).
   */
  zabroshen: boolean;
  email: string;
  balance_kop: number;
};

/**
 * Взять подписку под блокировку: аренда `pg_advisory` и `for update`
 * заказа цикла, потом подписки (порядок — см. шапку хода).
 * `null` — подписка занята другим экземпляром или уехала на другой заказ.
 */
async function vzyatPodpisku(c: PoolClient, id: number): Promise<Podpiska | null> {
  const zamok = await c.query<{ ok: boolean }>('select pg_try_advisory_xact_lock($1, $2::int) as ok', [ZAMOK, id]);
  if (!zamok.rows[0]?.ok) return null;
  const bylo = await c.query<{ order_id: string }>('select order_id from avtoplatezh where id = $1', [id]);
  const zakaz = Number(bylo.rows[0]?.order_id ?? 0);
  if (!zakaz) return null;
  await c.query('select id from shop_order where id = $1 for update', [zakaz]);
  const r = await c.query<{
    id: string;
    user_id: string;
    order_id: string;
    plan_id: string;
    period: number;
    status: StatusAvto;
    mat_payment_id: string | null;
    neudach: number;
    platezh_v_puti: string | null;
    napomnil_za_cikl: string | null;
    napomnil_summa_kop: string | null;
    vorota: boolean;
    pora: boolean;
    o_status: string;
    expires_at: Date | null;
    closed_at: Date | null;
    den: string | null;
    segodnya: string;
    vchera: string;
    zabroshen: boolean;
    email: string;
    balance_kop: string;
  }>(
    `select a.id, a.user_id, a.order_id, a.plan_id, a.period, a.status, a.mat_payment_id, a.neudach,
            a.platezh_v_puti, a.napomnil_za_cikl::text as napomnil_za_cikl, a.napomnil_summa_kop,
            coalesce(a.napomnil_at <= now() - interval '24 hours', false) as vorota,
            (a.sleduyushchaya_popytka is null or a.sleduyushchaya_popytka <= now()) as pora,
            o.status as o_status, o.expires_at, o.closed_at,
            (o.expires_at at time zone 'Europe/Moscow')::date::text as den,
            (now() at time zone 'Europe/Moscow')::date::text as segodnya,
            ((now() at time zone 'Europe/Moscow')::date - 1)::text as vchera,
            coalesce(greatest((o.expires_at at time zone 'Europe/Moscow')::date,
                              (a.napomnil_at at time zone 'Europe/Moscow')::date,
                              (a.sleduyushchaya_popytka at time zone 'Europe/Moscow')::date)
                       < (now() at time zone 'Europe/Moscow')::date - 2, false) as zabroshen,
            u.email, u.balance_kop
       from avtoplatezh a
       join shop_order o on o.id = a.order_id
       join app_user u on u.id = a.user_id
      where a.id = $1
      for update of a`,
    [id],
  );
  const a = r.rows[0];
  if (!a || Number(a.order_id) !== zakaz) return null;
  return {
    ...a,
    id: Number(a.id),
    user_id: Number(a.user_id),
    order_id: Number(a.order_id),
    period: Number(a.period),
    mat_payment_id: a.mat_payment_id === null ? null : Number(a.mat_payment_id),
    neudach: Number(a.neudach),
    platezh_v_puti: a.platezh_v_puti === null ? null : Number(a.platezh_v_puti),
    napomnil_summa_kop: a.napomnil_summa_kop === null ? null : Number(a.napomnil_summa_kop),
    balance_kop: Number(a.balance_kop),
  };
}

/** «Индивидуальный, полгода» — так подписку называют письма. */
function chtoPodpiski(spisok: TarifSCenami[], a: { plan_id: string; period: number }): string {
  const tarif = naytiTarif(spisok, a.plan_id);
  return `${tarif?.name ?? a.plan_id}, ${srokPolno(a.period).toLowerCase()}`;
}

/** Текущая цена пары «тариф × срок» со скидкой тарифа, без промокода. `null` — не продаётся. */
function cenaPodpiski(spisok: TarifSCenami[], a: { plan_id: string; period: number }): number | null {
  const tarif = naytiTarif(spisok, a.plan_id);
  return tarif ? cenaTarifa(tarif, a.period) : null;
}

/**
 * Отключить подписку ходом (не по просьбе человека): та же запись,
 * что у `otklyuchitPodpisku`, но под уже взятой блокировкой.
 */
async function otklyuchitKhodom(c: PoolClient, id: number, prichina: PrichinaAvto): Promise<void> {
  await c.query(
    `update avtoplatezh set status = 'otklyuchen', prichina = $2, otklyuchen_at = now(),
            sleduyushchaya_popytka = null, updated_at = now()
      where id = $1`,
    [id, prichina],
  );
  log.info('автоплатёж отключён ходом', { avto: id, prichina });
}

/**
 * Прежнее письмо «Продлить» — со строкой о том, что автоплатёж отключён
 * (постановка: «уходит прежнее письмо „Продлить" с одной строкой»).
 * Защёлка прежнего письма ставится здесь же: иначе прежний ход
 * напоминаний прислал бы его второй раз.
 */
async function pismoProdlit(c: PoolClient, a: Podpiska, chto: string, stroka: string): Promise<void> {
  await c.query('update shop_order set reminded_at = now() where id = $1', [a.order_id]);
  if (!a.expires_at) return;
  await pismoSkoroKonec({
    komu: a.email,
    chto,
    kogda: new Date(a.expires_at),
    ssylka: ssylkaProdlit(a.plan_id, a.period, a.order_id),
    avto: stroka,
  });
}

/**
 * РУЧНОЕ ПРОДЛЕНИЕ ТЕХ ЖЕ АККАУНТОВ (поправки money-10, product-4).
 *
 * Свой запрос, а не прежний из напоминаний: тот искал «хоть одну
 * совпавшую почту в любом заказе», а здесь продлением цикла считается
 * заказ ТОГО ЖЕ человека, ТОГО ЖЕ тарифа и срока, на ТОТ ЖЕ набор
 * аккаунтов целиком (`login_fp`), оплаченный (`paid`, `in_work`, `done`)
 * и созданный после закрытия заказа цикла. Неоплаченный `new` списание
 * не останавливает: брошенное оформление — не продление.
 *
 * Нашёлся и у него своя подписка — прежняя `otklyuchen/zamenena`.
 * Без своей — подписка переезжает на него, счётчики цикла обнуляются.
 * `true` — продление нашлось, дальше по этой подписке делать нечего.
 */
async function ruchnoeProdlenie(c: PoolClient, a: Podpiska): Promise<boolean> {
  if (!a.closed_at) return false;
  const r = await c.query<{ id: string; svoya: string | null }>(
    `select o2.id, (select x.id from avtoplatezh x where x.order_id = o2.id) as svoya
       from shop_order o2
      where o2.user_id = $1
        and o2.id <> $2
        and o2.status in ('paid', 'in_work', 'done')
        and o2.plan_id = $3 and o2.period = $4
        and o2.created_at > $5
        and (select array_agg(s.login_fp order by s.login_fp) from order_slot s where s.order_id = o2.id)
          = (select array_agg(s.login_fp order by s.login_fp) from order_slot s where s.order_id = $2)
      order by o2.created_at desc
      limit 1`,
    [a.user_id, a.order_id, a.plan_id, a.period, a.closed_at],
  );
  const novy = r.rows[0];
  if (!novy) return false;
  if (novy.svoya) {
    await otklyuchitKhodom(c, a.id, 'zamenena');
    log.info('автоплатёж заменён подпиской ручного продления', { avto: a.id, order: Number(novy.id) });
    return true;
  }
  await c.query(
    `update avtoplatezh set order_id = $2, neudach = 0, sleduyushchaya_popytka = null,
            napomnil_za_cikl = null, napomnil_at = null, napomnil_summa_kop = null, updated_at = now()
      where id = $1`,
    [a.id, Number(novy.id)],
  );
  log.info('автоплатёж переехал на заказ ручного продления', { avto: a.id, s: a.order_id, na: Number(novy.id) });
  return true;
}

/**
 * Мать прошла в другом режиме Робокассы, чем сейчас (поправка money-17):
 * тестовые операции Робокасса не помнит по номеру, и боевое списание
 * по тестовой матери невозможно. `null` у старых счетов — неизвестно,
 * и такая мать за чужую не считается.
 */
async function matChuzhogoRezhima(c: PoolClient, a: Podpiska, n: Nastroyki): Promise<boolean> {
  if (a.mat_payment_id === null) return false;
  const m = await c.query<{ test: boolean | null }>('select test from payment where id = $1', [a.mat_payment_id]);
  const test = m.rows[0]?.test;
  return test !== null && test !== undefined && test !== n.test;
}

/** Раз в сутки на ключ: сигнал команде и повтор письма по отвергнутому адресу. */
async function razVSutki(klyuch: string): Promise<boolean> {
  const bylo = Number(await nastroyka(klyuch, '0'));
  if (Number.isFinite(bylo) && Date.now() - bylo < SUTKI_MS) return false;
  await zadatNastroyku(klyuch, String(Date.now()));
  return true;
}

/* ── Проход 2: письма о списании — ворота ─────────────────────── */

/**
 * ПИСЬМО О СПИСАНИИ ОДНОЙ ПОДПИСКИ (поправки money-4…6, product-1).
 *
 *   письмо этого цикла есть и цена не выросла — делать нечего;
 *   цена выросла выше названной — новое письмо с новой суммой: списать
 *     можно не больше названного и не раньше суток после письма;
 *   письма нет, а цикл кончился раньше вчерашнего дня — `prosrochen`
 *     и прежнее письмо «Продлить»: списывать без предупреждения нельзя;
 *   письма нет — письмо сейчас, даже если до конца меньше трёх дней
 *     (заказ выполнили поздно, выключатель включили недавно).
 *
 * ⚠️ ЦИКЛ, БРОШЕННЫЙ НА ДНИ, ТОЖЕ `prosrochen`: последняя из его дат
 * (окончание, письмо, назначенный повтор) старше позавчерашней. Так
 * выключатель, выключенный на месяц, или остановка списаний после трёх
 * отказов не превращаются в списание за подписку, кончившуюся месяц
 * назад, по письму, отправленному месяц назад.
 *
 * ⚠️ ПИСЬМО УХОДИТ ПОД БЛОКИРОВКОЙ ПОДПИСКИ, и защёлка пишется по его
 * исходу (`otpravit`): `ushlo` открывает ворота, `net` — повтор
 * на следующем часу, `adres` — ворота закрыты, команде сообщение
 * и повтор не чаще раза в сутки.
 */
async function pismoOdnoy(id: number, spisok: TarifSCenami[], n: Nastroyki): Promise<void> {
  const posle = await vTranzakcii(async (c) => {
    const a = await vzyatPodpisku(c, id);
    if (!a || a.status !== 'vklyuchen' || a.platezh_v_puti !== null) return null;
    if (a.o_status !== 'done' || !a.expires_at || !a.den) return null;
    if (await ruchnoeProdlenie(c, a)) return null;
    const chto = chtoPodpiski(spisok, a);
    if (await matChuzhogoRezhima(c, a, n)) {
      await otklyuchitKhodom(c, a.id, 'testovaya');
      await pismoProdlit(c, a, chto, 'Автоплатёж для этой подписки отключён.');
      return { vid: 'testovaya' as const, a };
    }
    const cena = cenaPodpiski(spisok, a);
    if (cena === null) {
      await otklyuchitKhodom(c, a.id, 'ne_prodayotsya');
      await pismoProdlit(c, a, chto, 'Автоплатёж отключён: этот тариф на этот срок больше не продаётся.');
      return null;
    }
    const estPismo = a.napomnil_za_cikl === a.den;
    if ((!estPismo && a.den < a.vchera) || (estPismo && a.zabroshen)) {
      await otklyuchitKhodom(c, a.id, 'prosrochen');
      await pismoProdlit(
        c,
        a,
        chto,
        'Автоплатёж отключён: срок подписки кончился раньше, чем мы успели предупредить о списании.',
      );
      return null;
    }
    if (estPismo && a.napomnil_summa_kop !== null && cena <= a.napomnil_summa_kop) return null;
    // Почтовый узел уже отверг этот адрес — повтор не чаще раза в сутки.
    const otvergnut = Number(await nastroyka(`avto_adres:${a.id}`, '0'));
    if (Number.isFinite(otvergnut) && Date.now() - otvergnut < SUTKI_MS) return null;

    const konec = new Date(a.expires_at);
    const spisanie = new Date(Math.max(konec.getTime(), Date.now() + SUTKI_MS));
    const ishod = await pismoAvtoSkoro({
      komu: a.email,
      chto,
      kogda: konec,
      spisanie,
      summaKop: cena,
      sBalansa: a.balance_kop >= cena,
      ssylkaOtklyuchit: await ssylkaOtklyuchit(c, a.id),
    });
    if (ishod === 'ushlo') {
      await c.query(
        `update avtoplatezh set napomnil_za_cikl = $2::date, napomnil_at = now(), napomnil_summa_kop = $3,
                updated_at = now()
          where id = $1`,
        [a.id, a.den, cena],
      );
      log.info('письмо о списании автоплатежа ушло', { avto: a.id, order: a.order_id, kop: cena, novaya: estPismo });
      return null;
    }
    if (ishod === 'adres') {
      log.error('письмо о списании автоплатежа: почтовый узел отверг адрес, не списываем', {
        avto: a.id,
        order: a.order_id,
      });
      await zadatNastroyku(`avto_adres:${a.id}`, String(Date.now()));
      return { vid: 'adres' as const, a };
    }
    log.warn('письмо о списании автоплатежа не ушло, повторим через час', { avto: a.id });
    return null;
  });
  if (posle?.vid === 'testovaya') {
    await soobshchitKomande({ vid: 'avto_testovaya', avto: posle.a.id, zakaz: posle.a.order_id });
  }
  if (posle?.vid === 'adres') {
    await soobshchitKomande({ vid: 'avto_pismo_adres', avto: posle.a.id, zakaz: posle.a.order_id });
  }
}

async function pismaAvto(spisok: TarifSCenami[], n: Nastroyki): Promise<void> {
  const r = await zapros<{ id: string }>(
    `select a.id from avtoplatezh a join shop_order o on o.id = a.order_id
      where a.status = 'vklyuchen' and a.platezh_v_puti is null
        and o.status = 'done' and o.expires_at is not null
        and o.expires_at <= now() + interval '3 days'
      order by o.expires_at
      limit 200`,
  );
  for (const x of r) {
    try {
      await pismoOdnoy(Number(x.id), spisok, n);
    } catch (e) {
      log.error('письмо о списании автоплатежа: сбой', { avto: Number(x.id), text: String((e as Error).message) });
    }
  }
}

/* ── Проход 3: списания ──────────────────────────────────────── */

/** Почему списать картой сейчас нельзя — словами для журнала; `null` — можно. */
async function pochemuNeKartoy(n: Nastroyki): Promise<string | null> {
  if ((await nastroyka(AVTO_STOP, '0')) === '1') return 'списания картой остановлены после трёх отказов Робокассы';
  if (!robokassaRabotaet()) return 'магазин Робокассы не настроен';
  /* ⚠️ У `Merchant/Recurring` НЕТ ТЕСТОВОГО РЕЖИМА (поправка money-17):
     при `ROBOKASSA_TEST=1` запрос уходит только на адрес, заданный
     явно, — то есть на поддельную Робокассу стенда. */
  if (n.test && !env.rkRecurringZadan) return 'тестовый режим Робокассы, а у Recurring его нет';
  return null;
}

type ShagSpisaniya =
  | { kak: 'nichego' }
  | { kak: 'ne_kartoy' }
  | { kak: 'balans'; novy: number }
  | { kak: 'testovaya'; a: Podpiska }
  | { kak: 'karta'; a: Podpiska; platyozh: number; summaKop: number; tarif: string };

/**
 * Т1 (поправка money-1): под блокировкой подписки перепроверить всё
 * и либо продлить с баланса целиком, либо завести дочерний счёт
 * и поставить его «в путь» — до запроса. После коммита ResultURL
 * уже видит строку платежа, а второй экземпляр приложения — что
 * по этой подписке списание в пути.
 */
async function nachatSpisanie(id: number, spisok: TarifSCenami[], n: Nastroyki, neKartoy: string | null): Promise<ShagSpisaniya> {
  return vTranzakcii<ShagSpisaniya>(async (c) => {
    const a = await vzyatPodpisku(c, id);
    if (!a || a.status !== 'vklyuchen' || a.platezh_v_puti !== null || !a.pora) return { kak: 'nichego' };
    if (a.o_status !== 'done' || !a.den || a.den > a.segodnya) return { kak: 'nichego' };
    // Ворота: письмо ЭТОГО цикла и сутки после него (поправка money-4).
    if (a.napomnil_za_cikl !== a.den || !a.vorota || a.napomnil_summa_kop === null) return { kak: 'nichego' };
    if (await ruchnoeProdlenie(c, a)) return { kak: 'nichego' };
    const cena = cenaPodpiski(spisok, a);
    // Не продаётся — отключит проход писем со своим письмом.
    if (cena === null) return { kak: 'nichego' };
    // Не больше названного в письме (поправка money-6).
    const summaKop = Math.min(a.napomnil_summa_kop, cena);

    /* С БАЛАНСА — ЕСЛИ ХВАТАЕТ ЦЕЛИКОМ, ОДНОЙ ТРАНЗАКЦИЕЙ. Хватает ли,
       решает `zakazProdleniya` ПОСЛЕ `for update` строки человека. */
    const novy = await zakazProdleniya(c, {
      avto: a.id,
      userId: a.user_id,
      planId: a.plan_id,
      period: a.period,
      ciklZakaz: a.order_id,
      oplata: { kak: 'balans', summaKop },
    });
    if (novy !== null) {
      await podpiskaProdlena(c, { avto: a.id, novy, platyozh: null });
      return { kak: 'balans', novy };
    }

    if (neKartoy) return { kak: 'ne_kartoy' };
    if (a.mat_payment_id === null) {
      log.error('включённый автоплатёж без материнского счёта: картой не списать', { avto: a.id });
      return { kak: 'nichego' };
    }
    if (await matChuzhogoRezhima(c, a, n)) {
      await otklyuchitKhodom(c, a.id, 'testovaya');
      await pismoProdlit(c, a, chtoPodpiski(spisok, a), 'Автоплатёж для этой подписки отключён.');
      return { kak: 'testovaya', a };
    }
    const p = await c.query<{ id: string }>(
      `insert into payment (order_id, user_id, provider, amount_kop, status, kind, avtoplatezh_id, avto_cikl_order_id, test)
       values (null, $1, 'robokassa', $2, 'new', 'avto', $3, $4, $5) returning id`,
      [a.user_id, summaKop, a.id, a.order_id, n.test],
    );
    const platyozh = Number(p.rows[0]!.id);
    await c.query('update payment set external_id = $2 where id = $1', [platyozh, String(platyozh)]);
    await c.query('update avtoplatezh set platezh_v_puti = $2, otpravlen_at = null, updated_at = now() where id = $1', [
      a.id,
      platyozh,
    ]);
    return { kak: 'karta', a, platyozh, summaKop, tarif: naytiTarif(spisok, a.plan_id)?.name ?? a.plan_id };
  });
}

type IshodT2 =
  | { kak: 'snyat' }
  | { kak: 'ok' }
  | { kak: 'obryv'; pochemu: string }
  | { kak: 'ne_doshlo'; pochemu: string }
  | { kak: 'ne_ok'; otvet: string };

/**
 * Т2 (поправки money-1, money-9): снова `for update` подписки,
 * перепроверка — и запрос `Recurring`, ПОКА БЛОКИРОВКА ДЕРЖИТСЯ.
 * «Отключить» берёт ту же блокировку: нажатое в эту секунду дождётся
 * ответа, а нажатое раньше остановит запрос здесь же.
 *
 * ⚠️ СТРОКУ ПЛАТЕЖА Т2 НЕ ТРОГАЕТ: её блокирует дверь «оплачено»
 * ПЕРВОЙ, и ResultURL, пришедший во время запроса, ждал бы нас, а мы —
 * его. Отметка `failed` ставится отдельным запросом после коммита.
 */
async function otpravitSpisanie(n: Nastroyki, k: Extract<ShagSpisaniya, { kak: 'karta' }>): Promise<IshodT2> {
  return vTranzakcii<IshodT2>(async (c) => {
    const r = await c.query<{ status: StatusAvto; platezh_v_puti: string | null; mat_payment_id: string | null }>(
      'select status, platezh_v_puti, mat_payment_id from avtoplatezh where id = $1 for update',
      [k.a.id],
    );
    const a = r.rows[0];
    const moy = a && a.platezh_v_puti !== null && Number(a.platezh_v_puti) === k.platyozh;
    const mozhno =
      moy &&
      a.status === 'vklyuchen' &&
      a.mat_payment_id !== null &&
      (await avtoplatezhVklyuchen()) &&
      (await pochemuNeKartoy(n)) === null;
    if (!mozhno) {
      if (moy) {
        await c.query('update avtoplatezh set platezh_v_puti = null, otpravlen_at = null, updated_at = now() where id = $1', [
          k.a.id,
        ]);
      }
      return { kak: 'snyat' };
    }
    const ishod = await zaprositSpisanie(n, {
      invoiceId: k.platyozh,
      previousInvoiceId: Number(a.mat_payment_id),
      summaKop: k.summaKop,
      opisanie: OPISANIE_SPISANIYA,
      // Тот же чек, что у ссылки на оплату: одна позиция, полный расчёт.
      pozicii: [{ name: nazvanieZakaza(k.tarif, k.a.period, 'plan'), sumKop: k.summaKop }],
    });
    if (ishod.kak === 'ok' || ishod.kak === 'obryv') {
      // Обрыв ПОСЛЕ отправки — тоже «в пути»: исход решит опрос.
      await c.query('update avtoplatezh set otpravlen_at = now(), updated_at = now() where id = $1', [k.a.id]);
      return ishod.kak === 'ok' ? { kak: 'ok' } : { kak: 'obryv', pochemu: ishod.pochemu };
    }
    // До отправки не дошло — тихо, повтор через час; отказ Робокассы —
    // повтор через сутки: почти всегда это настройка, а не карта.
    await c.query(
      `update avtoplatezh set platezh_v_puti = null, otpravlen_at = null,
              sleduyushchaya_popytka = now() + $2::interval, updated_at = now()
        where id = $1`,
      [k.a.id, ishod.kak === 'ne_doshlo' ? '1 hour' : '1 day'],
    );
    return ishod.kak === 'ne_doshlo' ? { kak: 'ne_doshlo', pochemu: ishod.pochemu } : { kak: 'ne_ok', otvet: ishod.otvet };
  });
}

/** Счёт не дошёл до списания — `failed`, если он всё ещё `new`. Отдельно от блокировки подписки. */
async function schetNeUdalsya(platyozh: number): Promise<void> {
  await zapros(`update payment set status = 'failed' where id = $1 and status = 'new'`, [platyozh]);
}

/**
 * Робокасса ответила «не OK» (на `Recurring` или опросом «операции нет»
 * у давно отправленного): клиенту не пишем, неудачей клиента не считаем,
 * команде — по-английски; три подряд — остановка списаний картой
 * (поправки money-3, money-14).
 */
async function otkazRobokassy(o: { platyozh: number; avto: number; zakaz: number; otvet: string }): Promise<void> {
  await soobshchitKomande({ vid: 'avto_ne_ok', platyozh: o.platyozh, avto: o.avto, zakaz: o.zakaz, otvet: o.otvet });
  const podryad = Number(await nastroyka(AVTO_NE_OK, '0')) + 1;
  if (podryad >= NE_OK_DO_STOPA) {
    await zadatNastroyku(AVTO_STOP, '1');
    await zadatNastroyku(AVTO_NE_OK, '0');
    log.error('списания автоплатежа картой остановлены: три отказа Робокассы подряд', { otvet: o.otvet.slice(0, 120) });
    await soobshchitKomande({ vid: 'avto_stop', otvet: o.otvet });
    return;
  }
  await zadatNastroyku(AVTO_NE_OK, String(podryad));
}

async function spisatOdnu(id: number, spisok: TarifSCenami[], n: Nastroyki, neKartoy: string | null): Promise<'ne_kartoy' | null> {
  const shag = await nachatSpisanie(id, spisok, n, neKartoy);
  if (shag.kak === 'ne_kartoy') return 'ne_kartoy';
  if (shag.kak === 'balans') {
    log.info('автоплатёж: продлено с баланса', { avto: id, order: shag.novy });
    await posleOplaty(shag.novy);
    return null;
  }
  if (shag.kak === 'testovaya') {
    await soobshchitKomande({ vid: 'avto_testovaya', avto: shag.a.id, zakaz: shag.a.order_id });
    return null;
  }
  if (shag.kak !== 'karta') return null;

  const t2 = await otpravitSpisanie(n, shag);
  if (t2.kak === 'ok') {
    log.info('автоплатёж: списание отправлено, ждём уведомления', { avto: id, payment: shag.platyozh, kop: shag.summaKop });
    if ((await nastroyka(AVTO_NE_OK, '0')) !== '0') await zadatNastroyku(AVTO_NE_OK, '0');
    return null;
  }
  if (t2.kak === 'obryv') {
    log.warn('автоплатёж: ответа на списание нет, исход решит опрос', {
      avto: id,
      payment: shag.platyozh,
      text: t2.pochemu,
    });
    return null;
  }
  await schetNeUdalsya(shag.platyozh);
  if (t2.kak === 'snyat') {
    log.info('автоплатёж: списание снято до отправки', { avto: id, payment: shag.platyozh });
    return null;
  }
  if (t2.kak === 'ne_doshlo') {
    log.warn('автоплатёж: Робокасса недоступна, повторим через час', { avto: id, payment: shag.platyozh, text: t2.pochemu });
    return null;
  }
  log.error('автоплатёж: Робокасса отказала в списании', { avto: id, payment: shag.platyozh, text: t2.otvet.slice(0, 200) });
  await otkazRobokassy({ platyozh: shag.platyozh, avto: id, zakaz: shag.a.order_id, otvet: t2.otvet });
  return null;
}

/**
 * Перед ПОВТОРНОЙ попыткой цикла — что стало с прежними счетами этого
 * цикла (поправка money-14). Состояние 5, 50 или 100 у «неудавшегося»
 * счёта значит, что деньги, может быть, уже идут: второй запрос был бы
 * двойным списанием. Тогда повтор откладывается на час, а команда
 * узнаёт об этом не чаще раза в сутки.
 */
async function prezhnieSchetaChisty(id: number, n: Nastroyki): Promise<boolean> {
  if (!robokassaRabotaet() || (n.test && !env.rkOpStateZadan)) return true;
  const r = await zapros<{ id: string; zakaz: string }>(
    `select p.id, p.avto_cikl_order_id as zakaz from payment p join avtoplatezh a on a.id = p.avtoplatezh_id
      where p.avtoplatezh_id = $1 and p.kind = 'avto' and p.status = 'failed'
        and p.avto_cikl_order_id = a.order_id`,
    [id],
  );
  for (const p of r) {
    const s = await sprositSostoyanie(n, Number(p.id));
    if (s.kak === 'otvet' && s.result === 0 && s.state !== null && [5, 50, 100].includes(s.state)) {
      await zapros(`update avtoplatezh set sleduyushchaya_popytka = now() + interval '1 hour', updated_at = now() where id = $1`, [
        id,
      ]);
      log.warn('автоплатёж: прежний счёт цикла ещё жив, повтор отложен', { avto: id, payment: Number(p.id), state: s.state });
      if (await razVSutki(`avto_signal:${p.id}`)) {
        await soobshchitKomande({
          vid: 'avto_rukami',
          platyozh: Number(p.id),
          avto: id,
          zakaz: Number(p.zakaz),
          pochemu: `a charge marked failed has Robokassa state ${s.state}; the retry is on hold`,
        });
      }
      return false;
    }
  }
  return true;
}

async function spisaniya(spisok: TarifSCenami[], n: Nastroyki): Promise<void> {
  const r = await zapros<{ id: string; povtor: boolean }>(
    `select a.id, (a.neudach > 0 or exists (select 1 from payment p where p.avtoplatezh_id = a.id
                                              and p.kind = 'avto' and p.status = 'failed'
                                              and p.avto_cikl_order_id = a.order_id)) as povtor
       from avtoplatezh a join shop_order o on o.id = a.order_id
      where a.status = 'vklyuchen' and a.platezh_v_puti is null
        and (a.sleduyushchaya_popytka is null or a.sleduyushchaya_popytka <= now())
        and o.status = 'done' and o.expires_at is not null
        and (o.expires_at at time zone 'Europe/Moscow')::date <= (now() at time zone 'Europe/Moscow')::date
        and a.napomnil_za_cikl = (o.expires_at at time zone 'Europe/Moscow')::date
        and a.napomnil_at <= now() - interval '24 hours'
      order by o.expires_at
      limit 100`,
  );
  if (!r.length) return;
  const neKartoy = await pochemuNeKartoy(n);
  let otlozheno = 0;
  for (const x of r) {
    const id = Number(x.id);
    try {
      if (x.povtor && !(await prezhnieSchetaChisty(id, n))) continue;
      if ((await spisatOdnu(id, spisok, n, neKartoy)) === 'ne_kartoy') otlozheno += 1;
    } catch (e) {
      log.error('автоплатёж: списание не прошло', { avto: id, text: String((e as Error).message) });
    }
  }
  // Одна строка за проход, а не на каждую подписку (поправка money-17).
  if (otlozheno) log.warn('автоплатёж: картой сейчас не списываем', { pochemu: neKartoy ?? '—', podpisok: otlozheno });
}

/* ── Проход 1: списания «в пути» ─────────────────────────────── */

type Neudacha =
  | { kak: 'net' }
  | { kak: 'chuzhoy' }
  | { kak: 'pervaya' }
  | { kak: 'vtoraya' };

/**
 * НЕУДАЧА КЛИЕНТА — банк не списал (поправки money-14, product-6).
 * Первая — письмо «попробуем ещё раз» и повтор завтра в 10:00 по Москве,
 * вторая — `otklyuchen/dve_neudachi` и письмо «Продлить вручную».
 *
 * ⚠️ СЧЁТ ЧУЖОГО ЦИКЛА НЕУДАЧЕЙ НЕ СЧИТАЕТСЯ: подписка за это время
 * переехала на новый заказ (поздний ResultURL другого счёта), и чужая
 * неудача не имеет права отключить её через два дня.
 */
async function neudachaKlienta(id: number, platyozh: number, pochemu: string, spisok: TarifSCenami[]): Promise<void> {
  const itog = await vTranzakcii<Neudacha>(async (c) => {
    const a = await vzyatPodpisku(c, id);
    if (!a || a.platezh_v_puti !== platyozh) return { kak: 'net' };
    const p = await c.query<{ avto_cikl_order_id: string | null; amount_kop: string }>(
      'select avto_cikl_order_id, amount_kop from payment where id = $1',
      [platyozh],
    );
    await c.query('update avtoplatezh set platezh_v_puti = null, otpravlen_at = null, updated_at = now() where id = $1', [id]);
    if (a.status !== 'vklyuchen' || Number(p.rows[0]?.avto_cikl_order_id ?? 0) !== a.order_id) return { kak: 'chuzhoy' };
    const summaKop = Number(p.rows[0]?.amount_kop ?? 0);
    const chto = chtoPodpiski(spisok, a);
    if (a.neudach + 1 < 2) {
      const r = await c.query<{ povtor: Date }>(
        `update avtoplatezh
            set neudach = neudach + 1,
                sleduyushchaya_popytka =
                  (((now() at time zone 'Europe/Moscow')::date + 1) + time '10:00') at time zone 'Europe/Moscow',
                updated_at = now()
          where id = $1
          returning sleduyushchaya_popytka as povtor`,
        [id],
      );
      await pismoAvtoNeudacha({
        komu: a.email,
        chto,
        summaKop,
        povtor: new Date(r.rows[0]!.povtor),
        ssylkaOtklyuchit: await ssylkaOtklyuchit(c, id),
      });
      return { kak: 'pervaya' };
    }
    await c.query('update avtoplatezh set neudach = neudach + 1 where id = $1', [id]);
    await otklyuchitKhodom(c, id, 'dve_neudachi');
    // Прежнее «Продлить» больше не нужно: его заменяет это письмо.
    await c.query('update shop_order set reminded_at = coalesce(reminded_at, now()) where id = $1', [a.order_id]);
    await pismoAvtoOtklyuchen({
      komu: a.email,
      chto,
      summaKop,
      ssylkaProdlit: ssylkaProdlit(a.plan_id, a.period, a.order_id),
    });
    return { kak: 'vtoraya' };
  });
  if (itog.kak === 'net') return;
  await schetNeUdalsya(platyozh);
  log.warn('автоплатёж: банк не списал', { avto: id, payment: platyozh, text: pochemu, itog: itog.kak });
}

/**
 * Снять счёт, до Робокассы не дошедший (поправка money-14, Code 3 при
 * незаписанной отправке): процесс упал между Т1 и Т2. Тихо, без неудачи,
 * повтор на следующем часу.
 */
async function snyatTikho(id: number, platyozh: number): Promise<void> {
  const snyali = await vTranzakcii(async (c) => {
    const r = await c.query(
      `update avtoplatezh set platezh_v_puti = null, otpravlen_at = null, updated_at = now()
        where id = $1 and platezh_v_puti = $2 returning id`,
      [id, platyozh],
    );
    return (r.rowCount ?? 0) > 0;
  });
  if (!snyali) return;
  await schetNeUdalsya(platyozh);
  log.info('автоплатёж: неотправленный счёт снят', { avto: id, payment: platyozh });
}

/**
 * Разбор списаний, ждущих ResultURL (поправки money-3, money-14).
 *
 *   не отправлен (процесс упал до запроса) — старше 15 минут;
 *   отправлен — старше двух часов: спросить `OpStateExt`.
 *
 *   State 100 или 50 — деньги идут: ждать ResultURL (успех — только
 *     по нему, закон 34); сутки без него — команде «руками»;
 *   State 10 — неудача клиента; State 5 дольше суток — тоже;
 *   20 / 60 / 80 — команде, не повторять;
 *   Code 3 у неотправленного — тихо снять; у отправленного дольше
 *     шести часов — как отказ Робокассы;
 *   Code 1 / 2 / 4 / 1000 — команде, опрос повторить;
 *   нет ответа сутки — неудача клиента.
 *
 * ⚠️ РАБОТАЕТ ПРИ ЛЮБОМ ПОЛОЖЕНИИ ВЫКЛЮЧАТЕЛЯ (поправка money-7).
 */
async function razobratVPuti(spisok: TarifSCenami[], n: Nastroyki): Promise<void> {
  /* Указатель на счёт, который уже решён (оплачен — и подписка
     почему-то не переехала, или помечен неудачным), не держит
     подписку: снимается сразу. */
  await zapros(
    `update avtoplatezh a set platezh_v_puti = null, otpravlen_at = null, updated_at = now()
       from payment p
      where p.id = a.platezh_v_puti and p.status <> 'new'`,
  );
  const r = await zapros<{ id: string; platyozh: string; zakaz: string; ne_otpravlen: boolean; sek: string }>(
    `select a.id, a.platezh_v_puti as platyozh, p.avto_cikl_order_id as zakaz,
            (a.otpravlen_at is null) as ne_otpravlen,
            extract(epoch from now() - coalesce(a.otpravlen_at, p.created_at))::bigint as sek
       from avtoplatezh a join payment p on p.id = a.platezh_v_puti
      where p.status = 'new'
        and coalesce(a.otpravlen_at, p.created_at)
            < now() - case when a.otpravlen_at is null then interval '15 minutes' else interval '2 hours' end
      order by a.otpravlen_at nulls first
      limit 100`,
  );
  if (!r.length) return;
  if (!robokassaRabotaet() || (n.test && !env.rkOpStateZadan)) {
    log.warn('автоплатёж: есть списания в пути, а спросить Робокассу нечем', { schetov: r.length });
    return;
  }
  for (const x of r) {
    const id = Number(x.id);
    const platyozh = Number(x.platyozh);
    const sek = Number(x.sek);
    const sutki = sek * 1000 >= SUTKI_MS;
    const rukami = async (pochemu: string): Promise<void> => {
      log.error('автоплатёж: списание нужно разобрать руками', { avto: id, payment: platyozh, text: pochemu });
      if (await razVSutki(`avto_signal:${platyozh}`)) {
        await soobshchitKomande({ vid: 'avto_rukami', platyozh, avto: id, zakaz: Number(x.zakaz) || null, pochemu });
      }
    };
    try {
      const s = await sprositSostoyanie(n, platyozh);
      if (s.kak === 'net') {
        if (sutki) await neudachaKlienta(id, platyozh, `OpStateExt не отвечает сутки: ${s.pochemu}`, spisok);
        continue;
      }
      if (s.result === 3) {
        if (x.ne_otpravlen) {
          await snyatTikho(id, platyozh);
        } else if (sek * 1000 >= 6 * CHAS_MS) {
          const snyali = await vTranzakcii(async (c) => {
            const u = await c.query(
              `update avtoplatezh set platezh_v_puti = null, otpravlen_at = null,
                      sleduyushchaya_popytka = now() + interval '1 day', updated_at = now()
                where id = $1 and platezh_v_puti = $2 returning id`,
              [id, platyozh],
            );
            return (u.rowCount ?? 0) > 0;
          });
          if (snyali) {
            await schetNeUdalsya(platyozh);
            await otkazRobokassy({
              platyozh,
              avto: id,
              zakaz: Number(x.zakaz),
              otvet: 'OpStateExt: no such operation six hours after the charge was sent',
            });
          }
        }
        continue;
      }
      if (s.result !== 0) {
        await rukami(`OpStateExt answered Result.Code ${s.result}`);
        continue;
      }
      if (s.state === 100 || s.state === 50) {
        if (sutki) await rukami(`Robokassa state ${s.state}, but no ResultURL for a day`);
        continue;
      }
      if (s.state === 10) {
        await neudachaKlienta(id, platyozh, 'операция отменена (State 10)', spisok);
        continue;
      }
      if (s.state === 5) {
        if (sutki) await neudachaKlienta(id, platyozh, 'операция не завершилась за сутки (State 5)', spisok);
        continue;
      }
      if (s.state === 20 || s.state === 60 || s.state === 80) {
        await rukami(`Robokassa state ${s.state}`);
        continue;
      }
      if (sutki) await rukami(`Robokassa state ${s.state ?? 'none'} for a day`);
    } catch (e) {
      log.error('автоплатёж: разбор списания в пути не прошёл', { avto: id, payment: platyozh, text: String((e as Error).message) });
    }
  }
}

/**
 * Продление цикла легло — подписка переезжает на новый заказ, счётчики
 * цикла обнуляются. Зовут обе ветки (`zakazProdleniya`): ResultURL
 * дочернего списания и списание с баланса.
 *
 * ⚠️ УКАЗАТЕЛЬ «В ПУТИ» СНИМАЕТСЯ ТОЛЬКО СВОЙ: поздний ResultURL
 * прежнего неудачного счёта не имеет права забыть о счёте, который
 * ушёл позже, — тот продолжит опрашиваться и, если пройдёт, ляжет
 * на баланс (цикл уже продлён).
 *
 * Статус подписки не трогается: продление по ушедшему запросу получает
 * и отключённая за это время (поправка money-2) — отключена она
 * от следующих.
 */
export async function podpiskaProdlena(
  c: PoolClient,
  o: { avto: number; novy: number | null; platyozh: number | null },
): Promise<void> {
  if (!o.novy) throw new Error('заказ продления не создан');
  await c.query(
    `update avtoplatezh
        set order_id = $2,
            otpravlen_at = case when platezh_v_puti = $3 then null else otpravlen_at end,
            platezh_v_puti = case when platezh_v_puti = $3 then null else platezh_v_puti end,
            neudach = 0, sleduyushchaya_popytka = null,
            napomnil_za_cikl = null, napomnil_at = null, napomnil_summa_kop = null,
            updated_at = now()
      where id = $1`,
    [o.avto, o.novy, o.platyozh],
  );
}

/**
 * ЧАСОВОЙ ХОД. Зовёт его уборка (`upkeep.ts`) после напоминаний,
 * своим `try`. Наружу не бросает ничего.
 */
export async function avtoplatezhChas(): Promise<void> {
  if (!bazaEst()) return;
  let spisok: TarifSCenami[];
  try {
    spisok = await katalog();
  } catch (e) {
    log.error('автоплатёж: каталог не прочитался', { text: String((e as Error).message) });
    return;
  }
  const n = nastroyki();
  try {
    await razobratVPuti(spisok, n);
  } catch (e) {
    log.error('автоплатёж: разбор списаний в пути не прошёл', { text: String((e as Error).message) });
  }
  // Выключатель запрещает только НОВОЕ: письма и запросы (поправка money-7).
  let vklyuchen = false;
  try {
    vklyuchen = await avtoplatezhVklyuchen();
  } catch {
    return;
  }
  if (!vklyuchen) return;
  try {
    await pismaAvto(spisok, n);
  } catch (e) {
    log.error('автоплатёж: письма о списании не разослались', { text: String((e as Error).message) });
  }
  try {
    await spisaniya(spisok, n);
  } catch (e) {
    log.error('автоплатёж: списания не прошли', { text: String((e as Error).message) });
  }
}

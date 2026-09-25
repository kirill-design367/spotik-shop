/**
 * Заказы: создание, оплата, работа оператора, отмена.
 *
 * ⚠️ ЕДИНСТВЕННАЯ ДВЕРЬ, ЧЕРЕЗ КОТОРУЮ ЗАКАЗ СТАНОВИТСЯ ОПЛАЧЕННЫМ, —
 * `otmetitOplachennym`. В неё стучится и проверенное уведомление
 * Робокассы, и полная оплата с баланса. Возврат человека на страницу
 * успеха не стучится в неё НИКОГДА (постановка двадцать седьмой
 * итерации): браузерный возврат ничего не подтверждает.
 *
 * ⚠️ ДЕНЬГИ ДВИГАЮТСЯ ТОЛЬКО В ТРАНЗАКЦИИ. Списание с баланса
 * и пометка заказа — две записи, и состояния «деньги списаны,
 * а заказ не оплачен» между ними быть не должно.
 */

import type { PoolClient } from 'pg';
import { odna, vTranzakcii, zapros } from './db';
import { otpechatokPochty, shifrGotov, zashifrovat } from './crypto';
import { log } from './log';
import { soobshchitKomande } from './notify';
import { utmVRyad, type Utm } from './utm';
import { pismoPochtaZanyata, pismoZakazGotov, pismoZakazOplachen, pismoZakazOtmenyon } from './letters';
import { vydatSertifikat } from './certificates';
import { cenaTarifa, katalog, naytiTarif, srokKratko, srokPolno } from './catalog';
import { parolNeGoditsya, pochtaNeVerna } from '@/lib/proverka';

export type Status = 'new' | 'paid' | 'in_work' | 'done' | 'cancelled';
export type Rezhim = 'new' | 'renew';

export const STATUS_SLOVAMI: Record<Status, string> = {
  new: 'Ждёт оплаты',
  paid: 'Оплачен, ждёт оператора',
  in_work: 'В работе',
  done: 'Готов',
  cancelled: 'Отменён',
};

/**
 * Что человек вводит на каждого участника.
 *
 * ⚠️ ПОЧТА И ПАРОЛЬ НУЖНЫ В ОБОИХ СЛУЧАЯХ С ТРИДЦАТЬ ЧЕТВЁРТОЙ
 * ИТЕРАЦИИ. Раньше при «новом аккаунте» человек не вводил ничего,
 * а логин с паролем придумывал оператор и присылал их в кабинет.
 * Постановка это отменила: у Spotify нет двухфакторной проверки,
 * значит аккаунт можно завести прямо на почту клиента — и тогда
 * доступ остаётся у него с самого начала, а выдавать нечего.
 *   mode='new'   — почта клиента и пароль, КОТОРЫЙ ОН ХОЧЕТ;
 *                  оператор заводит аккаунт ровно на эти данные;
 *   mode='renew' — почта и пароль СВОЕГО аккаунта Spotify.
 * Хранится и то, и другое одинаково: только шифротекстом (закон 35).
 */
export type VvodUchastnika = {
  mode: Rezhim;
  login?: string;
  password?: string;
};

export type ItogSozdaniya =
  | { ok: true; zakaz: number; sBalansa: number; kDoplate: number }
  | { ok: false; pochemu: string };

/**
 * Название заказа одной строкой: для чека, письма и админки.
 *
 * ⚠️ У СЕРТИФИКАТА ТЕПЕРЬ ЕСТЬ ТАРИФ, и он обязан быть в названии:
 * «Сертификат Spotik Shop» без тарифа не говорит ни покупателю,
 * ни кассе, за что взяты деньги (Р-93).
 */
export function nazvanieZakaza(tarif: string, period: number, kind: 'plan' | 'certificate'): string {
  return kind === 'certificate'
    ? `Сертификат Spotik Shop: ${tarif}, ${srokKratko(period)}`
    : `Spotify Premium, ${tarif}, ${srokKratko(period)}`;
}

/**
 * Проверка участников НА СЕРВЕРЕ, и она не повторяет клиентскую,
 * а ОПРЕДЕЛЯЕТ её: правила лежат в одном модуле `lib/proverka`
 * и зовутся с обеих сторон. Форма — это то, что человек правит
 * в браузере за секунду, поэтому последнее слово здесь.
 */
export function proveritUchastnikov(spisok: VvodUchastnika[]): string | null {
  for (let i = 0; i < spisok.length; i++) {
    const u = spisok[i]!;
    const kto = spisok.length > 1 ? `Участник ${i + 1}: ` : '';
    const bedaPochty = pochtaNeVerna(u.login ?? '');
    if (bedaPochty) return `${kto}${bedaPochty.toLowerCase()}.`;
    const bedaParolya = parolNeGoditsya(u.password ?? '');
    if (bedaParolya) return `${kto}${bedaParolya.toLowerCase()}.`;
    // ⚠️ БЕЗ КЛЮЧА ЧУЖИЕ ПАРОЛИ НЕ ПРИНИМАЮТСЯ ВОВСЕ. Положить их
    // открытым текстом «временно» — ровно тот случай, когда
    // временное живёт годами (закон 35).
    if (!shifrGotov()) return 'Приём паролей сейчас недоступен. Попробуйте позже.';
  }
  return null;
}

/**
 * Создание заказа.
 *
 * Баланс списывается СРАЗУ и в той же транзакции: иначе между
 * проверкой «хватает ли» и списанием помещается второй заказ,
 * и баланс уходит в минус. Заказ, брошенный без оплаты, можно
 * отменить в кабинете — деньги вернутся.
 */
export async function sozdatZakaz(opts: {
  userId: number;
  planId: string;
  period: number;
  kind: 'plan' | 'certificate';
  uchastniki: VvodUchastnika[];
  soglasie: boolean;
  tratitBalans: boolean;
  /** Метки кампании; их снял браузер при первом заходе (lib/server/utm.ts). */
  utm?: Utm;
}): Promise<ItogSozdaniya> {
  if (!opts.soglasie) return { ok: false, pochemu: 'Нужно согласие на обработку персональных данных.' };

  const spisok = await katalog();
  const tarif = naytiTarif(spisok, opts.planId);
  if (!tarif) return { ok: false, pochemu: 'Такого тарифа нет.' };
  const cena = cenaTarifa(tarif, opts.period);
  if (cena === null) return { ok: false, pochemu: 'На этот срок тариф пока не оформляется.' };

  // ⚠️ У СЕРТИФИКАТА УЧАСТНИКОВ НЕТ ВОВСЕ: их выбирает не покупатель,
  // а получатель, при активации. Тариф при этом настоящий — от него
  // идёт и цена, и число мест в будущем заказе (Р-93).
  const nuzhno = opts.kind === 'certificate' ? 0 : tarif.people;
  if (opts.uchastniki.length !== nuzhno) {
    return {
      ok: false,
      pochemu: nuzhno
        ? `Для этого тарифа нужно заполнить ${nuzhno} участника.`
        : 'У сертификата участников не бывает: их выбирает получатель.',
    };
  }
  const bedaUchastnikov = proveritUchastnikov(opts.uchastniki);
  if (bedaUchastnikov) return { ok: false, pochemu: bedaUchastnikov };

  const itog = await vTranzakcii(async (c) => {
    const u = await c.query<{ balance_kop: string }>('select balance_kop from app_user where id = $1 for update', [
      opts.userId,
    ]);
    const balans = Number(u.rows[0]?.balance_kop ?? 0);
    const sBalansa = opts.tratitBalans ? Math.min(balans, cena) : 0;
    const kDoplate = cena - sBalansa;

    /* ⚠️ МЕТКИ КАМПАНИИ ПИШУТСЯ РОВНО ЗДЕСЬ, В МОМЕНТ СОЗДАНИЯ
       ЗАКАЗА, и больше нигде. Приписать их позже неоткуда: кука
       живёт до конца сессии, а заказ — вечно. */
    const z = await c.query<{ id: string }>(
      `insert into shop_order (user_id, kind, plan_id, period, status, total_kop, balance_kop, money_kop, source, consent_at,
                               utm_source, utm_medium, utm_campaign, utm_term, utm_content)
       values ($1, $2, $3, $4, 'new', $5, $6, 0, 'payment', now(), $7, $8, $9, $10, $11)
       returning id`,
      [opts.userId, opts.kind, opts.planId, opts.period, cena, sBalansa, ...utmVRyad(opts.utm ?? {})],
    );
    const zakaz = Number(z.rows[0]!.id);

    for (let i = 0; i < opts.uchastniki.length; i++) {
      const uch = opts.uchastniki[i]!;
      await c.query(
        `insert into order_slot (order_id, idx, mode, in_login_enc, in_password_enc, login_fp)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          zakaz,
          i,
          uch.mode,
          /* ⚠️ ШИФРУЕТСЯ И ТО, И ДРУГОЕ, В ОБОИХ РЕЖИМАХ. При «новом
             аккаунте» это пароль, КОТОРЫЙ ЧЕЛОВЕК ХОЧЕТ, и уже
             через час он станет паролем от его аккаунта Spotify:
             ценность у него ровно та же, что у пароля на продлении. */
          zashifrovat(uch.login!.trim()),
          zashifrovat(uch.password!),
          otpechatokPochty(uch.login!),
        ],
      );
    }

    if (sBalansa > 0) {
      await c.query('update app_user set balance_kop = balance_kop - $1 where id = $2', [sBalansa, opts.userId]);
      await c.query(`insert into balance_move (user_id, delta_kop, reason, order_id) values ($1, $2, 'оплата заказа', $3)`, [
        opts.userId,
        -sBalansa,
        zakaz,
      ]);
    }

    const oplachen = kDoplate === 0 ? await oplatitVnutri(c, zakaz, 0) : false;

    log.info('заказ создан', { order: zakaz, plan: opts.planId, period: opts.period, balance_kop: sBalansa, rest_kop: kDoplate });
    return { ok: true as const, zakaz, sBalansa, kDoplate, oplachen };
  });

  /* ⚠️ ПОЛНАЯ ОПЛАТА С БАЛАНСА — ЭТО ТОЖЕ ОПЛАТА, И ЗА НЕЙ ОБЯЗАНО
     ИДТИ ВСЁ ТО ЖЕ САМОЕ. Без этой строки заказ, закрытый балансом
     целиком, становился «оплачен» и на этом всё кончалось: письма
     не было, команда не узнавала, а СЕРТИФИКАТ НЕ ВЫДАВАЛСЯ ВОВСЕ —
     человек платил и не получал ничего. Зовётся ПОСЛЕ транзакции:
     внутри неё поход в сеть держал бы соединение с базой, а при
     откате письмо ушло бы о заказе, которого нет (то же правило,
     что в `zakazPoSertifikatu`). */
  if (itog.oplachen) await posleOplaty(itog.zakaz);
  return { ok: true, zakaz: itog.zakaz, sBalansa: itog.sBalansa, kDoplate: itog.kDoplate };
}

/**
 * Пометить заказ оплаченным. ЕДИНСТВЕННАЯ ДВЕРЬ.
 *
 * Идемпотентна: Робокасса повторяет уведомление, пока не получит
 * `OK<номер>`, и второй заход обязан ничего не менять.
 */
async function oplatitVnutri(c: PoolClient, zakaz: number, dengiKop: number): Promise<boolean> {
  const r = await c.query<{ status: Status }>('select status from shop_order where id = $1 for update', [zakaz]);
  const st = r.rows[0]?.status;
  if (!st) return false;
  if (st !== 'new') return false; // уже оплачен или закрыт — молча выходим
  await c.query(
    `update shop_order set status = 'paid', paid_at = now(), money_kop = money_kop + $2 where id = $1`,
    [zakaz, dengiKop],
  );
  return true;
}

export async function otmetitOplachennym(platyozh: number, prishloKop: number): Promise<void> {
  const itog = await vTranzakcii(async (c) => {
    const p = await c.query<{ id: string; order_id: string; amount_kop: string; status: string }>(
      'select id, order_id, amount_kop, status from payment where id = $1 for update',
      [platyozh],
    );
    const row = p.rows[0];
    if (!row) {
      log.warn('уведомление о неизвестном платеже', { payment: platyozh });
      return null;
    }
    if (row.status === 'paid') return null; // повтор уведомления — это норма

    const zhdali = Number(row.amount_kop);
    if (prishloKop < zhdali) {
      // ⚠️ НЕДОПЛАТА НЕ ОПЛАТА. Подпись сошлась, значит уведомление
      // настоящее, но сумма другая — это разбирается руками.
      log.error('оплачено меньше выставленного', { payment: platyozh, want_kop: zhdali, got_kop: prishloKop });
      return null;
    }
    await c.query(`update payment set status = 'paid', paid_at = now() where id = $1`, [platyozh]);
    const zakaz = Number(row.order_id);
    if (await oplatitVnutri(c, zakaz, prishloKop)) return { zakaz, naBalans: 0 };

    /* ⚠️ ДЕНЬГИ ПРИШЛИ, А ЗАКАЗ ИХ УЖЕ НЕ ЖДЁТ — И ДЕТЬ ИХ НЕКУДА,
       КРОМЕ БАЛАНСА. Случай не выдуманный, и путей к нему два:
       человек отменил неоплаченный заказ в кабинете, пока платёжная
       форма была открыта, — и заплатил; либо на один заказ выставлено
       ДВА счёта (кнопка «Оплатить» заводит новую строку `payment`
       каждым нажатием), и оплачены оба. Раньше `oplatitVnutri`
       возвращала false МОЛЧА: платёж помечался оплаченным, а деньги
       не ложились никуда — ни в заказ, ни на баланс, ни даже строкой
       в журнал. Теперь они ложатся на баланс тем же движением, каким
       туда ложится возврат за отменённый заказ (Р-89), и команда
       узнаёт об этом отдельным сообщением. */
    const o = await c.query<{ user_id: string; status: Status }>(
      'select user_id, status from shop_order where id = $1 for update',
      [zakaz],
    );
    const vladelec = Number(o.rows[0]?.user_id ?? 0);
    if (!vladelec) {
      log.error('деньги пришли по заказу, которого нет', { payment: platyozh, order: zakaz, money_kop: prishloKop });
      return null;
    }
    await c.query('update app_user set balance_kop = balance_kop + $1 where id = $2', [prishloKop, vladelec]);
    await c.query(
      `insert into balance_move (user_id, delta_kop, reason, order_id) values ($1, $2, 'оплата по заказу, который уже не ждал денег', $3)`,
      [vladelec, prishloKop, zakaz],
    );
    log.error('оплата пришла по заказу вне ожидания: деньги на баланс', {
      payment: platyozh,
      order: zakaz,
      status: o.rows[0]?.status ?? '—',
      money_kop: prishloKop,
    });
    return { zakaz, naBalans: prishloKop };
  });

  if (!itog) return;
  /* ⚠️ СООБЩИТЬ КОМАНДЕ ОБЯЗАТЕЛЬНО, и это не «ещё одно
     уведомление»: деньги легли на баланс, а не в заказ, и без человека
     дальше ничего не произойдёт. */
  if (itog.naBalans > 0) {
    await soobshchitKomande({ vid: 'dengi_bez_zakaza', zakaz: itog.zakaz, platyozh, summaKop: itog.naBalans });
    return;
  }
  await posleOplaty(itog.zakaz);
}

/** Что происходит ПОСЛЕ оплаты: письмо, сертификат, сигнал команде. */
async function posleOplaty(zakaz: number): Promise<void> {
  const z = await odna<{
    id: string;
    kind: 'plan' | 'certificate';
    plan_id: string;
    period: number;
    user_id: string;
    email: string;
  }>(
    `select o.id, o.kind, o.plan_id, o.period, o.user_id, u.email
       from shop_order o join app_user u on u.id = o.user_id where o.id = $1`,
    [zakaz],
  );
  if (!z) return;
  const spisok = await katalog();
  const tarif = naytiTarif(spisok, z.plan_id);
  const nazvanie = nazvanieZakaza(tarif?.name ?? z.plan_id, z.period, z.kind);

  if (z.kind === 'certificate') {
    await vydatSertifikat({
      userId: Number(z.user_id),
      email: z.email,
      planId: z.plan_id,
      period: z.period,
      zakaz,
    });
    // Сертификат сам по себе работы оператору не даёт: заказ закрыт.
    await zapros(`update shop_order set status = 'done', closed_at = now() where id = $1`, [zakaz]);
    return;
  }

  await pismoZakazOplachen(z.email, nazvanie);
  await soobshchitKomande({
    vid: 'zakaz_oplachen',
    zakaz,
    tarif: tarif?.name ?? z.plan_id,
    srok: srokPolno(z.period).toLowerCase(),
    mest: tarif?.people ?? 1,
    podarok: false,
  });
}

/**
 * Заказ по сертификату: денег не берём вовсе, сразу в очередь
 * оператору.
 *
 * ⚠️ УЧАСТНИКОВ СТОЛЬКО, СКОЛЬКО МЕСТ В ПОДАРЕННОМ ТАРИФЕ, и число
 * это приходит НЕ ИЗ ФОРМЫ, а из кода сертификата (Р-93). Иначе
 * сертификат «на одного» оформлялся бы на троих одной правкой
 * разметки в браузере.
 *
 * ⚠️ ПОМЕТКА «ИСПОЛЬЗОВАН» СТОИТ В ТОЙ ЖЕ ТРАНЗАКЦИИ, что и создание
 * заказа, и ставится ТОЛЬКО на неиспользованный: два одновременных
 * нажатия не должны дать два заказа по одному коду. Не сошлось —
 * транзакция откатывается целиком.
 */
export async function zakazPoSertifikatu(opts: {
  userId: number;
  planId: string;
  period: number;
  certificateId: number;
  uchastniki: VvodUchastnika[];
  utm?: Utm;
}): Promise<number> {
  const beda = proveritUchastnikov(opts.uchastniki);
  if (beda) throw new Error(beda);
  const zakaz = await vTranzakcii(async (c) => {
    const pometka = await c.query(
      'update certificate set used_at = now() where id = $1 and used_at is null returning id',
      [opts.certificateId],
    );
    if (!pometka.rows.length) throw new Error('сертификат уже активирован');

    const z = await c.query<{ id: string }>(
      `insert into shop_order (user_id, kind, plan_id, period, status, total_kop, source, certificate_id, consent_at, paid_at,
                               utm_source, utm_medium, utm_campaign, utm_term, utm_content)
       values ($1, 'plan', $2, $3, 'paid', 0, 'certificate', $4, now(), now(), $5, $6, $7, $8, $9)
       returning id`,
      [opts.userId, opts.planId, opts.period, opts.certificateId, ...utmVRyad(opts.utm ?? {})],
    );
    const zakaz = Number(z.rows[0]!.id);
    for (let i = 0; i < opts.uchastniki.length; i++) {
      const u = opts.uchastniki[i]!;
      await c.query(
        `insert into order_slot (order_id, idx, mode, in_login_enc, in_password_enc, login_fp)
         values ($1, $2, $3, $4, $5, $6)`,
        [zakaz, i, u.mode, zashifrovat(u.login!.trim()), zashifrovat(u.password!), otpechatokPochty(u.login!)],
      );
    }
    await c.query('update certificate set used_order_id = $2 where id = $1', [opts.certificateId, zakaz]);
    log.info('заказ по сертификату', { order: zakaz, plan: opts.planId, period: opts.period, mest: opts.uchastniki.length });
    return zakaz;
  });

  /* ⚠️ УВЕДОМЛЕНИЕ — ПОСЛЕ ТРАНЗАКЦИИ, А НЕ ВНУТРИ НЕЁ. Внутри оно
     держало бы соединение с базой на всё время похода в сеть, а при
     откате команда узнала бы о заказе, которого нет.

     И такой заказ уходит оператору ТАК ЖЕ, как обычный оплаченный:
     работа по нему та же, разница только в том, что денег за ним нет
     вовсе — их взяли при покупке сертификата (Р-93). */
  const spisok = await katalog();
  const tarif = naytiTarif(spisok, opts.planId);
  await soobshchitKomande({
    vid: 'zakaz_oplachen',
    zakaz,
    tarif: tarif?.name ?? opts.planId,
    srok: srokPolno(opts.period).toLowerCase(),
    mest: opts.uchastniki.length,
    podarok: true,
  });
  return zakaz;
}

/* ── Работа оператора ──────────────────────────────────────────── */

export async function vzyatZakaz(zakaz: number, staffId: number): Promise<boolean> {
  return vTranzakcii(async (c) => {
    const r = await c.query<{ status: Status; operator_id: string | null }>(
      'select status, operator_id from shop_order where id = $1 for update',
      [zakaz],
    );
    const row = r.rows[0];
    if (!row) return false;
    if (row.status !== 'paid' || row.operator_id) return false;
    await c.query(`update shop_order set status = 'in_work', operator_id = $2, taken_at = now() where id = $1`, [
      zakaz,
      staffId,
    ]);
    return true;
  });
}

export async function vernutVOchered(zakaz: number, staffId: number): Promise<boolean> {
  const r = await zapros(
    `update shop_order set status = 'paid', operator_id = null, taken_at = null
      where id = $1 and status = 'in_work' and operator_id = $2 returning id`,
    [zakaz, staffId],
  );
  return r.length > 0;
}

/** Выданные оператором доступы к НОВОМУ аккаунту. Шифруются те же. */
export async function zapisatVydachu(opts: {
  slotId: number;
  zakaz: number;
  staffId: number;
  login: string;
  mailPass: string;
  spotifyPass: string;
}): Promise<boolean> {
  if (!shifrGotov()) return false;
  const r = await zapros(
    `update order_slot s
        set out_login_enc = $3, out_mail_pass_enc = $4, out_password_enc = $5, done_at = now()
       from shop_order o
      where s.id = $1 and s.order_id = o.id and o.id = $2 and o.operator_id is not null
      returning s.id`,
    [opts.slotId, opts.zakaz, zashifrovat(opts.login.trim()), zashifrovat(opts.mailPass), zashifrovat(opts.spotifyPass)],
  );
  return r.length > 0;
}

/**
 * Отметить участника выполненным.
 *
 * ⚠️ РАБОТАЕТ В ОБОИХ РЕЖИМАХ С ТРИДЦАТЬ ЧЕТВЁРТОЙ ИТЕРАЦИИ. Пока
 * при «новом аккаунте» логин с паролем придумывал оператор, слот
 * закрывался САМ ФАКТОМ выдачи (`zapisatVydachu`), и эта дверь была
 * только для продления. Теперь оператор заводит аккаунт на данные
 * КЛИЕНТА и вводить ему нечего — значит закрывают слот одинаково.
 */
export async function otmetitSlotGotovym(slotId: number, zakaz: number): Promise<boolean> {
  const r = await zapros(
    `update order_slot set done_at = now() where id = $1 and order_id = $2 returning id`,
    [slotId, zakaz],
  );
  return r.length > 0;
}

export async function zavershitZakaz(zakaz: number, staffId: number): Promise<{ ok: boolean; pochemu?: string }> {
  const slots = await zapros<{ id: string; done_at: Date | null }>(
    'select id, done_at from order_slot where order_id = $1',
    [zakaz],
  );
  if (slots.some((s) => !s.done_at)) return { ok: false, pochemu: 'Не все участники заполнены.' };
  /* ⚠️ ДАТА ОКОНЧАНИЯ СТАВИТСЯ ЗДЕСЬ, А НЕ ПРИ ОПЛАТЕ, и это
     не мелочь. Доступ начинается тогда, когда его выдали, а между
     оплатой и выдачей стоит очередь оператора: посчитай мы от оплаты —
     человек потерял бы эти часы, и потерял бы их по нашей вине.
     Срок тарифа приходит числом месяцев из той же строки заказа. */
  const r = await zapros(
    `update shop_order set status = 'done', closed_at = now(),
            expires_at = now() + (period || ' months')::interval
      where id = $1 and status = 'in_work' and operator_id = $2 returning user_id`,
    [zakaz, staffId],
  );
  if (!r.length) return { ok: false, pochemu: 'Заказ не в работе у вас.' };
  const u = await odna<{ email: string; plan_id: string; period: number; kind: 'plan' | 'certificate' }>(
    `select u.email, o.plan_id, o.period, o.kind
       from shop_order o join app_user u on u.id = o.user_id where o.id = $1`,
    [zakaz],
  );
  if (u) {
    /* Название заказа вместо номера: номера клиент больше нигде
       не видит (тридцать шестая итерация). */
    const spisok = await katalog();
    const t = naytiTarif(spisok, u.plan_id);
    await pismoZakazGotov(u.email, nazvanieZakaza(t?.name ?? u.plan_id, u.period, u.kind));
  }
  /* ⚠️ «КТО ВЫПОЛНИЛ» БЕРЁТСЯ ИЗ БАЗЫ, А НЕ ИЗ ВЫЗЫВАЮЩЕГО. Заказ
     закрывает тот, у кого он в работе, и проверено это тем же
     `update … where operator_id = $2`: адрес, пришедший сбоку,
     мог бы разойтись с тем, кто на самом деле закрыл. */
  const f = await odna<{ email: string }>('select email from staff where id = $1', [staffId]);
  await soobshchitKomande({ vid: 'zakaz_zakryt', zakaz, kto: f?.email ?? `сотрудник ${staffId}` });
  return { ok: true };
}

/**
 * Отмена заказа с возвратом денег НА БАЛАНС.
 *
 * ⚠️ ВОЗВРАЩАЕТСЯ ВСЁ, ЧЕМ ЗАКАЗ БЫЛ ЗАКРЫТ, — и то, что пришло
 * с баланса, и то, что пришло картой. Деньги уходят на баланс,
 * а не обратно на карту: так велит постановка, и так человек может
 * оформить заново в один клик.
 */
export const PRICHINA_POCHTA_ZANYATA = 'На эту почту уже есть аккаунт Spotify — новый завести нельзя.';

export async function otmenitZakaz(
  zakaz: number,
  pochemu: string,
  staffId: number | null,
  /* ⚠️ ВИД ОТМЕНЫ РЕШАЕТ ТОЛЬКО ОДНО — КАКОЕ УЙДЁТ ПИСЬМО. Деньги
     возвращаются одинаково, причина ложится в ту же колонку и так же
     видна клиенту. «Почта занята» — это не отказ, а развилка: человеку
     надо не сочувствие, а слова «оформите заново и выберите
     „Продлить существующий“». */
  vid: 'obychno' | 'pochta_zanyata' = 'obychno',
  /* ⚠️ КТО ОТМЕНИЛ — ОТДЕЛЬНЫЙ ПРИЗНАК, А НЕ ВЫВОД ИЗ `operator_id`.
     Заказ, отменённый САМИМ покупателем, из кабинета исчезает
     совсем (постановка тридцать шестой итерации), а отменённый
     оператором остаётся с причиной. Вывести это из пустого
     `operator_id` можно было бы сегодня, но это молчаливая связь:
     достаточно однажды закрыть взятый заказ действием клиента —
     и карточка перестанет исчезать, а понять почему будет нечем. */
  kem: 'klient' | 'operator' = 'operator',
): Promise<{ ok: boolean; pochemuNet?: string }> {
  const itog = await vTranzakcii(async (c) => {
    const r = await c.query<{
      status: Status;
      user_id: string;
      balance_kop: string;
      money_kop: string;
      certificate_id: string | null;
      plan_id: string;
      period: number;
      kind: 'plan' | 'certificate';
    }>(
      `select status, user_id, balance_kop, money_kop, certificate_id, plan_id, period, kind
         from shop_order where id = $1 for update`,
      [zakaz],
    );
    const row = r.rows[0];
    if (!row) return { ok: false as const, pochemuNet: 'Заказа нет.' };
    if (row.status === 'done' || row.status === 'cancelled') return { ok: false as const, pochemuNet: 'Заказ уже закрыт.' };

    const vernut = Number(row.balance_kop) + Number(row.money_kop);
    if (vernut > 0) {
      await c.query('update app_user set balance_kop = balance_kop + $1 where id = $2', [vernut, row.user_id]);
      await c.query(
        `insert into balance_move (user_id, delta_kop, reason, order_id) values ($1, $2, 'возврат за отменённый заказ', $3)`,
        [row.user_id, vernut, zakaz],
      );
    }
    // Сертификат, по которому заказ оформляли, возвращается к жизни:
    // человек не виноват, что доступ не оформили.
    if (row.certificate_id) {
      await c.query('update certificate set used_at = null, used_order_id = null where id = $1', [row.certificate_id]);
    }
    await c.query(
      `update shop_order
          set status = 'cancelled', closed_at = now(), cancel_reason = $2,
              operator_id = coalesce(operator_id, $3), cancelled_by_client = $4
        where id = $1`,
      [zakaz, pochemu.slice(0, 500), staffId, kem === 'klient'],
    );
    return {
      ok: true as const,
      vernut,
      userId: Number(row.user_id),
      planId: row.plan_id,
      period: row.period,
      kind: row.kind,
    };
  });

  if (!itog.ok) return itog;
  const u = await odna<{ email: string }>('select email from app_user where id = $1', [itog.userId]);
  if (u) {
    const spisok = await katalog();
    const t = naytiTarif(spisok, itog.planId);
    const chto = nazvanieZakaza(t?.name ?? itog.planId, itog.period, itog.kind);
    if (vid === 'pochta_zanyata') await pismoPochtaZanyata(u.email, chto, itog.vernut);
    else await pismoZakazOtmenyon(u.email, chto, itog.vernut, pochemu);
  }
  await soobshchitKomande({ vid: 'zakaz_otmenyon', zakaz });
  return { ok: true };
}

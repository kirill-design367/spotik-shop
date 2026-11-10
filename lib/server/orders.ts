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
import { nachatRazdachu, popravitZakrytoe, razdatNovyyPervym, snyatRazdachu } from './razdacha';
import { utmVRyad, type Utm } from './utm';
import { pismoAvtoNaBalans, pismoPochtaZanyata, pismoZakazGotov, pismoZakazOplachen, pismoZakazOtmenyon } from './letters';
import { vydatSertifikat } from './certificates';
import { cenaTarifa, katalog, naytiTarif, srokKratko } from './catalog';
import { imyaTarifaIz, srokDlyaSotrudnika } from '@/lib/plans';
import { imenaTarifov } from './imena';
import type { Para } from './dostup';
import { parolNeGoditsya, pochtaNeVerna } from '@/lib/proverka';
import {
  zanyat as zanyatPromo,
  vernut as vernutPromo,
  predel as promoPredel,
  neudacha as promoNeudacha,
} from './promokody';
import { kodPromo, otkazSlovami, type OtkazPromo } from '@/lib/promokod';
import { nastoyashchayaData } from '../data';
import { otklyuchitPoZakazu, podpiskaProdlena, podtverditMat, prodleniyaCikla, zavestiPodpisku, type SposobOplaty } from './avtoplatezh';
import { avtoplatezhVklyuchen } from './settings';
import { sposobStrokoy, tekstSoglasiyaAvto } from '@/lib/avtoplatezh';

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
  /** Промокод, как его набрал человек; пусто — без промокода (Р-167). */
  promo?: string;
  /**
   * Галочка «Продлевать автоматически» (пятьдесят четвёртая итерация).
   * Подписка заводится, только если выключатель включён и это заказ
   * тарифа, а не покупка сертификата: поле формы правится в браузере.
   */
  avto?: boolean;
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

  /* ⚠️ КОД ПРОМОКОДА ПРИШЁЛ ИЗ ФОРМЫ, А ФОРМУ ПРАВЯТ В БРАУЗЕРЕ.
     Скрытое поле заполняет «Применить», но стучаться в действие можно
     и мимо него, с любым кодом: предел частоты поэтому стоит и здесь,
     а неудача пишется ПОСЛЕ отката транзакции (Р-167, Р-107). Набрано
     что-то, от чего после приведения ничего не осталось, — это не
     «без промокода», а неверный код: молча взять полную цену с того,
     кто вводил промокод, было бы обманом. */
  const promoSyroe = (opts.promo ?? '').trim();
  const promoVvod = kodPromo(promoSyroe);
  if (promoSyroe && !promoVvod) {
    await promoNeudacha(opts.userId);
    return { ok: false, pochemu: `${otkazSlovami('net')} Заказ не оформлен: уберите промокод или введите другой.` };
  }
  if (promoVvod) {
    const kak = await promoPredel(opts.userId);
    if (kak) return { ok: false, pochemu: `${otkazSlovami(kak)} Заказ не оформлен.` };
  }
  /* ⚠️ ВЫКЛЮЧАТЕЛЬ СПРАШИВАЕТСЯ ЗДЕСЬ, А НЕ ТОЛЬКО НА СТРАНИЦЕ: галочку
     можно дописать в форму руками, а пока он выключен, клиент про
     автоплатёж не видит и не получает ничего. Текст согласия собирает
     СЕРВЕР той же функцией, что форма, и из того, что знает сам: цены
     тарифа без промокода, имени тарифа и числа мест (поправка money-15). */
  const avtoNado = Boolean(opts.avto) && opts.kind === 'plan' && (await avtoplatezhVklyuchen());
  const avtoTekst = avtoNado
    ? tekstSoglasiyaAvto({ cenaKop: cena, tarif: tarif.name, period: opts.period, mest: tarif.people, promo: Boolean(promoVvod) })
    : '';
  const itog = await vTranzakcii(async (c) => {
    const u = await c.query<{ balance_kop: string }>('select balance_kop from app_user where id = $1 for update', [
      opts.userId,
    ]);
    const balans = Number(u.rows[0]?.balance_kop ?? 0);

    /* ⚠️ МЕТКИ КАМПАНИИ ПИШУТСЯ РОВНО ЗДЕСЬ, В МОМЕНТ СОЗДАНИЯ
       ЗАКАЗА, и больше нигде. Приписать их позже неоткуда: кука
       живёт до конца сессии, а заказ — вечно. */
    const z = await c.query<{ id: string }>(
      `insert into shop_order (user_id, kind, plan_id, period, status, total_kop, balance_kop, money_kop, source, consent_at,
                               utm_source, utm_medium, utm_campaign, utm_term, utm_content)
       values ($1, $2, $3, $4, 'new', $5, 0, 0, 'payment', now(), $6, $7, $8, $9, $10)
       returning id`,
      [opts.userId, opts.kind, opts.planId, opts.period, cena, ...utmVRyad(opts.utm ?? {})],
    );
    const zakaz = Number(z.rows[0]!.id);

    /* ⚠️ ПРОМОКОД (Р-167): АКТИВАЦИЯ ЗАНИМАЕТСЯ В ЭТОЙ ЖЕ ТРАНЗАКЦИИ.
       Ответ формы был предварительным; настоящее решение — здесь,
       и принимает его база. Не подошёл — заказ НЕ создаётся вовсе:
       человек видел в форме цену со скидкой, и молча взять с него
       полную значило бы обмануть ровно там, где он проверяет.
       Скидка считается от текущей цены (уже со скидкой тарифа)
       и ДО баланса. `total_kop` — цена ПОСЛЕ промокода: от неё
       считаются платёж, чек и возврат, и ни одно место не обязано
       помнить о вычитании. */
    let itogo = cena;
    if (promoVvod) {
      const p = await zanyatPromo(c, promoVvod, zakaz, opts.userId, cena);
      if (!p.zanyali) throw new PromoNePodoshyol(p.pochemu);
      itogo = cena - p.skidkaKop;
      await c.query('update shop_order set promo_kod = $2, promo_skidka_kop = $3 where id = $1', [
        zakaz,
        p.kod,
        p.skidkaKop,
      ]);
    }
    const sBalansa = opts.tratitBalans ? Math.min(balans, itogo) : 0;
    const kDoplate = itogo - sBalansa;
    await c.query('update shop_order set total_kop = $2, balance_kop = $3 where id = $1', [zakaz, itogo, sBalansa]);

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

    /* ⚠️ ПОДПИСКА ЗАВОДИТСЯ В ТОЙ ЖЕ ТРАНЗАКЦИИ, ЧТО И ЗАКАЗ: заказа
       без своей подписки при отмеченной галочке не бывает, и наоборот.
       Заказ закрыт балансом целиком — первый платёж прошёл не картой,
       материнского счёта у цепочки не будет, и подписка сразу
       `ne_karta` (форма в этом случае галочку и не даёт). */
    if (avtoNado) {
      await zavestiPodpisku(c, {
        userId: opts.userId,
        zakaz,
        planId: opts.planId,
        period: opts.period,
        status: kDoplate === 0 ? 'ne_karta' : 'zhdyot_oplaty',
        soglasieTekst: avtoTekst,
      });
    }

    const oplachen = kDoplate === 0 ? await oplatitVnutri(c, zakaz, 0) : false;

    log.info('заказ создан', {
      order: zakaz,
      plan: opts.planId,
      period: opts.period,
      balance_kop: sBalansa,
      rest_kop: kDoplate,
      promo: promoVvod || '—',
      avto: avtoNado,
    });
    return { ok: true as const, zakaz, sBalansa, kDoplate, oplachen };
  }).catch((e: unknown) => {
    if (e instanceof PromoNePodoshyol) return { ok: false as const, pochemu: e.pochemu };
    throw e;
  });
  if (!itog.ok) {
    // «Уже держит другой заказ» и «уже использовали» — не перебор: код
    // верный, и в счёт неудач такой отказ не идёт (то же в `proverit`).
    if (itog.pochemu !== 'uzhe' && itog.pochemu !== 'ispolzovan') await promoNeudacha(opts.userId);
    return { ok: false, pochemu: `${otkazSlovami(itog.pochemu)} Заказ не оформлен: уберите промокод или введите другой.` };
  }

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

/** Промокод не подошёл в момент оформления — транзакция откатывается целиком. */
class PromoNePodoshyol extends Error {
  constructor(readonly pochemu: OtkazPromo) {
    super(`промокод: ${pochemu}`);
  }
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
  /* ⚠️ НАЧАЛЬНОЕ СОСТОЯНИЕ РАЗДАЧИ — В ЭТОЙ ЖЕ ТРАНЗАКЦИИ (пятьдесят
     четвёртая итерация, поправка concurrency-1). После коммита
     с пустым состоянием заказ на время письма и сообщения в группу
     стал бы виден всем разрешённым операторам — а предложен он должен
     быть одному. Здесь проходят все оплаты: ResultURL, баланс целиком
     и заказ автопродления. */
  await nachatRazdachu(c, zakaz);
  return true;
}

/**
 * Причина движения по балансу при пополнении. ОДНО место: по этой же
 * строке статистика складывает пополнения за период (Р-168).
 */
export const PRICHINA_POPOLNENIYA = 'пополнение баланса';

/** Движения по балансу автоплатежа — словами, их видит человек в истории баланса. */
export const PRICHINA_AVTO_SPISANIE = 'оплата заказа (автоплатёж)';
export const PRICHINA_AVTO_NA_BALANS = 'Списание автоплатежа, которому нечего было продлевать';

/**
 * ЗАКАЗ ПРОДЛЕНИЯ, СОЗДАННЫЙ АВТОПЛАТЕЖОМ (пятьдесят четвёртая итерация).
 *
 * Постановка: «После успеха автоматически создаётся заказ на продление
 * того же аккаунта (почта и пароль из прошлого заказа) и уходит
 * оператору, как обычный заказ».
 *
 * ⚠️ ОДНА ФУНКЦИЯ НА ОБЕ ВЕТКИ (поправка money-12): списание с баланса
 * в часовом ходе и проверенное уведомление о дочернем списании картой.
 * Обе — внутри уже открытой транзакции вызывающего, и обе проходят
 * через ту же `oplatitVnutri`, что и любая оплата: заказ рождается
 * `new` и становится `paid` только там. Так у закона 34 появляется
 * третий вход — автопродление с баланса, — но дверь остаётся одной.
 *
 * ⚠️ СЛОТЫ — КОПИИ ШИФРОТЕКСТОВ, А НЕ РАСШИФРОВКА: ключ тот же,
 * почта и пароль не выходят из базы открытым текстом ни на миг
 * (закон 35). Режим у копий — `renew`: аккаунт уже существует, даже
 * если в прошлый раз его заводили с нуля.
 *
 * ⚠️ БАЛАНС СРАВНИВАЕТСЯ С СУММОЙ ТОЛЬКО ПОСЛЕ `for update` СТРОКИ
 * ЧЕЛОВЕКА: две подписки одного человека в один день (или подписка
 * и оформление) иначе увели бы баланс в минус. Не хватает — `null`,
 * и ничего не создано: вызывающий пойдёт списывать с карты.
 *
 * `posleOplaty` — после транзакции, у вызывающего.
 */
export async function zakazProdleniya(
  c: PoolClient,
  o: {
    avto: number;
    userId: number;
    planId: string;
    period: number;
    /** Заказ, срок которого продлеваем: из него копируются слоты. */
    ciklZakaz: number;
    oplata: { kak: 'balans'; summaKop: number } | { kak: 'karta'; prishloKop: number };
  },
): Promise<number | null> {
  if (o.oplata.kak === 'balans') {
    const u = await c.query<{ balance_kop: string }>('select balance_kop from app_user where id = $1 for update', [
      o.userId,
    ]);
    if (Number(u.rows[0]?.balance_kop ?? 0) < o.oplata.summaKop) return null;
  }
  const summa = o.oplata.kak === 'balans' ? o.oplata.summaKop : o.oplata.prishloKop;
  const z = await c.query<{ id: string }>(
    `insert into shop_order (user_id, kind, plan_id, period, status, total_kop, balance_kop, money_kop, source,
                             avtoplatezh_id, consent_at)
     values ($1, 'plan', $2, $3, 'new', $4, 0, 0, 'avto', $5, now())
     returning id`,
    [o.userId, o.planId, o.period, summa, o.avto],
  );
  const zakaz = Number(z.rows[0]!.id);
  /* ⚠️ У ЗАКАЗОВ ДО ТРИДЦАТЬ ЧЕТВЁРТОЙ ИТЕРАЦИИ данные аккаунта лежали
     в `out_*` — их выдавал оператор. Цепочки автоплатежа моложе, но
     копия честная в обоих случаях. */
  const sloty = await c.query(
    `insert into order_slot (order_id, idx, mode, in_login_enc, in_password_enc, login_fp)
     select $1, idx, 'renew', coalesce(in_login_enc, out_login_enc), coalesce(in_password_enc, out_password_enc), login_fp
       from order_slot where order_id = $2 order by idx`,
    [zakaz, o.ciklZakaz],
  );
  if (!sloty.rowCount) {
    // Продлевать без единого аккаунта нечего; откат — и вызывающий
    // разберётся (у ResultURL это повтор уведомления, а не потеря денег).
    throw new Error('у заказа цикла нет слотов для продления');
  }
  if (o.oplata.kak === 'balans') {
    await c.query('update shop_order set balance_kop = $2 where id = $1', [zakaz, summa]);
    await c.query('update app_user set balance_kop = balance_kop - $1 where id = $2', [summa, o.userId]);
    await c.query('insert into balance_move (user_id, delta_kop, reason, order_id) values ($1, $2, $3, $4)', [
      o.userId,
      -summa,
      PRICHINA_AVTO_SPISANIE,
      zakaz,
    ]);
  }
  const oplachen = await oplatitVnutri(c, zakaz, o.oplata.kak === 'karta' ? o.oplata.prishloKop : 0);
  if (!oplachen) throw new Error('заказ продления не оплатился');
  log.info('заказ продления создан автоплатежом', {
    order: zakaz,
    avto: o.avto,
    cikl: o.ciklZakaz,
    kak: o.oplata.kak,
    kop: summa,
  });
  return zakaz;
}

/**
 * Дверь «оплачено».
 *
 * `sposob` — способ оплаты из уведомления Робокассы (`PaymentMethod`
 * и `IncCurrLabel`, пятьдесят четвёртая итерация). Необязателен:
 * имитатор и прежние вызовы его не знают. В подпись уведомления эти поля
 * не входят — по ним решается только одно: включается ли автоплатёж.
 *
 * ⚠️ ВЕТКИ ПО ВИДУ ПЛАТЕЖА ЯВНЫЕ (поправка money-11): `order`, `topup`,
 * `avto`. Незнакомый вид и платёж без владельца — `throw`: транзакция
 * откатывается, ResultURL отвечает 500, и Робокасса повторит уведомление.
 * Прежде всё, что не пополнение, шло веткой заказа: платёж помечался
 * оплаченным, заказа с номером 0 не находилось, деньги не ложились
 * никуда, а Робокасса получала `OK` и больше не повторяла.
 */
export async function otmetitOplachennym(platyozh: number, prishloKop: number, sposob?: SposobOplaty): Promise<void> {
  const itog = await vTranzakcii(async (c) => {
    const p = await c.query<{
      id: string;
      order_id: string | null;
      user_id: string | null;
      kind: string;
      amount_kop: string;
      status: string;
      recurring: boolean;
      avtoplatezh_id: string | null;
      avto_cikl_order_id: string | null;
    }>(
      `select id, order_id, user_id, kind, amount_kop, status, recurring, avtoplatezh_id, avto_cikl_order_id
         from payment where id = $1 for update`,
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
    /* Способ оплаты пишется у ЛЮБОГО платежа: по нему разбирают
       и пополнения, и заказы. Нет полей — прежнее значение не трогаем. */
    const sposobStroka = sposob ? sposobStrokoy(sposob.paymentMethod, sposob.incCurrLabel) : null;
    await c.query(`update payment set status = 'paid', paid_at = now(), sposob = coalesce($2, sposob) where id = $1`, [
      platyozh,
      sposobStroka,
    ]);

    /* ⚠️ ПОПОЛНЕНИЕ БАЛАНСА (Р-168): заказа нет, деньги ложатся
       на баланс владельца счёта В ЭТОЙ ЖЕ ТРАНЗАКЦИИ, и движение
       называется своими словами. Зачисляется то, что ПРИШЛО: недоплата
       отбита выше, а переплата — тоже деньги человека. В выручку
       пополнение само не идёт: оно посчитается один раз, когда им
       оплатят выполненный заказ (`balance_kop` заказа, stats.ts). */
    if (row.kind === 'topup') {
      const vladelec = Number(row.user_id ?? 0);
      if (!vladelec) {
        // Ограничение `payment_kind_check` такого не пускает; дошло
        // сюда — откат и повтор, а не «принято» в никуда.
        log.error('пополнение без владельца', { payment: platyozh, money_kop: prishloKop });
        throw new Error('пополнение без владельца');
      }
      await c.query('update app_user set balance_kop = balance_kop + $1 where id = $2', [prishloKop, vladelec]);
      await c.query('insert into balance_move (user_id, delta_kop, reason, order_id) values ($1, $2, $3, null)', [
        vladelec,
        prishloKop,
        PRICHINA_POPOLNENIYA,
      ]);
      log.info('баланс пополнен', { payment: platyozh, user: vladelec, money_kop: prishloKop });
      return { popolnenie: true as const };
    }

    if (row.kind === 'avto') {
      /* ⚠️ ДОЧЕРНЕЕ СПИСАНИЕ АВТОПЛАТЕЖА (поправка money-2). Какой цикл
         оно продлевает, говорит МАРКЕР В САМОМ ПЛАТЕЖЕ
         (`avto_cikl_order_id` — заказ подписки на момент списания),
         а не `platezh_v_puti`: уведомление может прийти раньше, чем
         запишется отправка, а подписка к тому времени — переехать.

         Продление создаётся, если подписка есть, она всё ещё стоит
         на заказе этого цикла и заказ цикла всё ещё выполнен. СТАТУС
         ПОДПИСКИ ПРИ ЭТОМ НЕ ВАЖЕН: запрос ушёл по действующему
         согласию, и человек, нажавший «Отключить», пока он был в пути,
         продление получает (отключено оно от следующих). Иначе — нет
         подписки, цикл уже продлён другим платежом, заказ цикла
         отменён — деньги ложатся на баланс владельца счёта.

         ⚠️ И ТЕ ЖЕ АККАУНТЫ УЖЕ ПРОДЛЕНЫ ДРУГИМ ЗАКАЗОМ — тоже баланс
         (доводка пятьдесят пятой): человек оплатил продление руками,
         пока списание было в пути, и второе продление за тот же
         период было бы двойной оплатой. Вопрос «продлено ли» задаёт
         та же функция, что у часового хода (`prodleniyaCikla`): любой
         оплаченный заказ на любой из аккаунтов цикла, на любой срок.

         ⚠️ ПОРЯДОК БЛОКИРОВОК: платёж → заказ цикла → подписка, тот же,
         что у отмены заказа и отмены подписки (заказ → подписка),
         и у часового хода. Владелец — `payment.user_id`: у дочернего
         списания заказа нет, искать владельца через `shop_order` было
         бы нечем (поправка money-11). */
      const vladelec = Number(row.user_id ?? 0);
      if (!vladelec) {
        log.error('списание автоплатежа без владельца', { payment: platyozh, money_kop: prishloKop });
        throw new Error('списание автоплатежа без владельца');
      }
      const cikl = Number(row.avto_cikl_order_id ?? 0);
      const podpiska = Number(row.avtoplatezh_id ?? 0);
      const co = cikl
        ? (await c.query<{ status: Status }>('select status from shop_order where id = $1 for update', [cikl])).rows[0]
        : undefined;
      const a = podpiska
        ? (
            await c.query<{ id: string; status: string; order_id: string; plan_id: string; period: number; platezh_v_puti: string | null }>(
              'select id, status, order_id, plan_id, period, platezh_v_puti from avtoplatezh where id = $1 for update',
              [podpiska],
            )
          ).rows[0]
        : undefined;
      const prodleno = cikl ? (await prodleniyaCikla(c, cikl)).length > 0 : false;
      if (a && co && Number(a.order_id) === cikl && co.status === 'done' && !prodleno) {
        const novy = await zakazProdleniya(c, {
          avto: podpiska,
          userId: vladelec,
          planId: a.plan_id,
          period: Number(a.period),
          ciklZakaz: cikl,
          oplata: { kak: 'karta', prishloKop },
        });
        await podpiskaProdlena(c, { avto: podpiska, novy, platyozh });
        return { zakaz: novy!, naBalans: 0 };
      }
      await c.query('update app_user set balance_kop = balance_kop + $1 where id = $2', [prishloKop, vladelec]);
      await c.query('insert into balance_move (user_id, delta_kop, reason, order_id) values ($1, $2, $3, $4)', [
        vladelec,
        prishloKop,
        PRICHINA_AVTO_NA_BALANS,
        cikl || null,
      ]);
      if (a && a.platezh_v_puti !== null && Number(a.platezh_v_puti) === platyozh) {
        await c.query(
          'update avtoplatezh set platezh_v_puti = null, otpravlen_at = null, updated_at = now() where id = $1',
          [podpiska],
        );
      }
      log.error('списание автоплатежа пришло, а продлевать нечего: деньги на баланс', {
        payment: platyozh,
        avto: podpiska || '—',
        cikl: cikl || '—',
        cikl_status: co?.status ?? '—',
        avto_status: a?.status ?? '—',
        prodleno_drugim: prodleno,
        money_kop: prishloKop,
      });
      const kto = await c.query<{ email: string }>('select email from app_user where id = $1', [vladelec]);
      return {
        avtoNaBalans: {
          platyozh,
          avto: podpiska || null,
          zakaz: cikl || null,
          summaKop: prishloKop,
          email: kto.rows[0]?.email ?? null,
        },
      };
    }

    if (row.kind !== 'order') {
      log.error('уведомление о платеже незнакомого вида', { payment: platyozh, kind: row.kind.slice(0, 32) });
      throw new Error(`платёж незнакомого вида: ${row.kind.slice(0, 32)}`);
    }

    const zakaz = Number(row.order_id);
    if (await oplatitVnutri(c, zakaz, prishloKop)) {
      /* ⚠️ ЗАКАЗ ОПЛАЧЕН ИМЕННО ЭТИМ ПЛАТЕЖОМ — только тогда решается
         судьба подписки, той же транзакцией (поправка money-16). */
      await podtverditMat(c, { zakaz, platyozh, recurring: row.recurring, sposob: sposob ?? null });
      return { zakaz, naBalans: 0 };
    }

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
      // Внешний ключ такого не пускает; дошло сюда — откат и повтор:
      // «принято» без владельца значило бы деньги, не лёгшие никуда.
      log.error('деньги пришли по заказу, которого нет', { payment: platyozh, order: zakaz, money_kop: prishloKop });
      throw new Error('деньги пришли по заказу, которого нет');
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

  if (!itog || 'popolnenie' in itog) return;
  if ('avtoNaBalans' in itog && itog.avtoNaBalans) {
    const b = itog.avtoNaBalans;
    await soobshchitKomande({ vid: 'avto_na_balans', platyozh: b.platyozh, avto: b.avto, zakaz: b.zakaz, summaKop: b.summaKop });
    if (b.email) await pismoAvtoNaBalans({ komu: b.email, summaKop: b.summaKop });
    return;
  }
  /* ⚠️ СООБЩИТЬ КОМАНДЕ ОБЯЗАТЕЛЬНО, и это не «ещё одно
     уведомление»: деньги легли на баланс, а не в заказ, и без человека
     дальше ничего не произойдёт. */
  if (itog.naBalans > 0) {
    await soobshchitKomande({ vid: 'dengi_bez_zakaza', zakaz: itog.zakaz, platyozh, summaKop: itog.naBalans });
    return;
  }
  await posleOplaty(itog.zakaz);
}

/**
 * Что происходит ПОСЛЕ оплаты: письмо, сертификат, сигнал команде.
 *
 * ⚠️ ЗОВЁТСЯ ТОЛЬКО ПОСЛЕ ТРАНЗАКЦИИ, СДЕЛАВШЕЙ ЗАКАЗ ОПЛАЧЕННЫМ.
 * Наружу она отдана ради одного вызывающего — автопродления с баланса
 * в часовом ходе (`avtoplatezh.ts`): тот оплачивает заказ в своей
 * транзакции через `zakazProdleniya` и обязан дальше пройти тот же
 * путь, что любая оплата.
 */
export async function posleOplaty(zakaz: number): Promise<void> {
  const z = await odna<{
    id: string;
    kind: 'plan' | 'certificate';
    plan_id: string;
    period: number;
    user_id: string;
    email: string;
    source: string;
  }>(
    `select o.id, o.kind, o.plan_id, o.period, o.user_id, u.email, o.source
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

  /* ⚠️ РАЗДАЧА — ПЕРВОЙ, ДО ПИСЬМА И СООБЩЕНИЯ В ГРУППУ (поправка
     concurrency-1): предложение оператору не ждёт почты. Ждём её
     С ПОТОЛКОМ: при лежащем Telegram ход раздачи тянется таймаутами,
     а ResultURL Робокассы ждёт ответа. Свои сообщения в группу раздача
     шлёт ПОСЛЕ «New paid order» — для этого ей передаётся `gotovo`.
     Не вышло вовсе — минутный тик подхватит заказ в «ждёт». */
  const gotovo = otpuskanie();
  await razdatNovyyPervym(zakaz, gotovo.zhdat);
  try {
    await pismoZakazOplachen(z.email, nazvanie);
    /* ⚠️ В ЧАТ УХОДЯТ АНГЛИЙСКИЕ НАЗВАНИЯ, И ЭТО НЕ ПЕРЕВОД ДАННЫХ.
       Сообщения бота — надписи интерфейса для двух сотрудников
       (закон 40); с тридцать девятой итерации к ним отнесены и тариф
       со сроком: «Plan: Индивидуальный, месяц» читалось как недоделка.
       Почта клиента, его пароль и причина отмены переводу не подлежат
       по-прежнему — их не выбирали мы. */
    await soobshchitKomande({
      vid: 'zakaz_oplachen',
      zakaz,
      tarif: imyaTarifaIz(await imenaTarifov(), z.plan_id, true),
      srok: srokDlyaSotrudnika(z.period, true),
      mest: tarif?.people ?? 1,
      podarok: false,
      avto: z.source === 'avto',
    });
  } finally {
    gotovo.otpustit();
  }
}

/**
 * Обещание «сообщение о новом заказе ушло»: раздача ждёт его, прежде
 * чем писать в ту же группу своё. Отпускается в `finally` — упавшее
 * письмо не должно навсегда задержать «предложить некому».
 */
function otpuskanie(): { zhdat: Promise<void>; otpustit: () => void } {
  let otpustit: () => void = () => {};
  const zhdat = new Promise<void>((r) => {
    otpustit = r;
  });
  return { zhdat, otpustit };
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
    /* Заказ сразу оплачен — значит и начальное состояние раздачи
       ставится здесь, в той же транзакции (поправка concurrency-1). */
    await nachatRazdachu(c, zakaz);
    log.info('заказ по сертификату', { order: zakaz, plan: opts.planId, period: opts.period, mest: opts.uchastniki.length });
    return zakaz;
  });

  /* ⚠️ УВЕДОМЛЕНИЕ — ПОСЛЕ ТРАНЗАКЦИИ, А НЕ ВНУТРИ НЕЁ. Внутри оно
     держало бы соединение с базой на всё время похода в сеть, а при
     откате команда узнала бы о заказе, которого нет.

     И такой заказ уходит оператору ТАК ЖЕ, как обычный оплаченный:
     работа по нему та же, разница только в том, что денег за ним нет
     вовсе — их взяли при покупке сертификата (Р-93). Раздача —
     первой и тем же порядком, что в `posleOplaty`. */
  const gotovo = otpuskanie();
  await razdatNovyyPervym(zakaz, gotovo.zhdat);
  try {
    await soobshchitKomande({
      vid: 'zakaz_oplachen',
      zakaz,
      tarif: imyaTarifaIz(await imenaTarifov(), opts.planId, true),
      srok: srokDlyaSotrudnika(opts.period, true),
      mest: opts.uchastniki.length,
      podarok: true,
    });
  } finally {
    gotovo.otpustit();
  }
  return zakaz;
}

/* ── Работа оператора ──────────────────────────────────────────── */

/**
 * ЗАПИСЬ В ЖУРНАЛ РАБОТЫ: кто и что сделал с заказом.
 *
 * Постановка сорок четвёртой итерации: администратор должен видеть,
 * «кто взял заказ, кто вернул его в очередь, кто выполнил, кто
 * отменил», и все записи по порядку, если заказ передавали из рук
 * в руки.
 *
 * ⚠️ ПИШЕТСЯ В ТОЙ ЖЕ ТРАНЗАКЦИИ, ЧТО И САМА ПЕРЕМЕНА СОСТОЯНИЯ.
 * Состояния «заказ выполнен, а записи об этом нет» быть не должно:
 * история потеряла бы ровно то событие, ради которого её и завели.
 * Поэтому все четыре двери принимают клиент транзакции, а не ходят
 * в базу сами.
 *
 * ⚠️ КЛАДЁТСЯ НОМЕР СОТРУДНИКА, А НЕ ПОЧТА. Почта живёт в `staff`
 * одной строкой, и копия в журнале разошлась бы с ней на первой же
 * правке; подставляется она при чтении (Р-151, миграция 012).
 */
type VidSobytiya =
  | 'vzyal'
  | 'vernul'
  | 'vypolnil'
  | 'otmenil'
  /* ⚠️ ДВА ГЛАГОЛА ОТМЕНЫ ПОДПИСКИ (сорок девятая итерация), и «Отменил»
     среди них нет: `otmenil` считает статистика по сотрудникам, и это
     отмена ДО выполнения, с деньгами на балансе. Здесь работа сделана
     и деньги остаются — другое действие, другое слово (миграция 015). */
  | 'otmena_zaproshena'
  | 'podpiska_otmenena';

async function zapisatSobytie(
  c: PoolClient,
  zakaz: number,
  staffId: number | null,
  vid: VidSobytiya,
): Promise<void> {
  await c.query('insert into order_event (order_id, staff_id, vid) values ($1, $2, $3)', [zakaz, staffId, vid]);
}

/**
 * Взять заказ в работу.
 *
 * `zapreshcheno` — тарифы, которых ЭТОМУ сотруднику брать нельзя;
 * `null` значит «ограничений нет» и приходит от администратора
 * («Сам администратор может взять любой заказ всегда»).
 *
 * ⚠️ ПРОВЕРКА ТАРИФА СТОИТ ВНУТРИ ТОЙ ЖЕ ТРАНЗАКЦИИ И ПОД ТЕМ ЖЕ
 * `for update`, ЧТО И ПРОВЕРКА «СВОБОДЕН ЛИ ЗАКАЗ». Поставь мы её
 * на странице или в действии — получилась бы ещё одна дверь, мимо
 * которой можно пройти: серверное действие вызывается и без
 * страницы. Здесь её обойти нечем — взятие заказа идёт только сюда.
 */
export async function vzyatZakaz(
  zakaz: number,
  staffId: number,
  zapreshcheno: Para[] | null,
): Promise<boolean> {
  const itog = await vTranzakcii(async (c) => {
    const r = await c.query<{
      status: Status;
      operator_id: string | null;
      plan_id: string;
      period: number;
      razdacha: string | null;
      offer_staff_id: string | null;
      offer_zhivo: boolean;
    }>(
      `select status, operator_id, plan_id, period, razdacha, offer_staff_id,
              coalesce(offer_until > now(), false) as offer_zhivo
         from shop_order where id = $1 for update`,
      [zakaz],
    );
    const row = r.rows[0];
    if (!row) return null;
    if (row.status !== 'paid' || row.operator_id) return null;
    /* ⚠️ СРАВНИВАЕТСЯ ПАРА ЦЕЛИКОМ (сорок седьмая итерация): тариф
       оператору может быть разрешён, а этот его срок — нет. */
    if (zapreshcheno && zapreshcheno.some((z) => z.planId === row.plan_id && z.period === Number(row.period)))
      return null;
    /* ⚠️ И ТЕ ЖЕ ПРАВИЛА РАЗДАЧИ, ЧТО У ОЧЕРЕДИ (`dostup.ts`), — ЗДЕСЬ,
       ПОД `for update` (пятьдесят четвёртая итерация). Ждущий заказ
       и чужое предложение оператор не видит, и со старой страницы
       или старого сообщения взять их тоже не может. Администратору
       можно всё — `zapreshcheno = null`. */
    if (zapreshcheno) {
      if (row.razdacha === 'zhdyot') return null;
      if (row.razdacha === 'predlozhen' && Number(row.offer_staff_id) !== staffId) return null;
      /* Истёкшее предложение не берётся и своим (доводка пятьдесят
         пятой): пятнадцать минут прошли — заказ ждёт следующего хода
         раздачи, а тот предложит его другому. */
      if (row.razdacha === 'predlozhen' && !row.offer_zhivo) return null;
    }
    await c.query(`update shop_order set status = 'in_work', operator_id = $2, taken_at = now() where id = $1`, [
      zakaz,
      staffId,
    ]);
    await zapisatSobytie(c, zakaz, staffId, 'vzyal');
    /* Взятие любым путём снимает предложение: `vzyal`, если взял тот,
       кому предлагали, иначе `snyat`. */
    const zp = row.razdacha === null ? null : await snyatRazdachu(c, zakaz, { ishod: 'snyat', vzyal: staffId, stanet: null });
    return { zp };
  });
  if (!itog) return false;
  /* После коммита и не дожидаясь: правка личного сообщения — лучшим
     усилием, а взятие из Telegram ждёт ответа на нажатие. */
  void popravitZakrytoe(itog.zp, staffId);
  return true;
}

/**
 * Вернуть заказ в очередь.
 *
 * ⚠️ ОБНУЛЯЕТ `operator_id` И `taken_at`, И ИМЕННО ПОЭТОМУ НУЖЕН
 * ЖУРНАЛ. После этой строки в заказе не остаётся ни следа того,
 * что он у кого-то был: «кто его брал до передачи» — вопрос,
 * на который сама строка заказа ответить не может ни сейчас,
 * ни потом. Запись идёт В ТОЙ ЖЕ транзакции, что и обнуление.
 */
export async function vernutVOchered(zakaz: number, staffId: number): Promise<boolean> {
  const vernul = await vTranzakcii(async (c) => {
    /* ⚠️ ПОСЛЕ «ВЕРНУТЬ» ЗАКАЗ В ОБЩЕЙ ОЧЕРЕДИ И ЗАНОВО НЕ РАЗДАЁТСЯ
       (пятьдесят четвёртая итерация): `obshchaya`, а не пусто и не «ждёт».
       Открытого предложения у взятого заказа нет — взятие его сняло. */
    const r = await c.query(
      `update shop_order
          set status = 'paid', operator_id = null, taken_at = null,
              razdacha = case when kind = 'plan' then 'obshchaya' else razdacha end,
              offer_staff_id = null, offer_until = null, razdacha_at = now()
        where id = $1 and status = 'in_work' and operator_id = $2 returning id`,
      [zakaz, staffId],
    );
    if (!r.rows.length) return false;
    await zapisatSobytie(c, zakaz, staffId, 'vernul');
    return true;
  });
  /* Поправка concurrency-16: Лев узнаёт, что заказ снова ничей. */
  if (vernul) await soobshchitKomande({ vid: 'zakaz_vozvrashchyon', zakaz });
  return vernul;
}

/**
 * ПРОЙТИ ТЕКУЩИЙ ШАГ: отметить аккаунт и, если он последний, ВЫПОЛНИТЬ
 * ЗАКАЗ — одной транзакцией.
 *
 * ⚠️ ШАГА «ЗАВЕРШЕНИЕ» НЕТ С ПЯТЬДЕСЯТ ТРЕТЬЕЙ ИТЕРАЦИИ (Р-169).
 * Постановка: «Когда подтверждён последний шаг („Вы уверены?" → „Да"),
 * заказ выполняется сразу». Отметка последнего аккаунта и закрытие
 * заказа поэтому стоят в ОДНОЙ транзакции: раздельно бывало бы
 * состояние «все аккаунты отмечены, а заказ в работе», и выйти из него
 * было бы нечем — кнопки «Завершить» больше нет.
 *
 * ⚠️ ДАТА ОКОНЧАНИЯ У ПРОДЛЕНИЯ ПРИХОДИТ ВМЕСТЕ С ШАГОМ СВОЕГО АККАУНТА
 * и проверяется ЗДЕСЬ: поле `required` человек снимает в браузере
 * за секунду, а от даты считается письмо за три дня (закон 44).
 * Расчётная дата у продления врёт — у клиента мог остаться неистёкший
 * срок, — поэтому оператор переписывает её из Spotify (Р-145).
 *
 * ⚠️ ТЕКУЩИЙ ШАГ ВЫЧИСЛЯЕТСЯ, А НЕ БЕРЁТСЯ ИЗ ФОРМЫ: это первый
 * аккаунт без отметки. Номер из формы только сверяется с ним — иначе
 * правкой разметки отмечался бы любой аккаунт. Если отметки стоят
 * у всех, а заказ ещё в работе (так остаются заказы, начатые до этой
 * итерации со старым шагом «Завершение»), текущим считается ПОСЛЕДНИЙ
 * аккаунт: его «Да» и выполняет заказ.
 *
 * ⚠️ `expires_at` — САМАЯ РАННЯЯ ИЗ ДАТ: напоминание обязано уйти
 * до того, как кончится ПЕРВЫЙ из аккаунтов. У нового аккаунта своей
 * даты нет, и срок ему считается от выдачи; `least` в Postgres
 * пропускает NULL, поэтому одна строка накрывает все три случая.
 */
export type ItogShaga =
  | { ok: true; zakryt: boolean }
  | { ok: false; pochemu: 'ne_vash' | 'ne_tot_shag' | 'nuzhna_data' | 'net_klyucha'; n?: number };

export async function proytiShag(opts: {
  zakaz: number;
  staffId: number;
  slotId: number;
  /** Дата окончания подписки из Spotify, `ГГГГ-ММ-ДД` — только у продления. */
  ends: string | null;
  /** Старый заказ: доступы к новому аккаунту вводит оператор (до тридцать четвёртой итерации). */
  vydacha?: { login: string; mailPass: string; spotifyPass: string };
}): Promise<ItogShaga> {
  if (opts.vydacha && !shifrGotov()) return { ok: false, pochemu: 'net_klyucha' };
  const itog = await vTranzakcii(async (c): Promise<ItogShaga> => {
    const o = await c.query<{ status: Status; operator_id: string | null }>(
      'select status, operator_id from shop_order where id = $1 for update',
      [opts.zakaz],
    );
    const row = o.rows[0];
    if (!row || row.status !== 'in_work' || Number(row.operator_id) !== opts.staffId) return { ok: false, pochemu: 'ne_vash' };
    const slots = (
      await c.query<{ id: string; idx: number; mode: Rezhim; done_at: Date | null; ends_at: Date | null }>(
        'select id, idx, mode, done_at, ends_at from order_slot where order_id = $1 order by idx for update',
        [opts.zakaz],
      )
    ).rows;
    if (!slots.length) return { ok: false, pochemu: 'ne_tot_shag' };
    /* ⚠️ ПРОДЛЕНИЕ БЕЗ ДАТЫ — НЕ ПРОЙДЕННЫЙ ШАГ. До пятьдесят третьей
       итерации дату спрашивал шаг «Завершение», а аккаунты отмечались
       без неё; заказ, начатый тогда, иначе закрылся бы без официальной
       даты у уже отмеченного продления, и письмо за три дня считалось бы
       от расчётной (закон 44). Такой аккаунт снова встаёт текущим шагом
       и просит дату. Та же мера пройденного — `gotov` в виде админки. */
    const proyden = (s: (typeof slots)[number]) => Boolean(s.done_at) && (s.mode !== 'renew' || Boolean(s.ends_at));
    const tekushchiy = slots.find((s) => !proyden(s)) ?? slots[slots.length - 1]!;
    if (Number(tekushchiy.id) !== opts.slotId) return { ok: false, pochemu: 'ne_tot_shag' };
    const prodlenie = tekushchiy.mode === 'renew';
    if (prodlenie && !nastoyashchayaData(opts.ends)) {
      return { ok: false, pochemu: 'nuzhna_data', n: tekushchiy.idx + 1 };
    }
    if (opts.vydacha) {
      await c.query(
        `update order_slot set out_login_enc = $2, out_mail_pass_enc = $3, out_password_enc = $4,
                done_at = coalesce(done_at, now())
          where id = $1`,
        [
          opts.slotId,
          zashifrovat(opts.vydacha.login.trim()),
          zashifrovat(opts.vydacha.mailPass),
          zashifrovat(opts.vydacha.spotifyPass),
        ],
      );
    } else {
      await c.query(
        `update order_slot set done_at = coalesce(done_at, now()),
                ends_at = case when $2::text is null then ends_at else $2::date end
          where id = $1`,
        [opts.slotId, prodlenie ? opts.ends : null],
      );
    }
    const ostalis = slots.some((s) => !proyden(s) && Number(s.id) !== opts.slotId);
    if (ostalis) return { ok: true, zakryt: false };

    /* ⚠️ ДАТА ОКОНЧАНИЯ ЗАКАЗА СТАВИТСЯ ЗДЕСЬ, А НЕ ПРИ ОПЛАТЕ:
       доступ начинается тогда, когда его выдали, а между оплатой
       и выдачей стоит очередь оператора (закон 44). И закрытие с записью
       в журнал — та же транзакция: «Выполнил» спрашивают у журнала. */
    await c.query(
      `update shop_order set status = 'done', closed_at = now(),
              expires_at = least(
                (select min(ends_at) from order_slot where order_id = $1)::timestamptz,
                case when exists (select 1 from order_slot where order_id = $1 and ends_at is null)
                     then now() + (period || ' months')::interval else null end
              )
        where id = $1`,
      [opts.zakaz],
    );
    await zapisatSobytie(c, opts.zakaz, opts.staffId, 'vypolnil');
    return { ok: true, zakryt: true };
  });
  if (itog.ok && itog.zakryt) await posleVypolneniya(opts.zakaz, opts.staffId);
  return itog;
}

/** Что происходит ПОСЛЕ выполнения: письмо клиенту и сигнал команде. */
async function posleVypolneniya(zakaz: number, staffId: number): Promise<void> {
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
  /* ⚠️ «КТО ВЫПОЛНИЛ» БЕРЁТСЯ ИЗ БАЗЫ, А НЕ ИЗ ВЫЗЫВАЮЩЕГО: заказ
     закрыла транзакция, проверившая `operator_id`. */
  const f = await odna<{ email: string }>('select email from staff where id = $1', [staffId]);
  await soobshchitKomande({ vid: 'zakaz_zakryt', zakaz, kto: f?.email ?? `сотрудник ${staffId}` });
}

/**
 * Шаг назад: снять отметку с ПОСЛЕДНЕГО пройденного аккаунта.
 *
 * Постановка сорок второй итерации: «На каждом шаге есть кнопка
 * „Назад" — возвращает к предыдущему шагу и снимает с него отметку».
 *
 * ⚠️ «ПРЕДЫДУЩИЙ ШАГ» — ЭТО САМЫЙ ПОЗДНИЙ ИЗ ПРОЙДЕННЫХ, и считать
 * его надо ЗАПРОСОМ, а не номером из формы. Номер в форме человек
 * правит в браузере за секунду, и «назад» тогда снимало бы отметку
 * с произвольного аккаунта; здесь снимать нечего, кроме последнего.
 *
 * ⚠️ И ВМЕСТЕ С ОТМЕТКОЙ СНИМАЕТСЯ ОФИЦИАЛЬНАЯ ДАТА. Оператор вернулся
 * шагом назад — значит этот аккаунт он будет проходить заново, и дата,
 * введённая за прошлый проход, к новому отношения не имеет.
 */
export async function shagNazad(zakaz: number, staffId: number): Promise<boolean> {
  const r = await zapros(
    `update order_slot set done_at = null, ends_at = null
      where id = (
        select s.id from order_slot s join shop_order o on o.id = s.order_id
         where s.order_id = $1 and o.operator_id = $2 and o.status = 'in_work' and s.done_at is not null
         order by s.idx desc limit 1
      )
      returning id`,
    [zakaz, staffId],
  );
  return r.length > 0;
}

/**
 * Отмена заказа с возвратом денег НА БАЛАНС.
 *
 * ⚠️ ВОЗВРАЩАЕТСЯ ВСЁ, ЧЕМ ЗАКАЗ БЫЛ ЗАКРЫТ, — и то, что пришло
 * с баланса, и то, что пришло картой. Деньги уходят на баланс,
 * а не обратно на карту: так велит постановка, и так человек может
 * оформить заново в один клик.
 */
export async function otmenitZakaz(
  zakaz: number,
  pochemu: string,
  staffId: number | null,
  /* ⚠️ ВИД ОТМЕНЫ РЕШАЕТ ТОЛЬКО ОДНО — КАКОЕ УЙДЁТ ПИСЬМО. Деньги
     возвращаются одинаково, причина ложится в ту же колонку и так же
     видна клиенту. «Почта занята» — это не отказ, а развилка: человеку
     надо не сочувствие, а слова «оформите заново и выберите
     „Продлить существующий“». */
  /* ⚠️ `parol` НЕ ПОСЫЛАЕТ НИЧЕГО, И ЭТО НЕ ПРОПУСК. При причине
     «неправильный логин или пароль» письмо клиенту уходит ДРУГОЕ
     и уходит само — «Не подошёл пароль» со ссылкой на страницу
     восстановления (постановка сорок второй итерации). В его тексте
     уже сказано и что заказ отменён, и что деньги вернулись
     на баланс: второе письмо про то же самое — это два письма
     на одно событие. */
  vid: 'obychno' | 'pochta_zanyata' | 'parol' = 'obychno',
  /* ⚠️ КТО ОТМЕНИЛ — ОТДЕЛЬНЫЙ ПРИЗНАК, А НЕ ВЫВОД ИЗ `operator_id`.
     Заказ, отменённый САМИМ покупателем, из кабинета исчезает
     совсем (постановка тридцать шестой итерации), а отменённый
     оператором остаётся с причиной. Вывести это из пустого
     `operator_id` можно было бы сегодня, но это молчаливая связь:
     достаточно однажды закрыть взятый заказ действием клиента —
     и карточка перестанет исчезать, а понять почему будет нечем. */
  kem: 'klient' | 'operator' = 'operator',
  /* ⚠️ АККАУНТ, К КОТОРОМУ ОТНОСИТСЯ ПРИЧИНА. В базу ложится
     ТОЛЬКО НОМЕР: открытый адрес в `cancel_reason` пережил бы
     семидневное стирание шифротекстов и уехал бы в ночную копию,
     а в карточке админки его увидел бы любой сотрудник — поле
     `cancelReason` не закрыто признаком `moy`, в отличие
     от `clientLogin` (закон 35, миграция 011).

     Почта приходит СВЕРХУ и живёт ровно до отправки письма: она
     не расшифровывается здесь, потому что читателей шифротекста
     столько, сколько названо законом. Её нет (ключа нет,
     шифротекст стёрт) — письмо говорит «на указанную почту»,
     как говорило раньше. */
  akkaunt: { idx: number; pochta: string | null } | null = null,
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
      razdacha: string | null;
    }>(
      `select status, user_id, balance_kop, money_kop, certificate_id, plan_id, period, kind, razdacha
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
    /* Активация промокода возвращается коду ЭТОЙ ЖЕ транзакцией (Р-167):
       раздельно бывало бы «заказ отменён, активация сгорела». */
    await vernutPromo(c, zakaz);
    // Сертификат, по которому заказ оформляли, возвращается к жизни:
    // человек не виноват, что доступ не оформили.
    if (row.certificate_id) {
      await c.query('update certificate set used_at = null, used_order_id = null where id = $1', [row.certificate_id]);
    }
    await c.query(
      `update shop_order
          set status = 'cancelled', closed_at = now(), cancel_reason = $2,
              operator_id = coalesce(operator_id, $3), cancelled_by_client = $4,
              cancel_slot_idx = $5
        where id = $1`,
      [zakaz, pochemu.slice(0, 500), staffId, kem === 'klient', akkaunt?.idx ?? null],
    );
    /* ⚠️ У ОТМЕНЫ ПОКУПАТЕЛЕМ СОТРУДНИКА НЕТ ВОВСЕ, и запись всё
       равно идёт: история скажет «покупатель», а не промолчит.
       Пустой номер здесь значит именно это и ничего другого —
       единственный путь сюда без сотрудника лежит из кабинета
       (`deystvieOtmenitSvoy`, kem = 'klient'). */
    await zapisatSobytie(c, zakaz, staffId, 'otmenil');
    /* Заказ подписки отменён — подписка отключается той же транзакцией:
       продлевать отменённое нечего. */
    await otklyuchitPoZakazu(c, zakaz);
    /* Отмена снимает предложение раздачи той же транзакцией. */
    const zp = row.razdacha === null ? null : await snyatRazdachu(c, zakaz, { ishod: 'snyat', stanet: null });
    return {
      ok: true as const,
      zp,
      vernut,
      userId: Number(row.user_id),
      planId: row.plan_id,
      period: row.period,
      kind: row.kind,
    };
  });

  if (!itog.ok) return itog;
  void popravitZakrytoe(itog.zp, null);
  const u = await odna<{ email: string }>('select email from app_user where id = $1', [itog.userId]);
  if (u) {
    const spisok = await katalog();
    const t = naytiTarif(spisok, itog.planId);
    const chto = nazvanieZakaza(t?.name ?? itog.planId, itog.period, itog.kind);
    if (vid === 'pochta_zanyata') await pismoPochtaZanyata(u.email, chto, itog.vernut, akkaunt?.pochta ?? null);
    else if (vid !== 'parol') await pismoZakazOtmenyon(u.email, chto, itog.vernut, pochemu);
  }
  await soobshchitKomande({ vid: 'zakaz_otmenyon', zakaz });
  return { ok: true };
}

/* ── ОТМЕНА ПОДПИСКИ У ВЫПОЛНЕННОГО ЗАКАЗА ─────────────────────────────
   Сорок девятая итерация, пункт 9:

     «„Отменить" у выполненного заказа спрашивает подтверждение. Затем
      создаётся задача „Отмена подписки" и попадает в очередь тому
      оператору, который выполнял заказ. Если выполнял администратор
      или оператора больше нет — в общую очередь… Деньги клиенту
      не возвращаются. В кабинете клиента заказ помечается „Отменён",
      письмо клиенту не отправляем. Событие пишется в журнал заказа:
      кто нажал „Отменить", кто выполнил отмену подписки».

   ⚠️ ЗАКАЗ ПОМЕЧАЕТСЯ «ОТМЕНЁН» СРАЗУ, НА НАЖАТИИ АДМИНИСТРАТОРА,
   а не когда оператор доберётся до Spotify. Решение принято в эту
   секунду: с неё в кабинете не должно быть ни «Продлить», ни письма
   за три дня до конца срока (закон 44 зовёт напоминание только
   у `done`). Подписка при этом ещё живёт — её снимает задача.

   ⚠️ `closed_at` НЕ ТРОГАЕТСЯ. От него считается семидневное стирание
   паролей (закон 35), и постановка говорит прямо: «Пароли хранятся
   7 дней после закрытия, как сейчас». Перепиши мы его — пароль
   выполненного месяц назад заказа ожил бы ещё на неделю.

   ⚠️ ДЕНЕГ НИКТО НЕ ВОЗВРАЩАЕТ, И СЕРТИФИКАТ НЕ ОЖИВАЕТ. Это главное
   отличие от `otmenitZakaz`: там заказ не выполнен и всё уходит назад,
   здесь услуга оказана. Письма клиенту нет — постановка. */

export type ItogOtmenyPodpiski =
  | { ok: true; operatorId: number | null }
  | { ok: false; pochemu: 'net_zakaza' | 'ne_vypolnen' | 'sertifikat' | 'uzhe' };

export async function zaprositOtmenuPodpiski(zakaz: number, adminId: number): Promise<ItogOtmenyPodpiski> {
  return vTranzakcii(async (c) => {
    const r = await c.query<{ status: Status; kind: 'plan' | 'certificate' }>(
      'select status, kind from shop_order where id = $1 for update',
      [zakaz],
    );
    const row = r.rows[0];
    if (!row) return { ok: false as const, pochemu: 'net_zakaza' as const };
    /* Заказ на сертификат подписки не несёт вовсе: его «выполнение» —
       это выданный код, и отменять в Spotify нечего. */
    if (row.kind !== 'plan') return { ok: false as const, pochemu: 'sertifikat' as const };
    if (row.status !== 'done') return { ok: false as const, pochemu: 'ne_vypolnen' as const };
    const est = await c.query('select 1 from sub_cancel where order_id = $1', [zakaz]);
    if (est.rows.length) return { ok: false as const, pochemu: 'uzhe' as const };

    /* ⚠️ «КТО ВЫПОЛНЯЛ» — ИЗ ЖУРНАЛА, А НЕ ИЗ `operator_id`: держатель
       заказа — величина текущая, а вопрос исторический (Р-153).
       Задача уходит ему, только если он ОПЕРАТОР и ЕЩЁ РАБОТАЕТ:
       постановка — «если выполнял администратор или оператора больше
       нет — в общую очередь». «Больше нет» у нас значит «отключён»:
       строки сотрудников не удаляются, их гасят (`disabled`). */
    const kto = await c.query<{ id: string }>(
      `select f.id
         from order_event e
         join staff f on f.id = e.staff_id
        where e.order_id = $1 and e.vid = 'vypolnil' and f.role = 'operator' and not f.disabled
        order by e.created_at desc, e.id desc
        limit 1`,
      [zakaz],
    );
    const operatorId = kto.rows[0] ? Number(kto.rows[0].id) : null;

    await c.query(
      `update shop_order set status = 'cancelled', cancel_reason = null, cancelled_by_client = false where id = $1`,
      [zakaz],
    );
    await c.query('insert into sub_cancel (order_id, requested_by, operator_id) values ($1, $2, $3)', [
      zakaz,
      adminId,
      operatorId,
    ]);
    await zapisatSobytie(c, zakaz, adminId, 'otmena_zaproshena');
    /* Подписку Spotify снимают — значит и продлевать её автоплатежом
       больше нечего. */
    await otklyuchitPoZakazu(c, zakaz);
    return { ok: true as const, operatorId };
  });
}

/**
 * Взять задачу из общей очереди.
 *
 * ⚠️ ТЕ ЖЕ ПРАВИЛА, ЧТО У ВЗЯТИЯ ЗАКАЗА, И ТАМ ЖЕ, ГДЕ ОНИ
 * ПРОВЕРЯЮТСЯ: внутри транзакции, под `for update` — свободна ли
 * задача и разрешена ли оператору пара «тариф × срок» (Р-155, Р-156).
 * Администратору ограничений нет: `zapreshcheno = null`.
 */
export async function vzyatOtmenu(zakaz: number, staffId: number, zapreshcheno: Para[] | null): Promise<boolean> {
  return vTranzakcii(async (c) => {
    const r = await c.query<{ operator_id: string | null; done_at: Date | null; plan_id: string; period: number }>(
      `select t.operator_id, t.done_at, o.plan_id, o.period
         from sub_cancel t join shop_order o on o.id = t.order_id
        where t.order_id = $1 for update of t`,
      [zakaz],
    );
    const row = r.rows[0];
    if (!row || row.done_at || row.operator_id) return false;
    if (zapreshcheno && zapreshcheno.some((z) => z.planId === row.plan_id && z.period === Number(row.period)))
      return false;
    await c.query('update sub_cancel set operator_id = $2 where order_id = $1', [zakaz, staffId]);
    return true;
  });
}

/** Вернуть задачу в общую очередь — только держатель и только незакрытую. */
export async function vernutOtmenu(zakaz: number, staffId: number): Promise<boolean> {
  const r = await zapros(
    `update sub_cancel set operator_id = null
      where order_id = $1 and operator_id = $2 and done_at is null returning order_id`,
    [zakaz, staffId],
  );
  return r.length > 0;
}

/**
 * Шаг задачи: «Подписка отменена» на ТЕКУЩЕМ аккаунте.
 *
 * ⚠️ ТЕКУЩИЙ АККАУНТ СЧИТАЕТ ЗАПРОС, А НЕ ФОРМА: это первый слот без
 * отметки. Номер из формы человек правит в браузере за секунду — то же
 * правило, что у «Назад» обычного заказа (Р-145).
 *
 * ⚠️ ПОСЛЕДНЯЯ ОТМЕТКА ЗАКРЫВАЕТ ЗАДАЧУ В ТОЙ ЖЕ ТРАНЗАКЦИИ, и туда же
 * ложится событие «отменил подписку»: состояния «все аккаунты отмечены,
 * а задача открыта» и «задача закрыта без записи в журнале» не бывает
 * по построению.
 */
export async function otmetitPodpiskuOtmenyonnoy(
  zakaz: number,
  staffId: number,
): Promise<{ ok: boolean; zakryta?: boolean }> {
  return vTranzakcii(async (c) => {
    const t = await c.query('select 1 from sub_cancel where order_id = $1 and operator_id = $2 and done_at is null for update', [
      zakaz,
      staffId,
    ]);
    if (!t.rows.length) return { ok: false };
    const sl = await c.query<{ id: string }>(
      `update order_slot set sub_cancelled_at = now()
        where id = (select id from order_slot where order_id = $1 and sub_cancelled_at is null order by idx limit 1)
        returning id`,
      [zakaz],
    );
    if (!sl.rows.length) return { ok: false };
    const ostalos = await c.query('select 1 from order_slot where order_id = $1 and sub_cancelled_at is null limit 1', [
      zakaz,
    ]);
    if (ostalos.rows.length) return { ok: true, zakryta: false };
    await c.query('update sub_cancel set done_at = now(), done_by = $2 where order_id = $1', [zakaz, staffId]);
    await zapisatSobytie(c, zakaz, staffId, 'podpiska_otmenena');
    return { ok: true, zakryta: true };
  });
}

/** «Назад» в задаче: снять самую позднюю отметку — как у обычного заказа. */
export async function otmenaNazad(zakaz: number, staffId: number): Promise<boolean> {
  const r = await zapros(
    `update order_slot set sub_cancelled_at = null
      where id = (
        select s.id from order_slot s join sub_cancel t on t.order_id = s.order_id
         where s.order_id = $1 and t.operator_id = $2 and t.done_at is null and s.sub_cancelled_at is not null
         order by s.idx desc limit 1
      )
      returning id`,
    [zakaz, staffId],
  );
  return r.length > 0;
}

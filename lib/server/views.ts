/**
 * Выборки для кабинета и админки.
 *
 * ⚠️ РАСШИФРОВКА ЖИВЁТ ЗДЕСЬ И ТОЛЬКО ДЛЯ ДВУХ ЧИТАТЕЛЕЙ:
 * владельца заказа (его ВЫДАННЫЕ доступы) и оператора, который
 * ЭТОТ заказ взял (пароль от аккаунта клиента). Ни один другой
 * вызов открытого текста не получает — постановка двадцать седьмой
 * итерации.
 *
 * ⚠️ С СОРОК ДЕВЯТОЙ ИТЕРАЦИИ ЧИТАТЕЛЕЙ БОЛЬШЕ, И КАЖДЫЙ НАЗВАН
 * ПОСТАНОВКОЙ (Р-160):
 *   • АДМИНИСТРАТОР — у ВЫПОЛНЕННОГО заказа: «„Открыть" показывает
 *     карточку заказа: почты и пароли аккаунтов…»;
 *   • ДЕРЖАТЕЛЬ ЗАДАЧИ «ОТМЕНА ПОДПИСКИ», пока она открыта: «оператор
 *     открывает задачу, видит почту и пароль»;
 *   • СООБЩЕНИЕ БОТА об этой задаче: «почта и пароль аккаунта (пока
 *     не стёрт)».
 * Все три — здесь же, в этом файле, и стирание через семь дней после
 * закрытия заказа для них то же самое (закон 35).
 */

import { odna, zapros } from './db';
import { poprobovatRasshifrovat } from './crypto';
import {
  PRICHINA_AVTO_NA_BALANS,
  PRICHINA_AVTO_SPISANIE,
  PRICHINA_POPOLNENIYA,
  STATUS_SLOVAMI,
  type Rezhim,
  type Status,
} from './orders';
import { cenaTarifa, katalog, naytiTarif, srokKratko } from './catalog';
import { usloviyeVidimosti, usloviyeVidimostiOtmeny, usloviyeVidimostiSZadachey, type Dostup } from './dostup';
import { METKI } from './utm';
import { rabocheeVremya } from '@/lib/chasy';
import type { PrichinaAvto, StatusAvto } from '@/lib/avtoplatezh';

export type SlotKlientu = {
  idx: number;
  mode: Rezhim;
  gotov: boolean;
  /**
   * Почта, которую человек указал сам: при «новом аккаунте» это
   * адрес, НА КОТОРЫЙ оператор завёл аккаунт и включил Premium,
   * при продлении — его собственный аккаунт.
   *
   * ⚠️ ЭТО ЕГО СОБСТВЕННЫЕ ДАННЫЕ, и читатель тут прежний —
   * владелец заказа (закон 35). Пароль ему обратно не показываем:
   * он его и так знает, а лишнее место, где открытый пароль
   * оказывается на экране, нам не нужно.
   */
  pochta: string | null;
  /** Что выдал оператор. Только у СТАРЫХ заказов: с тридцать
   *  четвёртой итерации оператор ничего не выдаёт. */
  login: string | null;
  mailPass: string | null;
  spotifyPass: string | null;
};

/**
 * Подписка автоплатежа на карточке заказа — ВЛАДЕЛЬЦУ (пятьдесят
 * четвёртая итерация). Номер подписки нужен ровно одному месту —
 * скрытому полю формы «Отключить»; почты аккаунта и номера заказа
 * здесь нет.
 */
export type AvtoKlientu = {
  id: number;
  status: StatusAvto;
  prichina: PrichinaAvto | null;
  neudach: number;
  sleduyushchayaPopytka: Date | null;
  /** Есть дочерний счёт, ждущий подтверждения банка. */
  vPuti: boolean;
  otpravlenAt: Date | null;
  /** Сумма, названная в письме о списании этого цикла. */
  napomnilSummaKop: number | null;
  /**
   * Сколько спишется в следующий раз: та же величина, что спишет
   * часовой ход, — `min(названная в письме этого цикла, текущая цена)`,
   * а без письма — текущая цена пары со скидкой тарифа, без промокода
   * (поправка money-4: «кабинет показывает то же число»). `null` —
   * пара больше не продаётся, и подписку отключит ближайший ход.
   */
  summaKop: number | null;
  /**
   * Когда спишется — не раньше дня окончания, не раньше суток после
   * письма о списании (ворота, поправки money-4…6) и не раньше
   * назначенного повтора. `null` — заказ ещё не выполнен, и дня
   * окончания нет.
   */
  sleduyushcheeSpisanie: Date | null;
  /** Сумма и время дочернего счёта «в пути». */
  vPutiSummaKop: number | null;
  vPutiKogda: Date | null;
  /** Последняя неудачная попытка списания в этом цикле. */
  neudachaKogda: Date | null;
};

export type ZakazKlientu = {
  id: number;
  kind: 'plan' | 'certificate';
  /** Тариф и срок — нужны ссылке «Продлить». */
  planId: string;
  period: number;
  nazvanie: string;
  srok: string;
  status: Status;
  statusSlovami: string;
  totalKop: number;
  balanceKop: number;
  moneyKop: number;
  kDoplate: number;
  poSertifikatu: boolean;
  sozdan: Date;
  /** Когда доступ заканчивается. Считается при закрытии заказа. */
  konchaetsya: Date | null;
  /**
   * Причина отмены и адрес аккаунта, к которому она относится, — ВРОЗЬ.
   * Склеивает их `dopisatAdres` при отрисовке: адрес встаёт отдельным
   * узлом под `translate="no"`, иначе переводчик браузера переписал
   * бы его вместе с фразой (Р-166).
   */
  prichinaOtmeny: { tekst: string; adres: string | null } | null;
  /**
   * Заказ отменён ПОСЛЕ выполнения — подписку сняли (сорок девятая
   * итерация). Деньги не возвращаются, и строки «Деньги лежат
   * на балансе» у такого заказа быть не должно.
   */
  otmenaPodpiski: boolean;
  sekretyStyorty: boolean;
  /**
   * Отзыв к заказу и его статус (пятьдесят четвёртая итерация);
   * `null` — отзыва нет. Кнопка «Оставить отзыв» стоит только
   * у выполненного заказа тарифа (`kind = 'plan'`) без отзыва.
   */
  otzyv: 'moderaciya' | 'opublikovan' | 'skryt' | null;
  /**
   * Заказ создан автоплатежом — «Продлён автоплатежом» (пятьдесят
   * четвёртая итерация). Показывает её кабинет, как и всё про
   * автоплатёж, только при включённом выключателе.
   */
  avtoProdlenie: boolean;
  /**
   * Подписка автоплатежа, которая СЕЙЧАС стоит на этом заказе; `null` —
   * нет. Показывает её кабинет только при включённом выключателе
   * (постановка: «пока выключен, клиент ничего про автоплатёж не видит»).
   */
  avto: AvtoKlientu | null;
  slots: SlotKlientu[];
};

/**
 * Подписка на карточке заказа — те же числа, что возьмёт часовой ход
 * (`lib/server/avtoplatezh.ts`): сумма — `min(названная в письме этого
 * цикла, текущая цена)`, день — не раньше окончания, не раньше суток
 * после письма и не раньше назначенного повтора. Посчитай кабинет их
 * по-своему — человек прочёл бы одну сумму и одну дату, а списали бы
 * другие.
 *
 * ⚠️ «СУТКИ ПОСЛЕ ПИСЬМА» БЕЗ ПИСЬМА — ЭТО СУТКИ ОТ СЕЙЧАС: письма
 * этого цикла ещё нет, значит оно уйдёт не раньше ближайшего хода,
 * а списание — не раньше суток после него. У далёкого окончания
 * это ничего не меняет: побеждает сам день окончания.
 */
function avtoKlientu(
  r: {
    a_id: string | null;
    a_status: StatusAvto | null;
    a_prichina: PrichinaAvto | null;
    a_neudach: number | null;
    a_sleduyushchaya: Date | null;
    a_v_puti: string | null;
    a_otpravlen: Date | null;
    a_summa: string | null;
    a_est_pismo: boolean | null;
    a_napomnil_at: Date | null;
    a_v_puti_kop: string | null;
    a_v_puti_sozdan: Date | null;
    a_neudacha_at: Date | null;
    status: Status;
    expires_at: Date | null;
  },
  cena: number | null,
): AvtoKlientu {
  const estPismo = r.a_est_pismo === true;
  const nazvana = estPismo && r.a_summa !== null ? Number(r.a_summa) : null;
  const summaKop = nazvana !== null ? (cena !== null ? Math.min(nazvana, cena) : nazvana) : cena;
  const SUTKI = 24 * 60 * 60 * 1000;
  let kogda: Date | null = null;
  if (r.status === 'done' && r.expires_at) {
    const vorota =
      estPismo && r.a_napomnil_at ? new Date(r.a_napomnil_at).getTime() + SUTKI : Date.now() + SUTKI;
    kogda = new Date(
      Math.max(
        new Date(r.expires_at).getTime(),
        vorota,
        r.a_sleduyushchaya ? new Date(r.a_sleduyushchaya).getTime() : 0,
      ),
    );
  }
  return {
    id: Number(r.a_id),
    status: r.a_status!,
    prichina: r.a_prichina,
    neudach: Number(r.a_neudach ?? 0),
    sleduyushchayaPopytka: r.a_sleduyushchaya ? new Date(r.a_sleduyushchaya) : null,
    vPuti: r.a_v_puti !== null,
    otpravlenAt: r.a_otpravlen ? new Date(r.a_otpravlen) : null,
    napomnilSummaKop: r.a_summa === null ? null : Number(r.a_summa),
    summaKop,
    sleduyushcheeSpisanie: kogda,
    vPutiSummaKop: r.a_v_puti_kop === null ? null : Number(r.a_v_puti_kop),
    vPutiKogda: r.a_otpravlen ? new Date(r.a_otpravlen) : r.a_v_puti_sozdan ? new Date(r.a_v_puti_sozdan) : null,
    neudachaKogda: r.a_neudacha_at ? new Date(r.a_neudacha_at) : null,
  };
}

export async function moiZakazy(userId: number): Promise<ZakazKlientu[]> {
  const rows = await zapros<{
    id: string;
    kind: 'plan' | 'certificate';
    plan_id: string;
    period: number;
    status: Status;
    total_kop: string;
    balance_kop: string;
    money_kop: string;
    source: string;
    created_at: Date;
    cancel_reason: string | null;
    cancel_slot_idx: number | null;
    secrets_wiped_at: Date | null;
    expires_at: Date | null;
    otmena_podpiski: boolean;
    otzyv: 'moderaciya' | 'opublikovan' | 'skryt' | null;
    a_id: string | null;
    a_status: StatusAvto | null;
    a_prichina: PrichinaAvto | null;
    a_neudach: number | null;
    a_sleduyushchaya: Date | null;
    a_v_puti: string | null;
    a_otpravlen: Date | null;
    a_summa: string | null;
    a_est_pismo: boolean | null;
    a_napomnil_at: Date | null;
    a_v_puti_kop: string | null;
    a_v_puti_sozdan: Date | null;
    a_neudacha_at: Date | null;
  }>(
    /* ⚠️ ОТМЕНЁННЫЕ САМИМ ПОКУПАТЕЛЕМ СЮДА НЕ ПОПАДАЮТ ВОВСЕ —
       постановка тридцать шестой итерации: «карточка плавно
       схлопывается и больше не показывается, причину не пишем».
       Отменённые ОПЕРАТОРОМ остаются: там есть что сказать —
       причина и деньги на балансе. */
    `select shop_order.id, shop_order.kind, shop_order.plan_id, shop_order.period, shop_order.status, total_kop, balance_kop,
            money_kop, source, shop_order.created_at, cancel_reason, cancel_slot_idx, secrets_wiped_at, expires_at,
            exists (select 1 from sub_cancel t where t.order_id = shop_order.id) as otmena_podpiski,
            (select z.status from otzyv z where z.order_id = shop_order.id) as otzyv,
            a.id as a_id, a.status as a_status, a.prichina as a_prichina, a.neudach as a_neudach,
            a.sleduyushchaya_popytka as a_sleduyushchaya, a.platezh_v_puti as a_v_puti,
            a.otpravlen_at as a_otpravlen, a.napomnil_summa_kop as a_summa,
            /* Письмо о списании ушло ЗА ЭТОТ ЦИКЛ: защёлка хранит
               московскую дату окончания, о которой напомнили. */
            a.napomnil_za_cikl = (shop_order.expires_at at time zone 'Europe/Moscow')::date as a_est_pismo,
            a.napomnil_at as a_napomnil_at,
            vp.amount_kop as a_v_puti_kop, vp.created_at as a_v_puti_sozdan,
            (select max(f.created_at) from payment f
              where f.avtoplatezh_id = a.id and f.kind = 'avto' and f.status = 'failed'
                and f.avto_cikl_order_id = a.order_id) as a_neudacha_at
       from shop_order
       left join avtoplatezh a on a.order_id = shop_order.id
       left join payment vp on vp.id = a.platezh_v_puti
      where shop_order.user_id = $1 and not cancelled_by_client
      order by shop_order.created_at desc limit 100`,
    [userId],
  );
  if (!rows.length) return [];
  const slots = await zapros<{
    order_id: string;
    idx: number;
    mode: Rezhim;
    in_login_enc: string | null;
    out_login_enc: string | null;
    out_mail_pass_enc: string | null;
    out_password_enc: string | null;
    done_at: Date | null;
  }>(
    `select order_id, idx, mode, in_login_enc, out_login_enc, out_mail_pass_enc, out_password_enc, done_at
       from order_slot where order_id = any($1::bigint[]) order by idx`,
    [rows.map((r) => Number(r.id))],
  );
  const spisok = await katalog();

  return rows.map((r) => {
    const tarif = naytiTarif(spisok, r.plan_id);
    const svoi = slots.filter((s) => s.order_id === r.id);
    const total = Number(r.total_kop);
    const bal = Number(r.balance_kop);
    const mon = Number(r.money_kop);
    return {
      id: Number(r.id),
      kind: r.kind,
      planId: r.plan_id,
      period: r.period,
      /* ⚠️ У СЕРТИФИКАТА ТЕПЕРЬ ЕСТЬ ТАРИФ, и без него строка в кабинете
         не говорит, что именно куплено (Р-93). */
      nazvanie:
        r.kind === 'certificate'
          ? `Сертификат в подарок: ${tarif?.name ?? r.plan_id}`
          : (tarif?.name ?? r.plan_id),
      srok: srokKratko(r.period),
      status: r.status,
      statusSlovami: STATUS_SLOVAMI[r.status],
      totalKop: total,
      balanceKop: bal,
      moneyKop: mon,
      kDoplate: Math.max(0, total - bal - mon),
      poSertifikatu: r.source === 'certificate',
      sozdan: new Date(r.created_at),
      konchaetsya: r.expires_at ? new Date(r.expires_at) : null,
      /* ⚠️ АДРЕС ПОДСТАВЛЯЕТСЯ ЗДЕСЬ, А В БАЗЕ ЕГО НЕТ (Р-151).
         В `cancel_reason` лежит причина без адреса, а рядом — НОМЕР
         аккаунта, и стоит он только у тех причин, которым адрес
         нужен. Открытая почта в самой колонке пережила бы
         семидневное стирание шифротекстов и уехала бы в ночную
         копию, а в карточке админки её увидел бы любой сотрудник:
         `cancelReason` там не закрыт признаком `moy` (закон 35).
         Здесь читатель законный — владелец заказа, и почта уже
         расшифрована строкой ниже, для его же карточки участника.
         Шифротекст стёрт — остаётся причина без адреса: мы к этому
         времени его и правда забыли. */
      prichinaOtmeny: (() => {
        if (!r.cancel_reason) return null;
        if (r.cancel_slot_idx === null) return { tekst: r.cancel_reason, adres: null };
        const pochta = poprobovatRasshifrovat(
          svoi.find((x) => x.idx === Number(r.cancel_slot_idx))?.in_login_enc ?? null,
        );
        return { tekst: r.cancel_reason, adres: pochta };
      })(),
      otmenaPodpiski: r.otmena_podpiski,
      sekretyStyorty: Boolean(r.secrets_wiped_at),
      otzyv: r.otzyv,
      avtoProdlenie: r.source === 'avto',
      avto: r.a_id && r.a_status ? avtoKlientu(r, tarif ? cenaTarifa(tarif, r.period) : null) : null,
      slots: svoi.map((s) => ({
        idx: s.idx,
        mode: s.mode,
        gotov: Boolean(s.done_at),
        pochta: poprobovatRasshifrovat(s.in_login_enc),
        login: poprobovatRasshifrovat(s.out_login_enc),
        mailPass: poprobovatRasshifrovat(s.out_mail_pass_enc),
        spotifyPass: poprobovatRasshifrovat(s.out_password_enc),
      })),
    };
  });
}

/**
 * Почты участников заказа — ВЛАДЕЛЬЦУ, для подстановки в продление.
 *
 * ⚠️ ЧИТАТЕЛЬ ТОТ ЖЕ, ЧТО У КАБИНЕТА: владелец заказа и его
 * собственные данные. Отдельной двери для этого не заводится —
 * запрос сам проверяет `user_id`, и чужой заказ отдаёт пустой список.
 * Ради этого ссылка в письме и несёт НОМЕР ЗАКАЗА, а не адрес:
 * адрес остаётся в базе шифротекстом и в письмо не попадает.
 */
export async function pochtyZakaza(userId: number, zakaz: number): Promise<string[]> {
  const rows = await zapros<{ in_login_enc: string | null }>(
    `select s.in_login_enc
       from order_slot s join shop_order o on o.id = s.order_id
      where s.order_id = $1 and o.user_id = $2 order by s.idx`,
    [zakaz, userId],
  );
  return rows.map((r) => poprobovatRasshifrovat(r.in_login_enc) ?? '');
}

/**
 * У продлеваемого заказа включён автоплатёж — день окончания, от
 * которого он спишет; `null` — не включён или заказ чужой (пятьдесят
 * четвёртая итерация, поправка money-10).
 *
 * Оформление по ссылке «Продлить» (`renew=`) называет это прямо:
 * иначе человек оплатил бы руками то, что и так спишется само.
 */
export async function avtoNaProdlevaemom(userId: number, zakaz: number): Promise<Date | null> {
  const r = await odna<{ expires_at: Date | null }>(
    `select o.expires_at
       from avtoplatezh a join shop_order o on o.id = a.order_id
      where a.order_id = $1 and a.user_id = $2 and a.status = 'vklyuchen' and o.status = 'done'`,
    [zakaz, userId],
  );
  return r?.expires_at ? new Date(r.expires_at) : null;
}

/**
 * ВСЕ ПОЧТЫ, КОТОРЫЕ ЧЕЛОВЕК УЖЕ УКАЗЫВАЛ В СВОИХ ЗАКАЗАХ.
 *
 * Постановка сорок второй итерации: на продлении под полем почты
 * выезжает список — нажатие подставляет адрес.
 *
 * ⚠️ ЧИТАТЕЛЬ ТОТ ЖЕ, ЧТО У КАБИНЕТА: владелец и его собственные
 * данные (закон 35). Ни новой двери, ни нового места расшифровки
 * не заводится — запрос сам проверяет `user_id`.
 *
 * ⚠️ ТОЛЬКО ПОЧТА. Пароли в подсказку не попадают ни при каких
 * условиях: их ценность ровно та же, что у пароля от аккаунта
 * Spotify, и выпадающий список был бы третьим местом, где открытый
 * пароль оказывается на экране.
 *
 * ⚠️ РАЗЛИЧНЫЕ СЧИТАЮТСЯ ПОСЛЕ РАСШИФРОВКИ, А НЕ `distinct` В SQL.
 * AES-GCM со случайным вектором двух одинаковых адресов одинаковыми
 * не делает (то же, что в Р-115), поэтому `distinct in_login_enc`
 * отдал бы одну и ту же почту столько раз, сколько заказов.
 */
export async function pochtyKlienta(userId: number, skolko = 8): Promise<string[]> {
  const rows = await zapros<{ in_login_enc: string | null }>(
    `select s.in_login_enc
       from order_slot s join shop_order o on o.id = s.order_id
      where o.user_id = $1 and s.in_login_enc is not null
      order by o.created_at desc, s.idx
      limit 60`,
    [userId],
  );
  const vidno: string[] = [];
  for (const r of rows) {
    const p = poprobovatRasshifrovat(r.in_login_enc);
    if (!p) continue;
    if (vidno.some((x) => x.toLowerCase() === p.toLowerCase())) continue;
    vidno.push(p);
    if (vidno.length >= skolko) break;
  }
  return vidno;
}

export async function balans(userId: number): Promise<number> {
  const r = await odna<{ balance_kop: string }>('select balance_kop from app_user where id = $1', [userId]);
  return Number(r?.balance_kop ?? 0);
}

/** Строка истории баланса — то, что видит клиент (Р-168). */
export type DvizhenieBalansa = {
  kogda: string;
  deltaKop: number;
  /** Человеческое название движения: без номера заказа (закон 48). */
  chto: string;
};

/**
 * ИСТОРИЯ БАЛАНСА в кабинете.
 *
 * ⚠️ ПРИЧИНА В `balance_move` — СЛОВО ДЛЯ ЖУРНАЛА, а клиенту нужна
 * фраза, и номера заказа в ней быть не должно (закон 48): заказ
 * называется тарифом и сроком, как везде в кабинете. Незнакомая
 * причина показывается как есть — лучше честное служебное слово,
 * чем пустая строка.
 */
export async function istoriyaBalansa(userId: number, skolko = 20): Promise<DvizhenieBalansa[]> {
  const rows = await zapros<{
    created_at: Date;
    delta_kop: string;
    reason: string;
    plan_id: string | null;
    period: number | null;
    kind: 'plan' | 'certificate' | null;
  }>(
    `select m.created_at, m.delta_kop, m.reason, o.plan_id, o.period, o.kind
       from balance_move m
       left join shop_order o on o.id = m.order_id
      where m.user_id = $1
      order by m.created_at desc, m.id desc
      limit $2`,
    [userId, skolko],
  );
  if (!rows.length) return [];
  const spisok = await katalog();
  return rows.map((r) => {
    const zakaz = r.plan_id
      ? `${r.kind === 'certificate' ? 'сертификат, ' : ''}${naytiTarif(spisok, r.plan_id)?.name ?? r.plan_id}, ${srokKratko(r.period ?? 1)}`
      : '';
    const chto =
      r.reason === PRICHINA_POPOLNENIYA
        ? 'Пополнение баланса'
        : r.reason === 'оплата заказа'
          ? `Оплата заказа${zakaz ? ` — ${zakaz}` : ''}`
          : r.reason === 'возврат за отменённый заказ'
            ? `Возврат за отменённый заказ${zakaz ? ` — ${zakaz}` : ''}`
            : r.reason === 'оплата по заказу, который уже не ждал денег'
              ? /* ⚠️ НЕ «ПОСЛЕ ОТМЕНЫ»: путей сюда два, и второй — второй
                   оплаченный счёт по заказу, который никто не отменял
                   (кнопка «Оплатить» заводит новый счёт каждым нажатием). */
                `Деньги по заказу, который их уже не ждал${zakaz ? ` — ${zakaz}` : ''}`
              : r.reason === PRICHINA_AVTO_SPISANIE
                ? `Автоплатёж${zakaz ? ` — ${zakaz}` : ''}`
                : r.reason === PRICHINA_AVTO_NA_BALANS
                  ? `${PRICHINA_AVTO_NA_BALANS}${zakaz ? ` — ${zakaz}` : ''}`
                  : r.reason;
    return { kogda: new Date(r.created_at).toISOString(), deltaKop: Number(r.delta_kop), chto };
  });
}

/* ── Админка ───────────────────────────────────────────────────── */

/**
 * ⚠️ ТАРИФ И СРОК УЕЗЖАЮТ В АДМИНКУ СЫРЫМИ — `planId` и число
 * месяцев, — А НЕ ГОТОВОЙ РУССКОЙ СТРОКОЙ (тридцать девятая
 * итерация). Админка двуязычная, и названия тарифов в ней — такие же
 * надписи интерфейса, как «Queue» и «Prices»: переводит их страница,
 * зная свой язык, ровно как любой другой ключ (закон 40). Отдай мы
 * отсюда готовую строку — половина английской таблицы осталась бы
 * русской, и починить это было бы нечем.
 */
export type StrokaOcheredi = {
  id: number;
  planId: string;
  people: number;
  period: number;
  status: Status;
  paidAt: string | null;
  createdAt: string;
  /**
   * Почта держателя. `null` — СПРАШИВАЛ НЕ АДМИНИСТРАТОР.
   *
   * ⚠️ С СОРОК ШЕСТОЙ ИТЕРАЦИИ ЭТО ПОЛЕ АДМИНИСТРАТОРСКОЕ, и это
   * отменяет прежнее исключение (Р-153): до неё почта держателя
   * ездила в очередь ВСЕМ сотрудникам с двадцать седьмой итерации
   * и стояла в колонке состояния — «взял: …». Постановка сорок
   * шестой прямо говорит: «Подписи „взял: {почта}" у оператора нет
   * нигде». Спрятать её разметкой было бы мало — адрес всё равно
   * лежал бы в разметке страницы и в JSON самообновления (Р-148).
   */
  operator: string | null;
  /**
   * Заказ взят ТЕМ, кто спрашивает.
   *
   * ⚠️ СЧИТАЕТ ЭТО СЕРВЕР, А НЕ СРАВНЕНИЕ ПОЧТ НА СТРАНИЦЕ. Прежде
   * очередь сама сличала `operator` со своей почтой; теперь почты
   * у оператора нет вовсе, и сличать было бы нечего.
   */
  moy: boolean;
  bySertificate: boolean;
  /**
   * Заказ создан автоплатежом — «Автопродление» (пятьдесят четвёртая
   * итерация). ⚠️ ВИДНО И ОПЕРАТОРУ: ему важно, что это продление,
   * которое клиент в этот раз руками не заказывал.
   */
  avtoProdlenie: boolean;
  /**
   * Это не заказ, а задача «Отмена подписки» (сорок девятая итерация).
   * Номер — номер того же заказа: задача одна на заказ и открывается
   * его же карточкой. `paidAt` у неё — время, когда её поставили.
   */
  otmena: boolean;
  /**
   * Заказ ПРЕДЛОЖЕН ТОМУ, кто спрашивает, — и до какого времени
   * (пятьдесят четвёртая итерация). Оператору это единственное, что
   * он знает о раздаче: «Предложен вам до 12:15», без чужих имён
   * (поправка concurrency-15).
   */
  predlozhenVam: boolean;
  offerUntil: string | null;
  /**
   * Состояние раздачи — ТОЛЬКО АДМИНИСТРАТОРУ, оператору `null`:
   * в нём почта того, кому предложено (поправка concurrency-15,
   * то же правило, что у `operator`).
   */
  razdacha: RazdachaVOcheredi | null;
};

/** Раздача заказа глазами администратора. `null` в `sost` — заказ не раздавался. */
export type RazdachaVOcheredi = {
  sost: 'predlozhen' | 'zhdyot' | 'obshchaya' | null;
  /** Кому предложено — почта (данные, `Bukvalno`). */
  komu: string | null;
  /** До какого времени предложено. */
  do: string | null;
  /**
   * Сейчас нерабочее время — «ждёт 10:00», а не «ждёт раздачи».
   * Час считает СЕРВЕР по Москве (закон 49), а не часы устройства.
   */
  noch: boolean;
};

/**
 * Очередь.
 *
 * ⚠️ ЧТО ВИДНО — РЕШАЕТ ОДНО УСЛОВИЕ ИЗ `dostup.ts`, а не разметка:
 * оператору не показывается вовсе ни заказ, взятый другим, ни заказ
 * тарифа, которого ему не разрешили (постановка сорок шестой
 * итерации, пункты 2 и 3).
 */
export async function ochered(d: Dostup): Promise<StrokaOcheredi[]> {
  const v = usloviyeVidimosti(d, 'o', 1);
  const rows = await zapros<{
    id: string;
    plan_id: string;
    period: number;
    status: Status;
    source: string;
    paid_at: Date | null;
    created_at: Date;
    operator: string | null;
    operator_id: string | null;
    slots: string;
    razdacha: 'predlozhen' | 'zhdyot' | 'obshchaya' | null;
    offer_staff_id: string | null;
    offer_until: Date | null;
    komu: string | null;
  }>(
    `select o.id, o.plan_id, o.period, o.status, o.source, o.paid_at, o.created_at,
            f.email as operator, o.operator_id,
            (select count(*) from order_slot s where s.order_id = o.id)::text as slots,
            o.razdacha, o.offer_staff_id, o.offer_until, k.email as komu
       from shop_order o
       left join staff f on f.id = o.operator_id
       left join staff k on k.id = o.offer_staff_id
      where o.status in ('paid', 'in_work')${v.uslovie}
      order by o.paid_at asc nulls last, o.id asc
      limit 200`,
    v.params,
  );
  const noch = !rabocheeVremya();
  const zakazy: StrokaOcheredi[] = rows.map((r) => {
    const svobodnyy = r.status === 'paid' && r.operator_id === null;
    const predlozhen = svobodnyy && r.razdacha === 'predlozhen';
    const predlozhenVam = predlozhen && r.offer_staff_id !== null && Number(r.offer_staff_id) === d.staffId;
    const doKogda = r.offer_until ? new Date(r.offer_until).toISOString() : null;
    return {
      id: Number(r.id),
      planId: r.plan_id,
      people: Number(r.slots),
      period: r.period,
      status: r.status,
      paidAt: r.paid_at ? new Date(r.paid_at).toISOString() : null,
      createdAt: new Date(r.created_at).toISOString(),
      operator: d.admin ? r.operator : null,
      moy: r.operator_id !== null && Number(r.operator_id) === d.staffId,
      bySertificate: r.source === 'certificate',
      avtoProdlenie: r.source === 'avto',
      otmena: false,
      predlozhenVam,
      offerUntil: predlozhenVam ? doKogda : null,
      /* У взятого заказа раздачи нет: состояние, если оно и осталось
         (откат на старый код), тик снимет, а показывать его незачем. */
      razdacha: d.admin
        ? {
            sost: svobodnyy ? r.razdacha : null,
            komu: predlozhen ? r.komu : null,
            do: predlozhen ? doKogda : null,
            noch,
          }
        : null,
    };
  });

  /* ⚠️ ЗАДАЧИ «ОТМЕНА ПОДПИСКИ» ИДУТ В ТУ ЖЕ ОЧЕРЕДЬ (сорок девятая
     итерация): «попадает в очередь тому оператору, который выполнял
     заказ… или в общую очередь». Видимость — то же правило, что
     у заказа: своя всегда, свободная — при разрешённой паре. Статус
     в строке — «свободна» или «взята», тем же словом, что у заказа:
     `paid` и `in_work`, — чтобы очередь рисовала её теми же значками. */
  const vt = usloviyeVidimostiOtmeny(d, 't', 'o', 1);
  const zadachi = await zapros<{
    id: string;
    plan_id: string;
    period: number;
    created_at: Date;
    operator: string | null;
    operator_id: string | null;
    slots: string;
  }>(
    `select o.id, o.plan_id, o.period, t.created_at, f.email as operator, t.operator_id,
            (select count(*) from order_slot s where s.order_id = o.id)::text as slots
       from sub_cancel t
       join shop_order o on o.id = t.order_id
       left join staff f on f.id = t.operator_id
      where t.done_at is null${vt.uslovie}
      order by t.created_at asc
      limit 200`,
    vt.params,
  );
  const otmeny: StrokaOcheredi[] = zadachi.map((r) => ({
    id: Number(r.id),
    planId: r.plan_id,
    people: Number(r.slots),
    period: r.period,
    status: r.operator_id ? 'in_work' : 'paid',
    paidAt: new Date(r.created_at).toISOString(),
    createdAt: new Date(r.created_at).toISOString(),
    operator: d.admin ? r.operator : null,
    moy: r.operator_id !== null && Number(r.operator_id) === d.staffId,
    bySertificate: false,
    avtoProdlenie: false,
    otmena: true,
    predlozhenVam: false,
    offerUntil: null,
    razdacha: d.admin ? { sost: null, komu: null, do: null, noch } : null,
  }));
  /* Отмена подписки стоит ПЕРВОЙ: пока она не сделана, Spotify
     продолжает списывать за подписку, которую мы уже отменили. */
  return [...otmeny, ...zakazy];
}

/**
 * ИСТОРИЯ РАБОТЫ НАД ЗАКАЗОМ: кто взял, кто вернул, кто выполнил,
 * кто отменил — по порядку.
 *
 * ⚠️ ЧИТАЕТСЯ ИЗ ЖУРНАЛА, А НЕ ВЫВОДИТСЯ ИЗ `operator_id`. Колонка
 * заказа хранит ТЕКУЩЕГО держателя и обнуляется при возврате
 * в очередь: у заказа, побывавшего у двоих, она помнит только
 * последнего. Журнал помнит обоих (миграция 012).
 *
 * ⚠️ ПОЧТА ПОДСТАВЛЯЕТСЯ ЗДЕСЬ, JOIN'ОМ, А В ЖУРНАЛЕ ЛЕЖИТ НОМЕР.
 * Один источник у почты — строка `staff`; копия в журнале разошлась
 * бы с ней на первой же правке (то же, что с номером аккаунта
 * в причине отмены, Р-151).
 */
export type Sobytie = {
  vid:
    | 'vzyal'
    | 'vernul'
    | 'vypolnil'
    | 'otmenil'
    | 'otmena_zaproshena'
    | 'podpiska_otmenena'
    /* ⚠️ ТРИ ГЛАГОЛА РАЗДАЧИ (пятьдесят четвёртая итерация, миграция 020).
       У `predlozhen` и `ne_vzyal` сотрудник — тот, КОМУ предлагали;
       у `naznachil` — назначивший администратор, а кому — `komu`. */
    | 'predlozhen'
    | 'ne_vzyal'
    | 'naznachil';
  /**
   * Почта сотрудника. `null` значит «сотрудника не было»: так
   * выглядит отмена САМИМ ПОКУПАТЕЛЕМ, и надпись к ней своя.
   * «Данных нет» это НЕ значит — у заказа без истории событий нет
   * вовсе, и список приходит пустым.
   */
  email: string | null;
  /** Кому назначил администратор (`naznachil`); у прочих событий `null`. */
  komu: string | null;
  /** Момент в ISO; по Москве его раскладывает страница. */
  kogda: string;
};

async function istoriyaZakaza(zakaz: number): Promise<Sobytie[]> {
  const rows = await zapros<{ vid: Sobytie['vid']; email: string | null; komu: string | null; created_at: Date }>(
    `select e.vid, f.email, k.email as komu, e.created_at
       from order_event e
       left join staff f on f.id = e.staff_id
       left join staff k on k.id = e.komu_staff_id
      where e.order_id = $1
      order by e.created_at, e.id`,
    [zakaz],
  );
  return rows.map((r) => ({
    vid: r.vid,
    email: r.email,
    komu: r.komu,
    kogda: new Date(r.created_at).toISOString(),
  }));
}

/** Одно предложение раздачи: кому, когда, до какого времени и чем кончилось. */
export type Predlozhenie = {
  komu: string | null;
  kogda: string;
  do: string;
  /** `null` — предложение ещё открыто. */
  ishod: 'vzyal' | 'istyok' | 'snyat' | 'perenaznachen' | 'ne_dostavleno' | null;
  zakryto: string | null;
};

/**
 * РАЗДАЧА В КАРТОЧКЕ ЗАКАЗА — только администратору (пятьдесят
 * четвёртая итерация): текущее состояние, история предложений
 * и список операторов для «Назначить».
 */
export type RazdachaKartochki = {
  sost: 'predlozhen' | 'zhdyot' | 'obshchaya' | null;
  komu: string | null;
  do: string | null;
  predlozheniya: Predlozhenie[];
  /** Можно ли назначить: заказ на тариф, оплачен или в работе. */
  mozhnoNaznachit: boolean;
  /** Действующие операторы — кому вообще можно назначить. */
  operatory: { id: number; email: string }[];
};

async function razdachaKartochki(zakaz: number, kind: string, status: Status): Promise<RazdachaKartochki> {
  const [z, predl, oper] = await Promise.all([
    odna<{ razdacha: RazdachaKartochki['sost']; komu: string | null; offer_until: Date | null }>(
      `select o.razdacha, k.email as komu, o.offer_until
         from shop_order o left join staff k on k.id = o.offer_staff_id
        where o.id = $1`,
      [zakaz],
    ),
    zapros<{ email: string | null; created_at: Date; until: Date; ishod: Predlozhenie['ishod']; closed_at: Date | null }>(
      `select f.email, p.created_at, p.until, p.ishod, p.closed_at
         from order_offer p left join staff f on f.id = p.staff_id
        where p.order_id = $1
        order by p.id`,
      [zakaz],
    ),
    zapros<{ id: string; email: string }>(
      `select id, email from staff where role = 'operator' and not disabled order by email`,
    ),
  ]);
  const svobodnyy = status === 'paid';
  const sost = svobodnyy ? (z?.razdacha ?? null) : null;
  return {
    sost,
    komu: sost === 'predlozhen' ? (z?.komu ?? null) : null,
    do: sost === 'predlozhen' && z?.offer_until ? new Date(z.offer_until).toISOString() : null,
    predlozheniya: predl.map((p) => ({
      komu: p.email,
      kogda: new Date(p.created_at).toISOString(),
      do: new Date(p.until).toISOString(),
      ishod: p.ishod,
      zakryto: p.closed_at ? new Date(p.closed_at).toISOString() : null,
    })),
    mozhnoNaznachit: kind === 'plan' && (status === 'paid' || status === 'in_work'),
    operatory: oper.map((o) => ({ id: Number(o.id), email: o.email })),
  };
}

export type SlotOperatoru = {
  id: number;
  idx: number;
  mode: Rezhim;
  gotov: boolean;
  recoverySent: boolean;
  /** Официальная дата окончания из Spotify, «ГГГГ-ММ-ДД». */
  endsAt: string | null;
  /** Открытый текст: только оператору, который взял ЭТОТ заказ. */
  clientLogin: string | null;
  clientPassword: string | null;
  outLogin: string | null;
  outMailPass: string | null;
  outPassword: string | null;
  /** Шаг задачи «Отмена подписки» на этом аккаунте пройден. */
  podpiskaOtmenena: boolean;
};

/**
 * Задача «Отмена подписки» у заказа (сорок девятая итерация).
 *
 * ⚠️ ПОЧТА ДЕРЖАТЕЛЯ — ТОЛЬКО АДМИНИСТРАТОРУ, как у заказа
 * (Р-155): оператору приходит `null`, а «своя или чужая» решает
 * признак `moya`, посчитанный сервером.
 */
export type OtmenaPodpiski = {
  operatorEmail: string | null;
  moya: boolean;
  svobodna: boolean;
  zakryta: boolean;
};

export type ZakazOperatoru = {
  id: number;
  planId: string;
  period: number;
  status: Status;
  clientEmail: string;
  operatorId: number | null;
  operatorEmail: string | null;
  bySertificate: boolean;
  /**
   * Заказ создан автоплатежом — «Автопродление». Видно и оператору
   * (пятьдесят четвёртая итерация): работа та же, что у продления,
   * но клиент её в этот раз руками не заказывал.
   */
  avtoProdlenie: boolean;
  /**
   * Подписка автоплатежа этого заказа. `null` — подписки нет ИЛИ
   * СПРАШИВАЛ НЕ АДМИНИСТРАТОР: исполнителю этот блок не нужен
   * (SPEC, раздел 4), и, как с деньгами, наружу не уходит само число.
   */
  avto: AvtoAdminu | null;
  /**
   * Деньги. `null` — СПРАШИВАЛ НЕ АДМИНИСТРАТОР.
   *
   * ⚠️ ИСПОЛНИТЕЛЮ ИХ НЕ ВИДНО ВОВСЕ с сорок второй итерации
   * (постановка), и «не показываем» сделано НЕ РАЗМЕТКОЙ: наружу
   * не уходит само число. Спрячь мы строку стилем — сумма всё равно
   * лежала бы в разметке страницы, то есть была бы видна всякому,
   * кто её откроет.
   */
  totalKop: number | null;
  balanceKop: number | null;
  moneyKop: number | null;
  /**
   * Промокод заказа и скидка по нему (Р-167) — ТОЛЬКО АДМИНИСТРАТОРУ,
   * как и деньги заказа: это та же величина «сколько заплатил».
   * `null` у кода — промокода не было или смотрит не администратор.
   */
  promoKod: string | null;
  promoSkidkaKop: number | null;
  cancelReason: string | null;
  /**
   * История работы. `null` — СПРАШИВАЛ НЕ АДМИНИСТРАТОР.
   *
   * ⚠️ ИСПОЛНИТЕЛЮ ЧУЖИХ ПОЧТ НЕ ВИДНО (постановка, пункт 5), и,
   * как с деньгами заказа (Р-148), «не показываем» сделано НЕ
   * РАЗМЕТКОЙ: наружу не уходит сам список. Спрячь мы блок стилем —
   * адреса всё равно лежали бы в разметке страницы.
   */
  istoriya: Sobytie[] | null;
  /**
   * Раздача в Telegram. `null` — СПРАШИВАЛ НЕ АДМИНИСТРАТОР: в ней
   * почты операторов (поправка concurrency-15, как и история).
   */
  razdacha: RazdachaKartochki | null;
  secretsWiped: boolean;
  /** Исполнитель смотрит свой заказ, закрытый больше семи дней назад: доступы ему уже не показываются. */
  oknoIsteklo: boolean;
  /**
   * Дата, которой заранее заполняется поле окончания: сегодня плюс
   * срок заказа, «ГГГГ-ММ-ДД».
   *
   * ⚠️ СЧИТАЕТ ЕЁ СЕРВЕР, А НЕ БРАУЗЕР. Спроси мы часы устройства —
   * оператор из другого пояса получил бы другую подстановку (то же
   * правило, что у плашки рабочего времени, закон 49).
   */
  raschyotnayaData: string;
  /**
   * Дата окончания доступа по заказу, «ГГГГ-ММ-ДД» (`expires_at`).
   * У нового аккаунта своей даты нет, и окончание по нему — это она.
   */
  konchaetsya: string | null;
  /** Задача «Отмена подписки». `null` — подписку не отменяли. */
  otmena: OtmenaPodpiski | null;
  /**
   * Доступы в карточке расшифрованы ТОМУ, КТО СМОТРИТ: держателю
   * заказа в работе, держателю открытой задачи или администратору
   * у выполненного заказа (сорок девятая итерация, пункт 8).
   */
  dostupyVidny: boolean;
  /**
   * Откуда пришёл заказ. Пары «имя — значение» в порядке `METKI`;
   * пустых меток тут нет вовсе, поэтому пустой список означает
   * «пришёл без меток».
   *
   * ⚠️ ЭТО ДАННЫЕ, А НЕ НАДПИСЬ, и переводу они не подлежат (закон 40):
   * `utm_source=yandex` выглядит одинаково на любом языке админки.
   */
  utm: { imya: string; znachenie: string }[];
  slots: SlotOperatoru[];
};

/**
 * Подписка автоплатежа в карточке заказа — АДМИНИСТРАТОРУ (пятьдесят
 * четвёртая итерация): статус, способ первой оплаты, следующее
 * списание, неудачи, платёж в пути.
 *
 * ⚠️ ПОДПИСКА ЕЗДИТ ПО ЦЕПОЧКЕ ЗАКАЗОВ: после удачного продления она
 * стоит уже на новом заказе. Поэтому в карточке старого заказа — та же
 * подписка с пометкой, на каком заказе она сейчас (`naZakaze`), а
 * кнопка «Отключить» работает с подпиской, где бы она ни стояла.
 */
export type AvtoAdminu = {
  id: number;
  status: StatusAvto;
  prichina: PrichinaAvto | null;
  /** Способ первой оплаты как пришёл: «<PaymentMethod>/<IncCurrLabel>». */
  sposob: string | null;
  /** Материнский счёт (PreviousInvoiceID). */
  matPaymentId: number | null;
  /** Заказ, на котором подписка стоит сейчас. */
  naZakaze: number;
  neudach: number;
  /** Назначенный повтор, ISO. */
  sleduyushchayaPopytka: string | null;
  /** Когда и сколько спишется — те же числа, что у кабинета. */
  sleduyushcheeSpisanie: string | null;
  summaKop: number | null;
  /** Дочерний счёт «в пути»: номер, сумма, когда ушёл запрос. */
  vPuti: number | null;
  vPutiSummaKop: number | null;
  vPutiOtpravlen: string | null;
  soglasieAt: string;
  otklyuchenAt: string | null;
};

/**
 * Карточка заказа для админки.
 *
 * `moy` — заказ взят ЭТИМ оператором. Только при `moy` наружу уходят
 * расшифрованные пароли; остальным видна структура заказа и ничего
 * больше.
 *
 * ⚠️ `null` ЗНАЧИТ «НЕ ПОКАЗЫВАЕМ», А НЕ «ЗАКАЗА НЕТ». С сорок
 * шестой итерации сюда же попадает заказ, взятый ДРУГИМ оператором,
 * и заказ чужого тарифа: постановка требует, чтобы по прямой ссылке
 * оператор увидел «Заказ недоступен» — то есть одно и то же и в том
 * случае, когда заказа нет вовсе. Различать их на экране значило бы
 * отвечать на вопрос «а такой заказ вообще есть?», которого никто
 * не задавал; администратору, у которого условие пустое, `null`
 * по-прежнему означает ровно «не найден», и страница так и говорит.
 *
 * ⚠️ УСЛОВИЕ ТО ЖЕ САМОЕ, ЧТО У ОЧЕРЕДИ, и берётся оно из того же
 * места (`dostup.ts`). Своя проверка здесь разошлась бы с очередью
 * на первой же правке — и разошлась бы молча.
 */
export async function zakazDlyaAdminki(id: number, d: Dostup): Promise<ZakazOperatoru | null> {
  const admin = d.admin;
  const staffId = d.staffId;
  /* ⚠️ С СОРОК ДЕВЯТОЙ ИТЕРАЦИИ УСЛОВИЕ ЗНАЕТ И ПРО ЗАДАЧУ «ОТМЕНА
     ПОДПИСКИ»: её держатель может не быть держателем заказа, и без
     этого он не открыл бы свою же задачу (`dostup.ts`). */
  const v = usloviyeVidimostiSZadachey(d, 'o', 2);
  const r = await odna<{
    id: string;
    plan_id: string;
    period: number;
    status: Status;
    source: string;
    kind: string;
    email: string;
    operator_id: string | null;
    operator_email: string | null;
    total_kop: string;
    balance_kop: string;
    money_kop: string;
    promo_kod: string | null;
    promo_skidka_kop: string;
    cancel_reason: string | null;
    secrets_wiped_at: Date | null;
    v_okne: boolean;
    raschyot: Date;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_term: string | null;
    utm_content: string | null;
    expires_at: Date | null;
    t_order: string | null;
    t_operator_id: string | null;
    t_operator_email: string | null;
    t_done_at: Date | null;
  }>(
    `select o.id, o.plan_id, o.period, o.status, o.source, o.kind, u.email, o.expires_at,
            t.order_id as t_order, t.operator_id as t_operator_id, tf.email as t_operator_email, t.done_at as t_done_at,
            o.operator_id, f.email as operator_email,
            o.total_kop, o.balance_kop, o.money_kop, o.promo_kod, o.promo_skidka_kop,
            o.cancel_reason, o.secrets_wiped_at,
            (o.closed_at is null or o.closed_at > now() - interval '7 days') as v_okne,
            (now() + (o.period || ' months')::interval)::date as raschyot,
            o.utm_source, o.utm_medium, o.utm_campaign, o.utm_term, o.utm_content
       from shop_order o
       join app_user u on u.id = o.user_id
       left join staff f on f.id = o.operator_id
       left join sub_cancel t on t.order_id = o.id
       left join staff tf on tf.id = t.operator_id
      where o.id = $1${v.uslovie}`,
    [id, ...v.params],
  );
  if (!r) return null;
  const moy = r.operator_id !== null && Number(r.operator_id) === staffId;
  const otmena: OtmenaPodpiski | null = r.t_order
    ? {
        operatorEmail: admin ? r.t_operator_email : null,
        moya: r.t_operator_id !== null && Number(r.t_operator_id) === staffId,
        svobodna: r.t_operator_id === null && !r.t_done_at,
        zakryta: Boolean(r.t_done_at),
      }
    : null;
  /* ⚠️ КОМУ РАСШИФРОВЫВАЕМ — ОДНА СТРОКА, И КАЖДОЕ «ИЛИ» В НЕЙ НАЗВАНО
     ПОСТАНОВКОЙ:
       • `moy` — оператор, у которого ЭТОТ заказ (закон 35, как было);
       • держатель ОТКРЫТОЙ задачи «Отмена подписки» — «оператор
         открывает задачу, видит почту и пароль» (пункт 9). Закрытая
         задача читателем больше не делает: работа сделана;
       • администратор у ВЫПОЛНЕННОГО заказа — «„Открыть" показывает
         карточку заказа: почты и пароли аккаунтов» (пункт 8), — и
         у заказа, отменённого после выполнения: это тот же заказ,
         и подписку с него снимают по этим же данным.
       • с пятьдесят третьей итерации — администратор у ЛЮБОГО заказа:
         «Продажи → Открыть показывает карточку заказа: почты и пароли
         аккаунтов, даты окончания подписки, историю» (Р-171).
     Стёртое до пятьдесят третьей итерации не расшифровывается никому:
     шифротекста нет вовсе (закон 35).

     ⚠️ ИСПОЛНИТЕЛЮ ЗАКРЫТОГО ЗАКАЗА — СЕМЬ ДНЕЙ ПОСЛЕ ЗАКРЫТИЯ, КАК БЫЛО.
     До пятьдесят третьей итерации это окно держало стирание: через семь
     дней шифротекста не оставалось. Стирание снято (Р-172), а читателей
     постановка расширила только у АДМИНИСТРАТОРА; без окна оператор
     читал бы почту и пароль каждого заказа, который когда-либо закрыл,
     бессрочно. Шифротекст при этом на месте — администратору он виден. */
  const vidit = (moy && r.v_okne) || Boolean(otmena && otmena.moya && !otmena.zakryta) || admin;
  const slots = await zapros<{
    id: string;
    idx: number;
    mode: Rezhim;
    in_login_enc: string | null;
    in_password_enc: string | null;
    out_login_enc: string | null;
    out_mail_pass_enc: string | null;
    out_password_enc: string | null;
    recovery_sent_at: Date | null;
    done_at: Date | null;
    ends_at: Date | null;
    sub_cancelled_at: Date | null;
  }>(
    `select id, idx, mode, in_login_enc, in_password_enc, out_login_enc, out_mail_pass_enc,
            out_password_enc, recovery_sent_at, done_at, ends_at, sub_cancelled_at
       from order_slot where order_id = $1 order by idx`,
    [id],
  );
  return {
    id: Number(r.id),
    planId: r.plan_id,
    period: r.period,
    status: r.status,
    clientEmail: r.email,
    operatorId: r.operator_id ? Number(r.operator_id) : null,
    /* ⚠️ ПОЧТА ДЕРЖАТЕЛЯ — ТОЛЬКО АДМИНИСТРАТОРУ (постановка сорок
       шестой итерации): «Подписи „взял: {почта}" у оператора нет
       нигде». Свой заказ карточка при этом по-прежнему называет
       своим — по `operatorId`, а не по адресу. */
    operatorEmail: admin ? r.operator_email : null,
    bySertificate: r.source === 'certificate',
    avtoProdlenie: r.source === 'avto',
    avto: admin ? await avtoDlyaAdminki(id) : null,
    utm: METKI.flatMap((m) => (r[m] ? [{ imya: m as string, znachenie: r[m] as string }] : [])),
    totalKop: admin ? Number(r.total_kop) : null,
    balanceKop: admin ? Number(r.balance_kop) : null,
    moneyKop: admin ? Number(r.money_kop) : null,
    promoKod: admin ? r.promo_kod : null,
    promoSkidkaKop: admin && r.promo_kod ? Number(r.promo_skidka_kop) : null,
    cancelReason: r.cancel_reason,
    istoriya: admin ? await istoriyaZakaza(id) : null,
    razdacha: admin ? await razdachaKartochki(id, r.kind, r.status) : null,
    secretsWiped: Boolean(r.secrets_wiped_at),
    oknoIsteklo: moy && !r.v_okne && !admin,
    raschyotnayaData: new Date(r.raschyot).toISOString().slice(0, 10),
    konchaetsya: r.expires_at ? new Date(r.expires_at).toISOString().slice(0, 10) : null,
    otmena,
    dostupyVidny: vidit,
    slots: slots.map((s) => ({
      id: Number(s.id),
      idx: s.idx,
      mode: s.mode,
      /* Пройден — отмечен и, у продления в работе, с датой: старый заказ
         мог отметить продление без неё (см. `proytiShag`). У закрытого
         заказа меру не меняем: закрытый до сорок второй итерации даты
         не знал вовсе, и его аккаунты читались бы «не пройденными». */
      gotov: Boolean(s.done_at) && (r.status !== 'in_work' || s.mode !== 'renew' || Boolean(s.ends_at)),
      recoverySent: Boolean(s.recovery_sent_at),
      endsAt: s.ends_at ? new Date(s.ends_at).toISOString().slice(0, 10) : null,
      clientLogin: vidit ? poprobovatRasshifrovat(s.in_login_enc) : null,
      clientPassword: vidit ? poprobovatRasshifrovat(s.in_password_enc) : null,
      outLogin: vidit ? poprobovatRasshifrovat(s.out_login_enc) : null,
      outMailPass: vidit ? poprobovatRasshifrovat(s.out_mail_pass_enc) : null,
      outPassword: vidit ? poprobovatRasshifrovat(s.out_password_enc) : null,
      podpiskaOtmenena: Boolean(s.sub_cancelled_at),
    })),
  };
}

/**
 * Подписка этого заказа — та, что стоит на нём сейчас, иначе та, что
 * через него прошла: заказ создан ею (`shop_order.avtoplatezh_id`) или
 * им оплачен её материнский счёт. Чисел здесь своих нет — сумму и день
 * считает тот же `avtoKlientu`, что и кабинету: администратор,
 * отвечающий клиенту в поддержке, обязан видеть то же, что тот.
 */
async function avtoDlyaAdminki(zakaz: number): Promise<AvtoAdminu | null> {
  const r = await odna<{
    a_id: string;
    a_status: StatusAvto;
    a_prichina: PrichinaAvto | null;
    a_neudach: number;
    a_sleduyushchaya: Date | null;
    a_v_puti: string | null;
    a_otpravlen: Date | null;
    a_summa: string | null;
    a_est_pismo: boolean | null;
    a_napomnil_at: Date | null;
    a_v_puti_kop: string | null;
    a_v_puti_sozdan: Date | null;
    a_neudacha_at: Date | null;
    status: Status;
    expires_at: Date | null;
    order_id: string;
    plan_id: string;
    period: number;
    sposob: string | null;
    mat_payment_id: string | null;
    soglasie_at: Date;
    otklyuchen_at: Date | null;
  }>(
    `select a.id as a_id, a.status as a_status, a.prichina as a_prichina, a.neudach as a_neudach,
            a.sleduyushchaya_popytka as a_sleduyushchaya, a.platezh_v_puti as a_v_puti,
            a.otpravlen_at as a_otpravlen, a.napomnil_summa_kop as a_summa,
            a.napomnil_za_cikl = (o.expires_at at time zone 'Europe/Moscow')::date as a_est_pismo,
            a.napomnil_at as a_napomnil_at,
            vp.amount_kop as a_v_puti_kop, vp.created_at as a_v_puti_sozdan,
            (select max(f.created_at) from payment f
              where f.avtoplatezh_id = a.id and f.kind = 'avto' and f.status = 'failed'
                and f.avto_cikl_order_id = a.order_id) as a_neudacha_at,
            o.status, o.expires_at, a.order_id, a.plan_id, a.period, a.sposob, a.mat_payment_id,
            a.soglasie_at, a.otklyuchen_at
       from avtoplatezh a
       join shop_order o on o.id = a.order_id
       left join payment vp on vp.id = a.platezh_v_puti
      where a.order_id = $1
         or a.id = (select z.avtoplatezh_id from shop_order z where z.id = $1)
         or a.mat_payment_id in (select p.id from payment p where p.order_id = $1)
      order by (a.order_id = $1) desc, a.id desc
      limit 1`,
    [zakaz],
  );
  if (!r) return null;
  const tarif = naytiTarif(await katalog(), r.plan_id);
  const k = avtoKlientu(r, tarif ? cenaTarifa(tarif, r.period) : null);
  return {
    id: k.id,
    status: k.status,
    prichina: k.prichina,
    sposob: r.sposob,
    matPaymentId: r.mat_payment_id === null ? null : Number(r.mat_payment_id),
    naZakaze: Number(r.order_id),
    neudach: k.neudach,
    sleduyushchayaPopytka: k.sleduyushchayaPopytka ? k.sleduyushchayaPopytka.toISOString() : null,
    sleduyushcheeSpisanie:
      k.status === 'vklyuchen' && k.sleduyushcheeSpisanie ? k.sleduyushcheeSpisanie.toISOString() : null,
    summaKop: k.status === 'vklyuchen' ? k.summaKop : null,
    vPuti: r.a_v_puti === null ? null : Number(r.a_v_puti),
    vPutiSummaKop: k.vPutiSummaKop,
    vPutiOtpravlen: r.a_otpravlen ? new Date(r.a_otpravlen).toISOString() : null,
    soglasieAt: new Date(r.soglasie_at).toISOString(),
    otklyuchenAt: r.otklyuchen_at ? new Date(r.otklyuchen_at).toISOString() : null,
  };
}

export type VypushchennySertifikat = {
  id: number;
  tail: string;
  planId: string;
  period: number;
  status: 'valid' | 'used' | 'expired';
  buyer: string | null;
  activatedBy: string | null;
  orderId: number | null;
  boughtAt: string;
  expiresAt: string;
  usedAt: string | null;
};

/**
 * Выпущенные сертификаты — для администратора.
 *
 * Постановка: «тариф, срок, статус, кто купил, кто активировал».
 * Кода здесь нет и быть не может: в базе лежит шифротекст, а читать
 * его вправе только владелец в своём кабинете (Р-87). Оператору
 * и администратору видно четыре последних знака — этого довольно,
 * чтобы сверить сертификат с тем, что показывает человек.
 */
export async function vypushchennyeSertifikaty(limit = 200): Promise<VypushchennySertifikat[]> {
  const rows = await zapros<{
    id: string;
    tail: string;
    plan_id: string;
    period: number;
    created_at: Date;
    expires_at: Date;
    used_at: Date | null;
    used_order_id: string | null;
    buyer: string | null;
    activator: string | null;
  }>(
    `select c.id, c.tail, c.plan_id, c.period, c.created_at, c.expires_at, c.used_at, c.used_order_id,
            b.email as buyer, a.email as activator
       from certificate c
       left join app_user b on b.id = c.buyer_id
       left join shop_order o on o.id = c.used_order_id
       left join app_user a on a.id = o.user_id
      order by c.created_at desc
      limit $1`,
    [limit],
  );
  if (!rows.length) return [];
  const teper = Date.now();
  return rows.map((r) => {
    return {
      id: Number(r.id),
      tail: r.tail,
      planId: r.plan_id,
      period: r.period,
      status: r.used_at ? 'used' : new Date(r.expires_at).getTime() < teper ? 'expired' : 'valid',
      buyer: r.buyer,
      activatedBy: r.activator,
      orderId: r.used_order_id ? Number(r.used_order_id) : null,
      boughtAt: new Date(r.created_at).toISOString(),
      expiresAt: new Date(r.expires_at).toISOString(),
      usedAt: r.used_at ? new Date(r.used_at).toISOString() : null,
    };
  });
}

export type ZakrytyyZakaz = {
  id: number;
  status: Status;
  closedAt: string;
  planId: string;
  client: string;
  /**
   * Почта сотрудника, который заказ ЗАКРЫЛ: выполнил или отменил.
   *
   * `null` — спрашивал не администратор (постановка, пункт 5),
   * либо закрывал не сотрудник: отменённый покупателем заказ
   * закрыт без единого сотрудника, и в колонке честно пусто
   * (пункт 6).
   */
  staff: string | null;
  /**
   * У выполненного заказа можно отменить подписку: он выполнен,
   * это тариф (не сертификат) и отмены ещё не было. Решает сервер —
   * кнопка «Отменить» рисуется по этому признаку.
   */
  otmenaMozhno: boolean;
  /** Заказ отменён после выполнения — задачей «Отмена подписки». */
  otmenaPodpiski: boolean;
};

/**
 * Недавно закрытые заказы.
 *
 * ⚠️ «КТО ЗАКРЫЛ» БЕРЁТСЯ ИЗ ЖУРНАЛА, А НЕ ИЗ `operator_id`, и это
 * не придирка. Колонка заказа отвечает на вопрос «у кого он сейчас»;
 * у закрытого заказа это остаток, и читать остаток как «кто это
 * сделал» — ровно та молчаливая связь, на которой мы уже обжигались
 * (Р-126). Сегодня оба числа совпадают, потому что закрытие идёт
 * `where operator_id = $2`; журнал отвечает на тот вопрос, который
 * задан, и отвечать на него будет и дальше.
 *
 * ⚠️ СОБЫТИЕ ВЫБИРАЕТСЯ ПО СОСТОЯНИЮ ЗАКАЗА, а не «последнее
 * какое попало»: у выполненного это `vypolnil`, у отменённого
 * `otmenil`. Возьми мы просто последнее — заказ, брошенный обратно
 * в очередь, показывал бы того, кто его ВЕРНУЛ.
 *
 * ⚠️ СПИСОК ТОЖЕ ФИЛЬТРУЕТСЯ ДОСТУПОМ (сорок шестая итерация):
 * постановка говорит «в его очереди и СПИСКАХ не показываются
 * вовсе», и закрытый заказ, который вёл другой оператор, — такой же
 * чужой заказ. Свои закрытые при этом остаются: `operator_id`
 * у закрытого хранит того, кто его закрыл.
 */
export async function zakrytye(d: Dostup, limit = 50): Promise<ZakrytyyZakaz[]> {
  const admin = d.admin;
  const v = usloviyeVidimosti(d, 'o', 2);
  const rows = await zapros<{
    id: string;
    status: Status;
    closed_at: Date;
    plan_id: string;
    email: string;
    staff: string | null;
    kind: 'plan' | 'certificate';
    otmena: boolean;
  }>(
    `select o.id, o.status, o.closed_at, o.plan_id, u.email, fs.email as staff, o.kind,
            (t.order_id is not null) as otmena
       from shop_order o
       join app_user u on u.id = o.user_id
       left join sub_cancel t on t.order_id = o.id
       left join lateral (
         select e.staff_id from order_event e
          where e.order_id = o.id
            /* ⚠️ У ЗАКАЗА С ОТМЕНЁННОЙ ПОДПИСКОЙ «КТО ЗАКРЫЛ» — ТОТ,
               КТО НАЖАЛ «ОТМЕНИТЬ»: события «отменил» у него нет,
               у него свой глагол (миграция 015). */
            and e.vid = case
                          when o.status = 'done' then 'vypolnil'
                          when t.order_id is not null then 'otmena_zaproshena'
                          else 'otmenil'
                        end
          order by e.created_at desc, e.id desc limit 1
       ) ev on true
       left join staff fs on fs.id = ev.staff_id
      where o.status in ('done', 'cancelled')${v.uslovie}
      order by o.closed_at desc limit $1`,
    [limit, ...v.params],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    status: r.status,
    closedAt: new Date(r.closed_at).toISOString(),
    planId: r.plan_id,
    client: r.email,
    staff: admin ? r.staff : null,
    otmenaMozhno: r.status === 'done' && r.kind === 'plan' && !r.otmena,
    otmenaPodpiski: r.otmena,
  }));
}

/**
 * Почты и пароли аккаунтов заказа — ДЛЯ СООБЩЕНИЯ БОТА об отмене
 * подписки (сорок девятая итерация, пункт 9): «почта и пароль аккаунта
 * (пока не стёрт)».
 *
 * ⚠️ ЭТО ЧИТАТЕЛЬ, НАЗВАННЫЙ ПОСТАНОВКОЙ, И ЗВАТЬ ЕГО МОЖНО ИЗ ОДНОГО
 * МЕСТА — из действия администратора, который нажал «Отменить».
 * Стёртое не возвращается: шифротекста нет, и в сообщении будет `null`
 * («стёрт через 7 дней после закрытия»).
 *
 * ⚠️ БЕРЁТСЯ ТО, НА ЧТО ЗАКАЗ ОФОРМЛЕН: данные клиента, а у старых
 * заказов (до тридцать четвёртой итерации) — то, что выдал оператор.
 */
export async function akkauntyDlyaOtmeny(zakaz: number): Promise<{ pochta: string | null; parol: string | null }[]> {
  const rows = await zapros<{
    in_login_enc: string | null;
    in_password_enc: string | null;
    out_login_enc: string | null;
    out_password_enc: string | null;
  }>(
    `select in_login_enc, in_password_enc, out_login_enc, out_password_enc
       from order_slot where order_id = $1 order by idx`,
    [zakaz],
  );
  return rows.map((s) => ({
    pochta: poprobovatRasshifrovat(s.in_login_enc) ?? poprobovatRasshifrovat(s.out_login_enc),
    parol: poprobovatRasshifrovat(s.in_password_enc) ?? poprobovatRasshifrovat(s.out_password_enc),
  }));
}

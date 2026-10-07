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
import { dopisatAdres } from '@/lib/admin/prichiny';
import { STATUS_SLOVAMI, type Rezhim, type Status } from './orders';
import { katalog, naytiTarif, srokKratko } from './catalog';
import { usloviyeVidimosti, usloviyeVidimostiOtmeny, usloviyeVidimostiSZadachey, type Dostup } from './dostup';
import { METKI } from './utm';

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
  prichinaOtmeny: string | null;
  /**
   * Заказ отменён ПОСЛЕ выполнения — подписку сняли (сорок девятая
   * итерация). Деньги не возвращаются, и строки «Деньги лежат
   * на балансе» у такого заказа быть не должно.
   */
  otmenaPodpiski: boolean;
  sekretyStyorty: boolean;
  slots: SlotKlientu[];
};

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
  }>(
    /* ⚠️ ОТМЕНЁННЫЕ САМИМ ПОКУПАТЕЛЕМ СЮДА НЕ ПОПАДАЮТ ВОВСЕ —
       постановка тридцать шестой итерации: «карточка плавно
       схлопывается и больше не показывается, причину не пишем».
       Отменённые ОПЕРАТОРОМ остаются: там есть что сказать —
       причина и деньги на балансе. */
    `select id, kind, plan_id, period, status, total_kop, balance_kop, money_kop, source,
            created_at, cancel_reason, cancel_slot_idx, secrets_wiped_at, expires_at,
            exists (select 1 from sub_cancel t where t.order_id = shop_order.id) as otmena_podpiski
       from shop_order
      where user_id = $1 and not cancelled_by_client
      order by created_at desc limit 100`,
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
        if (!r.cancel_reason) return r.cancel_reason;
        if (r.cancel_slot_idx === null) return r.cancel_reason;
        const pochta = poprobovatRasshifrovat(
          svoi.find((x) => x.idx === Number(r.cancel_slot_idx))?.in_login_enc ?? null,
        );
        return dopisatAdres(r.cancel_reason, pochta);
      })(),
      otmenaPodpiski: r.otmena_podpiski,
      sekretyStyorty: Boolean(r.secrets_wiped_at),
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
   * Это не заказ, а задача «Отмена подписки» (сорок девятая итерация).
   * Номер — номер того же заказа: задача одна на заказ и открывается
   * его же карточкой. `paidAt` у неё — время, когда её поставили.
   */
  otmena: boolean;
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
  }>(
    `select o.id, o.plan_id, o.period, o.status, o.source, o.paid_at, o.created_at,
            f.email as operator, o.operator_id,
            (select count(*) from order_slot s where s.order_id = o.id)::text as slots
       from shop_order o
       left join staff f on f.id = o.operator_id
      where o.status in ('paid', 'in_work')${v.uslovie}
      order by o.paid_at asc nulls last, o.id asc
      limit 200`,
    v.params,
  );
  const zakazy: StrokaOcheredi[] = rows.map((r) => ({
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
    otmena: false,
  }));

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
    otmena: true,
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
  vid: 'vzyal' | 'vernul' | 'vypolnil' | 'otmenil' | 'otmena_zaproshena' | 'podpiska_otmenena';
  /**
   * Почта сотрудника. `null` значит «сотрудника не было»: так
   * выглядит отмена САМИМ ПОКУПАТЕЛЕМ, и надпись к ней своя.
   * «Данных нет» это НЕ значит — у заказа без истории событий нет
   * вовсе, и список приходит пустым.
   */
  email: string | null;
  /** Момент в ISO; по Москве его раскладывает страница. */
  kogda: string;
};

async function istoriyaZakaza(zakaz: number): Promise<Sobytie[]> {
  const rows = await zapros<{ vid: Sobytie['vid']; email: string | null; created_at: Date }>(
    `select e.vid, f.email, e.created_at
       from order_event e
       left join staff f on f.id = e.staff_id
      where e.order_id = $1
      order by e.created_at, e.id`,
    [zakaz],
  );
  return rows.map((r) => ({ vid: r.vid, email: r.email, kogda: new Date(r.created_at).toISOString() }));
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
  secretsWiped: boolean;
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
    email: string;
    operator_id: string | null;
    operator_email: string | null;
    total_kop: string;
    balance_kop: string;
    money_kop: string;
    cancel_reason: string | null;
    secrets_wiped_at: Date | null;
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
    `select o.id, o.plan_id, o.period, o.status, o.source, u.email, o.expires_at,
            t.order_id as t_order, t.operator_id as t_operator_id, tf.email as t_operator_email, t.done_at as t_done_at,
            o.operator_id, f.email as operator_email,
            o.total_kop, o.balance_kop, o.money_kop, o.cancel_reason, o.secrets_wiped_at,
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
     Стёртое через семь дней не расшифровывается никому: шифротекста
     к тому времени нет вовсе (закон 35). */
  const vidit =
    moy ||
    Boolean(otmena && otmena.moya && !otmena.zakryta) ||
    (admin && (r.status === 'done' || Boolean(otmena)));
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
    utm: METKI.flatMap((m) => (r[m] ? [{ imya: m as string, znachenie: r[m] as string }] : [])),
    totalKop: admin ? Number(r.total_kop) : null,
    balanceKop: admin ? Number(r.balance_kop) : null,
    moneyKop: admin ? Number(r.money_kop) : null,
    cancelReason: r.cancel_reason,
    istoriya: admin ? await istoriyaZakaza(id) : null,
    secretsWiped: Boolean(r.secrets_wiped_at),
    raschyotnayaData: new Date(r.raschyot).toISOString().slice(0, 10),
    konchaetsya: r.expires_at ? new Date(r.expires_at).toISOString().slice(0, 10) : null,
    otmena,
    dostupyVidny: vidit,
    slots: slots.map((s) => ({
      id: Number(s.id),
      idx: s.idx,
      mode: s.mode,
      gotov: Boolean(s.done_at),
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

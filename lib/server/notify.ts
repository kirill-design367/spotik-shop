/**
 * Уведомления СОТРУДНИКАМ.
 *
 * ⚠️ КАНАЛ ВЫБРАН: TELEGRAM, и он служебный — клиентов там нет.
 * Место осталось тем же, что было заведено под это в двадцать
 * седьмой итерации (Р-90): зовут отсюда все, кому есть что сообщить
 * команде, и ни один вызывающий при смене канала не трогается.
 *
 * ⚠️ СБОЙ СВЯЗИ НЕ РОНЯЕТ ОПЛАТУ — прямое требование постановки.
 * Отсюда три свойства, и все три обязательны:
 *   • отправка НИЧЕГО не бросает наружу: любая беда кончается
 *     строкой в журнале и строкой в очереди;
 *   • очередь лежит В БАЗЕ, а не в памяти процесса: выкладка
 *     перезапускает службу, и неотправленное пропало бы молча;
 *   • пока токена нет, уведомления идут только в журнал — ровно
 *     как письма до настройки SMTP.
 *
 * ⚠️ В ТЕЛЕГРАМ УХОДЯТ ДВА СОБЫТИЯ ИЗ ЧЕТЫРЁХ, и это постановка:
 * «новый оплаченный заказ» и «заказ выполнен». Взятие заказа
 * и отмена остаются в журнале: они шумные и адресованы не команде,
 * а разбору беды.
 *
 * ⚠️ РАБОЧИЕ СООБЩЕНИЯ ИДУТ ПО-АНГЛИЙСКИ С ТРИДЦАТЬ ЧЕТВЁРТОЙ
 * ИТЕРАЦИИ — постановка. Это надписи интерфейса, и относятся они
 * к тому же классу, что надписи админки: сотрудников двое, язык
 * у них общий.
 *
 * ⚠️ И С ТРИДЦАТЬ ДЕВЯТОЙ АНГЛИЙСКИЕ ЕЩЁ И НАЗВАНИЕ ТАРИФА СО СРОКОМ:
 * «Plan: Индивидуальный, месяц» читалось как недоделка. Это НЕ ОТМЕНА
 * закона 40, а уточнение его границы: тариф и срок выбираем МЫ —
 * это такие же наши надписи, как «Queue» и «Prices». Всё, что ввёл
 * или выбрал КЛИЕНТ, — его почта, его пароль, причина отмены,
 * текст обращения — не переводится по-прежнему.
 *
 * ⚠️ И ОДНО СОБЫТИЕ ОСТАЁТСЯ РУССКИМ — ОБРАЩЕНИЕ В ПОДДЕРЖКУ.
 * Там внутри текст, который написал КЛИЕНТ, и он русский; заголовок
 * по-английски над русским телом читался бы как чужая врезка.
 *
 * ⚠️ ПЕРСОНАЛЬНЫХ ДАННЫХ КЛИЕНТА В СОБЫТИИ НЕТ. Адрес СОТРУДНИКА
 * в «заказ выполнен» есть — постановка требует «кто выполнил»,
 * а чат служебный; в журнал он при этом идёт огрызком (Р-87).
 */

import { bazaEst, zapros } from './db';
import { poprobovatRasshifrovat, shifrGotov, zashifrovat } from './crypto';
import { env } from './env';
import { log, pochtaVZhurnal } from './log';
import { rubli } from './money';
import { poslatVChat, telegramNastroen } from './telegram';

export type SobytieKomande =
  | { vid: 'zakaz_oplachen'; zakaz: number; tarif: string; srok: string; mest: number; podarok: boolean }
  | { vid: 'zakaz_vzyat'; zakaz: number; kto: string }
  | { vid: 'zakaz_zakryt'; zakaz: number; kto: string }
  | { vid: 'zakaz_otmenyon'; zakaz: number }
  /* Деньги пришли по заказу, который их уже не ждал, и легли
     на баланс покупателя. Разбирается руками — потому и в чат. */
  | { vid: 'dengi_bez_zakaza'; zakaz: number; platyozh: number; summaKop: number }
  /* Обращение в поддержку с сайта. Форма публичная, поэтому текст
     приходит сюда как есть — и как есть уходит в чат. */
  | { vid: 'obrashchenie'; tekst: string; svyaz: string; ot: string | null }
  /* Отмена подписки у выполненного заказа (сорок девятая итерация).
     Постановка: «Бот присылает в группу сообщение на английском: что
     это отмена подписки, номер заказа, тариф, почта и пароль аккаунта
     (пока не стёрт), ссылка на заказ».

     ⚠️ ЕДИНСТВЕННОЕ СОБЫТИЕ С ПАРОЛЕМ ВНУТРИ, и с ним обращаются
     иначе, чем со всеми: в журнал оно идёт без почт и паролей,
     а в очередь — шифротекстом (см. `vOchered`). */
  | {
      vid: 'otmena_podpiski';
      zakaz: number;
      tarif: string;
      srok: string;
      akkaunty: { pochta: string | null; parol: string | null }[];
      /** Кому ушла задача: почта оператора или `null` — общая очередь. */
      komu: string | null;
    };

/**
 * События, текст которых несёт ЧУЖОЙ ПАРОЛЬ. Их строка в очереди
 * лежит шифротекстом и стирается сразу после отправки (закон 35).
 */
const S_PAROLEM = new Set(['otmena_podpiski']);

/** Сколько раз пробуем, прежде чем бросить. */
const POPYTOK = 10;
/** Как часто разгребается очередь. */
const MINUTA = 60_000;

function ssylka(zakaz: number): string {
  return `${env.siteUrl}/admin/orders/${zakaz}/`;
}

/**
 * Текст для чата. Без разметки: `parse_mode` не задаётся вовсе,
 * поэтому экранировать нечего и сломать сообщение подчёркиванием
 * в адресе нельзя.
 */
function tekstDlyaChata(s: SobytieKomande): string | null {
  if (s.vid === 'zakaz_oplachen') {
    return [
      `New paid order #${s.zakaz}`,
      `Plan: ${s.tarif}, ${s.srok}`,
      `Participants: ${s.mest}`,
      s.podarok
        ? 'Payment: gift certificate — no money on this order, it was taken when the certificate was bought'
        : 'Payment: card or balance',
      ssylka(s.zakaz),
    ].join('\n');
  }
  /* ⚠️ ПОЧТА И ПАРОЛЬ — ДАННЫЕ КЛИЕНТА, И ПЕРЕВОДУ ОНИ НЕ ПОДЛЕЖАТ
     (закон 40); остальное — английские надписи, как у всех рабочих
     сообщений (Р-120). Стёртый пароль назван словами, а не пропущен:
     «пока не стёрт» значит, что его отсутствие должно быть видно. */
  if (s.vid === 'otmena_podpiski') {
    const mnogo = s.akkaunty.length > 1;
    const stroki = s.akkaunty.flatMap((a, i) => {
      const kto = mnogo ? `Account ${i + 1}` : 'Account';
      return [
        `${kto} email: ${a.pochta ?? 'wiped 7 days after the order closed'}`,
        `${kto} password: ${a.parol ?? 'wiped 7 days after the order closed'}`,
      ];
    });
    return [
      `Subscription cancellation for order #${s.zakaz}`,
      `Plan: ${s.tarif}, ${s.srok}`,
      ...stroki,
      s.komu ? `Assigned to: ${s.komu}` : 'Queue: general — any operator can take it',
      'Cancel the subscription in Spotify. No refund to the client.',
      ssylka(s.zakaz),
    ].join('\n');
  }
  if (s.vid === 'zakaz_zakryt') {
    return [`Order #${s.zakaz} is done`, `Operator: ${s.kto}`, ssylka(s.zakaz)].join('\n');
  }
  /* ⚠️ ОБРАЩЕНИЕ — ЕДИНСТВЕННОЕ СОБЫТИЕ, КОТОРОЕ ОСТАЁТСЯ РУССКИМ.
     Внутри текст клиента, и он русский. */
  if (s.vid === 'obrashchenie') {
    return [
      'Обращение в поддержку',
      s.ot ? `От: ${s.ot}` : 'От: не входил в кабинет',
      `Связь: ${s.svyaz}`,
      '',
      s.tekst,
    ].join('\n');
  }
  /* ⚠️ ТРЕТЬЕ СОБЫТИЕ В ЧАТЕ, И ОНО ДРУГОГО КЛАССА. Постановка
     называла два РЯДОВЫХ события; это не рядовое, а происшествие:
     деньги приняты, заказ их не ждал, и без человека они так
     и останутся на балансе. Журнала тут мало — журнал никто
     не читает, пока не сломалось. */
  if (s.vid === 'dengi_bez_zakaza') {
    return [
      `Money arrived for order #${s.zakaz}, which was no longer waiting for it`,
      `Invoice #${s.platyozh}, ${rubli(s.summaKop)}`,
      'The amount went to the buyer’s balance. Needs a look by hand.',
      ssylka(s.zakaz),
    ].join('\n');
  }
  return null;
}

/**
 * Строка в журнал: без адресов целиком.
 *
 * ⚠️ ТЕКСТ ОБРАЩЕНИЯ В ЖУРНАЛ НЕ ПИШЕТСЯ. Его написал человек,
 * и там бывает что угодно — вплоть до его же пароля. Журнал читают
 * все, у кого есть доступ к серверу; в чат обращение уходит, потому
 * что чат для того и заведён, а в журнал идёт только факт.
 */
function vZhurnal(s: SobytieKomande): void {
  const { vid, ...ostalnoe } = s;
  const polya: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(ostalnoe)) {
    /* ⚠️ ПОЧТЫ И ПАРОЛИ АККАУНТОВ В ЖУРНАЛ НЕ ИДУТ НИКОГДА (закон 35):
       туда ложится только их число. */
    if (k === 'akkaunty' && Array.isArray(v)) {
      polya[k] = v.length;
      continue;
    }
    if (vid === 'obrashchenie' && (k === 'tekst' || k === 'svyaz')) {
      polya[k] = `${String(v).length} знаков`;
      continue;
    }
    polya[k] =
      (k === 'kto' || k === 'ot') && typeof v === 'string'
        ? pochtaVZhurnal(v)
        : (v as string | number | boolean);
  }
  log.info(`команде: ${vid}`, polya);
}

async function vOchered(vid: string, tekst: string, pochemu: string): Promise<void> {
  if (!bazaEst()) return;
  /* ⚠️ ТЕКСТ С ЧУЖИМ ПАРОЛЕМ ЛОЖИТСЯ В ОЧЕРЕДЬ ШИФРОТЕКСТОМ. Очередь —
     это таблица в базе и в ночной копии, а пароли от аккаунтов Spotify
     хранятся только зашифрованными (закон 35). Нет ключа — такой текст
     не кладётся вовсе: «временно открытым текстом» запрещено. */
  if (S_PAROLEM.has(vid)) {
    if (!shifrGotov()) {
      log.error('уведомление с паролем не легло в очередь: нет ключа шифрования', { vid });
      return;
    }
    tekst = zashifrovat(tekst);
  }
  try {
    await zapros(
      `insert into notify_outbox (vid, tekst, popytok, poslednyaya_oshibka, sleduyushchaya_v)
       values ($1, $2, 1, $3, now() + interval '1 minute')`,
      [vid, tekst, pochemu.slice(0, 500)],
    );
  } catch (e) {
    log.error('уведомление не легло в очередь', { text: String((e as Error).message) });
  }
}

export async function soobshchitKomande(s: SobytieKomande): Promise<void> {
  vZhurnal(s);
  const tekst = tekstDlyaChata(s);
  if (!tekst) return;
  if (!telegramNastroen()) {
    // Пока токена нет — только журнал, как письма до настройки SMTP.
    return;
  }
  const itog = await poslatVChat(tekst);
  if (itog.ok) {
    log.info('уведомление ушло в Telegram', { vid: s.vid, adres: itog.adres });
    return;
  }
  log.warn('Telegram не ответил, уведомление в очереди', {
    vid: s.vid,
    adres: itog.adres,
    text: itog.pochemu.slice(0, 200),
  });
  await vOchered(s.vid, tekst, itog.pochemu);
}

/**
 * Разгрести очередь.
 *
 * ⚠️ СТРОКА БЕРЁТСЯ ОДНИМ ОПЕРАТОРОМ, И ЭТО НЕ КРАСОТА. Выкладка
 * на минуту поднимает ВТОРОЕ приложение: старое ещё отвечает, новое
 * уже живо, — и оба будильника приходят в очередь. Отдельный
 * `select … for update skip locked` тут не спасает вовсе: вне
 * транзакции блокировка снимается сразу за самим запросом. Поэтому
 * выборка и аренда — один `update`: взявший строку отодвигает её
 * срок на пять минут, и второму она уже не видна.
 */
export async function razgrestiOchered(): Promise<void> {
  if (!bazaEst() || !telegramNastroen()) return;
  try {
    const stroki = await zapros<{ id: string; vid: string; tekst: string; popytok: number }>(
      `update notify_outbox
          set sleduyushchaya_v = now() + interval '5 minutes'
        where id in (
          select id from notify_outbox
           where sent_at is null and popytok < $1 and sleduyushchaya_v <= now()
           order by id limit 20 for update skip locked
        )
      returning id, vid, tekst, popytok`,
      [POPYTOK],
    );
    for (const r of stroki) {
      /* Шифротекст узнаётся по виду события, а не по виду строки:
         догадка «похоже на шифротекст» однажды приняла бы за него
         обычный текст. Не расшифровалось — строку бросаем, а не шлём
         в чат мусор. */
      const sParolem = S_PAROLEM.has(r.vid);
      const tekst = sParolem ? poprobovatRasshifrovat(r.tekst) : r.tekst;
      if (tekst === null) {
        await zapros(
          `update notify_outbox set popytok = $2, poslednyaya_oshibka = 'не расшифровалось' where id = $1`,
          [Number(r.id), POPYTOK],
        );
        log.error('уведомление с паролем не расшифровалось и брошено', { vid: r.vid });
        continue;
      }
      const itog = await poslatVChat(tekst);
      if (itog.ok) {
        /* ⚠️ УШЕДШИЙ ТЕКСТ С ПАРОЛЕМ СТИРАЕТСЯ СРАЗУ: хранить его
           у себя дальше незачем, а строка отправленного живёт ещё
           две недели (`upkeep.ts`). */
        await zapros(
          `update notify_outbox set sent_at = now(), tekst = case when $2 then '' else tekst end where id = $1`,
          [Number(r.id), sParolem],
        );
        log.info('отложенное уведомление ушло', { vid: r.vid, popytok: r.popytok + 1, adres: itog.adres });
        continue;
      }
      /* Отступ растёт вдвое с каждой попыткой и упирается в час:
         Telegram, лежащий полдня, не должен превратиться
         в непрерывный стук. */
      const minut = Math.min(2 ** r.popytok, 60);
      await zapros(
        `update notify_outbox
            set popytok = popytok + 1,
                poslednyaya_oshibka = $2,
                sleduyushchaya_v = now() + ($3 || ' minutes')::interval
          where id = $1`,
        [Number(r.id), itog.pochemu.slice(0, 500), String(minut)],
      );
      if (r.popytok + 1 >= POPYTOK) {
        log.error('уведомление брошено после всех попыток', { vid: r.vid, text: itog.pochemu.slice(0, 200) });
      }
    }
  } catch (e) {
    log.error('очередь уведомлений не разгреблась', { text: String((e as Error).message) });
  }
}

type Global = typeof globalThis & { __spotikNotify?: NodeJS.Timeout };

/** Минутный будильник очереди. `unref` — чтобы не держать процесс. */
export function zavestiOchered(): void {
  const g = globalThis as Global;
  if (g.__spotikNotify) return;
  g.__spotikNotify = setInterval(() => void razgrestiOchered(), MINUTA);
  g.__spotikNotify.unref?.();
}

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
 * у них общий. ⚠️ ДАННЫЕ ЗАКАЗА ПРИ ЭТОМ НЕ ПЕРЕВОДЯТСЯ (закон 40):
 * название тарифа и срок приходят из каталога и остаются как есть.
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
  | { vid: 'obrashchenie'; tekst: string; svyaz: string; ot: string | null };

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
      const itog = await poslatVChat(r.tekst);
      if (itog.ok) {
        await zapros('update notify_outbox set sent_at = now() where id = $1', [Number(r.id)]);
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

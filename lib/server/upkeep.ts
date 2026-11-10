/**
 * Уборка.
 *
 * ⚠️ ДОСТУПЫ БОЛЬШЕ НЕ СТИРАЮТСЯ — С ПЯТЬДЕСЯТ ТРЕТЬЕЙ ИТЕРАЦИИ (Р-172).
 * Постановка: «Отключи стирание почт и паролей аккаунтов через 7 дней
 * после закрытия заказа — данные хранятся зашифрованными и дальше».
 * До неё здесь стоял запрос, гасивший пять колонок `*_enc` у слотов
 * заказов, закрытых больше недели назад, и ставивший `secrets_wiped_at`.
 * Снят он целиком; уже стёртое не восстанавливается — шифротекста нет,
 * — и у таких заказов `secrets_wiped_at` остаётся законной пометкой
 * «стёрт» в карточке и в кабинете.
 *
 * ⚠️ СООБЩЕНИЯ БОТА С ПАРОЛЕМ ИЗ ЧАТА УБИРАЮТСЯ ПО-ПРЕЖНЕМУ — «оставь
 * как есть». Их срок отвязан от стирания и считается от того же
 * `closed_at`, от которого считалось стирание, то есть по времени
 * не сдвинулся ни на час (`notify.ts`).
 *
 * Заодно убираются просроченные коды входа, попытки ввода кода
 * сертификата и мёртвые сессии: они копятся по строке на каждый
 * вход и ничего не стоят, кроме места.
 *
 * ⚠️ ЗДЕСЬ ЖЕ ЕДУТ НАПОМИНАНИЯ ОБ ОКОНЧАНИИ ПОДПИСКИ. Своего
 * будильника им не заводится: часовой ход для письма, которое уходит
 * за три дня до конца срока, — это точность с запасом в семьдесят
 * два раза (см. `napominaniya.ts`).
 */

import { bazaEst, zapros } from './db';
import { log } from './log';
import { napomnitObOkonchanii } from './napominaniya';
import { ubratSoobshcheniyaSParolem } from './notify';

const CHAS = 3_600_000;

export async function ubrat(): Promise<void> {
  if (!bazaEst()) return;
  try {
    await zapros(`delete from login_code where created_at < now() - interval '2 days'`);
    // Попытки ввода кода сертификата: окно лимита — час, так что
    // всё старше суток для дела не нужно вовсе. Двое суток держим
    // затем же, зачем и коды входа, — чтобы разбор беды застал след.
    await zapros(`delete from cert_try where created_at < now() - interval '2 days'`);
    // Попытки отправить обращение в поддержку — тот же счётчик и тот
    // же срок, что у кода сертификата.
    await zapros(`delete from support_try where created_at < now() - interval '2 days'`);
    await zapros('delete from session where expires_at < now()');
    // Ссылки восстановления пароля Spotify: живут семь дней, дальше
    // не нужны вовсе.
    await zapros('delete from recovery_link where expires_at < now()');
    // Ушедшие уведомления держать незачем: разбор беды идёт
    // по журналу, а неушедшие остаются в очереди до последней попытки.
    await zapros(`delete from notify_outbox where sent_at is not null and sent_at < now() - interval '14 days'`);
    // ⚠️ Неушедшее уведомление С ПАРОЛЕМ живёт не дольше недели —
    // это часть «удаления сообщений бота с паролями», которое
    // пятьдесят третья итерация велела оставить как есть (Р-172):
    // через неделю отменять подписку по нему уже поздно, задача
    // в очереди и карточка заказа говорят то же самое.
    await zapros(`delete from notify_outbox where vid = 'otmena_podpiski' and created_at < now() - interval '7 days'`);
    // Убранные из чата сообщения помнить незачем дольше, чем ушедшие
    // уведомления: паролей в строке нет, а разбор беды идёт по журналу.
    await zapros(`delete from tg_s_parolem where ubrano_at is not null and ubrano_at < now() - interval '14 days'`);
    // Ссылки привязки Telegram: живут сутки. Погашенная держится ещё
    // сутки — повторная доставка того же `/start` обязана ответить
    // «Linked.», а не «ссылка недействительна» (`tgbot.ts`).
    await zapros(`delete from tg_privyazka where expires_at < now() or used_at < now() - interval '1 day'`);
    // Номера принятых обновлений бота: Telegram не держит обновления
    // дольше суток, так что двое суток — с запасом против повтора.
    await zapros(`delete from tg_obnovlenie where created_at < now() - interval '2 days'`);
    // Ссылки «Отключить автоплатёж» из писем: живут тридцать дней,
    // дальше отключают из кабинета (пятьдесят четвёртая итерация).
    await zapros('delete from avto_token where expires_at < now()');
  } catch (e) {
    log.error('уборка не прошла', { text: String((e as Error).message) });
  }
  /* ⚠️ СООБЩЕНИЯ С ПАРОЛЕМ УХОДЯТ ИЗ ЧАТА ЧЕРЕЗ СЕМЬ ДНЕЙ ПОСЛЕ ЗАКРЫТИЯ
     ЗАКАЗА (Р-161), и с пятьдесят третьей итерации срок считается прямо
     от `closed_at` — стирания на сайте больше нет (Р-172). Своё `try`:
     упавший Telegram не должен отменять уборку выше и напоминания ниже. */
  await ubratSoobshcheniyaSParolem();
  /* ⚠️ НАПОМИНАНИЯ ЕДУТ НА ТОМ ЖЕ БУДИЛЬНИКЕ, а не на своём —
     прямое требование постановки, и оно разумно: заводить второй
     таймер ради письма, которое уходит раз в три месяца на заказ,
     незачем. Стоит ПОСЛЕ уборки и в своём `try`: упавшая рассылка
     не должна отменять уборку. */
  await napomnitObOkonchanii();
}

type Global = typeof globalThis & { __spotikUpkeep?: NodeJS.Timeout };

/**
 * Часовой будильник.
 *
 * Отдельного демона заводить не за чем: приложение на сервере одно,
 * и уборка стоит доли миллисекунды. `unref` — чтобы таймер
 * не держал процесс живым при остановке сервиса.
 */
export function zavestiUborku(): void {
  const g = globalThis as Global;
  if (g.__spotikUpkeep) return;
  g.__spotikUpkeep = setInterval(() => void ubrat(), CHAS);
  g.__spotikUpkeep.unref?.();
  void ubrat();
}

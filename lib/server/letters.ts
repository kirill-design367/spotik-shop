/**
 * Письма клиенту: пять поводов из постановки.
 *
 * Код входа живёт отдельно (lib/server/auth.ts) — он уходит до того,
 * как у человека вообще появляется заказ.
 *
 * ⚠️ ВЫДАННЫХ ПАРОЛЕЙ В ПИСЬМАХ НЕТ. Почта не шифруется на пути
 * и остаётся в ящике навсегда; доступы человек забирает в кабинете,
 * где они лежат за сессией. Письмо только зовёт.
 */

import { env } from './env';
import { otpravit } from './mail';
import { rubli } from './money';

const PODPIS = '\n—\nSpotik Shop\nspotik.shop\n';

/*
 * ⚠️ НОМЕРА ЗАКАЗА В ПИСЬМАХ НЕТ НИ В ОДНОМ — постановка тридцать
 * шестой итерации: «номер заказа клиенту не показываем нигде, он
 * остаётся внутренним». Вместо номера письмо называет САМ ЗАКАЗ —
 * тариф и срок: человеку это говорит больше, а нам различить его
 * заказы по названию достаточно. Номер остался там, где он и нужен, —
 * в админке и в служебном чате.
 */

export async function pismoZakazOplachen(komu: string, nazvanie: string): Promise<void> {
  await otpravit({
    komu,
    tema: 'Заказ оплачен',
    telo:
      `Оплата прошла, заказ принят в работу.\n\n` +
      `Что оформляем: ${nazvanie}\n\n` +
      `Доступ появится в личном кабинете: ${env.siteUrl}/cabinet/\n` +
      `Обычно это занимает несколько часов.\n` +
      PODPIS,
  });
}

export async function pismoZakazGotov(komu: string, chto: string): Promise<void> {
  await otpravit({
    komu,
    tema: 'Заказ готов',
    telo:
      `Доступ оформлен: ${chto}.\n\n` +
      `Логины и пароли лежат в личном кабинете: ${env.siteUrl}/cabinet/\n` +
      `В письме мы их не присылаем — почта для этого слишком открытое место.\n` +
      PODPIS,
  });
}

/**
 * ⚠️ `chto` — ЭТО ПОДАРОК ЦЕЛИКОМ, а не один только срок: «На двоих,
 * полгода». С двадцать восьмой итерации сертификат несёт тариф
 * вместе со сроком, и письмо обязано называть оба (Р-93).
 */
export async function pismoSertifikatKuplen(komu: string, kod: string, srokDo: Date, chto: string): Promise<void> {
  await otpravit({
    komu,
    tema: 'Сертификат Spotik Shop',
    telo:
      `Сертификат оформлен: ${chto}.\n\n` +
      `Код: ${kod}\n` +
      `Действует до ${srokDo.toLocaleDateString('ru-RU')}.\n\n` +
      `Активировать его можно здесь: ${env.siteUrl}/certificate/\n` +
      `Код одноразовый: после активации он больше не действует.\n` +
      PODPIS,
  });
}

export async function pismoZakazOtmenyon(komu: string, chto: string, naBalans: number, pochemu: string): Promise<void> {
  await otpravit({
    komu,
    tema: 'Заказ отменён',
    telo:
      `Заказ отменён: ${chto}.\n\n` +
      (pochemu ? `Причина: ${pochemu}\n\n` : '') +
      (naBalans > 0
        ? `${rubli(naBalans)} вернулись на баланс в личном кабинете — их можно потратить на следующий заказ.\n` +
          `${env.siteUrl}/cabinet/\n`
        : '') +
      PODPIS,
  });
}

/**
 * На почту уже есть аккаунт Spotify, и новый на неё не завести.
 *
 * ⚠️ ЭТО НЕ ОТКАЗ, А РАЗВИЛКА. Человек хотел новый аккаунт, а он
 * у него уже есть — значит заказ тот же самый, только режим другой.
 * Письмо и зовёт оформить заново, выбрав «Продлить существующий»,
 * а деньги к этому моменту уже лежат на балансе: оформление
 * получается в один клик.
 */
export async function pismoPochtaZanyata(komu: string, chto: string, naBalans: number): Promise<void> {
  await otpravit({
    komu,
    tema: 'На эту почту уже есть аккаунт Spotify',
    telo:
      `Мы попробовали завести новый аккаунт Spotify на указанную почту — она уже занята: ` +
      `аккаунт на ней существует.\n\n` +
      `Что сделать: оформите заказ заново и выберите «Продлить существующий» — ` +
      `мы включим Premium на том аккаунте, который у вас уже есть.\n` +
      `${env.siteUrl}/checkout/\n\n` +
      (naBalans > 0
        ? `Деньги за заказ (${chto}) — ${rubli(naBalans)} — вернулись на баланс в личном кабинете, ` +
          `и новый заказ закроется ими же.\n${env.siteUrl}/cabinet/\n`
        : '') +
      PODPIS,
  });
}

/**
 * Подписка скоро кончится.
 *
 * ⚠️ ССЫЛКА «ПРОДЛИТЬ» ОТКРЫВАЕТ ОФОРМЛЕНИЕ УЖЕ ЗАПОЛНЕННЫМ: тариф,
 * срок, режим «продлить существующий» и почта аккаунта. Человеку
 * остаётся ввести пароль и нажать кнопку — а не собирать заказ
 * заново, вспоминая, что у него было.
 */
export async function pismoSkoroKonec(opts: {
  komu: string;
  chto: string;
  kogda: Date;
  ssylka: string;
}): Promise<void> {
  await otpravit({
    komu: opts.komu,
    tema: `Подписка Spotify Premium заканчивается ${opts.kogda.toLocaleDateString('ru-RU')}`,
    telo:
      `Доступ (${opts.chto}) заканчивается ` +
      `${opts.kogda.toLocaleDateString('ru-RU')}.\n\n` +
      `Продлить на тот же аккаунт можно здесь — тариф, срок и почта уже подставлены:\n` +
      `${opts.ssylka}\n` +
      PODPIS,
  });
}

/**
 * Восстановление пароля Spotify.
 *
 * ⚠️ ЭТО ПИСЬМО — ОБЯЗАТЕЛЬНЫЙ ШАГ ПЕРЕД ОТМЕНОЙ, и порядок жёсткий
 * (постановка): пока письмо не отправлено, кнопка отмены в админке
 * не работает. Человек, у которого не подошёл пароль, обязан сначала
 * узнать, что делать.
 */
export async function pismoParolNePodoshyol(komu: string): Promise<void> {
  await otpravit({
    komu,
    tema: 'Не подошёл пароль от аккаунта Spotify',
    telo:
      `Мы попробовали войти в указанный аккаунт Spotify, и пароль не подошёл.\n\n` +
      `Что сделать:\n` +
      `1. Откройте https://www.spotify.com/ru-ru/login/\n` +
      `2. Нажмите «Забыли пароль?» и введите почту от аккаунта Spotify.\n` +
      `3. Перейдите по ссылке из письма Spotify и задайте новый пароль.\n` +
      `4. Оформите заказ заново и укажите новый пароль.\n\n` +
      `Заказ мы отменяем, деньги вернутся на баланс в личном кабинете:\n` +
      `${env.siteUrl}/cabinet/\n` +
      PODPIS,
  });
}

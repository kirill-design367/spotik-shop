/**
 * АВТОПЛАТЁЖ: то, что нужно и форме, и серверу (пятьдесят четвёртая
 * итерация).
 *
 * ⚠️ ФАЙЛ ОБЩИЙ ДЛЯ БРАУЗЕРА И СЕРВЕРА, и это не удобство, а условие
 * согласия. Текст под галочкой «Продлевать автоматически» человек
 * видит на форме, а в базу ложится текст, собранный СЕРВЕРОМ из цены
 * и тарифа, которые знает сервер (поле формы правится в браузере).
 * Собирай их две разные функции — однажды в истории согласий лежало бы
 * не то, что человек видел. Функция одна, и она здесь.
 */

import { PERIODS } from './plans';
import { rubli } from './server/money';

/** Ключи настроек. `setting` усекается в проверках — умолчание в коде. */
export const AVTO_NASTROYKA = 'avtoplatezh';
/**
 * Глобальная остановка списаний после трёх подряд ответов Робокассы
 * «не OK» (поправка money-3). Снимается тем же выключателем в админке:
 * выключить — включить.
 */
export const AVTO_STOP = 'avto_stop';

export type StatusAvto = 'zhdyot_oplaty' | 'vklyuchen' | 'ne_karta' | 'otklyuchen';
export type PrichinaAvto =
  | 'klient'
  | 'dve_neudachi'
  | 'zakaz_otmenyon'
  | 'ne_prodayotsya'
  | 'admin'
  | 'prosrochen'
  | 'testovaya'
  | 'zamenena'
  | 'bez_recurring'
  /** Аккаунт продлён другим заказом, и сдвинуть подписку на него нельзя (миграция 022). */
  | 'prodlen';

/** Срок в винительном падеже, после «на»: «на месяц», «на полгода». */
export function srokNa(period: number): string {
  const p = PERIODS.find((x) => x.key === period);
  return p ? p.label.toLowerCase() : `${period} мес.`;
}

/**
 * ТЕКСТ СОГЛАСИЯ ПОД ГАЛОЧКОЙ — с подстановками (поправки money-15,
 * product-2): какая сумма, за какой тариф и срок, откуда спишется,
 * что продлится тот же аккаунт и что промокод на продление
 * не переходит. Строка «с карты спишется» без суммы и без баланса
 * описывала бы не то списание, которое произойдёт.
 *
 * ⚠️ ЦЕНА — ЦЕНА ТАРИФА БЕЗ ПРОМОКОДА, но со скидкой тарифа: именно
 * её спишет автоплатёж (постановка: «по текущей цене тарифа и срока,
 * со скидкой тарифа, без промокода»).
 *
 * ⚠️ У ТАРИФА НА НЕСКОЛЬКИХ — «ЭТИ ЖЕ АККАУНТЫ»: продлевается весь
 * набор, и единственное число здесь было бы неправдой.
 */
export function tekstSoglasiyaAvto(o: {
  cenaKop: number;
  tarif: string;
  period: number;
  mest: number;
  promo: boolean;
}): string {
  const akkaunt =
    o.mest > 1
      ? 'Продлим эти же аккаунты с указанными почтами и паролями.'
      : 'Продлим этот же аккаунт с указанными почтой и паролем.';
  const promo = o.promo ? ' Промокод действует только на этот платёж.' : '';
  return (
    `В день окончания подписки спишется ${rubli(o.cenaKop)} — цена тарифа «${o.tarif}» на ${srokNa(o.period)} ` +
    'без промокода: с баланса, если на нём хватает, иначе с карты, которой вы платите сейчас. ' +
    `${akkaunt} Автоплатёж включится, только если оплатить картой. ` +
    `Отключить можно в личном кабинете в любой момент.${promo}`
  );
}

/**
 * Оплачен ли счёт КАРТОЙ — по полям уведомления Робокассы (поправка
 * money-18).
 *
 * ⚠️ ЕСЛИ `IncCurrLabel` ЕСТЬ, РЕШАЕТ ТОЛЬКО ОН. `PaymentMethod` бывает
 * общим (`PayButton` у СБП и кошельков), а у кошелька с карточной
 * основой может прийти и `BankCard`; метка валюты точнее —
 * `BankCardPSR` против `SBPPSR`. `PaymentMethod` учитывается лишь
 * при пустой метке.
 *
 * `null` — нет ни того, ни другого поля: решать не по чему, и для
 * автоплатежа это «не карта» (с предупреждением в журнал у вызывающего).
 */
export function oplachenoKartoy(paymentMethod: string, incCurrLabel: string): boolean | null {
  const metka = incCurrLabel.trim();
  if (metka) return /^BankCard/i.test(metka);
  const sposob = paymentMethod.trim();
  if (sposob) return sposob.toLowerCase() === 'bankcard';
  return null;
}

/** Строка способа оплаты для `payment.sposob`: «<PaymentMethod>/<IncCurrLabel>». */
export function sposobStrokoy(paymentMethod: string, incCurrLabel: string): string | null {
  const a = paymentMethod.trim();
  const b = incCurrLabel.trim();
  return a || b ? `${a}/${b}` : null;
}

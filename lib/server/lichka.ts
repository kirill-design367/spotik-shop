/**
 * Тексты личных сообщений оператору и кнопка «Take».
 *
 * ⚠️ ОДНО МЕСТО НА ДВЕ СТОРОНЫ: раздача заказов (`razdacha.ts`) пишет
 * предложение с кнопкой, а бот (`tgbot.ts`) принимает нажатие и правит
 * сообщение. Разойдись у них формат `callback_data` или текст «is
 * yours» — кнопка перестала бы работать молча.
 *
 * ⚠️ ТЕКСТЫ АНГЛИЙСКИЕ — это рабочие надписи для сотрудников (Р-120,
 * закон 40), и данных клиента в них нет вовсе: ни почты, ни пароля.
 * ⚠️ И НИГДЕ НЕ НАЗВАНЫ ДРУГИЕ ОПЕРАТОРЫ: оператор по-прежнему
 * не знает, что они есть (постановка, раздача, пункт 7).
 */

import { env } from './env';
import type { Klaviatura } from './telegram';

function ssylka(zakaz: number): string {
  return `${env.siteUrl}/admin/orders/${zakaz}/`;
}

/** Данные кнопки «Take»: `take:<номер заказа>`, до 64 байт с запасом. */
export function dannyeVzyat(zakaz: number): string {
  return `take:${zakaz}`;
}

/** Номер заказа из данных нажатия; `null` — это не наша кнопка. */
export function zakazIzNazhatiya(dannye: unknown): number | null {
  if (typeof dannye !== 'string') return null;
  const m = /^take:(\d{1,12})$/.exec(dannye);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Кнопка «Take» под предложением. */
export function knopkaVzyat(zakaz: number): Klaviatura {
  return { inline_keyboard: [[{ text: 'Take', callback_data: dannyeVzyat(zakaz) }]] };
}

/**
 * Предложение заказа: номер, тариф, срок, что делать с каждым аккаунтом
 * и сколько минут оно открыто. Тариф и срок — английские надписи
 * (Р-139), данных клиента нет вовсе: почты и пароли оператор увидит
 * в админке, когда возьмёт заказ.
 */
export function tekstPredlozheniya(p: {
  zakaz: number;
  tarif: string;
  srok: string;
  akkaunty: ('new' | 'renew')[];
  avto: boolean;
  minut: number;
}): string {
  const akk = p.akkaunty.map((m) => (m === 'renew' ? 'renewal' : 'new account')).join(', ');
  return [
    `New order #${p.zakaz}`,
    `Plan: ${p.tarif}, ${p.srok}`,
    ...(akk ? [`Accounts: ${akk}`] : []),
    ...(p.avto ? ['Auto-renewal'] : []),
    `The offer is open for ${p.minut} ${p.minut === 1 ? 'minute' : 'minutes'}.`,
    ssylka(p.zakaz),
  ].join('\n');
}

/** Заказ теперь у этого оператора. */
export function tekstTvoy(zakaz: number): string {
  return `Order #${zakaz} is yours.\n${ssylka(zakaz)}`;
}

/** Предложение этому оператору снято: истекло, заказ взял другой и т. п. */
export function tekstBolsheNePredlozhen(zakaz: number): string {
  return `Order #${zakaz} is no longer offered to you.`;
}

/** Администратор назначил заказ этому оператору вручную. */
export function tekstNaznachen(zakaz: number): string {
  return `Order #${zakaz} has been assigned to you.\n${ssylka(zakaz)}`;
}

/** Заказ передан другому — без имён (поправка concurrency-16). */
export function tekstPereNaznachen(zakaz: number): string {
  return `Order #${zakaz} has been reassigned. It is no longer yours.`;
}

/* ── Ответы бота в личном чате ─────────────────────────────────── */

export const OTVET = {
  privyazan: 'Linked. New orders for you will arrive here.',
  nevernaya: 'This link is invalid or has expired. Ask the administrator for a new one.',
  dlyaSotrudnikov: 'This bot is for Spotik Shop staff.',
  vzyat: 'Taken',
  nedostupen: 'This order is no longer available.',
  sboy: 'Something went wrong. Try again in a minute.',
} as const;

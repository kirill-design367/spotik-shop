/**
 * Настройки, которые меняет администратор.
 *
 * Хранятся строками: чисел тут два с половиной, а отдельная колонка
 * на каждое означала бы миграцию на каждую новую настройку.
 */

import { odna, tikho, zapros } from './db';
import { RAZDACHA_MINUT_DO, RAZDACHA_MINUT_OT, RAZDACHA_MINUT_UMOLCHANIE } from '@/lib/admin/razdacha';
import { AVTO_NASTROYKA } from '@/lib/avtoplatezh';

export const SROK_SERTIFIKATA = 'certificate_days';
/** Сколько минут заказ ждёт оператора, которому его предложили (раздача). */
export const RAZDACHA_MINUT = 'razdacha_minut';
/**
 * Служебные величины бота — не настройки администратора, но живут
 * здесь же: они обязаны переживать перезапуск и быть общими для двух
 * экземпляров приложения во время выкладки.
 *   `tg_offset` — с какого обновления читать `getUpdates`;
 *   `tg_bot_username` — имя бота из `getMe`, для ссылки привязки.
 */
export const TG_OFFSET = 'tg_offset';
export const TG_BOT = 'tg_bot_username';

export async function nastroyka(klyuch: string, poUmolchaniyu: string): Promise<string> {
  const r = await tikho(() => odna<{ value: string }>('select value from setting where key = $1', [klyuch]), null);
  return r?.value ?? poUmolchaniyu;
}

export async function zadatNastroyku(klyuch: string, znachenie: string): Promise<void> {
  await zapros(
    `insert into setting (key, value) values ($1, $2)
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [klyuch, znachenie],
  );
}

/** Срок жизни сертификата в днях. По умолчанию год, как в постановке. */
export async function srokSertifikataDney(): Promise<number> {
  const v = Number(await nastroyka(SROK_SERTIFIKATA, '365'));
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 365;
}

/**
 * Время на взятие предложенного заказа, минут. По умолчанию 15 —
 * постановка: «Если оператор не взял заказ за 15 минут…».
 */
export async function vremyaNaVzyatieMinut(): Promise<number> {
  const v = Number(await nastroyka(RAZDACHA_MINUT, String(RAZDACHA_MINUT_UMOLCHANIE)));
  return Number.isInteger(v) && v >= RAZDACHA_MINUT_OT && v <= RAZDACHA_MINUT_DO ? v : RAZDACHA_MINUT_UMOLCHANIE;
}

/**
 * ВЫКЛЮЧАТЕЛЬ АВТОПЛАТЕЖА (пятьдесят четвёртая итерация). Строки нет —
 * выключен: постановка «по умолчанию выключен», а `setting` усекается
 * в проверках, поэтому умолчание живёт здесь, а не в базе.
 *
 * ⚠️ ОН ЗАПРЕЩАЕТ ТОЛЬКО НОВОЕ (поправка money-7): галочку на оформлении,
 * `Recurring=true` в новых счетах, новые запросы списания и письма
 * автоплатежа. Уведомление по уже ушедшему списанию, разбор платежей
 * «в пути», отключение подписки из кабинета и по ссылке из письма
 * работают при любом его положении: деньги, уже взятые с карты, обязаны
 * дойти до заказа, а отказ от подписки закон велит принимать всегда.
 */
export async function avtoplatezhVklyuchen(): Promise<boolean> {
  return (await nastroyka(AVTO_NASTROYKA, '0')) === '1';
}

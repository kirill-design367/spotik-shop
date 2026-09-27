/**
 * Названия тарифов, заданные в админке.
 *
 * ⚠️ СОСТАВ ТАРИФОВ ОСТАЁТСЯ В `lib/plans.ts`, А ИМЕНА НАКЛАДЫВАЮТСЯ
 * ПОВЕРХ — ровно так же, как цены (Р-85). Лендинг собирается
 * на раннере GitHub, где базы нет вовсе, и он обязан собраться:
 * база недоступна — работают имена из кода, и страница выглядит
 * как раньше.
 *
 * ⚠️ ДВА ИМЕНИ РАЗНОГО КЛАССА, И ПУТАТЬ ИХ НЕЛЬЗЯ. Русское видит
 * КЛИЕНТ: главная, сертификаты, оформление, кабинет, письма.
 * Английское — надпись для СОТРУДНИКОВ: бот и английская админка
 * (закон 40). Клиенту английское не показывается нигде.
 */

import { tikho, zapros } from './db';
import { PLANS, type ImenaTarifov } from '@/lib/plans';

/** Имена из кода. Ни одного обращения к базе. */
export function imenaPoUmolchaniyu(): ImenaTarifov {
  const m: ImenaTarifov = {};
  for (const p of PLANS) m[p.id] = { name: p.name, nameEn: p.nameEn };
  return m;
}

export async function imenaTarifov(): Promise<ImenaTarifov> {
  const m = imenaPoUmolchaniyu();
  const rows = await tikho(
    () => zapros<{ plan_id: string; name: string; name_en: string }>('select plan_id, name, name_en from plan_name'),
    [] as { plan_id: string; name: string; name_en: string }[],
  );
  for (const r of rows) m[r.plan_id] = { name: r.name, nameEn: r.name_en };
  return m;
}

/**
 * Задать или снять имя.
 *
 * ⚠️ ПУСТЫЕ ОБА ПОЛЯ ЗНАЧАТ «ВЕРНУТЬ ИМЯ ИЗ КОДА». Отдельной кнопки
 * «сбросить» не заводим: она означала бы третье состояние у величины,
 * у которой их два, — так же, как у скидки (Р-116).
 */
export async function zadatImyaTarifa(planId: string, name: string, nameEn: string): Promise<void> {
  if (!name && !nameEn) {
    await zapros('delete from plan_name where plan_id = $1', [planId]);
    return;
  }
  const po = imenaPoUmolchaniyu()[planId];
  await zapros(
    `insert into plan_name (plan_id, name, name_en) values ($1, $2, $3)
     on conflict (plan_id) do update set name = excluded.name, name_en = excluded.name_en`,
    [planId, name || po?.name || planId, nameEn || po?.nameEn || planId],
  );
}

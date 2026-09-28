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
 *
 * ⚠️ РУССКИХ ИМЁН С СОРОК ТРЕТЬЕЙ ИТЕРАЦИИ ДВА: полное и КОРОТКОЕ
 * для карточки. Короткое пустое — на карточку встаёт полное, то есть
 * ровно то, что было до этой итерации; выдумывать его за человека
 * мы не имеем права, а брать короткое из `lib/plans.ts` тем более:
 * переименованный тариф менялся бы везде, кроме карточки, — тот же
 * дефект, который закрыл Р-142, только с другой стороны.
 */

import { tikho, zapros } from './db';
import { PLANS, type ImenaTarifov } from '@/lib/plans';

/** Имена из кода. Ни одного обращения к базе. */
export function imenaPoUmolchaniyu(): ImenaTarifov {
  const m: ImenaTarifov = {};
  for (const p of PLANS) m[p.id] = { name: p.name, nameEn: p.nameEn, short: p.short ?? p.name };
  return m;
}

export async function imenaTarifov(): Promise<ImenaTarifov> {
  const m = imenaPoUmolchaniyu();
  const rows = await tikho(
    () =>
      zapros<{ plan_id: string; name: string; name_en: string; name_short: string }>(
        'select plan_id, name, name_en, name_short from plan_name',
      ),
    [] as { plan_id: string; name: string; name_en: string; name_short: string }[],
  );
  /* ⚠️ КОРОТКОЕ ПУСТО — НА КАРТОЧКУ ИДЁТ ПОЛНОЕ ИМЯ ЭТОЙ ЖЕ СТРОКИ,
     а НЕ короткое из кода. Строка в базе значит «тариф переименован
     человеком», и подставить сюда `На одного` от `Индивидуальный`
     означало бы показать на карточке прежнее слово. */
  for (const r of rows) m[r.plan_id] = { name: r.name, nameEn: r.name_en, short: r.name_short || r.name };
  return m;
}

/**
 * Имена КАК ОНИ ЛЕЖАТ В БАЗЕ, без наложения на умолчания, — для формы
 * в админке.
 *
 * ⚠️ ФОРМА ОБЯЗАНА ПОКАЗЫВАТЬ ПУСТОЕ КОРОТКОЕ ИМЯ ПУСТЫМ, А НЕ
 * ПОДСТАВЛЯТЬ ДЕЙСТВУЮЩЕЕ. Подставь мы туда действующее — админ,
 * который правит только полное имя, сохранил бы вместе с ним
 * и старое короткое, и карточка на главной осталась бы с прежним
 * словом: ровно тот дефект, который закрыл Р-142, только вернувшийся
 * через форму. Пустым поле значит «на карточке стоит полное», и это
 * же написано в подсказке.
 */
export async function imenaSyrye(): Promise<ImenaTarifov> {
  const rows = await tikho(
    () =>
      zapros<{ plan_id: string; name: string; name_en: string; name_short: string }>(
        'select plan_id, name, name_en, name_short from plan_name',
      ),
    [] as { plan_id: string; name: string; name_en: string; name_short: string }[],
  );
  const m: ImenaTarifov = {};
  for (const r of rows) m[r.plan_id] = { name: r.name, nameEn: r.name_en, short: r.name_short };
  return m;
}

/**
 * Задать или снять имя.
 *
 * ⚠️ ПУСТЫЕ ВСЕ ПОЛЯ ЗНАЧАТ «ВЕРНУТЬ ИМЯ ИЗ КОДА». Отдельной кнопки
 * «сбросить» не заводим: она означала бы третье состояние у величины,
 * у которой их два, — так же, как у скидки (Р-116).
 *
 * ⚠️ КОРОТКОЕ ИМЯ НЕОБЯЗАТЕЛЬНО, и пустым оно остаётся законно:
 * у тарифа с коротким названием второму полю взяться неоткуда.
 * Пустое короткое значит «на карточке стоит полное».
 */
export async function zadatImyaTarifa(
  planId: string,
  name: string,
  nameEn: string,
  short = '',
): Promise<void> {
  if (!name && !nameEn && !short) {
    await zapros('delete from plan_name where plan_id = $1', [planId]);
    return;
  }
  const po = imenaPoUmolchaniyu()[planId];
  await zapros(
    `insert into plan_name (plan_id, name, name_en, name_short) values ($1, $2, $3, $4)
     on conflict (plan_id) do update
        set name = excluded.name, name_en = excluded.name_en, name_short = excluded.name_short`,
    [planId, name || po?.name || planId, nameEn || po?.nameEn || planId, short],
  );
}

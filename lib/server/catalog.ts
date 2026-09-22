/**
 * Каталог: цены и сроки.
 *
 * ⚠️ `lib/plans.ts` ОСТАЁТСЯ ИСТОЧНИКОМ СОСТАВА, А БАЗА — ИСТОЧНИКОМ
 * ЦЕН. Так это устроено не из лени: лендинг собирается на раннере
 * GitHub, где базы нет вовсе, и он обязан собраться. Цены из базы
 * НАКЛАДЫВАЮТСЯ поверх умолчаний; база недоступна — работают
 * умолчания, и страница выглядит ровно как раньше.
 *
 * ⚠️ ВНУТРИ ВСЁ В КОПЕЙКАХ. В `lib/plans.ts` цены в рублях —
 * это данные для вёрстки, и трогать их формат незачем; на входе
 * в сервер они домножаются на сто ОДИН раз, здесь.
 */

import { DARIMYE, PERIODS, type Plan, type PeriodKey } from '@/lib/plans';
import { tikho, zapros } from './db';

export type Cena = { period: PeriodKey; kop: number };

export type TarifSCenami = {
  id: string;
  name: string;
  short: string;
  people: number;
  note: string;
  gift: boolean;
  /** Сроки, на которые тариф вообще оформляется. */
  ceny: Cena[];
};

export const SROKI = PERIODS;

/** Срок жизни сертификата по умолчанию — год, как в постановке. */
export const SROK_SERTIFIKATA_PO_UMOLCHANIYU = 365;

function umolchaniya(): Map<string, Map<number, number>> {
  const m = new Map<string, Map<number, number>>();
  for (const p of DARIMYE) {
    const ceny = new Map<number, number>();
    for (const [k, v] of Object.entries(p.prices)) {
      if (typeof v === 'number') ceny.set(Number(k), Math.round(v * 100));
    }
    m.set(p.id, ceny);
  }
  return m;
}

/**
 * Каталог с наложенными ценами из базы.
 *
 * Цена из базы ПЕРЕКРЫВАЕТ умолчание, а не дополняет его: админ,
 * поставивший 0, и имеет в виду ноль. Срок, которого нет ни там,
 * ни там, тарифом не оформляется вовсе — так сейчас у «На троих».
 *
 * ⚠️ КАРТОЧКИ СЕРТИФИКАТА В КАТАЛОГЕ НЕТ ВОВСЕ. Сертификат
 * не тариф: он дарит один из этих же тарифов и стоит ровно столько же
 * (Р-93). Заказ на сертификат несёт `plan_id` ПОДАРЕННОГО тарифа
 * и отличается от обычного только полем `kind`.
 */
export async function katalog(): Promise<TarifSCenami[]> {
  const ceny = umolchaniya();
  const rows = await tikho(
    () => zapros<{ plan_id: string; period: number; price_kop: string }>('select plan_id, period, price_kop from plan_price'),
    [] as { plan_id: string; period: number; price_kop: string }[],
  );
  for (const r of rows) {
    const m = ceny.get(r.plan_id) ?? new Map<number, number>();
    m.set(Number(r.period), Number(r.price_kop));
    ceny.set(r.plan_id, m);
  }
  return DARIMYE.map((p) => svesti(p, ceny.get(p.id)));
}

/** Тот же каталог, но без единого обращения к базе. */
export function katalogPoUmolchaniyu(): TarifSCenami[] {
  const ceny = umolchaniya();
  return DARIMYE.map((p) => svesti(p, ceny.get(p.id)));
}

function svesti(p: Plan, ceny: Map<number, number> | undefined): TarifSCenami {
  const spisok: Cena[] = [];
  for (const s of PERIODS) {
    const kop = ceny?.get(s.key);
    if (typeof kop === 'number') spisok.push({ period: s.key, kop });
  }
  return {
    id: p.id,
    name: p.name,
    short: p.short ?? p.name,
    people: p.people,
    note: p.note,
    gift: Boolean(p.gift),
    ceny: spisok,
  };
}

export function naytiTarif(spisok: TarifSCenami[], id: string): TarifSCenami | null {
  return spisok.find((t) => t.id === id) ?? null;
}

export function cenaTarifa(t: TarifSCenami, period: number): number | null {
  return t.ceny.find((c) => c.period === period)?.kop ?? null;
}

/** Срок в человеческом виде: «6 мес». */
export function srokKratko(period: number): string {
  return PERIODS.find((p) => p.key === period)?.short ?? `${period} мес`;
}

export function srokPolno(period: number): string {
  return PERIODS.find((p) => p.key === period)?.label ?? `${period} месяцев`;
}

/**
 * Что подарено, одной строкой: «На двоих, Полгода».
 *
 * ⚠️ ОДНО МЕСТО НА ВЕСЬ САЙТ. Строка встаёт в письмо, в кабинет,
 * на страницу активации и в админку; собери её в четырёх местах —
 * и на четвёртой правке они разойдутся.
 */
export function podarokSlovami(planName: string, period: number): string {
  return `${planName}, ${srokPolno(period).toLowerCase()}`;
}

export type { PeriodKey };

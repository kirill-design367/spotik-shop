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

/**
 * Цена на срок.
 *
 * ⚠️ `kop` — ЭТО ВСЕГДА ЦЕНА, ПО КОТОРОЙ ПЛАТЯТ. Скидка не лежит
 * рядом «на выбор»: она уже применена, и весь остальной код —
 * оформление, чек, письмо, статистика — о ней вообще не знает.
 * Знать о ней должен ровно один: тот, кто рисует зачёркнутую
 * старую цену.
 */
export type Cena = { period: PeriodKey; kop: number; bezSkidki?: number; doDaty?: string };

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

  /* ⚠️ СКИДКА СНИМАЕТСЯ САМА, И СНИМАЕТ ЕЁ ЗАПРОС, А НЕ БУДИЛЬНИК.
     `until >= current_date` — это и есть «после даты окончания скидка
     снимается»: ни уборки, ни таймера для этого не нужно, и забыть
     его негде. Лендинг статический, но у него стоит `revalidate`,
     поэтому новая цена доезжает сама (Р-85). */
  const skidki = await tikho(
    () =>
      zapros<{ plan_id: string; period: number; price_kop: string; until: Date }>(
        'select plan_id, period, price_kop, until from plan_discount where until >= current_date',
      ),
    [] as { plan_id: string; period: number; price_kop: string; until: Date }[],
  );
  /* ⚠️ В `plan_off` ЛЕЖАТ ТОЛЬКО ВЫКЛЮЧЕННЫЕ ПАРЫ. «Ничего не
     сказано» значит «доступно, если есть цена», — то самое поведение,
     которое было до сетки доступности. */
  const vyklyucheny = await tikho(
    () => zapros<{ plan_id: string; period: number }>('select plan_id, period from plan_off'),
    [] as { plan_id: string; period: number }[],
  );

  return DARIMYE.map((p) => svesti(p, ceny.get(p.id), skidki, vyklyucheny));
}

/** Скидки и выключенные пары — для админки, без наложения на цены. */
export async function skidkiIVyklyuchennye(): Promise<{
  skidki: { planId: string; period: number; kop: number; until: string }[];
  vyklyucheny: { planId: string; period: number }[];
}> {
  const s = await tikho(
    () =>
      zapros<{ plan_id: string; period: number; price_kop: string; until: Date }>(
        'select plan_id, period, price_kop, until from plan_discount',
      ),
    [] as { plan_id: string; period: number; price_kop: string; until: Date }[],
  );
  const v = await tikho(
    () => zapros<{ plan_id: string; period: number }>('select plan_id, period from plan_off'),
    [] as { plan_id: string; period: number }[],
  );
  return {
    skidki: s.map((r) => ({
      planId: r.plan_id,
      period: Number(r.period),
      kop: Number(r.price_kop),
      until: new Date(r.until).toISOString().slice(0, 10),
    })),
    vyklyucheny: v.map((r) => ({ planId: r.plan_id, period: Number(r.period) })),
  };
}

/** Тот же каталог, но без единого обращения к базе. */
export function katalogPoUmolchaniyu(): TarifSCenami[] {
  const ceny = umolchaniya();
  return DARIMYE.map((p) => svesti(p, ceny.get(p.id)));
}

/**
 * Каталог со ВСЕМИ ценами, без учёта выключенных пар, — для админки.
 * Сетка доступности обязана показывать и выключенные ячейки: иначе
 * включить их обратно было бы нечем.
 */
export async function katalogPolny(): Promise<TarifSCenami[]> {
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

function svesti(
  p: Plan,
  ceny: Map<number, number> | undefined,
  skidki: { plan_id: string; period: number; price_kop: string; until: Date }[] = [],
  vyklyucheny: { plan_id: string; period: number }[] = [],
): TarifSCenami {
  const spisok: Cena[] = [];
  for (const s of PERIODS) {
    const kop = ceny?.get(s.key);
    if (typeof kop !== 'number') continue;
    if (vyklyucheny.some((v) => v.plan_id === p.id && Number(v.period) === s.key)) continue;
    const sk = skidki.find((x) => x.plan_id === p.id && Number(x.period) === s.key);
    if (sk && Number(sk.price_kop) < kop) {
      const d = new Date(sk.until);
      spisok.push({
        period: s.key,
        kop: Number(sk.price_kop),
        bezSkidki: kop,
        doDaty: `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
      });
      continue;
    }
    spisok.push({ period: s.key, kop });
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

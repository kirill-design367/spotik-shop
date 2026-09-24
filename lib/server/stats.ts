/**
 * Статистика для админки.
 *
 * ⚠️ СЧИТАЕТСЯ ПО БАЗЕ, А НЕ ПО МЕТРИКЕ — прямое требование
 * постановки: «цифры должны сходиться с реальными заказами».
 * Метрика видит браузеры, база видит заказы; расходятся они всегда,
 * и верить надо второй.
 *
 * ⚠️ ВЫРУЧКА — ЭТО `money_kop`, А НЕ `total_kop`, и это не мелочь.
 * `total_kop` — цена заказа; в неё входит и то, что списано
 * с баланса, а баланс появляется ТОЛЬКО возвратом за ранее
 * оплаченный заказ (Р-89). Считать его выручкой значило бы
 * посчитать одни и те же деньги дважды. У заказа по сертификату
 * сумма и вовсе нулевая: деньги взяли, когда покупали сертификат
 * (Р-93), — и они уже посчитаны там.
 *
 * ⚠️ ПЕРИОД ОТСЧИТЫВАЕТСЯ ОТ `now()` НАЗАД, А НЕ ОТ ПОЛУНОЧИ.
 * «За сутки» — это последние 24 часа, и такой счёт не зависит
 * от часового пояса базы вовсе. Календарные сутки потребовали бы
 * знать, в каком поясе живёт заказчик, а сервер стоит в UTC.
 */

import { odna, zapros } from './db';
import { katalog, naytiTarif, srokKratko } from './catalog';

export type StrokaPerioda = { kluch: 'day' | 'week' | 'month'; zakazov: number; vyruchkaKop: number };
export type StrokaTarifa = { plan: string; srok: string; zakazov: number; vyruchkaKop: number };
export type StrokaIstochnika = { istochnik: string | null; zakazov: number; dolya: number };

export type Svodka = {
  periody: StrokaPerioda[];
  vOcheredi: number;
  /** Минуты. `null` — выполненных заказов ещё не было. */
  srednyayaMinut: number | null;
  tarify: StrokaTarifa[];
  sertifikatovKupleno: number;
  sertifikatovAktivirovano: number;
  istochniki: StrokaIstochnika[];
};

const PERIODY = [
  { kluch: 'day' as const, sql: '1 day' },
  { kluch: 'week' as const, sql: '7 days' },
  { kluch: 'month' as const, sql: '30 days' },
];

export async function svodka(): Promise<Svodka> {
  const periody: StrokaPerioda[] = [];
  for (const p of PERIODY) {
    /* ⚠️ ИНТЕРВАЛ ПОДСТАВЛЯЕТСЯ ПАРАМЕТРОМ, А НЕ СКЛЕЙКОЙ. Строка тут
       своя и безопасная, но склейка в SQL — привычка, которая однажды
       встретит чужую строку. */
    const r = await odna<{ n: string; kop: string }>(
      `select count(*)::text as n, coalesce(sum(money_kop), 0)::text as kop
         from shop_order
        where paid_at is not null and paid_at > now() - ($1)::interval`,
      [p.sql],
    );
    periody.push({ kluch: p.kluch, zakazov: Number(r?.n ?? 0), vyruchkaKop: Number(r?.kop ?? 0) });
  }

  const och = await odna<{ n: string }>(
    `select count(*)::text as n from shop_order where status in ('paid', 'in_work')`,
  );

  /* Среднее время выполнения: от оплаты до закрытия. Незакрытые
     заказы в счёт не идут вовсе — у них этого времени ещё нет,
     а подставлять «сейчас» значило бы считать незаконченную работу
     законченной. */
  const sr = await odna<{ min: string | null }>(
    `select round(avg(extract(epoch from (closed_at - paid_at)) / 60))::text as min
       from shop_order
      where status = 'done' and paid_at is not null and closed_at is not null
        and closed_at > now() - interval '30 days'`,
  );

  const potarif = await zapros<{ plan_id: string; period: number; n: string; kop: string }>(
    `select plan_id, period, count(*)::text as n, coalesce(sum(money_kop), 0)::text as kop
       from shop_order
      where paid_at is not null and paid_at > now() - interval '30 days'
      group by plan_id, period
      order by count(*) desc, plan_id`,
  );
  const spisok = await katalog();
  const tarify: StrokaTarifa[] = potarif.map((r) => ({
    plan: naytiTarif(spisok, r.plan_id)?.name ?? r.plan_id,
    srok: srokKratko(r.period),
    zakazov: Number(r.n),
    vyruchkaKop: Number(r.kop),
  }));

  const sert = await odna<{ kupleno: string; aktivirovano: string }>(
    `select count(*)::text as kupleno,
            count(*) filter (where used_at is not null)::text as aktivirovano
       from certificate`,
  );

  /* ⚠️ ИСТОЧНИКИ СЧИТАЮТСЯ ПО ОПЛАЧЕННЫМ ЗАКАЗАМ, а не по всем
     созданным: незавершённое оформление — это не источник заказа,
     а брошенная корзина, и смешивать их в одной таблице нельзя. */
  const ist = await zapros<{ utm_source: string | null; n: string }>(
    `select utm_source, count(*)::text as n
       from shop_order
      where paid_at is not null and paid_at > now() - interval '30 days'
      group by utm_source
      order by count(*) desc`,
  );
  const vsego = ist.reduce((a, r) => a + Number(r.n), 0);
  const istochniki: StrokaIstochnika[] = ist.map((r) => ({
    istochnik: r.utm_source,
    zakazov: Number(r.n),
    /* Деление на ноль невозможно по построению: если строк нет,
       цикла нет вовсе. */
    dolya: vsego ? Math.round((Number(r.n) / vsego) * 100) : 0,
  }));

  return {
    periody,
    vOcheredi: Number(och?.n ?? 0),
    srednyayaMinut: sr?.min == null ? null : Number(sr.min),
    tarify,
    sertifikatovKupleno: Number(sert?.kupleno ?? 0),
    sertifikatovAktivirovano: Number(sert?.aktivirovano ?? 0),
    istochniki,
  };
}

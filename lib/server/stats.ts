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
 * ⚠️ БЫСТРЫЙ ПЕРИОД ОТСЧИТЫВАЕТСЯ ОТ `now()` НАЗАД, А НЕ ОТ ПОЛУНОЧИ.
 * «За сутки» — это последние 24 часа, и такой счёт не зависит
 * от часового пояса базы вовсе. Календарные сутки потребовали бы
 * знать, в каком поясе живёт заказчик, а сервер стоит в UTC.
 *
 * ⚠️ А ВЫБРАННЫЕ ДАТЫ — ИМЕННО КАЛЕНДАРНЫЕ, И ЭТО ДРУГОЕ. Человек,
 * набравший «с 12.09 по 12.09», спрашивает про ЭТОТ ДЕНЬ целиком,
 * а не про сутки от текущего часа: граница идёт `>= дата`
 * и `< дата + 1`, то есть последний день входит полностью.
 *
 * ⚠️ ПЕРИОД ОДИН НА ВЕСЬ ЭКРАН (сорок вторая итерация). Прежде
 * первая таблица показывала сутки, неделю и месяц сразу, а таблицы
 * тарифов и источников молча считались за 30 дней — два разных
 * периода на одной странице, и второй из них не был назван нигде.
 * Теперь их один, он выбирается и он написан.
 */

import { odna, zapros } from './db';

/* ⚠️ ТАРИФ И СРОК СЫРЫЕ: переводит их страница, зная свой язык.

   ⚠️ `vyruchkaKop` — `null` У ИСПОЛНИТЕЛЯ (сорок шестая итерация).
   Постановка: «У оператора убери всё про деньги… Убирай на сервере:
   данные о деньгах не должны уходить оператору вообще, а не
   прятаться разметкой». Отсутствие величины выражено `null`,
   а не нулём: ноль — законная выручка (подарочные заказы её
   не приносят вовсе), и путать эти два состояния нельзя — то же
   правило, что у денег одного заказа (Р-148). */
export type StrokaTarifa = { planId: string; period: number; zakazov: number; vyruchkaKop: number | null };
export type StrokaIstochnika = { istochnik: string | null; zakazov: number; dolya: number };

/**
 * СКОЛЬКО СДЕЛАЛ КАЖДЫЙ СОТРУДНИК за выбранный период.
 *
 * ⚠️ СЧИТАЮТСЯ СОБЫТИЯ ЖУРНАЛА, А НЕ ЗАКАЗЫ ПО `operator_id`.
 * Вопрос здесь исторический — «сколько он ВЫПОЛНИЛ», — а
 * `operator_id` хранит текущего держателя: у закрытого заказа это
 * остаток, и читать остаток как «кто это сделал» нельзя (то же
 * рассуждение, что в `zakrytye`). Журнал заведён миграцией 012
 * и засыпан историей старых заказов, поэтому «до этой итерации»
 * в таблице тоже видно.
 *
 * ⚠️ ПЕРИОД БЕРЁТСЯ ПО ВРЕМЕНИ СОБЫТИЯ, а не по оплате заказа:
 * спрашивают, сколько человек сделал ЗА ЭТИ ДНИ, а оплатить заказ
 * могли месяцем раньше.
 *
 * ⚠️ ОТМЕНЫ САМИМ ПОКУПАТЕЛЕМ СЮДА НЕ ВХОДЯТ, И ДЕРЖИТСЯ ЭТО
 * ПОСТРОЕНИЕМ, А НЕ УСЛОВИЕМ. У такой отмены `staff_id` пустой —
 * «сотрудника не было» (Р-153), — а запрос СОЕДИНЯЕТСЯ со `staff`
 * внутренним соединением: строка без сотрудника не доходит
 * до группировки вовсе. Отдельный признак «это не покупатель» был бы
 * вторым источником одного и того же и разошёлся бы с первым
 * на ближайшей правке порядка отмены (то же, что закон 48 про пустой
 * `operator_id`).
 */
export type StrokaSotrudnika = {
  email: string;
  zakazov: number;
  /** Разбивка ВЫПОЛНЕННЫХ по тарифам; `planId` сырой — переводит страница. */
  tarify: { planId: string; zakazov: number }[];
  /** Сколько заказов сотрудник ОТМЕНИЛ за тот же период. */
  otmen: number;
  /** Разбивка ОТМЕНЁННЫХ по тарифам; `planId` сырой — переводит страница. */
  tarifyOtmen: { planId: string; zakazov: number }[];
};

export type BystryPeriod = 'day' | 'week' | 'month';

/** Быстрый период или пара календарных дат. */
export type Period = { vid: BystryPeriod } | { vid: 'daty'; ot: string; do: string | null };

export const BYSTRYE: { kluch: BystryPeriod; sql: string }[] = [
  { kluch: 'day', sql: '1 day' },
  { kluch: 'week', sql: '7 days' },
  { kluch: 'month', sql: '30 days' },
];

export type Svodka = {
  zakazov: number;
  /** Выручка за период. `null` — СПРАШИВАЛ НЕ АДМИНИСТРАТОР. */
  vyruchkaKop: number | null;
  vOcheredi: number;
  /** Минуты. `null` — выполненных заказов за период не было. */
  srednyayaMinut: number | null;
  tarify: StrokaTarifa[];
  /**
   * По сотрудникам. `null` — СПРАШИВАЛ НЕ АДМИНИСТРАТОР.
   *
   * ⚠️ ИСПОЛНИТЕЛЮ ЧУЖИХ ПОЧТ НЕ ВИДНО (постановка, пункт 5),
   * и, как с деньгами заказа (Р-148), наружу не уходит сам список:
   * спрятать блок стилем значило бы оставить адреса в разметке.
   */
  poSotrudnikam: StrokaSotrudnika[] | null;
  sertifikatovKupleno: number;
  sertifikatovAktivirovano: number;
  istochniki: StrokaIstochnika[];
};

/**
 * Разобрать период из адреса.
 *
 * ⚠️ ЧУЖОЕ ЗНАЧЕНИЕ ПАДАЕТ В УМОЛЧАНИЕ, А НЕ РОНЯЕТ СТРАНИЦУ. Период
 * приходит из адресной строки, то есть его пишет кто угодно; «месяц»
 * тут безопасное умолчание, и оно же сохраняет прежний смысл таблиц
 * тарифов и источников (они считались за 30 суток).
 */
export function ponyatPeriod(vid: string, ot: string, doDaty: string): Period {
  const data = /^\d{4}-\d{2}-\d{2}$/;
  if (data.test(ot)) return { vid: 'daty', ot, do: data.test(doDaty) ? doDaty : null };
  const b = BYSTRYE.find((x) => x.kluch === vid);
  return { vid: b ? b.kluch : 'month' };
}

/**
 * Границы периода одним условием.
 *
 * ⚠️ ИНТЕРВАЛ И ДАТЫ ПОДСТАВЛЯЮТСЯ ПАРАМЕТРАМИ, А НЕ СКЛЕЙКОЙ. Строки
 * тут свои и безопасные, но склейка в SQL — привычка, которая однажды
 * встретит чужую строку. Имя колонки — единственное, что попадает
 * в текст запроса, и оно приходит из этого же файла, а не снаружи.
 */
function granicy(
  p: Period,
  kolonka: 'paid_at' | 'closed_at' | 'e.created_at' = 'paid_at',
): { uslovie: string; params: string[] } {
  if (p.vid === 'daty') {
    return {
      uslovie: `${kolonka} >= $1::date and ${kolonka} < ($2::date + 1)`,
      params: [p.ot, p.do ?? p.ot],
    };
  }
  const sql = BYSTRYE.find((x) => x.kluch === p.vid)?.sql ?? '30 days';
  return { uslovie: `${kolonka} > now() - ($1)::interval`, params: [sql] };
}

export async function svodka(p: Period, admin = false): Promise<Svodka> {
  const g = granicy(p);

  /* ⚠️ ДЕНЬГИ НЕ ПОДНИМАЮТСЯ ИЗ БАЗЫ ВОВСЕ, КОГДА ПОКАЗЫВАТЬ ИХ
     НЕКОМУ. «Убирай на сервере» можно было бы выполнить и стиранием
     числа перед возвратом, но не считать его — короче и строже:
     тогда нет ни одного места, где сумма существует и её забыли
     убрать. То же рассуждение, что у списка сотрудников ниже. */
  const itog = await odna<{ n: string; kop: string | null }>(
    `select count(*)::text as n${admin ? ', coalesce(sum(money_kop), 0)::text as kop' : ', null as kop'}
       from shop_order
      where paid_at is not null and ${g.uslovie}`,
    g.params,
  );

  const och = await odna<{ n: string }>(
    `select count(*)::text as n from shop_order where status in ('paid', 'in_work')`,
  );

  /* Среднее время выполнения: от оплаты до закрытия. Незакрытые
     заказы в счёт не идут вовсе — у них этого времени ещё нет,
     а подставлять «сейчас» значило бы считать незаконченную работу
     законченной. Период здесь берётся по ЗАКРЫТИЮ: вопрос «сколько
     мы делали заказы за эти дни», а не «когда их оплатили». */
  const gz = granicy(p, 'closed_at');
  const sr = await odna<{ min: string | null }>(
    `select round(avg(extract(epoch from (closed_at - paid_at)) / 60))::text as min
       from shop_order
      where status = 'done' and paid_at is not null and closed_at is not null and ${gz.uslovie}`,
    gz.params,
  );

  const potarif = await zapros<{ plan_id: string; period: number; n: string; kop: string | null }>(
    `select plan_id, period, count(*)::text as n${
      admin ? ', coalesce(sum(money_kop), 0)::text as kop' : ', null as kop'
    }
       from shop_order
      where paid_at is not null and ${g.uslovie}
      group by plan_id, period
      order by count(*) desc, plan_id`,
    g.params,
  );
  const tarify: StrokaTarifa[] = potarif.map((r) => ({
    planId: r.plan_id,
    period: r.period,
    zakazov: Number(r.n),
    vyruchkaKop: r.kop === null ? null : Number(r.kop),
  }));

  /* ⚠️ СЕРТИФИКАТЫ СЧИТАЮТСЯ ЗА ВСЁ ВРЕМЯ, И ЭТО НАЗВАНО НА ЭКРАНЕ.
     «Куплено» и «активировано» — это остаток, а не поток: код живёт
     год и активируется когда угодно, поэтому «за неделю активировано
     ноль» не значит ничего. Считать их за период можно, но тогда две
     величины на одном экране мерили бы разное, и на экране это
     не было бы видно. */
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
      where paid_at is not null and ${g.uslovie}
      group by utm_source
      order by count(*) desc`,
    g.params,
  );
  const vsego = ist.reduce((a, r) => a + Number(r.n), 0);
  const istochniki: StrokaIstochnika[] = ist.map((r) => ({
    istochnik: r.utm_source,
    zakazov: Number(r.n),
    /* Деление на ноль невозможно по построению: если строк нет,
       цикла нет вовсе. */
    dolya: vsego ? Math.round((Number(r.n) / vsego) * 100) : 0,
  }));

  /* ⚠️ ОДИН ЗАПРОС НА ИТОГ И НА РАЗБИВКУ. Две выборки — «сколько
     всего» и «по тарифам» — считали бы одно и то же дважды и разошлись
     бы на границе периода: между ними прошло бы время, и событие,
     случившееся в этот зазор, попало бы только во вторую. Итог
     складывается из разбивки здесь же.

     ⚠️ ЗАПРОС ИДЁТ, ТОЛЬКО ЕСЛИ СПРАШИВАЕТ АДМИНИСТРАТОР: адресам
     сотрудников незачем даже подниматься из базы, когда показывать
     их некому. */
  let poSotrudnikam: StrokaSotrudnika[] | null = null;
  if (admin) {
    const gs = granicy(p, 'e.created_at');
    /* ⚠️ ВЫПОЛНЕННОЕ И ОТМЕНЁННОЕ БЕРУТСЯ ОДНИМ ЗАПРОСОМ, а не двумя.
       Два запроса считали бы одно и то же поле `e.created_at` в разные
       мгновения, и событие, случившееся в зазор между ними, попало бы
       только во второй: у одного сотрудника число выполненных и число
       отменённых оказались бы за чуть разные периоды, и на экране
       это было бы не видно. Вид события едет колонкой и разбирается
       здесь же. */
    const rows = await zapros<{ email: string; plan_id: string; vid: string; n: string }>(
      `select f.email, o.plan_id, e.vid, count(*)::text as n
         from order_event e
         join staff f on f.id = e.staff_id
         join shop_order o on o.id = e.order_id
        where e.vid in ('vypolnil', 'otmenil') and ${gs.uslovie}
        group by f.email, o.plan_id, e.vid
        order by f.email, count(*) desc, o.plan_id`,
      gs.params,
    );
    const po = new Map<string, StrokaSotrudnika>();
    for (const r of rows) {
      const n = Number(r.n);
      const est = po.get(r.email) ?? { email: r.email, zakazov: 0, tarify: [], otmen: 0, tarifyOtmen: [] };
      if (r.vid === 'otmenil') {
        est.otmen += n;
        est.tarifyOtmen.push({ planId: r.plan_id, zakazov: n });
      } else {
        est.zakazov += n;
        est.tarify.push({ planId: r.plan_id, zakazov: n });
      }
      po.set(r.email, est);
    }
    /* ⚠️ ПОРЯДОК ДЕРЖИТСЯ ВЫПОЛНЕННЫМИ, А НЕ СУММОЙ СОБЫТИЙ: таблица
       отвечает на вопрос «сколько сделал каждый», и сотрудник,
       который много отменял, не должен из-за этого подниматься выше
       того, кто много выполнил. В списке он при этом остаётся —
       даже с нулём выполненных: за период он работал. */
    poSotrudnikam = [...po.values()].sort(
      (a, b) => b.zakazov - a.zakazov || b.otmen - a.otmen || a.email.localeCompare(b.email),
    );
  }

  return {
    zakazov: Number(itog?.n ?? 0),
    vyruchkaKop: itog?.kop == null ? null : Number(itog.kop),
    vOcheredi: Number(och?.n ?? 0),
    srednyayaMinut: sr?.min == null ? null : Number(sr.min),
    tarify,
    poSotrudnikam,
    sertifikatovKupleno: Number(sert?.kupleno ?? 0),
    sertifikatovAktivirovano: Number(sert?.aktivirovano ?? 0),
    istochniki,
  };
}

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

/**
 * ОБЩИЕ ЦИФРЫ ПО СЕРВИСУ — ТОЛЬКО АДМИНИСТРАТОРУ.
 *
 * ⚠️ ПОСТАНОВКА СОРОК ДЕВЯТОЙ ИТЕРАЦИИ: «Общих цифр по всему сервису
 * у него нет: общего числа заказов, очереди, среднего времени,
 * сертификатов. Отбор — на сервере». Поэтому у оператора этого
 * объекта нет вовсе (`null`), и запросы за ним не выполняются:
 * «не показываем» сделано не разметкой — то же правило, что у денег
 * заказа (Р-148) и у выручки (Р-155).
 */
export type Obshchee = {
  /** Оплаченные заказы за период (по дате оплаты) — как было. */
  zakazov: number;
  vyruchkaKop: number;
  vOcheredi: number;
  /** Минуты. `null` — выполненных заказов за период не было. */
  srednyayaMinut: number | null;
  sertifikatovKupleno: number;
  sertifikatovAktivirovano: number;
};

export type Svodka = {
  /** `null` — СПРАШИВАЛ НЕ АДМИНИСТРАТОР. */
  obshchee: Obshchee | null;
  /**
   * ВЫПОЛНЕННЫЕ заказы за период — у администратора все, у оператора
   * только его. Это и есть «общее число» оператора из постановки.
   */
  vypolneno: number;
  /**
   * По тарифам и срокам: ТОЛЬКО ВЫПОЛНЕННЫЕ, по времени выполнения
   * (сорок девятая итерация). У оператора — только его.
   */
  tarify: StrokaTarifa[];
  /**
   * По сотрудникам. `null` — СПРАШИВАЛ НЕ АДМИНИСТРАТОР.
   *
   * ⚠️ ИСПОЛНИТЕЛЮ ЧУЖИХ ПОЧТ НЕ ВИДНО (постановка, пункт 5),
   * и, как с деньгами заказа (Р-148), наружу не уходит сам список:
   * спрятать блок стилем значило бы оставить адреса в разметке.
   */
  poSotrudnikam: StrokaSotrudnika[] | null;
  /**
   * Источники заказов. `null` — СПРАШИВАЛ НЕ АДМИНИСТРАТОР.
   *
   * ⚠️ ПОСТАНОВКА СОРОК СЕДЬМОЙ ИТЕРАЦИИ: «Убери у оператора таблицу
   * „Источники заказов" — на сервере, как выручку». Значит запрос
   * не выполняется вовсе, а не прячется разметкой: реклама — это
   * то же, что деньги, и знать о ней исполнителю незачем (Р-155).
   */
  istochniki: StrokaIstochnika[] | null;
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
  kolonka: 'paid_at' | 'closed_at' | 'o.closed_at' | 'e.created_at' = 'paid_at',
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

/**
 * Сводка за период.
 *
 * `kto` — кто спрашивает: администратор видит весь сервис, оператор —
 * только свои выполненные заказы (сорок девятая итерация, пункт 4).
 */
export async function svodka(p: Period, kto: { admin: boolean; staffId: number }): Promise<Svodka> {
  const admin = kto.admin;

  /* ⚠️ «ВЫПОЛНЕННЫЙ» — ЭТО СТАТУС `done`, А ДАТА — ВРЕМЯ ВЫПОЛНЕНИЯ
     (`closed_at`), и это одна величина на весь экран (постановка
     сорок девятой итерации, пункты 1 и 2). Прежде таблица тарифов
     и источников брала ВСЕ ОПЛАЧЕННЫЕ заказы по дате оплаты, и туда
     попадали отменённые — деньги которых вернулись на баланс:
     выручка за день выходила неверной.

     ⚠️ `closed_at` У ВЫПОЛНЕННОГО ЗАКАЗА — ЭТО ТОТ ЖЕ МОМЕНТ, ЧТО
     У СОБЫТИЯ «ВЫПОЛНИЛ» В ЖУРНАЛЕ: закрытие и запись идут одной
     транзакцией и одним `now()` (`zavershitZakaz`), а старые заказы
     засыпаны в журнал ровно по `closed_at` (миграция 012). Значит
     «по времени выполнения, как в блоке По сотрудникам» выполняется
     буквально — и при этом сюда попадают и заказы на сертификат,
     у которых сотрудника нет вовсе: код выдаёт сервер, и событие
     «выполнил» у них не пишется.

     ⚠️ ЗАКАЗ С ОТМЕНЁННОЙ ПОДПИСКОЙ СЮДА НЕ ПОПАДАЕТ: он помечен
     «Отменён» (пункт 9), и статус его `cancelled`, хотя деньги
     остались у нас. Это названо в отчёте как вопрос заказчику.

     ⚠️ У ОПЕРАТОРА — ТОЛЬКО ЕГО ВЫПОЛНЕННЫЕ, И ОТБОР ИДЁТ ПО ЖУРНАЛУ:
     «по почте, с которой он вошёл» — это номер сотрудника в событии
     «выполнил». `operator_id` заказа тут не годится: это держатель,
     и читать его как «кто выполнил» — та самая молчаливая связь
     (Р-153). */
  const gz = granicy(p, 'o.closed_at');
  const svoi = admin
    ? { uslovie: '', params: [] as unknown[] }
    : {
        uslovie: ` and exists (select 1 from order_event e
                                where e.order_id = o.id and e.vid = 'vypolnil' and e.staff_id = $${gz.params.length + 1})`,
        params: [kto.staffId] as unknown[],
      };

  /* ⚠️ ДЕНЬГИ НЕ ПОДНИМАЮТСЯ ИЗ БАЗЫ ВОВСЕ, КОГДА ПОКАЗЫВАТЬ ИХ
     НЕКОМУ. «Убирай на сервере» можно было бы выполнить и стиранием
     числа перед возвратом, но не считать его — короче и строже. */
  const potarif = await zapros<{ plan_id: string; period: number; n: string; kop: string | null }>(
    `select o.plan_id, o.period, count(*)::text as n${
      admin ? ', coalesce(sum(o.money_kop), 0)::text as kop' : ', null as kop'
    }
       from shop_order o
      where o.status = 'done' and o.closed_at is not null and ${gz.uslovie}${svoi.uslovie}
      group by o.plan_id, o.period
      order by count(*) desc, o.plan_id, o.period`,
    [...gz.params, ...svoi.params],
  );
  const tarify: StrokaTarifa[] = potarif.map((r) => ({
    planId: r.plan_id,
    period: r.period,
    zakazov: Number(r.n),
    vyruchkaKop: r.kop === null ? null : Number(r.kop),
  }));
  /* Итог складывается из разбивки здесь же, а не вторым запросом:
     два запроса прочли бы одно поле в разные мгновения и разошлись бы
     на границе периода. */
  const vypolneno = tarify.reduce((a, r) => a + r.zakazov, 0);

  if (!admin) {
    return { obshchee: null, vypolneno, tarify, poSotrudnikam: null, istochniki: null };
  }

  const g = granicy(p);
  const itog = await odna<{ n: string; kop: string }>(
    `select count(*)::text as n, coalesce(sum(money_kop), 0)::text as kop
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
  const gc = granicy(p, 'closed_at');
  const sr = await odna<{ min: string | null }>(
    `select round(avg(extract(epoch from (closed_at - paid_at)) / 60))::text as min
       from shop_order
      where status = 'done' and paid_at is not null and closed_at is not null and ${gc.uslovie}`,
    gc.params,
  );

  /* ⚠️ СЕРТИФИКАТЫ СЧИТАЮТСЯ ЗА ВСЁ ВРЕМЯ, И ЭТО НАЗВАНО НА ЭКРАНЕ.
     «Куплено» и «активировано» — это остаток, а не поток: код живёт
     год и активируется когда угодно, поэтому «за неделю активировано
     ноль» не значит ничего. */
  const sert = await odna<{ kupleno: string; aktivirovano: string }>(
    `select count(*)::text as kupleno,
            count(*) filter (where used_at is not null)::text as aktivirovano
       from certificate`,
  );

  /* ⚠️ ИСТОЧНИКИ — ТОЛЬКО ВЫПОЛНЕННЫЕ ЗАКАЗЫ (сорок девятая итерация,
     пункт 2): «Отменённые не считаем». Дата — та же, что у таблицы
     тарифов, время выполнения: две таблицы на одном экране обязаны
     считать за один и тот же период одно и то же множество заказов,
     иначе их итоги разошлись бы, и на экране это не было бы видно.

     ⚠️ И СЧИТАЮТСЯ ОНИ ТОЛЬКО АДМИНИСТРАТОРУ (сорок седьмая
     итерация): сюда оператор не доходит вовсе — выход выше. */
  const ist = await zapros<{ utm_source: string | null; n: string }>(
    `select o.utm_source, count(*)::text as n
       from shop_order o
      where o.status = 'done' and o.closed_at is not null and ${gz.uslovie}
      group by o.utm_source
      order by count(*) desc`,
    gz.params,
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
     бы на границе периода. Итог складывается из разбивки здесь же. */
  const gs = granicy(p, 'e.created_at');
  /* ⚠️ ВЫПОЛНЕННОЕ И ОТМЕНЁННОЕ БЕРУТСЯ ОДНИМ ЗАПРОСОМ, а не двумя.
     Два запроса считали бы одно и то же поле `e.created_at` в разные
     мгновения, и событие, случившееся в зазор между ними, попало бы
     только во второй. Вид события едет колонкой и разбирается здесь же.

     ⚠️ ОТМЕНА ПОДПИСКИ СЮДА НЕ ИДЁТ (сорок девятая итерация): у неё
     свои глаголы в журнале — `otmena_zaproshena` и `podpiska_otmenena`,
     — а «Отменил» здесь значит отмену ДО выполнения, с деньгами
     на балансе. */
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
     отвечает на вопрос «сколько сделал каждый». */
  const poSotrudnikam = [...po.values()].sort(
    (a, b) => b.zakazov - a.zakazov || b.otmen - a.otmen || a.email.localeCompare(b.email),
  );

  return {
    obshchee: {
      zakazov: Number(itog?.n ?? 0),
      vyruchkaKop: Number(itog?.kop ?? 0),
      vOcheredi: Number(och?.n ?? 0),
      srednyayaMinut: sr?.min == null ? null : Number(sr.min),
      sertifikatovKupleno: Number(sert?.kupleno ?? 0),
      sertifikatovAktivirovano: Number(sert?.aktivirovano ?? 0),
    },
    vypolneno,
    tarify,
    poSotrudnikam,
    istochniki,
  };
}

/**
 * ОТЗЫВЫ (пятьдесят четвёртая итерация).
 *
 * Постановка: «Только настоящие отзывы — ничего не выдумывай и не ставь
 * заглушек на боевом сайте». Отсюда два источника и ни одного третьего:
 * отзыв заводит администратор руками или оставляет клиент у своего
 * выполненного заказа. Клиентский уходит на модерацию и до неё
 * на сайте не виден.
 *
 * ⚠️ ГЛАВНАЯ ЧИТАЕТ ОПУБЛИКОВАННЫЕ ЧЕРЕЗ `tikho`, И ПУСТОЙ СПИСОК —
 * ЗАКОННОЕ СОСТОЯНИЕ. Лендинг собирается на раннере, где базы нет
 * вовсе (закон 36): там отзывов ноль, и блока нет. Меньше трёх
 * опубликованных — блока нет тоже, ни разметки, ни заголовка.
 *
 * ⚠️ ПОРЯДОК ПОКАЗА — `poryadok, id`, И МЕНЬШЕ ЗНАЧИТ ВЫШЕ. Новый
 * опубликованный (и повторно опубликованный) встаёт наверх: ему
 * ставится наименьшее значение своего списка минус единица. «Выше» и
 * «Ниже» меняют местами с ближайшим соседом ТОГО ЖЕ СТАТУСА: обмен
 * со скрытым соседом не сдвинул бы ничего на сайте, и Лев видел бы,
 * что кнопка не сработала (поправка после рецензии).
 *
 * ⚠️ ВСЁ, ЧТО МЕНЯЕТ ПОРЯДОК, ИДЁТ ПОД ОДНИМ ЗАМКОМ (`pg_advisory_xact_lock`):
 * два одновременных «наверх» иначе взяли бы одно и то же «наименьшее
 * минус единица», а перенумерация списка — разные снимки одного списка.
 */

import type { PoolClient } from 'pg';
import { odna, tikho, vTranzakcii, zapros } from './db';
import { log } from './log';
import { DARIMYE } from '@/lib/plans';
import { NA_GLAVNOY, bedaImeni, bedaTeksta, chistoeImya, chistyTekst, znakov } from '@/lib/otzyv';
import { nastoyashchayaData } from '../data';
import { ZONA_MSK } from '@/lib/chasy';

export type StatusOtzyva = 'moderaciya' | 'opublikovan' | 'skryt';

/** Замок порядка: одно число на весь раздел. */
const ZAMOK_PORYADKA = 54019;

/** Отзыв для главной: только то, что там показывается. */
export type OtzyvNaGlavnoy = {
  id: number;
  imya: string;
  tekst: string;
  /** «Название трека» — первые слова отзыва, см. `nazvanieOtzyva`. */
  nazvanie: string;
  /** `ДД.ММ.ГГГГ` — так, как стоит у трека длительность. */
  data: string;
  /** `ГГГГ-ММ-ДД` — для `<time dateTime>`. */
  dataIso: string;
  planId: string | null;
};

export type OtzyvDlyaAdminki = {
  id: number;
  istochnik: 'admin' | 'klient';
  orderId: number | null;
  imya: string;
  tekst: string;
  data: string;
  planId: string | null;
  status: StatusOtzyva;
  /** Когда клиент дал согласие на публикацию; у заведённых руками — нет. */
  soglasie: string | null;
  createdAt: string;
};

/**
 * «НАЗВАНИЕ ТРЕКА» — ПЕРВЫЕ СЛОВА ОТЗЫВА, И СЧИТАЕТ ИХ ОДНА ФУНКЦИЯ.
 *
 * Очередь и диктор берут одну и ту же строку: две копии обрезки
 * разошлись бы на первом же отзыве, где шестое слово длинное.
 * Правило: не больше шести слов и не длиннее 42 знаков; не вошло
 * всё — многоточие, и висящая перед ним запятая или тире снимаются.
 * ⚠️ СЛОВО ДЛИННЕЕ 42 ЗНАКОВ РЕЖЕТСЯ ЖЁСТКО (ссылка, ник без пробелов):
 * иначе название вышло бы пустым или вылезло бы за строку.
 */
export function nazvanieOtzyva(tekst: string): string {
  const MAX_SLOV = 6;
  const MAX_ZNAKOV = 42;
  const slova = tekst.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!slova.length) return '';
  let s = '';
  let n = 0;
  for (const w of slova) {
    const dalshe = s ? `${s} ${w}` : w;
    if (n >= MAX_SLOV || znakov(dalshe) > MAX_ZNAKOV) break;
    s = dalshe;
    n += 1;
  }
  if (!s) return `${Array.from(slova[0]).slice(0, MAX_ZNAKOV - 1).join('')}…`;
  if (n < slova.length) return `${s.replace(/[\s,.;:!?…—–-]+$/u, '')}…`;
  return s;
}

/** Сегодня по Москве, `ГГГГ-ММ-ДД`: дата отзыва не бывает позже. */
export function segodnyaPoMoskve(): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: ZONA_MSK,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    /* Запасной путь — тот же, что у часов работы (закон 49):
       перевода часов в России нет, и сдвиг на три часа честен. */
    return new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  }
}

/* ── главная ───────────────────────────────────────────────────── */

/**
 * Опубликованные — первые `NA_GLAVNOY` по порядку.
 *
 * ⚠️ ЧИСЛО ОГРАНИЧЕНО НАМЕРЕННО: высоту экрана «Сейчас играет» задаёт
 * самый длинный из показанных, а очередь в сорок строк на телефоне
 * уводила бы вопросы на три экрана вниз.
 */
export async function otzyvyNaGlavnuyu(): Promise<OtzyvNaGlavnoy[]> {
  return tikho(async () => {
    const rows = await zapros<{ id: string; imya: string; tekst: string; d: string; iso: string; plan_id: string | null }>(
      `select id, imya, tekst, to_char(data, 'DD.MM.YYYY') as d, to_char(data, 'YYYY-MM-DD') as iso, plan_id
         from otzyv where status = 'opublikovan'
        order by poryadok, id limit $1`,
      [NA_GLAVNOY],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      imya: r.imya,
      tekst: r.tekst,
      nazvanie: nazvanieOtzyva(r.tekst),
      data: r.d,
      dataIso: r.iso,
      planId: r.plan_id,
    }));
  }, [] as OtzyvNaGlavnoy[]);
}

/* ── админка ───────────────────────────────────────────────────── */

export async function otzyvyDlyaAdminki(): Promise<Record<StatusOtzyva, OtzyvDlyaAdminki[]>> {
  const rows = await zapros<{
    id: string;
    istochnik: 'admin' | 'klient';
    order_id: string | null;
    imya: string;
    tekst: string;
    d: string;
    plan_id: string | null;
    status: StatusOtzyva;
    soglasie_at: Date | null;
    created_at: Date;
  }>(
    `select id, istochnik, order_id, imya, tekst, to_char(data, 'DD.MM.YYYY') as d, plan_id, status,
            soglasie_at, created_at
       from otzyv
      order by poryadok, id`,
  );
  const out: Record<StatusOtzyva, OtzyvDlyaAdminki[]> = { moderaciya: [], opublikovan: [], skryt: [] };
  for (const r of rows) {
    out[r.status].push({
      id: Number(r.id),
      istochnik: r.istochnik,
      orderId: r.order_id ? Number(r.order_id) : null,
      imya: r.imya,
      tekst: r.tekst,
      data: r.d,
      planId: r.plan_id,
      status: r.status,
      soglasie: r.soglasie_at ? new Date(r.soglasie_at).toISOString() : null,
      createdAt: new Date(r.created_at).toISOString(),
    });
  }
  return out;
}

/** Сколько ждёт модерации — для пункта меню «Отзывы (N)». */
export async function chisloNaModeracii(): Promise<number> {
  return tikho(async () => {
    const r = await odna<{ n: string }>(`select count(*)::text as n from otzyv where status = 'moderaciya'`);
    return Number(r?.n ?? 0);
  }, 0);
}

export type OshibkaOtzyva = 'imya' | 'imya_dlinno' | 'tekst' | 'tekst_dlinno' | 'data' | 'data_pozzhe' | 'tarif' | 'net' | 'nelzya';

function bedaPoley(imya: string, tekst: string): OshibkaOtzyva | null {
  const bi = bedaImeni(imya);
  if (bi) return chistoeImya(imya) ? 'imya_dlinno' : 'imya';
  const bt = bedaTeksta(tekst);
  if (bt) return chistyTekst(tekst) ? 'tekst_dlinno' : 'tekst';
  return null;
}

/** Наверх своего списка: наименьшее значение минус единица. */
async function naverh(c: PoolClient, status: StatusOtzyva): Promise<number> {
  const r = await c.query<{ p: number }>(
    `select coalesce(min(poryadok), 0) - 1 as p from otzyv where status = $1`,
    [status],
  );
  return Number(r.rows[0]?.p ?? -1);
}

/**
 * Отзыв, заведённый администратором.
 *
 * ⚠️ ДАТА НЕ ПОЗЖЕ СЕГОДНЯШНЕЙ ПО МОСКВЕ: отзыв «из будущего» —
 * это опечатка, а на главной он стоял бы с датой, которой ещё не было.
 * И дата обязана быть настоящей — «2026-02-31» проходит образец,
 * а база на нём падает (`nastoyashchayaData`).
 */
export async function dobavitOtzyv(
  v: { imya: string; tekst: string; data: string; planId: string; srazu: boolean },
  staffId: number,
): Promise<{ ok: true; id: number } | { oshibka: OshibkaOtzyva }> {
  const beda = bedaPoley(v.imya, v.tekst);
  if (beda) return { oshibka: beda };
  if (!nastoyashchayaData(v.data)) return { oshibka: 'data' };
  if (v.data > segodnyaPoMoskve()) return { oshibka: 'data_pozzhe' };
  const plan = v.planId.trim();
  if (plan && !DARIMYE.some((p) => p.id === plan)) return { oshibka: 'tarif' };
  const status: StatusOtzyva = v.srazu ? 'opublikovan' : 'skryt';
  const id = await vTranzakcii(async (c) => {
    await c.query('select pg_advisory_xact_lock($1)', [ZAMOK_PORYADKA]);
    const p = await naverh(c, status);
    const r = await c.query<{ id: string }>(
      `insert into otzyv (istochnik, imya, tekst, data, plan_id, status, poryadok, staff_id)
       values ('admin', $1, $2, $3::date, $4, $5, $6, $7) returning id`,
      [chistoeImya(v.imya), chistyTekst(v.tekst), v.data, plan || null, status, p, staffId],
    );
    return Number(r.rows[0].id);
  });
  log.info('отзыв заведён администратором', { otzyv: id, status });
  return { ok: true, id };
}

/**
 * Опубликовать или скрыть. Отзыв встаёт НАВЕРХ того списка, куда ушёл:
 * повторно опубликованный — как новый (поправка после рецензии).
 */
export async function smenitStatus(
  id: number,
  novyy: 'opublikovan' | 'skryt',
  staffId: number,
): Promise<{ ok: true } | { oshibka: OshibkaOtzyva }> {
  const ok = await vTranzakcii(async (c) => {
    await c.query('select pg_advisory_xact_lock($1)', [ZAMOK_PORYADKA]);
    const r = await c.query<{ status: StatusOtzyva }>(`select status from otzyv where id = $1 for update`, [id]);
    const bylo = r.rows[0]?.status;
    if (!bylo) return false;
    if (bylo === novyy) return true;
    const p = await naverh(c, novyy);
    await c.query(
      `update otzyv set status = $2, poryadok = $3, staff_id = $4, updated_at = now() where id = $1`,
      [id, novyy, p, staffId],
    );
    return true;
  });
  if (!ok) return { oshibka: 'net' };
  log.info('отзыв: новый статус', { otzyv: id, status: novyy });
  return { ok: true };
}

/**
 * «Выше» / «Ниже»: обмен с ближайшим соседом того же статуса.
 *
 * ⚠️ СПИСОК ПЕРЕНУМЕРОВЫВАЕТСЯ ЦЕЛИКОМ, А НЕ МЕНЯЮТСЯ ДВА ЧИСЛА.
 * У соседей бывает одно и то же `poryadok` (умолчание — ноль), и обмен
 * равных значений не сдвинул бы ничего. Список короткий — десятки
 * строк, — и перенумерация одним запросом стоит дёшево.
 */
export async function sdvinut(id: number, kuda: -1 | 1): Promise<{ ok: true } | { oshibka: OshibkaOtzyva }> {
  const ok = await vTranzakcii(async (c) => {
    await c.query('select pg_advisory_xact_lock($1)', [ZAMOK_PORYADKA]);
    const r = await c.query<{ status: StatusOtzyva }>(`select status from otzyv where id = $1`, [id]);
    const status = r.rows[0]?.status;
    if (!status || status === 'moderaciya') return false;
    const spisok = (
      await c.query<{ id: string }>(`select id from otzyv where status = $1 order by poryadok, id for update`, [status])
    ).rows.map((x) => Number(x.id));
    const i = spisok.indexOf(id);
    const j = i + kuda;
    if (i < 0) return false;
    /* На краю списка двигать некуда: это не ошибка, кнопка там
       выключена, а пришедший мимо неё запрос просто ничего не делает. */
    if (j < 0 || j >= spisok.length) return true;
    [spisok[i], spisok[j]] = [spisok[j], spisok[i]];
    await c.query(
      `update otzyv o set poryadok = v.n::int - 1, updated_at = now()
         from unnest($1::bigint[]) with ordinality as v(id, n)
        where o.id = v.id`,
      [spisok],
    );
    return true;
  });
  return ok ? { ok: true } : { oshibka: 'net' };
}

/**
 * Удалить можно только заведённый руками. Отзыв клиента — его
 * собственный текст с его согласием: «Скрыть» и есть исполнение
 * отзыва согласия, а удаление стёрло бы след того, что он писал.
 */
export async function udalitOtzyv(id: number): Promise<{ ok: true } | { oshibka: OshibkaOtzyva }> {
  const r = await odna<{ istochnik: string }>(`select istochnik from otzyv where id = $1`, [id]);
  if (!r) return { oshibka: 'net' };
  if (r.istochnik !== 'admin') return { oshibka: 'nelzya' };
  await zapros(`delete from otzyv where id = $1 and istochnik = 'admin'`, [id]);
  log.info('отзыв удалён', { otzyv: id });
  return { ok: true };
}

/* ── кабинет ───────────────────────────────────────────────────── */

/** Сколько отзывов в сутки может оставить один человек. */
const ZA_SUTKI = 5;

/**
 * Отзыв клиента к своему выполненному заказу.
 *
 * ⚠️ ВСЁ ПРОВЕРЯЕТСЯ ЗДЕСЬ, А НЕ ФОРМОЙ: номер заказа лежит в скрытом
 * поле и правится в браузере. Заказ этого человека, выполнен, это
 * заказ ТАРИФА (покупатель подарка услугой не пользовался, а на главной
 * у его отзыва встал бы подаренный тариф), отзыва по нему ещё нет,
 * согласие на публикацию дано. Уникальный индекс на `order_id` —
 * последняя защита от двойного нажатия, а строка заказа берётся
 * `for update`, чтобы два нажатия не прошли проверку оба.
 *
 * ⚠️ НИ ИМЕНИ, НИ ТЕКСТА В ЖУРНАЛЕ: это то, что написал человек.
 */
export async function ostavitOtzyv(v: {
  userId: number;
  orderId: number;
  imya: string;
  tekst: string;
  soglasie: boolean;
}): Promise<{ ok: true } | { oshibka: string }> {
  const bi = bedaImeni(v.imya);
  if (bi) return { oshibka: bi };
  const bt = bedaTeksta(v.tekst);
  if (bt) return { oshibka: bt };
  if (!v.soglasie) return { oshibka: 'Отметьте согласие на публикацию — без него отзыв не отправить' };
  // Номер приходит скрытым полем формы: подменённый на «abc» или «1.5»
  // уронил бы запрос ошибкой базы вместо словесного отказа.
  if (!Number.isSafeInteger(v.orderId) || v.orderId <= 0) return { oshibka: 'Отзыв можно оставить только к своему выполненному заказу' };
  try {
    const itog = await vTranzakcii(async (c) => {
      const z = await c.query<{ plan_id: string }>(
        `select plan_id from shop_order
          where id = $1 and user_id = $2 and status = 'done' and kind = 'plan' for update`,
        [v.orderId, v.userId],
      );
      if (!z.rows.length) return 'Отзыв можно оставить только к своему выполненному заказу' as const;
      const est = await c.query(`select 1 from otzyv where order_id = $1`, [v.orderId]);
      if (est.rows.length) return 'Отзыв к этому заказу уже оставлен' as const;
      const chasto = await c.query<{ n: string }>(
        `select count(*)::text as n from otzyv where user_id = $1 and created_at > now() - interval '1 day'`,
        [v.userId],
      );
      if (Number(chasto.rows[0]?.n ?? 0) >= ZA_SUTKI) return 'Сегодня отзывов уже достаточно — попробуйте завтра' as const;
      const r = await c.query<{ id: string }>(
        `insert into otzyv (istochnik, order_id, user_id, imya, tekst, data, plan_id, status, soglasie_at)
         values ('klient', $1, $2, $3, $4, (now() at time zone 'Europe/Moscow')::date, $5, 'moderaciya', now())
         returning id`,
        [v.orderId, v.userId, chistoeImya(v.imya), chistyTekst(v.tekst), z.rows[0].plan_id],
      );
      return Number(r.rows[0].id);
    });
    if (typeof itog === 'string') return { oshibka: itog };
    log.info('отзыв клиента ушёл на модерацию', { otzyv: itog, zakaz: v.orderId });
    return { ok: true };
  } catch (e) {
    /* Двойное нажатие разняла база: вторая вставка с тем же заказом
       упала на уникальном индексе. Отзыв уже есть — так и говорим. */
    if ((e as { code?: string }).code === '23505') return { oshibka: 'Отзыв к этому заказу уже оставлен' };
    throw e;
  }
}

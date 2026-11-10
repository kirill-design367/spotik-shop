/**
 * Робокасса: приём платежей.
 *
 * Здесь ровно три вещи, и все три — про подпись:
 *   1. собрать ссылку на оплату и подписать её ПАРОЛЕМ №1;
 *   2. проверить уведомление на ResultURL подписью с ПАРОЛЕМ №2;
 *   3. проверить возврат человека на SuccessURL подписью с ПАРОЛЕМ №1.
 * С пятьдесят четвёртой итерации к ним добавились два запроса
 * автоплатежа — дочернее списание и опрос состояния (в конце файла).
 *
 * ⚠️ ТРИ РАЗНЫЕ ПОДПИСИ И ДВА РАЗНЫХ ПАРОЛЯ, и путать их нельзя.
 * Пароль №2 знает только наш сервер и Робокасса; именно поэтому
 * уведомление, подписанное им, можно считать правдой. Проверь мы
 * уведомление паролем №1 — тем самым, который уезжает в браузер
 * человека в составе ссылки, — «оплачено» мог бы сказать кто угодно,
 * кто хоть раз видел ссылку на оплату.
 *
 * ⚠️ ТЕСТОВЫЙ РЕЖИМ — ЭТО ДРУГАЯ ПАРА ПАРОЛЕЙ, а не только флажок
 * `IsTest=1`. Боевые пароли в тестовом режиме дают ошибку 29
 * («неверная подпись»), неотличимую на глаз от ошибки в формуле.
 * Поэтому пароли выбираются ОДНИМ местом, вместе с флажком.
 *
 * ⚠️ У КАЖДОГО АДРЕСА В КАБИНЕТЕ РОБОКАССЫ СВОЙ АЛГОРИТМ ХЕША.
 * У Result URL свой, у Success URL свой, и совпадать они не обязаны.
 * Пока настройка была одна на всё, расхождение выглядело как
 * «пароль №2 неверный».
 */

import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { env } from './env';
import { log } from './log';
import { rubliStrokoy } from './money';

export const ADRES_OPLATY = 'https://auth.robokassa.ru/Merchant/Index.aspx';

export type Algoritm = 'md5' | 'ripemd160' | 'sha1' | 'sha256' | 'sha384' | 'sha512';

const ALGORITMY: Algoritm[] = ['md5', 'ripemd160', 'sha1', 'sha256', 'sha384', 'sha512'];

/**
 * ⚠️ АЛГОРИТМ ЗАДАЁТСЯ НАСТРОЙКОЙ, А НЕ ЗАШИТ. У каждого адреса
 * в кабинете Робокассы он свой, и умолчание кабинета — md5; наше
 * умолчание такое же, поэтому НЕ ЗАДАННАЯ настройка работает.
 *
 * Неизвестное значение НЕ роняет оплату: сорванная подпись — это
 * ошибка 29, неотличимая на глаз от ошибки в формуле, и час
 * недоумения. Вместо этого берём md5 и говорим об этом в журнал
 * ОДИН раз — `nastroyki()` зовут на каждый платёж, и warn оттуда
 * забил бы журнал. Настройку сервера при таком значении роняет
 * сам прогон: он проверяет имя алгоритма до того, как его везти.
 */
const skazali = new Set<string>();

function algo(v: string): Algoritm {
  if ((ALGORITMY as string[]).includes(v)) return v as Algoritm;
  if (v && !skazali.has(v)) {
    skazali.add(v);
    log.warn('алгоритм хеша Робокассы не опознан, работаем по md5', { zadan: v });
  }
  return 'md5';
}

export type Nastroyki = {
  login: string;
  parol1: string;
  parol2: string;
  test: boolean;
  algoritm: Algoritm;
  algoritmResult: Algoritm;
  algoritmVozvrata: Algoritm;
  sno: string;
};

export function nastroyki(): Nastroyki {
  const test = env.rkTest;
  return {
    login: env.rkLogin,
    parol1: test ? env.rkTestPass1 : env.rkPass1,
    parol2: test ? env.rkTestPass2 : env.rkPass2,
    test,
    algoritm: algo(env.rkAlgo),
    algoritmResult: algo(env.rkAlgoResult),
    algoritmVozvrata: algo(env.rkAlgoSuccess),
    sno: env.rkSno,
  };
}

/** Можно ли уже принимать деньги картой. */
export function robokassaRabotaet(): boolean {
  const n = nastroyki();
  return Boolean(n.login && n.parol1 && n.parol2);
}

function hesh(a: Algoritm, s: string): string {
  return createHash(a).update(s, 'utf8').digest('hex');
}

/**
 * Пользовательские параметры (`Shp_…`) в строке подписи: ПОСЛЕ пароля,
 * парами `ключ=значение`, отсортированными по ключу. Сортировка
 * не украшение — Робокасса присылает их обратно в произвольном
 * порядке, и без общего правила строки не совпадут.
 */
function shpHvost(pary: Record<string, string>): string[] {
  return Object.keys(pary)
    .filter((k) => /^shp_/i.test(k))
    .sort()
    .map((k) => `${k}=${pary[k]}`);
}

/**
 * Способ расчёта в позиции чека.
 *
 * ⚠️ У ПОПОЛНЕНИЯ БАЛАНСА — ПРЕДОПЛАТА, А НЕ ПОЛНЫЙ РАСЧЁТ (Р-168):
 * постановка «чек по 54-ФЗ — как на предоплату». За деньгами на балансе
 * ещё не стоит оказанная услуга — её человек выберет потом, — и полный
 * расчёт в чеке был бы неправдой. У заказа по-прежнему полный расчёт.
 */
export type SposobRaschyota = 'full_payment' | 'full_prepayment';

export type PoziciyaCheka = {
  name: string;
  quantity: number;
  sum: number;
  payment_method: SposobRaschyota;
  payment_object: 'service';
  tax: 'none';
};

/**
 * Чек 54-ФЗ.
 *
 * ⚠️ СУММА ПОЗИЦИЙ — ЭТО СУММА ПЛАТЕЖА, А НЕ ЦЕНА ЗАКАЗА. Человек,
 * закрывший половину заказа балансом, платит остаток — и в чеке
 * обязан стоять этот остаток: чек пробивается на те деньги, которые
 * прошли через кассу.
 */
export function chek(
  n: Nastroyki,
  pozicii: { name: string; sumKop: number; sposob?: SposobRaschyota }[],
): Record<string, unknown> {
  const items: PoziciyaCheka[] = pozicii.map((p) => ({
    name: p.name.slice(0, 128),
    quantity: 1,
    sum: Number(rubliStrokoy(p.sumKop)),
    payment_method: p.sposob ?? 'full_payment',
    payment_object: 'service',
    tax: 'none',
  }));
  const out: Record<string, unknown> = { items };
  if (n.sno) out['sno'] = n.sno;
  return out;
}

export function podpisSsylki(n: Nastroyki, outSum: string, invId: number, chekVStroke: string | null): string {
  const chasti = [n.login, outSum, String(invId)];
  if (chekVStroke) chasti.push(chekVStroke);
  chasti.push(n.parol1);
  return hesh(n.algoritm, chasti.join(':'));
}

/**
 * Подпись уведомления: `OutSum:InvId:пароль2[:Shp_…]`.
 *
 * ⚠️ ЛОГИНА В ЭТОЙ СТРОКЕ НЕТ — в отличие от подписи ссылки.
 * Дописать его «для симметрии» значит получить несходящуюся подпись
 * и решить, что Робокасса врёт.
 */
export function podpisUvedomleniya(n: Nastroyki, outSum: string, invId: string, pary: Record<string, string>): string {
  return hesh(n.algoritmResult, [outSum, invId, n.parol2, ...shpHvost(pary)].join(':'));
}

export function podpisVozvrata(n: Nastroyki, outSum: string, invId: string, pary: Record<string, string>): string {
  return hesh(n.algoritmVozvrata, [outSum, invId, n.parol1, ...shpHvost(pary)].join(':'));
}

/**
 * Сравнение подписей — РЕГИСТРОНЕЗАВИСИМОЕ и постоянного времени.
 * Робокасса присылает hex прописными, мы считаем строчными; а по
 * времени сравнения подпись подбирается посимвольно.
 */
export function podpisiSovpali(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (x.length !== y.length) return false;
  let raznica = 0;
  for (let i = 0; i < x.length; i++) raznica |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return raznica === 0;
}

/**
 * Ссылка на оплату.
 *
 * ⚠️ ЧЕК КОДИРУЕТСЯ РОВНО ОДИН РАЗ. В строку запроса уезжает
 * закодированное значение, а в подпись — РАСКОДИРОВАННОЕ. Документация
 * Робокассы говорит обратное, но замер на живом магазине (перебор
 * шести алгоритмов на оба вида чека) показал именно так: одиннадцать
 * сочетаний отвечали ошибкой 29, и ровно одно — md5 с сырым чеком —
 * ответило ДРУГОЙ ошибкой, то есть подпись к тому моменту была принята.
 */
export function ssylkaOplaty(
  n: Nastroyki,
  invId: number,
  summaKop: number,
  opisanie: string,
  pozicii: { name: string; sumKop: number; sposob?: SposobRaschyota }[],
  /**
   * `recurring` — материнский счёт автоплатежа (пятьдесят четвёртая
   * итерация): в ссылку добавляется `Recurring=true`. В подпись он НЕ
   * входит — так считают официальные SDK Робокассы (PHP и .NET),
   * и тестовый вектор PHP SDK это подтверждает. Без него ссылка ровно
   * прежняя, байт в байт: `verify-pay` сверяет и состав, и подпись.
   */
  opcii: { recurring?: boolean } = {},
): string {
  const outSum = rubliStrokoy(summaKop);
  const chekJson = JSON.stringify(chek(n, pozicii));
  const chekKod = encodeURIComponent(chekJson);
  const podpis = podpisSsylki(n, outSum, invId, chekJson);

  /* Строка запроса собирается вручную, а не через URLSearchParams:
     чек уже закодирован, и повторное кодирование его испортит. */
  const pary: string[] = [
    `MerchantLogin=${encodeURIComponent(n.login)}`,
    `OutSum=${outSum}`,
    `InvId=${invId}`,
    `Description=${encodeURIComponent(opisanie.length <= 100 ? opisanie : `${opisanie.slice(0, 99)}…`)}`,
    `SignatureValue=${podpis}`,
    `Receipt=${chekKod}`,
    'Culture=ru',
    'Encoding=utf-8',
  ];
  if (opcii.recurring) pary.push('Recurring=true');
  if (n.test) pary.push('IsTest=1');
  return `${ADRES_OPLATY}?${pary.join('&')}`;
}

/**
 * ⚠️ ДВА НАБОРА ИМЁН, И ЭТО НЕ НАШ ВЫБОР. Робокасса присылает
 * на ResultURL ОБА разом: современный `OutSum` / `InvId` /
 * `SignatureValue` и старый `out_summ` / `inv_id` / `crc`.
 *
 * Брать надо ОДИН набор ЦЕЛИКОМ — тот, от которого сходится подпись.
 * Смешивать нельзя: проверить подпись по одному набору, а сумму взять
 * из другого, значит засчитать оплату по непроверенным числам.
 */
type Nabor = { imya: string; outSum: string; invId: string; podpis: string };

function nabory(pary: Record<string, string>): Nabor[] {
  const vzyat = (...klyuchi: string[]): string => {
    for (const k of klyuchi) {
      const v = pary[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  };
  return [
    {
      imya: 'OutSum/InvId/SignatureValue',
      outSum: vzyat('OutSum', 'outSum'),
      invId: vzyat('InvId', 'invId'),
      podpis: vzyat('SignatureValue', 'signatureValue'),
    },
    {
      imya: 'out_summ/inv_id/crc',
      outSum: vzyat('out_summ', 'OutSumm'),
      invId: vzyat('inv_id'),
      podpis: vzyat('crc', 'CRC'),
    },
  ];
}

/**
 * Сумма из уведомления в копейки.
 *
 * ⚠️ ЧИСЛО ЗНАКОВ ПОСЛЕ ТОЧКИ НЕ НАШЕ ДЕЛО. Живая Робокасса
 * присылала `1.000000`; строгая проверка «не больше двух знаков»
 * отвергла настоящий платёж, деньги при этом были списаны.
 */
export function kopeykiIzSummy(outSum: string): number | null {
  if (!outSum || outSum.length > 32) return null;
  if (!/^\d+(\.\d+)?$/.test(outSum)) return null;
  const rub = Number(outSum);
  if (!Number.isFinite(rub)) return null;
  const kop = Math.round(rub * 100);
  return Number.isSafeInteger(kop) ? kop : null;
}

export type PochemuNeVzyali = 'net_poley' | 'nomer_ne_chislo' | 'summa_ne_chislo' | 'podpis_ne_soshlas';

export type Razbor =
  | { vzyali: true; nomer: number; summaKop: number }
  | { vzyali: false; pochemu: PochemuNeVzyali; imena: string[] };

/**
 * Разбор уведомления.
 *
 * ⚠️ ПОДПИСЬ ПРОВЕРЯЕТСЯ ПЕРВОЙ, А СУММА РАЗБИРАЕТСЯ ПОСЛЕ. Раньше
 * порядок был обратный, и наше предположение о том, как Робокасса
 * пишет число, стояло впереди её же подписи — то есть впереди
 * единственного доказательства, что уведомление настоящее.
 */
export function razobrat(n: Nastroyki, pary: Record<string, string>): Razbor {
  const imena = Object.keys(pary).sort();
  const vse = nabory(pary);
  const polnye = vse.filter((x) => x.outSum && x.invId && x.podpis);
  if (!polnye.length) return { vzyali: false, pochemu: 'net_poley', imena };

  const nashe = polnye.find(
    (x) => /^\d+$/.test(x.invId) && podpisiSovpali(x.podpis, podpisUvedomleniya(n, x.outSum, x.invId, pary)),
  );
  if (!nashe) {
    if (polnye.every((x) => !/^\d+$/.test(x.invId))) return { vzyali: false, pochemu: 'nomer_ne_chislo', imena };
    return { vzyali: false, pochemu: 'podpis_ne_soshlas', imena };
  }
  const summaKop = kopeykiIzSummy(nashe.outSum);
  if (summaKop === null) return { vzyali: false, pochemu: 'summa_ne_chislo', imena };
  return { vzyali: true, nomer: Number(nashe.invId), summaKop };
}

/** Проверка возврата человека на SuccessURL. Ничего не подтверждает. */
export function proveritVozvrat(n: Nastroyki, pary: Record<string, string>): number | null {
  const outSum = (pary['OutSum'] ?? '').trim();
  const invId = (pary['InvId'] ?? '').trim();
  const podpis = (pary['SignatureValue'] ?? '').trim();
  if (!outSum || !invId || !podpis || !/^\d+$/.test(invId)) return null;
  if (!podpisiSovpali(podpis, podpisVozvrata(n, outSum, invId, pary))) return null;
  return Number(invId);
}

export function otvetPrinyato(nomer: number): string {
  return `OK${nomer}`;
}

export const POCHEMU_SLOVAMI: Record<PochemuNeVzyali, string> = {
  net_poley: 'в уведомлении нет суммы, номера счёта или самой подписи',
  nomer_ne_chislo: 'номер счёта (InvId) не число',
  summa_ne_chislo: 'ПОДПИСЬ СОШЛАСЬ, а сумму прочесть не удалось — разбирать руками',
  podpis_ne_soshlas: 'поля на месте, подпись не сошлась: пароль №2, алгоритм или формула',
};

/* ── Автоплатёж: дочернее списание и опрос состояния ─────────────────
 *
 * Пятьдесят четвёртая итерация. Два запроса СЕРВЕР → РОБОКАССА, оба
 * без браузера:
 *   • `Merchant/Recurring` — списать с карты по согласию, данному
 *     при материнском платеже (`PreviousInvoiceID` — номер ПЕРВОГО
 *     платежа серии, а не прошлого дочернего);
 *   • `OpStateExt` — что стало с операцией, о которой ResultURL молчит.
 *
 * ⚠️ «OK» ОТ `Recurring` ЗНАЧИТ «ОПЕРАЦИЯ СОЗДАНА», А НЕ «ДЕНЬГИ
 * СПИСАНЫ». Оплата подтверждается только проверенным уведомлением
 * на ResultURL (закон 34); отказ банка уведомления не присылает
 * вовсе и виден только опросом.
 */

/** Чем кончился HTTP-запрос — с различением «ушёл ли он вообще». */
type HttpItog =
  | { kak: 'otvet'; kod: number; telo: string }
  /** Соединения не было: отказ, имя не разрешилось, срок вышел ДО него. Запрос не ушёл. */
  | { kak: 'ne_doshlo'; pochemu: string }
  /** Соединение было, а ответа нет: срок, обрыв. Запрос МОГ уйти. */
  | { kak: 'obryv'; pochemu: string };

/** Потолок на запрос — тот же, что у Telegram (поправка money-9: держим блокировку подписки). */
const SROK_ZAPROSA_MS = 15_000;

/**
 * HTTP без библиотек и БЕЗ общего пула соединений (`agent: false`).
 *
 * ⚠️ ЧУЖОЕ СОЕДИНЕНИЕ ИЗ ПУЛА СТЁРЛО БЫ ГРАНИЦУ «ДО ОТПРАВКИ / ПОСЛЕ».
 * По ней решается, можно ли тихо повторить списание: тело запроса
 * уходит только после установленного соединения (для https — после
 * рукопожатия TLS), значит отказ ДО него — запрос не ушёл, а обрыв
 * ПОСЛЕ — мог уйти, и исход решает опрос (поправка money-3).
 */
function http(adres: string, metod: 'GET' | 'POST', telo: string | null): Promise<HttpItog> {
  return new Promise((resolve) => {
    let gotovo = false;
    let soedinilis = false;
    let u: URL;
    try {
      u = new URL(adres);
    } catch {
      resolve({ kak: 'ne_doshlo', pochemu: 'адрес не разобрался' });
      return;
    }
    const prostoy = u.protocol === 'http:';
    const konec = (x: HttpItog): void => {
      if (gotovo) return;
      gotovo = true;
      clearTimeout(budilnik);
      resolve(x);
    };
    const zagolovki: Record<string, string | number> = {};
    if (telo !== null) {
      zagolovki['content-type'] = 'application/x-www-form-urlencoded';
      zagolovki['content-length'] = Buffer.byteLength(telo);
    }
    const req = (prostoy ? httpRequest : httpsRequest)(
      u,
      { method: metod, agent: false, headers: zagolovki },
      (res) => {
        const kuski: Buffer[] = [];
        let dlina = 0;
        res.on('data', (b: Buffer) => {
          if (dlina < 65_536) {
            kuski.push(b);
            dlina += b.length;
          }
        });
        res.on('end', () => konec({ kak: 'otvet', kod: res.statusCode ?? 0, telo: Buffer.concat(kuski).toString('utf8') }));
        res.on('error', (e) => konec({ kak: 'obryv', pochemu: String(e.message).slice(0, 120) }));
      },
    );
    req.on('socket', (s) => {
      s.once(prostoy ? 'connect' : 'secureConnect', () => {
        soedinilis = true;
      });
    });
    req.on('error', (e: NodeJS.ErrnoException) => {
      const pochemu = `${e.code ?? 'ошибка'}: ${String(e.message).slice(0, 120)}`;
      konec(soedinilis ? { kak: 'obryv', pochemu } : { kak: 'ne_doshlo', pochemu });
    });
    const budilnik = setTimeout(() => req.destroy(new Error('срок ответа вышел')), SROK_ZAPROSA_MS);
    if (telo !== null) req.write(telo);
    req.end();
  });
}

export type IshodSpisaniya =
  | { kak: 'ok' }
  /** Робокасса ответила, и не OK: почти всегда настройка (34, 35, 29), а не отказ карты. */
  | { kak: 'ne_ok'; otvet: string }
  | { kak: 'ne_doshlo'; pochemu: string }
  | { kak: 'obryv'; pochemu: string };

export type ZaprosSpisaniya = {
  /** Новый номер счёта — `payment.id` дочернего списания. */
  invoiceId: number;
  /** Номер МАТЕРИНСКОГО счёта серии. */
  previousInvoiceId: number;
  summaKop: number;
  opisanie: string;
  pozicii: { name: string; sumKop: number }[];
};

/**
 * Тело запроса `Merchant/Recurring` — ровно так, как его собирают
 * официальные SDK Робокассы (PHP, .NET) и плагин WooCommerce
 * (поправка money-13).
 *
 * ⚠️ ЧЕК ЗДЕСЬ КОДИРУЕТСЯ ИНАЧЕ, ЧЕМ В ССЫЛКЕ НА ОПЛАТУ, И ЭТО НЕ
 * РАСХОЖДЕНИЕ. Значение поля `Receipt` — это `urlencode(json)`, подпись
 * считается ОТ НЕГО ЖЕ, а тело формы кодирует его ещё раз (на проводе
 * `%257B…`). Робокасса после одного разбора формы видит ровно ту
 * строку, что подписана. В ссылке правило то же, только уровнем ниже:
 * там браузер сам разбирает строку запроса один раз.
 *
 * `PreviousInvoiceID` и `Description` в подпись не входят; `IsTest`,
 * `Recurring` и `IncCurrLabel` в этом запросе запрещены вовсе.
 */
export function teloSpisaniya(n: Nastroyki, z: ZaprosSpisaniya): string {
  const outSum = rubliStrokoy(z.summaKop);
  const r = encodeURIComponent(JSON.stringify(chek(n, z.pozicii)));
  const podpis = hesh(n.algoritm, `${n.login}:${outSum}:${z.invoiceId}:${r}:${n.parol1}`);
  const opisanie = z.opisanie.length <= 100 ? z.opisanie : `${z.opisanie.slice(0, 99)}…`;
  return new URLSearchParams({
    MerchantLogin: n.login,
    InvoiceID: String(z.invoiceId),
    PreviousInvoiceID: String(z.previousInvoiceId),
    OutSum: outSum,
    Description: opisanie,
    Receipt: r,
    SignatureValue: podpis,
  }).toString();
}

/**
 * Дочернее списание.
 *
 * ⚠️ 502/503/504 — ЭТО «ОБРЫВ», А НЕ «ОТКАЗ». Такой ответ даёт
 * промежуточный узел, и дошёл ли запрос до Робокассы, по нему
 * не понять: исход решает опрос. Собственный отказ Робокассы —
 * 500 с описанием или текст без `OK`.
 */
export async function zaprositSpisanie(n: Nastroyki, z: ZaprosSpisaniya): Promise<IshodSpisaniya> {
  const itog = await http(env.rkRecurringUrl, 'POST', teloSpisaniya(n, z));
  if (itog.kak !== 'otvet') return itog;
  const telo = itog.telo.trim();
  const ok = /^OK\+?(\d+)$/i.exec(telo);
  if (itog.kod === 200 && ok && Number(ok[1]) === z.invoiceId) return { kak: 'ok' };
  if ([502, 503, 504].includes(itog.kod)) return { kak: 'obryv', pochemu: `HTTP ${itog.kod}` };
  return { kak: 'ne_ok', otvet: `HTTP ${itog.kod}: ${telo.replace(/\s+/g, ' ').slice(0, 200)}` };
}

export type SostoyanieOperacii =
  /** `result` — Result.Code (0 — ответ есть); `state` — State.Code или `null`, если его нет. */
  | { kak: 'otvet'; result: number; state: number | null }
  | { kak: 'net'; pochemu: string };

/** Подпись опроса: `MerchantLogin:InvoiceID:пароль2` тем же алгоритмом, что ссылка. */
export function podpisOpStateExt(n: Nastroyki, invoiceId: number): string {
  return hesh(n.algoritm, `${n.login}:${invoiceId}:${n.parol2}`);
}

/**
 * Что стало с операцией: `OpStateExt`.
 *
 * Ответ — XML, и ошибки приложения приходят тоже с HTTP 200: смысл
 * в `Result/Code` (0 — нашли, 3 — операции нет, 1/2/4/1000 — наша
 * или их беда) и в `State/Code` (5 — создана, 10 — отменена, 50 —
 * деньги получены, 100 — оплачена; 20, 60, 80 — руками).
 */
export async function sprositSostoyanie(n: Nastroyki, invoiceId: number): Promise<SostoyanieOperacii> {
  const q = new URLSearchParams({
    MerchantLogin: n.login,
    InvoiceID: String(invoiceId),
    Signature: podpisOpStateExt(n, invoiceId),
  }).toString();
  const sep = env.rkOpStateUrl.includes('?') ? '&' : '?';
  const itog = await http(`${env.rkOpStateUrl}${sep}${q}`, 'GET', null);
  if (itog.kak !== 'otvet') return { kak: 'net', pochemu: itog.pochemu };
  if (itog.kod !== 200) return { kak: 'net', pochemu: `HTTP ${itog.kod}` };
  const result = /<Result>[\s\S]*?<Code>\s*(\d+)\s*<\/Code>/i.exec(itog.telo);
  if (!result) return { kak: 'net', pochemu: 'в ответе нет Result/Code' };
  const state = /<State>[\s\S]*?<Code>\s*(\d+)\s*<\/Code>/i.exec(itog.telo);
  return { kak: 'otvet', result: Number(result[1]), state: state ? Number(state[1]) : null };
}

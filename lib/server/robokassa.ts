/**
 * Робокасса: приём платежей.
 *
 * Здесь ровно три вещи, и все три — про подпись:
 *   1. собрать ссылку на оплату и подписать её ПАРОЛЕМ №1;
 *   2. проверить уведомление на ResultURL подписью с ПАРОЛЕМ №2;
 *   3. проверить возврат человека на SuccessURL подписью с ПАРОЛЕМ №1.
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

export type PoziciyaCheka = {
  name: string;
  quantity: number;
  sum: number;
  payment_method: 'full_payment';
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
export function chek(n: Nastroyki, pozicii: { name: string; sumKop: number }[]): Record<string, unknown> {
  const items: PoziciyaCheka[] = pozicii.map((p) => ({
    name: p.name.slice(0, 128),
    quantity: 1,
    sum: Number(rubliStrokoy(p.sumKop)),
    payment_method: 'full_payment',
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
  pozicii: { name: string; sumKop: number }[],
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

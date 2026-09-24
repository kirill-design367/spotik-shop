/**
 * Метки кампании: снимаются с адреса первого захода и доезжают
 * до заказа.
 *
 * ⚠️ ЛОВИТ ИХ БРАУЗЕР, А НЕ СЕРВЕР, И ПРИЧИНА В ЗАКОНЕ 36. Лендинг
 * обязан остаться СТАТИЧЕСКИМ: у `app/page.tsx` стоит `revalidate`,
 * и первое же обращение к `searchParams`, `cookies()` или `headers()`
 * перевело бы первый экран на посчитанный ответ. Поэтому метки
 * снимает крошечный скрипт в `<head>` и кладёт в куку, а серверное
 * действие читает уже её — действию `cookies()` можно.
 *
 * ⚠️ КУКА НЕ HTTPONLY, И ИНАЧЕ НЕ БЫВАЕТ: её ставит сам браузер.
 * Ничего чувствительного в ней нет — это то, что человек и так принёс
 * в адресной строке, и подделка метки не даёт ничего, кроме кривой
 * строчки в статистике.
 *
 * ⚠️ ПОБЕЖДАЕТ ПЕРВЫЙ ЗАХОД. Человек приходит по рекламе, ходит
 * по сайту, возвращается из поиска — и последний заход затёр бы
 * настоящий источник. Кука ставится, только если её ещё нет.
 */

import { cookies } from 'next/headers';

export const KUKA_UTM = 'spotik_utm';

/** Пять имён, и ровно в этом порядке они лежат в куке. */
export const METKI = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;
export type Metka = (typeof METKI)[number];
export type Utm = Partial<Record<Metka, string>>;

/**
 * Сколько знаков оставляем от метки.
 *
 * ⚠️ РЕЖЕМ, А НЕ ОТКАЗЫВАЕМ. Метку пишет кто угодно, и чужая
 * рекламная ссылка бывает с хвостом в полкилобайта. Отказ означал бы
 * несозданный заказ — то есть потерянные деньги из-за строчки
 * статистики.
 */
const DLINA = 120;

function chisto(v: string): string {
  /* Управляющие знаки убираем: они попадают в админку и в отчёт. */
  return v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, DLINA);
}

/**
 * Разобрать значение куки.
 *
 * Формат — обычная строка запроса (`utm_source=ya&utm_medium=cpc`),
 * то есть ровно то, что было в адресе. Второго формата нет намеренно:
 * разбирать его умеет и браузер, и сервер, и глазами он читается.
 */
export function razobratUtm(syroe: string | undefined): Utm {
  if (!syroe) return {};
  const out: Utm = {};
  let p: URLSearchParams;
  try {
    p = new URLSearchParams(syroe);
  } catch {
    return {};
  }
  for (const m of METKI) {
    const v = p.get(m);
    if (v) {
      const c = chisto(v);
      if (c) out[m] = c;
    }
  }
  return out;
}

/** Метки текущего посетителя — для серверного действия. */
export async function utmIzKuki(): Promise<Utm> {
  try {
    const jar = await cookies();
    return razobratUtm(jar.get(KUKA_UTM)?.value);
  } catch {
    /* Куку читать неоткуда (сборка, фоновая задача) — меток нет. */
    return {};
  }
}

/** Пять значений в порядке `METKI` — прямо в параметры запроса. */
export function utmVRyad(u: Utm): (string | null)[] {
  return METKI.map((m) => u[m] ?? null);
}

/**
 * Язык админки.
 *
 * ⚠️ ИСТОЧНИКОВ ДВА, И ПОРЯДОК МЕЖДУ НИМИ ЖЁСТКИЙ. Главный —
 * строка сотрудника в базе: постановка требует «выбор запоминается
 * ЗА ПОЛЬЗОВАТЕЛЕМ», то есть переезжает вместе с ним на другую
 * машину. Кука нужна ровно для одной страницы — входа, где
 * пользователя ещё нет и спрашивать не у кого.
 *
 * Переключатель пишет оба: базу, чтобы выбор жил, и куку, чтобы
 * страница входа помнила его до следующего входа.
 */

import { cookies } from 'next/headers';
import { ktoSotrudnik } from './auth';
import { zapros } from './db';
import { ponyatYazyk, type Yazyk } from '@/lib/admin/slova';

export const KUKA_YAZYKA = 'spotik_lang';

/** Язык для страницы, где сотрудник уже известен. */
export async function yazykSotrudnika(s: { lang: Yazyk } | null): Promise<Yazyk> {
  if (s) return s.lang;
  const jar = await cookies();
  return ponyatYazyk(jar.get(KUKA_YAZYKA)?.value);
}

/** Язык, когда сотрудника ещё нет: вход и отказы до входа. */
export async function yazykAdminki(): Promise<Yazyk> {
  return yazykSotrudnika(await ktoSotrudnik());
}

export async function zapomnitYazyk(y: Yazyk): Promise<void> {
  const jar = await cookies();
  /* Кука не секрет и живёт год. `httpOnly` — потому что читать её
     из браузера некому: язык приезжает уже посчитанным в разметке. */
  jar.set(KUKA_YAZYKA, y, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 365 * 24 * 3600,
  });
  const s = await ktoSotrudnik();
  if (s) await zapros('update staff set lang = $2 where id = $1', [s.id, y]);
}

/**
 * PostgreSQL: один пул на процесс.
 *
 * ⚠️ БАЗЫ МОЖЕТ НЕ БЫТЬ, И ЭТО НОРМАЛЬНОЕ СОСТОЯНИЕ. Лендинг
 * собирается на раннере GitHub, где никакого PostgreSQL нет,
 * и обязан собраться: цены при недоступной базе берутся
 * из `lib/plans.ts` (см. lib/server/catalog.ts). Поэтому `pool()`
 * возвращает `null`, а не падает, и каждый узел сам решает,
 * что делать без базы.
 *
 * Пул кэшируется на `globalThis`: в разработке Next перезагружает
 * модули на каждую правку, и без этого к базе набежала бы сотня
 * соединений.
 */

import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { env } from './env';
import { log } from './log';

type Global = typeof globalThis & { __spotikPool?: Pool | null };
const g = globalThis as Global;

export function pool(): Pool | null {
  if (g.__spotikPool !== undefined) return g.__spotikPool;
  const url = env.databaseUrl;
  if (!url) {
    g.__spotikPool = null;
    return null;
  }
  const p = new Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  // ⚠️ БЕЗ ЭТОГО ОДНО УПАВШЕЕ СОЕДИНЕНИЕ РОНЯЕТ ПРОЦЕСС. `pg`
  // бросает 'error' на простаивающем клиенте, когда сервер закрыл
  // соединение со своей стороны, и необработанное событие 'error'
  // в Node — это выход из процесса.
  p.on('error', (e) => log.error('пул базы: ошибка простаивающего соединения', { text: String(e.message) }));
  g.__spotikPool = p;
  return p;
}

/** Есть ли база. Узлы, которым она обязательна, спрашивают это первым. */
export function bazaEst(): boolean {
  return pool() !== null;
}

export class NetBazy extends Error {
  constructor() {
    super('база не настроена');
  }
}

export async function zapros<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const p = pool();
  if (!p) throw new NetBazy();
  const r = await p.query<T>(text, params);
  return r.rows;
}

/** Одна строка или null. */
export async function odna<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await zapros<T>(text, params);
  return rows[0] ?? null;
}

/**
 * Транзакция.
 *
 * ⚠️ ДЕНЬГИ ДВИГАЮТСЯ ТОЛЬКО ЗДЕСЬ. Списание с баланса и пометка
 * заказа оплаченным — это две записи, и между ними не должно быть
 * состояния, в котором деньги уже списаны, а заказ ещё не оплачен.
 */
export async function vTranzakcii<T>(delo: (c: PoolClient) => Promise<T>): Promise<T> {
  const p = pool();
  if (!p) throw new NetBazy();
  const c = await p.connect();
  try {
    await c.query('BEGIN');
    const out = await delo(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    try {
      await c.query('ROLLBACK');
    } catch {
      /* пусто: откат уже невозможен, исходную ошибку это не меняет */
    }
    throw e;
  } finally {
    c.release();
  }
}

/** Мягкий запрос: база недоступна — вернётся значение по умолчанию. */
export async function tikho<T>(delo: () => Promise<T>, poUmolchaniyu: T): Promise<T> {
  if (!bazaEst()) return poUmolchaniyu;
  try {
    return await delo();
  } catch (e) {
    log.error('запрос к базе не прошёл', { text: String((e as Error).message) });
    return poUmolchaniyu;
  }
}

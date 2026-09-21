/**
 * Миграции.
 *
 * Свой прогон вместо библиотеки: файлов немного, а лишняя
 * зависимость в критическом пути сборки дороже двадцати строк.
 *
 * ⚠️ КАЖДЫЙ ФАЙЛ ИДЁТ В СВОЕЙ ТРАНЗАКЦИИ, и отметка о нём ставится
 * в той же транзакции. Иначе упавшая на середине миграция оставила
 * бы базу в состоянии «половина применена, а отметки нет»,
 * и следующий прогон начал бы её заново.
 *
 * ⚠️ БЛОКИРОВКА НА ВРЕМЯ ПРОГОНА. Выкладка и ручной запуск могут
 * встретиться; `pg_advisory_lock` даёт им встать в очередь, а не
 * применять одно и то же дважды.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pool } from './db';
import { log } from './log';

const ZAMOK = 728_140_927; // произвольное, но постоянное число

export async function migrirovat(katalog = path.join(process.cwd(), 'db', 'migrations')): Promise<string[]> {
  const p = pool();
  if (!p) throw new Error('DATABASE_URL не задан — мигрировать нечего');

  const c = await p.connect();
  const applied: string[] = [];
  try {
    await c.query('select pg_advisory_lock($1)', [ZAMOK]);
    await c.query(`create table if not exists migration (
      name text primary key,
      applied_at timestamptz not null default now()
    )`);
    const est = new Set((await c.query<{ name: string }>('select name from migration')).rows.map((r) => r.name));
    const fayly = (await readdir(katalog)).filter((f) => f.endsWith('.sql')).sort();

    for (const f of fayly) {
      if (est.has(f)) continue;
      const sql = await readFile(path.join(katalog, f), 'utf8');
      await c.query('BEGIN');
      try {
        await c.query(sql);
        await c.query('insert into migration (name) values ($1)', [f]);
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw new Error(`миграция ${f} не прошла: ${(e as Error).message}`);
      }
      applied.push(f);
      log.info('миграция применена', { name: f });
    }
  } finally {
    try {
      await c.query('select pg_advisory_unlock($1)', [ZAMOK]);
    } catch {
      /* пусто: соединение уже закрывается */
    }
    c.release();
  }
  return applied;
}

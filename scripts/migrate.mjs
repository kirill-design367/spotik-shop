/**
 * Прогон миграций: `node scripts/migrate.mjs`.
 *
 * Зовётся ВЫКЛАДКОЙ, до переключения симлинка: новая версия кода
 * не должна встретить старую схему. Идемпотентен — применённое
 * второй раз не применяется.
 */

// Миграции лежат в TypeScript рядом с приложением, а запускать их надо
// и на раннере, и на сервере, где сборки TypeScript нет. Поэтому здесь
// повторён минимум: чтение каталога и прогон файлов.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const ZAMOK = 728140927;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL не задан');
  process.exit(1);
}

const katalog = path.join(process.cwd(), 'db', 'migrations');
const pool = new pg.Pool({ connectionString: url, max: 1 });
const c = await pool.connect();
let kod = 0;
try {
  await c.query('select pg_advisory_lock($1)', [ZAMOK]);
  await c.query(`create table if not exists migration (
    name text primary key,
    applied_at timestamptz not null default now()
  )`);
  const est = new Set((await c.query('select name from migration')).rows.map((r) => r.name));
  const fayly = (await readdir(katalog)).filter((f) => f.endsWith('.sql')).sort();
  let n = 0;
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
      throw new Error(`миграция ${f} не прошла: ${e.message}`);
    }
    console.log(`  применена ${f}`);
    n++;
  }
  console.log(n ? `миграций применено: ${n}` : 'новых миграций нет');
} catch (e) {
  console.error(String(e.message || e));
  kod = 1;
} finally {
  try { await c.query('select pg_advisory_unlock($1)', [ZAMOK]); } catch {}
  c.release();
  await pool.end();
}
process.exit(kod);

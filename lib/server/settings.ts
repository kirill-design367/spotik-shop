/**
 * Настройки, которые меняет администратор.
 *
 * Хранятся строками: чисел тут два с половиной, а отдельная колонка
 * на каждое означала бы миграцию на каждую новую настройку.
 */

import { odna, tikho, zapros } from './db';

export const SROK_SERTIFIKATA = 'certificate_days';

export async function nastroyka(klyuch: string, poUmolchaniyu: string): Promise<string> {
  const r = await tikho(() => odna<{ value: string }>('select value from setting where key = $1', [klyuch]), null);
  return r?.value ?? poUmolchaniyu;
}

export async function zadatNastroyku(klyuch: string, znachenie: string): Promise<void> {
  await zapros(
    `insert into setting (key, value) values ($1, $2)
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [klyuch, znachenie],
  );
}

/** Срок жизни сертификата в днях. По умолчанию год, как в постановке. */
export async function srokSertifikataDney(): Promise<number> {
  const v = Number(await nastroyka(SROK_SERTIFIKATA, '365'));
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 365;
}

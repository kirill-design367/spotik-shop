/**
 * Точка входа сервера: что заводится один раз на процесс.
 *
 * Next зовёт `register()` при старте серверного рантайма — и только
 * там, где он вообще есть. На сборке и в браузере это не выполняется
 * вовсе, поэтому базы и ключа здесь можно не бояться.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { zavestiUborku } = await import('./lib/server/upkeep');
  const { bazaEst } = await import('./lib/server/db');
  const { zavestiPervyhAdminov } = await import('./lib/server/auth');
  const { log } = await import('./lib/server/log');

  if (!bazaEst()) {
    log.warn('DATABASE_URL не задан: работает только лендинг');
    return;
  }
  try {
    await zavestiPervyhAdminov();
  } catch (e) {
    log.error('первых администраторов завести не вышло', { text: String((e as Error).message) });
  }
  zavestiUborku();
}

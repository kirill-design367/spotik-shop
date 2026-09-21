/**
 * Поднимает СОБРАННОЕ ПРИЛОЖЕНИЕ по боевому пути.
 *
 * ⚠️ СТАТИЧЕСКОГО ЭКСПОРТА БОЛЬШЕ НЕТ. До двадцать седьмой итерации
 * здесь был крошечный файловый сервер поверх `out/`: сайт собирался
 * `output: 'export'`, и проверять было ровно те же байты, что уезжали
 * на сервер. Теперь сайт — приложение (кабинет, оформление, оплата,
 * админка), и `out/` не существует вовсе.
 *
 * Поэтому сторожа открывают ТО ЖЕ, ЧТО ВИДИТ ЧЕЛОВЕК: боевой сервер
 * Next, поднятый из свежей сборки. Это не ослабление проверки,
 * а усиление — прежний файловый сервер воспроизводил заголовки nginx
 * руками, а этот отдаёт страницу тем же кодом, что и на spotik.shop.
 *
 * ⚠️ БЕЗ БАЗЫ И БЕЗ КЛЮЧЕЙ, И ЭТО НАМЕРЕННО. `DATABASE_URL` сюда
 * не передаётся: лендинг обязан работать с умолчаниями из
 * `lib/plans.ts` (см. lib/server/db.ts), и сторожа заодно это
 * проверяют каждым своим запуском.
 *
 * Величина одна и она здесь; вторая половина — `BASE`
 * в `next.config.mjs`. Поедет сайт в подпапку — менять оба.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const PREFIX = '';

/** Сколько ждём, пока сервер ответит. Холодный старт Next ~2…6 с. */
const ZHDAT_MS = 60_000;

async function zhivoy(url) {
  try {
    const r = await fetch(url, { redirect: 'manual' });
    return r.status > 0;
  } catch {
    return false;
  }
}

/**
 * @param {number} port
 * @param {{dir?: string, env?: Record<string,string>}} opts
 *   `env` — чем дополнить окружение сервера. Сторожа лендинга его
 *   не задают вовсе и потому проверяют работу БЕЗ базы; сторож
 *   магазина передаёт туда строку подключения и ключ шифрования.
 */
export async function serveOut(port, { dir = '.next', env = {} } = {}) {
  if (!existsSync(resolve(dir))) {
    throw new Error(`нет сборки в ${dir}: сначала npm run build`);
  }
  const bin = resolve('node_modules', '.bin', 'next');
  /* ⚠️ СВОЯ ГРУППА ПРОЦЕССОВ, И ЭТО НЕ АККУРАТНОСТЬ. `next start`
     поднимает ОТДЕЛЬНЫЙ процесс сервера, и сигнал родителю до него
     не доходит: после первого же сторожа порт остаётся занят,
     а брошенный сервер ест процессор. Убиваем группу. */
  const proc = spawn(bin, ['start', '--port', String(port), '--hostname', '0.0.0.0'], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      // Сторожа судят о ЛЕНДИНГЕ, и база ему не нужна. Пустая строка
      // надёжнее отсутствия: она перекрывает переменную, случайно
      // оставленную в окружении разработчика.
      DATABASE_URL: '',
      SPOTIK_CRYPTO_KEY: '',
      ...env,
    },
  });
  let log = '';
  proc.stdout.on('data', (b) => (log += b));
  proc.stderr.on('data', (b) => (log += b));

  const ubit = () => {
    try {
      process.kill(-proc.pid, 'SIGKILL');
    } catch {
      try {
        proc.kill('SIGKILL');
      } catch {
        /* пусто: процесс уже мёртв */
      }
    }
  };
  // Сторож может упасть исключением на любой строке; брошенный
  // сервер после этого держал бы порт до конца сессии.
  process.once('exit', ubit);

  const url = `http://localhost:${port}${PREFIX}/`;
  const do_ = Date.now() + ZHDAT_MS;
  while (Date.now() < do_) {
    if (proc.exitCode !== null) throw new Error(`сервер упал при старте:\n${log}`);
    if (await zhivoy(url)) {
      return {
        url,
        proc,
        /** Весь журнал сервера с начала запуска. */
        zhurnal: () => log,
        close: ubit,
      };
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  ubit();
  throw new Error(`сервер не поднялся за ${ZHDAT_MS} мс:\n${log}`);
}

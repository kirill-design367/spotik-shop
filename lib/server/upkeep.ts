/**
 * Уборка.
 *
 * ⚠️ ДОСТУПЫ СТИРАЮТСЯ ЧЕРЕЗ СЕМЬ ДНЕЙ ПОСЛЕ ЗАКРЫТИЯ ЗАКАЗА —
 * прямое требование постановки. Стирается ВСЁ шифрованное: и пароль
 * клиента, который он дал на продление, и выданные оператором
 * логины с паролями. Сам заказ остаётся — он нужен для истории
 * и для баланса, — а секретов в нём больше нет.
 *
 * Семь дней, а не «сразу»: это окно, в котором человек успевает
 * заметить, что доступ не работает, и написать. После него хранить
 * чужой пароль не за чем.
 *
 * Заодно убираются просроченные коды входа и мёртвые сессии: они
 * копятся по строке на каждый вход и ничего не стоят, кроме места.
 */

import { bazaEst, zapros } from './db';
import { log } from './log';

const CHAS = 3_600_000;

export async function ubrat(): Promise<void> {
  if (!bazaEst()) return;
  try {
    const styorto = await zapros<{ id: string }>(
      `update shop_order
          set secrets_wiped_at = now()
        where closed_at is not null
          and closed_at < now() - interval '7 days'
          and secrets_wiped_at is null
        returning id`,
    );
    if (styorto.length) {
      await zapros(
        `update order_slot
            set in_login_enc = null, in_password_enc = null,
                out_login_enc = null, out_mail_pass_enc = null, out_password_enc = null
          where order_id = any($1::bigint[])`,
        [styorto.map((r) => Number(r.id))],
      );
      log.info('доступы стёрты по сроку', { orders: styorto.length });
    }
    await zapros(`delete from login_code where created_at < now() - interval '2 days'`);
    await zapros('delete from session where expires_at < now()');
    // Ушедшие уведомления держать незачем: разбор беды идёт
    // по журналу, а неушедшие остаются в очереди до последней попытки.
    await zapros(`delete from notify_outbox where sent_at is not null and sent_at < now() - interval '14 days'`);
  } catch (e) {
    log.error('уборка не прошла', { text: String((e as Error).message) });
  }
}

type Global = typeof globalThis & { __spotikUpkeep?: NodeJS.Timeout };

/**
 * Часовой будильник.
 *
 * Отдельного демона заводить не за чем: приложение на сервере одно,
 * и уборка стоит доли миллисекунды. `unref` — чтобы таймер
 * не держал процесс живым при остановке сервиса.
 */
export function zavestiUborku(): void {
  const g = globalThis as Global;
  if (g.__spotikUpkeep) return;
  g.__spotikUpkeep = setInterval(() => void ubrat(), CHAS);
  g.__spotikUpkeep.unref?.();
  void ubrat();
}

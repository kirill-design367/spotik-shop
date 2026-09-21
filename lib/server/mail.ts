/**
 * Письма.
 *
 * ⚠️ ПОКА SMTP НЕ НАСТРОЕН, ПИСЬМА ИДУТ В ЖУРНАЛ СЕРВЕРА — прямая
 * постановка двадцать седьмой итерации. Почтового ящика у проекта
 * ещё нет, а войти на сайт надо уже сейчас: код входа читается
 * из `journalctl -u spotik`. Как только в окружении появится
 * `SMTP_HOST`, тот же вызов начнёт слать настоящую почту, и в коде
 * менять нечего.
 *
 * ⚠️ ОТПРАВКА НИКОГДА НЕ РОНЯЕТ ДЕЙСТВИЕ. Заказ оплачен — значит
 * оплачен, даже если почтовый сервер лежит. Неудача уходит в журнал
 * и на этом всё: иначе упавший SMTP означал бы непринятые деньги.
 */

import { env } from './env';
import { log, pochtaVZhurnal } from './log';

export type Pismo = {
  komu: string;
  tema: string;
  /** Простой текст. HTML у нас не нужен: письма короткие и служебные. */
  telo: string;
};

type Global = typeof globalThis & { __spotikMailer?: unknown };
const g = globalThis as Global;

async function transport() {
  if (!env.smtpHost) return null;
  if (!g.__spotikMailer) {
    const { createTransport } = await import('nodemailer');
    g.__spotikMailer = createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpSecure,
      auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPass } : undefined,
    });
  }
  return g.__spotikMailer as { sendMail: (o: Record<string, unknown>) => Promise<unknown> };
}

/** Настроена ли настоящая отправка. Показывается в админке. */
export function pochtaNastroena(): boolean {
  return Boolean(env.smtpHost);
}

export async function otpravit(p: Pismo): Promise<void> {
  const t = await transport().catch(() => null);
  if (!t) {
    // Тестовый режим: письмо целиком в журнал. Это и есть способ
    // войти на сайт, пока ящика нет.
    log.info('ПИСЬМО (SMTP не настроен, шлём в журнал)', { to: p.komu, subject: p.tema });
    process.stdout.write(`--- письмо ---\nКому: ${p.komu}\nТема: ${p.tema}\n\n${p.telo}\n--- конец ---\n`);
    return;
  }
  try {
    await t.sendMail({ from: env.smtpFrom, to: p.komu, subject: p.tema, text: p.telo });
    log.info('письмо отправлено', { to: pochtaVZhurnal(p.komu), subject: p.tema });
  } catch (e) {
    log.error('письмо не ушло', { to: pochtaVZhurnal(p.komu), subject: p.tema, text: String((e as Error).message) });
  }
}

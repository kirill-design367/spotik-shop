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
 *
 * ⚠️ ОТВЕТ ПОЧТОВОГО СЕРВЕРА ПИШЕТСЯ В ЖУРНАЛ ДОСЛОВНО — И НА УСПЕХЕ
 * ТОЖЕ. Это то же правило, что у Telegram (закон 39): «ушло» обязано
 * быть НАБЛЮДЕНИЕМ, а не нашим выводом из того, что исключения
 * не случилось. У nodemailer дословный ответ сервера лежит
 * в `info.response` при успехе и в `err.response` при отказе;
 * рядом с ним пишутся `err.code` (EAUTH, EENVELOPE, ESOCKET, EDNS,
 * ETIMEDOUT) и `err.command` — ШАГ РАЗГОВОРА, на котором отказали.
 * Шаг и есть главное для разбора: `AUTH LOGIN` значит «не тот
 * пароль» (у Яндекса нужен пароль ПРИЛОЖЕНИЯ, а не от аккаунта),
 * `MAIL FROM` — «адрес в SMTP_FROM не тот, под которым вошли»,
 * `RCPT TO` — «получателя не приняли». Без шага все три выглядят
 * одинаково: «письмо не ушло».
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

/** Куда и как соединяемся. В журнал идёт как есть: секретов тут нет. */
function uzel(): string {
  return `${env.smtpHost}:${env.smtpPort} ${env.smtpSecure ? 'tls' : 'без tls'}`;
}

async function transport() {
  if (!env.smtpHost) return null;
  if (!g.__spotikMailer) {
    const { createTransport } = await import('nodemailer');
    g.__spotikMailer = createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpSecure,
      auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPass } : undefined,
      // ⚠️ СРОКИ ЗАДАНЫ ЯВНО. Умолчание nodemailer на соединение —
      // две минуты, и недоступный почтовый узел держал бы серверное
      // действие всё это время: человек, нажавший «Выслать код»,
      // смотрел бы на крутилку две минуты вместо честного отказа.
      // Те же пятнадцать секунд, что у отправки в Telegram.
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 20_000,
    });
  }
  return g.__spotikMailer as {
    sendMail: (o: Record<string, unknown>) => Promise<{
      response?: string;
      accepted?: unknown[];
      rejected?: unknown[];
      messageId?: string;
    }>;
  };
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
    const info = await t.sendMail({ from: env.smtpFrom, to: p.komu, subject: p.tema, text: p.telo });
    const prinyato = Array.isArray(info?.accepted) ? info.accepted.length : 0;
    const otvergnuto = Array.isArray(info?.rejected) ? info.rejected.length : 0;
    log.info('письмо отправлено', {
      to: pochtaVZhurnal(p.komu),
      subject: p.tema,
      ot: env.smtpFrom,
      uzel: uzel(),
      // Дословный ответ сервера на DATA: у Яндекса это
      // «250 2.0.0 Ok: queued on … as …» — то есть письмо принято
      // в очередь, и номер в нём ищется в журнале доставки Яндекса.
      otvet: info?.response ?? '—',
      prinyato,
      otvergnuto,
    });
  } catch (e) {
    const o = e as {
      message?: string;
      code?: string;
      responseCode?: number;
      response?: string;
      command?: string;
    };
    log.error('письмо не ушло', {
      to: pochtaVZhurnal(p.komu),
      subject: p.tema,
      ot: env.smtpFrom,
      uzel: uzel(),
      vid: o.code ?? '—',
      kod: o.responseCode ?? 0,
      shag: o.command ?? '—',
      otvet: o.response ?? o.message ?? String(e),
    });
  }
}

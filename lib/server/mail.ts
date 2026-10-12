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
 * ⚠️ НА БОЕВОМ СЕРВЕРЕ `SMTP_HOST` УЖЕ ЗАДАН, ТО ЕСТЬ ЭТА ВЕТКА ТАМ
 * ВЫКЛЮЧЕНА. Значит запасного пути «код в журнале» на бою нет:
 * не ушло письмо — войти нельзя. Печатать код в журнал и при НЕУДАЧНОЙ
 * отправке нельзя по-прежнему: временный путь такого рода живёт годами
 * (Р-91), и на бою он означает вход в любой кабинет для всякого, у кого
 * есть доступ к серверу.
 *
 * ⚠️ ПОЭТОМУ ЯЩИКОВ ДВА, И ЗАПАСНОЙ — У ДРУГОГО СЕРВИСА (Р-164).
 * 11 октября 2026 года почтовый узел Яндекса перестал пускать наш
 * сервер на всех портах, и вход закрылся для всех, кто не вошёл
 * раньше. Письмо идёт основным ящиком, не принял — запасным. Узел,
 * до которого не дотянулись вовсе, пропускается десять минут: иначе
 * каждый «Выслать код» ждал бы его отказа по сроку.
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
 *
 * ⚠️ И РЯДОМ С ШАГОМ ПИШЕТСЯ ЛОГИН, КОТОРЫМ ПРЕДСТАВИЛИСЬ. При отказе
 * на `AUTH` первый вопрос всегда один: тот ли это ящик. Отвечать
 * на него догадкой о содержимом секрета нельзя — в журнале стоит
 * огрызок адреса, и он отвечает прямо.
 */

import { env } from './env';
import { log, pochtaVZhurnal } from './log';

export type Pismo = {
  komu: string;
  tema: string;
  /** Простой текст. HTML у нас не нужен: письма короткие и служебные. */
  telo: string;
};

type Imya = 'osnovnoy' | 'zapasnoy';

type Yashchik = {
  imya: Imya;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
};

/** Как ящик называется в журнале: строку читает человек. */
const SLOVO: Record<Imya, string> = { osnovnoy: 'основной', zapasnoy: 'запасной' };

/* ⚠️ ДЕСЯТЬ МИНУТ — СРОК, А НЕ ПРИГОВОР. Узел, до которого не дотянулись
   вовсе (отказ соединения, срок, DNS), на это время пропускается, и письма
   сразу идут запасным. Потом основной пробуется снова: вернулся — дальше
   идёт им, и руки на сервере для этого не нужны. Отказ ПОСЛЕ соединения
   (пароль, отправитель) сюда не относится: это настройка, а не авария,
   и узел сам отвечает за доли секунды. */
const PAUZA_MS = 10 * 60_000;

type Sendmail = (o: Record<string, unknown>) => Promise<{
  response?: string;
  accepted?: unknown[];
  rejected?: unknown[];
  messageId?: string;
}>;

type Global = typeof globalThis & {
  __spotikMailers?: Partial<Record<Imya, { sendMail: Sendmail; klyuch: string }>>;
  __spotikPochtaLezhit?: Partial<Record<Imya, number>>;
};
const g = globalThis as Global;

function yashchiki(): Yashchik[] {
  const spisok: Yashchik[] = [];
  if (env.smtpHost) {
    spisok.push({
      imya: 'osnovnoy',
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpSecure,
      user: env.smtpUser,
      pass: env.smtpPass,
      from: env.smtpFrom,
    });
  }
  // Запасной имеет смысл только при основном: без SMTP_HOST сайт
  // в тестовом режиме, и письма идут в журнал (см. выше).
  if (env.smtpHost && env.smtpReserveHost) {
    spisok.push({
      imya: 'zapasnoy',
      host: env.smtpReserveHost,
      port: env.smtpReservePort,
      secure: env.smtpReserveSecure,
      user: env.smtpReserveUser,
      pass: env.smtpReservePass,
      from: env.smtpReserveFrom,
    });
  }
  return spisok;
}

/** Куда и как соединяемся. В журнал идёт как есть: секретов тут нет. */
function uzel(y: Yashchik): string {
  return `${y.host}:${y.port} ${y.secure ? 'tls' : 'без tls'}`;
}

/**
 * Каким логином представляемся серверу — то есть что уходит в AUTH.
 *
 * ⚠️ ОГРЫЗКОМ, А НЕ ЦЕЛИКОМ, и это не перестраховка. Строку из журнала
 * читают через прогон workflow, а его вывод у ПУБЛИЧНОГО репозитория
 * виден всем. Огрызок `n…@домен` отвечает на вопрос «тот ли ящик»
 * и не выдаёт адрес целиком. Заодно он не совпадает с секретом
 * побайтно, поэтому GitHub не заменит его звёздочками — а целый адрес
 * заменил бы, и строка стала бы бесполезной.
 */
function vhod(y: Yashchik): string {
  return y.user ? pochtaVZhurnal(y.user) : 'без AUTH: логин пуст';
}

async function transport(y: Yashchik): Promise<Sendmail> {
  const vse = (g.__spotikMailers ??= {});
  // Настройка ящика — часть ключа: другой логин или узел не должен
  // уехать старым соединением.
  const klyuch = `${y.host}|${y.port}|${y.secure}|${y.user}|${y.pass}`;
  const est = vse[y.imya];
  if (est && est.klyuch === klyuch) return est.sendMail;
  const { createTransport } = await import('nodemailer');
  const t = createTransport({
    host: y.host,
    port: y.port,
    secure: y.secure,
    auth: y.user ? { user: y.user, pass: y.pass } : undefined,
    // ⚠️ СРОКИ ЗАДАНЫ ЯВНО. Умолчание nodemailer на соединение —
    // две минуты, и недоступный почтовый узел держал бы серверное
    // действие всё это время: человек, нажавший «Выслать код»,
    // смотрел бы на крутилку две минуты вместо честного отказа.
    // Те же пятнадцать секунд, что у отправки в Telegram.
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  });
  const sendMail = t.sendMail.bind(t) as unknown as Sendmail;
  vse[y.imya] = { sendMail, klyuch };
  return sendMail;
}

/** Настроена ли настоящая отправка. Показывается в админке. */
export function pochtaNastroena(): boolean {
  return Boolean(env.smtpHost);
}

type Oshibka = { message?: string; code?: string; responseCode?: number; response?: string; command?: string };

/** До узла не дотянулись вовсе — соединение, срок, DNS. Ответа у него нет. */
function neDotyanulis(o: Oshibka): boolean {
  if (o.responseCode) return false;
  return o.command === 'CONN' || ['ESOCKET', 'ETIMEDOUT', 'ECONNECTION', 'EDNS'].includes(o.code ?? '');
}

/** Узел отверг сам адрес получателя — постоянным отказом на RCPT TO. */
function otvergnutAdres(o: Oshibka): boolean {
  return o.command === 'RCPT TO' && (o.responseCode ?? 0) >= 500;
}

function lezhit(imya: Imya): boolean {
  const do_ = g.__spotikPochtaLezhit?.[imya] ?? 0;
  return do_ > Date.now();
}

/**
 * Чем кончилась отправка. `ushlo` — письмо принял почтовый узел (или
 * сайт в тестовом режиме и письмо легло в журнал); `adres` — узел
 * отверг САМ АДРЕС получателя, и другим ящиком это не лечится; `net` —
 * не принял ни один ящик.
 */
export type Itog = 'ushlo' | 'adres' | 'net';

/** Отправить письмо. Наружу не бросает НИЧЕГО: отправка не роняет действие. */
export async function otpravit(p: Pismo): Promise<Itog> {
  const vse = yashchiki();
  if (!vse.length) {
    // Тестовый режим: письмо целиком в журнал. Это и есть способ
    // войти на сайт, пока ящика нет.
    log.info('ПИСЬМО (SMTP не настроен, шлём в журнал)', { to: p.komu, subject: p.tema });
    process.stdout.write(`--- письмо ---\nКому: ${p.komu}\nТема: ${p.tema}\n\n${p.telo}\n--- конец ---\n`);
    return 'ushlo';
  }

  /* Лежащий ящик идёт ПОСЛЕДНИМ, а не выбрасывается: лежат все — пробуем
     все, иначе десятиминутная пауза превратилась бы в десять минут
     без единой попытки. */
  const poryadok = [...vse.filter((y) => !lezhit(y.imya)), ...vse.filter((y) => lezhit(y.imya))];
  let poslednyaya: { y: Yashchik; o: Oshibka } | null = null;

  if (poryadok[0].imya !== vse[0].imya) {
    log.info('основной ящик пропущен: не отвечал, пауза ещё идёт', { yashchik: SLOVO[poryadok[0].imya] });
  }

  for (const y of poryadok) {
    // Лежащий ящик в очереди только последним, и сюда он доходит,
    // только если живые уже отказали.
    if (poslednyaya && lezhit(y.imya)) {
      log.info('лежащий ящик пробуем всё равно: другие не приняли', { yashchik: SLOVO[y.imya] });
    }
    try {
      const t = await transport(y);
      const info = await t({ from: y.from, to: p.komu, subject: p.tema, text: p.telo });
      const prinyato = Array.isArray(info?.accepted) ? info.accepted.length : 0;
      const otvergnuto = Array.isArray(info?.rejected) ? info.rejected.length : 0;
      if (g.__spotikPochtaLezhit?.[y.imya]) {
        delete g.__spotikPochtaLezhit[y.imya];
        log.info('ящик снова принимает письма', { yashchik: SLOVO[y.imya] });
      }
      log.info('письмо отправлено', {
        to: pochtaVZhurnal(p.komu),
        subject: p.tema,
        ot: y.from,
        vhod: vhod(y),
        uzel: uzel(y),
        yashchik: SLOVO[y.imya],
        // Дословный ответ сервера на DATA: у Яндекса это
        // «250 2.0.0 Ok: queued on … as …» — то есть письмо принято
        // в очередь, и номер в нём ищется в журнале доставки сервиса.
        otvet: info?.response ?? '—',
        prinyato,
        otvergnuto,
      });
      return 'ushlo';
    } catch (e) {
      const o = e as Oshibka;
      poslednyaya = { y, o };
      if (neDotyanulis(o) && vse.length > 1) {
        const bylo = lezhit(y.imya);
        (g.__spotikPochtaLezhit ??= {})[y.imya] = Date.now() + PAUZA_MS;
        if (!bylo) {
          log.warn('почтовый ящик не отвечает — десять минут письма идут другим', {
            yashchik: SLOVO[y.imya],
            uzel: uzel(y),
          });
        }
      }
      log.warn('ящик не принял письмо', {
        to: pochtaVZhurnal(p.komu),
        subject: p.tema,
        yashchik: SLOVO[y.imya],
        vid: o.code ?? '—',
        kod: o.responseCode ?? 0,
        shag: o.command ?? '—',
        otvet: o.response ?? o.message ?? String(e),
      });
      // Получателя не принял сам почтовый узел — другой ящик его тоже
      // не примет: адрес с опечаткой не чинится сменой отправителя.
      if (otvergnutAdres(o)) break;
    }
  }

  const { y, o } = poslednyaya as { y: Yashchik; o: Oshibka };
  log.error('письмо не ушло', {
    to: pochtaVZhurnal(p.komu),
    subject: p.tema,
    ot: y.from,
    vhod: vhod(y),
    uzel: uzel(y),
    yashchik: SLOVO[y.imya],
    vid: o.code ?? '—',
    kod: o.responseCode ?? 0,
    shag: o.command ?? '—',
    otvet: o.response ?? o.message ?? '—',
  });
  return otvergnutAdres(o) ? 'adres' : 'net';
}

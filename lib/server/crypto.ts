/**
 * Шифрование доступов и коды.
 *
 * AES-256-GCM: шифр с проверкой целостности. Подменённый в базе
 * шифротекст не расшифруется в мусор — расшифровка честно упадёт,
 * потому что не сойдётся метка подлинности.
 *
 * ⚠️ КЛЮЧ ПРИХОДИТ ИЗ ОКРУЖЕНИЯ СЕРВЕРА И В БАЗЕ НЕ ЛЕЖИТ. В этом
 * весь смысл: файл базы или её резервная копия, унесённые целиком,
 * паролей от аккаунтов Spotify не открывают.
 *
 * Формат хранения — одна строка: «v1.‹вектор›.‹метка›.‹шифротекст›»,
 * каждая часть в base64. Номер версии стоит первым, чтобы через год
 * можно было сменить схему и уметь читать старые записи.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { env } from './env';

const SHIFR = 'aes-256-gcm';
const DLINA_VEKTORA = 12; // рекомендованная для GCM
const VERSIYA = 'v1';

/** Ошибка шифрования. Открытого текста в ней нет и быть не должно. */
export class OshibkaShifra extends Error {}

let kesh: Buffer | null = null;

/** Ключ из окружения. `null` — ключа нет, шифровать нечем. */
export function klyuch(): Buffer | null {
  if (kesh) return kesh;
  const s = env.cryptoKey;
  if (!s) return null;
  let buf: Buffer;
  try {
    buf = Buffer.from(s, 'base64');
  } catch {
    return null;
  }
  if (buf.length !== 32) return null;
  kesh = buf;
  return kesh;
}

/** Есть ли чем шифровать. Без ключа приём чужих паролей запрещён. */
export function shifrGotov(): boolean {
  return klyuch() !== null;
}

export function zashifrovat(otkrytoe: string): string {
  const k = klyuch();
  if (!k) throw new OshibkaShifra('ключа шифрования нет в окружении');
  const vektor = randomBytes(DLINA_VEKTORA);
  const sh = createCipheriv(SHIFR, k, vektor);
  const telo = Buffer.concat([sh.update(otkrytoe, 'utf8'), sh.final()]);
  const metka = sh.getAuthTag();
  return [VERSIYA, vektor.toString('base64'), metka.toString('base64'), telo.toString('base64')].join('.');
}

export function rasshifrovat(hranimoe: string): string {
  const k = klyuch();
  if (!k) throw new OshibkaShifra('ключа шифрования нет в окружении');
  const chasti = hranimoe.split('.');
  if (chasti.length !== 4 || chasti[0] !== VERSIYA) throw new OshibkaShifra('неизвестный формат записи');
  try {
    const vektor = Buffer.from(chasti[1]!, 'base64');
    const metka = Buffer.from(chasti[2]!, 'base64');
    const telo = Buffer.from(chasti[3]!, 'base64');
    const rs = createDecipheriv(SHIFR, k, vektor);
    rs.setAuthTag(metka);
    return Buffer.concat([rs.update(telo), rs.final()]).toString('utf8');
  } catch {
    // Наружу не уходит ни причина, ни кусок данных: расшифровка
    // либо удалась целиком, либо не удалась вовсе.
    throw new OshibkaShifra('расшифровать не удалось');
  }
}

/** Мягкая расшифровка: вернёт null вместо исключения. */
export function poprobovatRasshifrovat(hranimoe: string | null): string | null {
  if (!hranimoe) return null;
  try {
    return rasshifrovat(hranimoe);
  } catch {
    return null;
  }
}

/* ── Хеши для поиска и сравнения ─────────────────────────────── */

/**
 * Отпечаток секрета для ПОИСКА по базе.
 *
 * Токен сессии и код сертификата лежат в базе только отпечатком:
 * унесённая база не даёт войти ни в один кабинет и не открывает
 * ни одного сертификата.
 */
export function otpechatok(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/**
 * Отпечаток ПОЧТЫ для поиска по базе.
 *
 * ⚠️ СОЛИТСЯ КЛЮЧОМ ШИФРОВАНИЯ, И ЭТО НЕ ПРИДИРКА. Простой sha256
 * от адреса подбирается словарём за минуты: адресов мало и они
 * предсказуемы, в отличие от кода сертификата, у которого 59 бит
 * случайности. Соль ключом делает отпечаток бесполезным для того,
 * кто унёс базу, но не ключ (Р-87).
 *
 * Нужен он ровно для одного: понять, не оформлено ли по этой же почте
 * продление, — не расшифровывая при этом ни одной строки. Расшифровка
 * остаётся там, где была, и читателей у неё по-прежнему два (закон 35).
 */
export function otpechatokPochty(pochta: string): string {
  const k = klyuch();
  const chistaya = pochta.trim().toLowerCase();
  return createHash('sha256')
    .update(k ? Buffer.concat([k, Buffer.from(chistaya, 'utf8')]) : Buffer.from(chistaya, 'utf8'))
    .digest('hex');
}

/** Сравнение постоянного времени: по времени секрет не подобрать. */
export function sovpali(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

/* ── Случайные величины ──────────────────────────────────────── */

/** Токен сессии: 32 байта случайности в безопасном для URL виде. */
export function novyToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Шестизначный код входа. Ведущие нули сохраняются. */
export function novyKodVhoda(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Код сертификата: SPOTIK-XXXX-XXXX-XXXX.
 *
 * Алфавит без похожих знаков (0/O, 1/I/L): код диктуют голосом
 * и переписывают с экрана, и «нолик или буква» здесь дороже, чем
 * четыре лишних бита энтропии. 12 знаков из 30 — это около 59 бит,
 * с запасом против перебора при живом ограничении попыток.
 */
const ALFAVIT = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function novyKodSertifikata(): string {
  const gruppy: string[] = [];
  for (let g = 0; g < 3; g++) {
    let s = '';
    for (let i = 0; i < 4; i++) s += ALFAVIT[randomInt(0, ALFAVIT.length)];
    gruppy.push(s);
  }
  return `SPOTIK-${gruppy.join('-')}`;
}

/** Приведение кода к каноническому виду: регистр и дефисы не важны. */
export function kanonKodaSertifikata(vvod: string): string {
  const golyy = vvod.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^SPOTIK/, '');
  if (golyy.length !== 12) return '';
  return `SPOTIK-${golyy.slice(0, 4)}-${golyy.slice(4, 8)}-${golyy.slice(8, 12)}`;
}

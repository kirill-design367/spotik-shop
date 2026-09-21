/**
 * Вход по коду на почту. Паролей на сайте нет вовсе.
 *
 * Правила из постановки, и все пять проверяются здесь:
 *   • код шестизначный;
 *   • живёт десять минут;
 *   • пять попыток на код;
 *   • запрос кода ограничен по частоте;
 *   • сессия — в защищённой куке.
 *
 * ⚠️ КОД ЛЕЖИТ В БАЗЕ ОТПЕЧАТКОМ, А НЕ ОТКРЫТЫМ ТЕКСТОМ. Унесённая
 * база не даёт войти ни в один кабинет, а прочитанный в журнале
 * код живёт десять минут — это разные уровни, и второй сознательный.
 *
 * ⚠️ ДВА ВХОДА, И ОНИ НЕ ПЕРЕСЕКАЮТСЯ. `client` — кабинет покупателя,
 * `staff` — админка, и она открыта только адресам из списка
 * сотрудников. Один и тот же человек может быть и тем, и другим;
 * куки у них разные, и сессия клиента в админку не пускает.
 */

import { cookies } from 'next/headers';
import { zapros, odna, tikho } from './db';
import { novyKodVhoda, novyToken, otpechatok } from './crypto';
import { env } from './env';
import { log, pochtaVZhurnal } from './log';
import { otpravit } from './mail';

export type Oblast = 'client' | 'staff';

export const KUKA: Record<Oblast, string> = { client: 'spotik_s', staff: 'spotik_a' };

const ZHIZN_KODA_MIN = 10;
const POPYTOK = 5;
const ZHIZN_SESSII_DNEY = 30;
/** Не чаще одного кода в минуту и не больше пяти за час на адрес. */
const PAUZA_SEK = 60;
const V_CHAS = 5;

export function normPochta(vvod: string): string {
  return vvod.trim().toLowerCase();
}

export function pochtaPohozha(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[a-zа-я]{2,}$/i.test(email) && email.length <= 200;
}

/* ── Сотрудники ────────────────────────────────────────────────── */

export type Sotrudnik = { id: number; email: string; role: 'admin' | 'operator'; disabled: boolean };

/**
 * Первые администраторы заводятся из окружения.
 *
 * ⚠️ ТОЛЬКО ЗАВОДЯТСЯ, НО НЕ ВОССТАНАВЛИВАЮТСЯ. Снятый в админке
 * администратор не должен возвращаться при перезапуске сервиса,
 * иначе уволить его было бы нечем. Поэтому `on conflict do nothing`.
 */
export async function zavestiPervyhAdminov(): Promise<void> {
  const spisok = env.firstAdmins;
  if (!spisok.length) return;
  for (const email of spisok) {
    await zapros(`insert into staff (email, role) values ($1, 'admin') on conflict (email) do nothing`, [email]);
  }
}

export async function sotrudnikPoPochte(email: string): Promise<Sotrudnik | null> {
  const r = await odna<{ id: string; email: string; role: 'admin' | 'operator'; disabled: boolean }>(
    'select id, email, role, disabled from staff where email = $1',
    [normPochta(email)],
  );
  return r ? { id: Number(r.id), email: r.email, role: r.role, disabled: r.disabled } : null;
}

/* ── Коды ──────────────────────────────────────────────────────── */

export type OtvetNaKod =
  | { ok: true; testovyRezhim: boolean }
  | { ok: false; pochemu: 'chasto' | 'ne_pochta' | 'ne_sotrudnik' | 'net_bazy' };

export async function poprositKod(vvodEmail: string, oblast: Oblast): Promise<OtvetNaKod> {
  const email = normPochta(vvodEmail);
  if (!pochtaPohozha(email)) return { ok: false, pochemu: 'ne_pochta' };

  if (oblast === 'staff') {
    await zavestiPervyhAdminov();
    const s = await sotrudnikPoPochte(email);
    // ⚠️ ОТВЕТ ПРО «НЕ СОТРУДНИКА» ЧЕСТНЫЙ, И ЭТО ВЫБОР. Адрес
    // администратора не секрет, а немой отказ на служебном входе
    // стоил бы часа недоумения у того, кого действительно забыли
    // завести. На КЛИЕНТСКОМ входе такого ответа нет вовсе: там
    // код уходит любому адресу, и по ответу нельзя узнать, кто
    // у нас зарегистрирован.
    if (!s || s.disabled) return { ok: false, pochemu: 'ne_sotrudnik' };
  }

  const svezhie = await odna<{ n: string; last: Date | null }>(
    `select count(*)::text as n, max(created_at) as last
       from login_code
      where email = $1 and scope = $2 and created_at > now() - interval '1 hour'`,
    [email, oblast],
  );
  const n = Number(svezhie?.n ?? 0);
  const last = svezhie?.last ? new Date(svezhie.last).getTime() : 0;
  if (n >= V_CHAS || (last && Date.now() - last < PAUZA_SEK * 1000)) {
    return { ok: false, pochemu: 'chasto' };
  }

  const kod = novyKodVhoda();
  await zapros(
    `insert into login_code (email, scope, code_hash, expires_at)
     values ($1, $2, $3, now() + ($4 || ' minutes')::interval)`,
    [email, oblast, otpechatok(kod), String(ZHIZN_KODA_MIN)],
  );

  await otpravit({
    komu: email,
    tema: oblast === 'staff' ? 'Spotik Shop — код входа в админку' : 'Spotik Shop — код входа',
    telo:
      `Код входа: ${kod}\n\n` +
      `Он действует ${ZHIZN_KODA_MIN} минут и годится для одного входа.\n` +
      `Если вход запрашивали не вы — просто не вводите код, ничего не произойдёт.\n`,
  });
  log.info('код входа выдан', { to: pochtaVZhurnal(email), scope: oblast });
  return { ok: true, testovyRezhim: !env.smtpHost };
}

export type OtvetNaProverku =
  | { ok: true; userId: number | null; staffId: number | null }
  | { ok: false; pochemu: 'net_koda' | 'ne_sovpal' | 'popytki' | 'istyok' };

export async function proveritKod(vvodEmail: string, kod: string, oblast: Oblast): Promise<OtvetNaProverku> {
  const email = normPochta(vvodEmail);
  const chistyy = kod.replace(/\D/g, '');
  const zapis = await odna<{ id: string; code_hash: string; attempts: number; expires_at: Date; used_at: Date | null }>(
    `select id, code_hash, attempts, expires_at, used_at
       from login_code
      where email = $1 and scope = $2
      order by created_at desc
      limit 1`,
    [email, oblast],
  );
  if (!zapis || zapis.used_at) return { ok: false, pochemu: 'net_koda' };
  if (new Date(zapis.expires_at).getTime() < Date.now()) return { ok: false, pochemu: 'istyok' };
  if (zapis.attempts >= POPYTOK) return { ok: false, pochemu: 'popytki' };

  if (otpechatok(chistyy) !== zapis.code_hash) {
    await zapros('update login_code set attempts = attempts + 1 where id = $1', [zapis.id]);
    const ostalos = POPYTOK - zapis.attempts - 1;
    return { ok: false, pochemu: ostalos <= 0 ? 'popytki' : 'ne_sovpal' };
  }
  await zapros('update login_code set used_at = now() where id = $1', [zapis.id]);

  if (oblast === 'staff') {
    const s = await sotrudnikPoPochte(email);
    if (!s || s.disabled) return { ok: false, pochemu: 'net_koda' };
    return { ok: true, userId: null, staffId: s.id };
  }
  const u = await odna<{ id: string }>(
    `insert into app_user (email) values ($1)
     on conflict (email) do update set email = excluded.email
     returning id`,
    [email],
  );
  return { ok: true, userId: Number(u!.id), staffId: null };
}

/* ── Сессии ────────────────────────────────────────────────────── */

export async function zavestiSessiyu(oblast: Oblast, userId: number | null, staffId: number | null): Promise<void> {
  const token = novyToken();
  await zapros(
    `insert into session (token_hash, scope, user_id, staff_id, expires_at)
     values ($1, $2, $3, $4, now() + ($5 || ' days')::interval)`,
    [otpechatok(token), oblast, userId, staffId, String(ZHIZN_SESSII_DNEY)],
  );
  const jar = await cookies();
  jar.set(KUKA[oblast], token, {
    httpOnly: true,
    sameSite: 'lax',
    // ⚠️ `secure` НЕ ЗАВИСИТ ОТ NODE_ENV: сайт живёт только по https,
    // а в разработке кука без него и так ставится на localhost.
    secure: env.siteUrl.startsWith('https://'),
    path: '/',
    maxAge: ZHIZN_SESSII_DNEY * 24 * 3600,
  });
}

export async function vyyti(oblast: Oblast): Promise<void> {
  const jar = await cookies();
  const t = jar.get(KUKA[oblast])?.value;
  if (t) await tikho(() => zapros('delete from session where token_hash = $1', [otpechatok(t)]), []);
  jar.delete(KUKA[oblast]);
}

export type Klient = { userId: number; email: string };

export async function ktoKlient(): Promise<Klient | null> {
  const jar = await cookies();
  const t = jar.get(KUKA.client)?.value;
  if (!t) return null;
  const r = await tikho(
    () =>
      odna<{ user_id: string; email: string }>(
        `select s.user_id, u.email
           from session s join app_user u on u.id = s.user_id
          where s.token_hash = $1 and s.scope = 'client' and s.expires_at > now()`,
        [otpechatok(t)],
      ),
    null,
  );
  return r ? { userId: Number(r.user_id), email: r.email } : null;
}

export async function ktoSotrudnik(): Promise<Sotrudnik | null> {
  const jar = await cookies();
  const t = jar.get(KUKA.staff)?.value;
  if (!t) return null;
  const r = await tikho(
    () =>
      odna<{ id: string; email: string; role: 'admin' | 'operator'; disabled: boolean }>(
        `select f.id, f.email, f.role, f.disabled
           from session s join staff f on f.id = s.staff_id
          where s.token_hash = $1 and s.scope = 'staff' and s.expires_at > now()`,
        [otpechatok(t)],
      ),
    null,
  );
  if (!r || r.disabled) return null;
  return { id: Number(r.id), email: r.email, role: r.role, disabled: r.disabled };
}

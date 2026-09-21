'use server';

/**
 * Действия админки. Интерфейс там английский — постановка; тексты
 * ошибок, которые видит СОТРУДНИК, тоже английские.
 *
 * ⚠️ КАЖДОЕ ДЕЙСТВИЕ САМО ПРОВЕРЯЕТ, КТО ЕГО ЗОВЁТ. Проверки
 * «на странице» недостаточно: серверное действие — это обычная
 * точка входа, и попасть в неё можно мимо страницы.
 */

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { ktoSotrudnik, normPochta, poprositKod, proveritKod, vyyti, zavestiSessiyu } from './auth';
import { bazaEst, zapros } from './db';
import {
  otmenitZakaz,
  otmetitSlotGotovym,
  vernutVOchered,
  vzyatZakaz,
  zapisatVydachu,
  zavershitZakaz,
} from './orders';
import { soobshchitKomande } from './notify';
import { pismoParolNePodoshyol } from './letters';
import { odna } from './db';
import { zadatNastroyku, SROK_SERTIFIKATA } from './settings';
import { shifrGotov } from './crypto';

export type OtvetA = { error?: string; ok?: string; step?: string; email?: string };

const NO_DB = 'Service is unavailable: no database.';

/* ── Вход ──────────────────────────────────────────────────────── */

export async function adminAskCode(_p: OtvetA, fd: FormData): Promise<OtvetA> {
  if (!bazaEst()) return { error: NO_DB };
  const email = normPochta(String(fd.get('email') ?? ''));
  const r = await poprositKod(email, 'staff');
  if (!r.ok) {
    const words: Record<string, string> = {
      ne_pochta: 'Check the email address.',
      ne_sotrudnik: 'This address is not on the staff list.',
      chasto: 'A code was just sent. Try again in a minute.',
      net_bazy: NO_DB,
    };
    return { error: words[r.pochemu] ?? 'Could not send the code.', email };
  }
  return { step: 'code', email, ok: r.testovyRezhim ? 'test' : '' };
}

export async function adminLogin(_p: OtvetA, fd: FormData): Promise<OtvetA> {
  if (!bazaEst()) return { error: NO_DB };
  const email = normPochta(String(fd.get('email') ?? ''));
  const r = await proveritKod(email, String(fd.get('code') ?? ''), 'staff');
  if (!r.ok) {
    const words: Record<string, string> = {
      net_koda: 'No code for this address. Request a new one.',
      ne_sovpal: 'Wrong code.',
      popytki: 'Too many attempts. Request a new code.',
      istyok: 'The code has expired. Request a new one.',
    };
    return { error: words[r.pochemu] ?? 'Wrong code.', step: 'code', email };
  }
  await zavestiSessiyu('staff', null, r.staffId);
  redirect('/admin/');
}

export async function adminLogout(): Promise<void> {
  await vyyti('staff');
  redirect('/admin/login/');
}

/* ── Очередь и заказ ───────────────────────────────────────────── */

async function tolkoSvoy(zakaz: number, staffId: number): Promise<boolean> {
  const r = await odna<{ id: string }>('select id from shop_order where id = $1 and operator_id = $2', [zakaz, staffId]);
  return Boolean(r);
}

export async function adminTake(fd: FormData): Promise<void> {
  const s = await ktoSotrudnik();
  if (!s) redirect('/admin/login/');
  const id = Number(fd.get('order') ?? 0);
  const vzyal = await vzyatZakaz(id, s.id);
  if (vzyal) await soobshchitKomande({ vid: 'zakaz_vzyat', zakaz: id, kto: s.email });
  revalidatePath('/admin');
  redirect(`/admin/orders/${id}/`);
}

export async function adminRelease(fd: FormData): Promise<void> {
  const s = await ktoSotrudnik();
  if (!s) redirect('/admin/login/');
  const id = Number(fd.get('order') ?? 0);
  await vernutVOchered(id, s.id);
  revalidatePath('/admin');
  redirect('/admin/');
}

export async function adminIssue(_p: OtvetA, fd: FormData): Promise<OtvetA> {
  const s = await ktoSotrudnik();
  if (!s) return { error: 'Session expired. Log in again.' };
  if (!shifrGotov()) return { error: 'SPOTIK_CRYPTO_KEY is missing on the server — credentials cannot be stored.' };
  const zakaz = Number(fd.get('order') ?? 0);
  const slot = Number(fd.get('slot') ?? 0);
  if (!(await tolkoSvoy(zakaz, s.id))) return { error: 'This order is not taken by you.' };

  const login = String(fd.get('login') ?? '').trim();
  const mailPass = String(fd.get('mailPass') ?? '');
  const spotifyPass = String(fd.get('spotifyPass') ?? '');
  if (!login || !mailPass || !spotifyPass) return { error: 'Fill in all three fields.' };

  const ok = await zapisatVydachu({ slotId: slot, zakaz, staffId: s.id, login, mailPass, spotifyPass });
  if (!ok) return { error: 'Could not save the credentials.' };
  revalidatePath(`/admin/orders/${zakaz}`);
  return { ok: 'Saved. The client sees these credentials in their cabinet.' };
}

export async function adminRenewDone(_p: OtvetA, fd: FormData): Promise<OtvetA> {
  const s = await ktoSotrudnik();
  if (!s) return { error: 'Session expired. Log in again.' };
  const zakaz = Number(fd.get('order') ?? 0);
  const slot = Number(fd.get('slot') ?? 0);
  if (!(await tolkoSvoy(zakaz, s.id))) return { error: 'This order is not taken by you.' };
  const ok = await otmetitSlotGotovym(slot, zakaz);
  if (!ok) return { error: 'Could not mark this participant as done.' };
  revalidatePath(`/admin/orders/${zakaz}`);
  return { ok: 'Marked as done.' };
}

export async function adminFinish(_p: OtvetA, fd: FormData): Promise<OtvetA> {
  const s = await ktoSotrudnik();
  if (!s) return { error: 'Session expired. Log in again.' };
  const zakaz = Number(fd.get('order') ?? 0);
  const r = await zavershitZakaz(zakaz, s.id);
  if (!r.ok) return { error: r.pochemu === 'Не все участники заполнены.' ? 'Not every participant is done yet.' : 'This order is not taken by you.' };
  revalidatePath('/admin');
  return { ok: 'Order closed. The client has been emailed.' };
}

/**
 * Неверный пароль у существующего аккаунта.
 *
 * ⚠️ ПОРЯДОК ЖЁСТКИЙ (постановка): сначала письмо с инструкцией,
 * и только потом отмена. Кнопка отмены до письма не работает,
 * и это проверяется здесь, а не только в разметке.
 */
export async function adminSendRecovery(_p: OtvetA, fd: FormData): Promise<OtvetA> {
  const s = await ktoSotrudnik();
  if (!s) return { error: 'Session expired. Log in again.' };
  const zakaz = Number(fd.get('order') ?? 0);
  const slot = Number(fd.get('slot') ?? 0);
  if (!(await tolkoSvoy(zakaz, s.id))) return { error: 'This order is not taken by you.' };
  const u = await odna<{ email: string }>(
    'select u.email from shop_order o join app_user u on u.id = o.user_id where o.id = $1',
    [zakaz],
  );
  if (!u) return { error: 'Order not found.' };
  await pismoParolNePodoshyol(u.email, zakaz);
  await zapros('update order_slot set recovery_sent_at = now() where id = $1 and order_id = $2', [slot, zakaz]);
  revalidatePath(`/admin/orders/${zakaz}`);
  return { ok: 'Recovery instructions sent. You can cancel the order now.' };
}

export async function adminCancel(_p: OtvetA, fd: FormData): Promise<OtvetA> {
  const s = await ktoSotrudnik();
  if (!s) return { error: 'Session expired. Log in again.' };
  const zakaz = Number(fd.get('order') ?? 0);
  if (!(await tolkoSvoy(zakaz, s.id))) return { error: 'This order is not taken by you.' };

  const prichina = String(fd.get('reason') ?? '').trim();
  const parolNePodoshyol = fd.get('badPassword') === 'on';
  if (parolNePodoshyol) {
    const nepislan = await odna<{ id: string }>(
      `select id from order_slot where order_id = $1 and mode = 'renew' and recovery_sent_at is null limit 1`,
      [zakaz],
    );
    if (nepislan) {
      return { error: 'Send the password-recovery email first — cancelling is blocked until then.' };
    }
  }
  const r = await otmenitZakaz(zakaz, prichina || 'Отменён оператором', s.id);
  if (!r.ok) return { error: r.pochemuNet ?? 'Could not cancel.' };
  revalidatePath('/admin');
  return { ok: 'Order cancelled, the money is back on the client balance.' };
}

/* ── Настройки (только администратор) ──────────────────────────── */

export async function adminSetPrice(_p: OtvetA, fd: FormData): Promise<OtvetA> {
  const s = await ktoSotrudnik();
  if (!s || s.role !== 'admin') return { error: 'Administrators only.' };
  const plan = String(fd.get('plan') ?? '');
  const period = Number(fd.get('period') ?? 0);
  const rub = String(fd.get('price') ?? '').replace(',', '.').trim();
  if (!plan || !period) return { error: 'Pick a plan and a term.' };
  if (rub === '') {
    await zapros('delete from plan_price where plan_id = $1 and period = $2', [plan, period]);
    revalidatePath('/');
    return { ok: 'Price removed: this term is no longer sold.' };
  }
  const n = Number(rub);
  if (!Number.isFinite(n) || n < 0) return { error: 'Price must be a non-negative number.' };
  await zapros(
    `insert into plan_price (plan_id, period, price_kop) values ($1, $2, $3)
     on conflict (plan_id, period) do update set price_kop = excluded.price_kop`,
    [plan, period, Math.round(n * 100)],
  );
  // Лендинг статический и обновляется по `revalidate`; после правки
  // цены он пересобирается сразу, а не через пять минут.
  revalidatePath('/');
  revalidatePath('/checkout');
  return { ok: 'Price saved.' };
}

export async function adminSetCertDays(_p: OtvetA, fd: FormData): Promise<OtvetA> {
  const s = await ktoSotrudnik();
  if (!s || s.role !== 'admin') return { error: 'Administrators only.' };
  const n = Number(String(fd.get('days') ?? ''));
  if (!Number.isFinite(n) || n < 1) return { error: 'Validity must be a positive number of days.' };
  await zadatNastroyku(SROK_SERTIFIKATA, String(Math.round(n)));
  return { ok: 'Certificate validity saved.' };
}

export async function adminAddStaff(_p: OtvetA, fd: FormData): Promise<OtvetA> {
  const s = await ktoSotrudnik();
  if (!s || s.role !== 'admin') return { error: 'Administrators only.' };
  const email = normPochta(String(fd.get('email') ?? ''));
  const role = String(fd.get('role') ?? 'operator') === 'admin' ? 'admin' : 'operator';
  if (!email.includes('@')) return { error: 'Check the email address.' };
  await zapros(
    `insert into staff (email, role) values ($1, $2)
     on conflict (email) do update set role = excluded.role, disabled = false`,
    [email, role],
  );
  revalidatePath('/admin/staff');
  return { ok: `${email} is now ${role}.` };
}

export async function adminDisableStaff(fd: FormData): Promise<void> {
  const s = await ktoSotrudnik();
  if (!s || s.role !== 'admin') redirect('/admin/');
  const id = Number(fd.get('id') ?? 0);
  // ⚠️ СЕБЯ ОТКЛЮЧИТЬ НЕЛЬЗЯ: иначе последний администратор
  // запирает админку одним нажатием.
  if (id !== s.id) {
    await zapros('update staff set disabled = true where id = $1', [id]);
    await zapros('delete from session where staff_id = $1', [id]);
  }
  revalidatePath('/admin/staff');
  redirect('/admin/staff/');
}

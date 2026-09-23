'use server';

/**
 * Действия админки.
 *
 * ⚠️ ДЕЙСТВИЕ ОТДАЁТ КЛЮЧ, А НЕ ГОТОВУЮ СТРОКУ. Интерфейс админки
 * двуязычный, и текст отказа — такая же надпись, как заголовок
 * кнопки: живёт он в одном месте (`lib/admin/slova.ts`), а страница
 * переводит его на язык сотрудника. Верни мы отсюда готовую фразу —
 * половина админки была бы переведена, а половина нет, и заметили бы
 * это не мы.
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
import { zapomnitYazyk } from './yazyk';
import { ponyatYazyk, type Klyuch, type Podstanovki } from '@/lib/admin/slova';

export type OtvetA = {
  error?: Klyuch;
  ok?: Klyuch;
  /** Подстановки в надпись: только данные, не текст. */
  polya?: Podstanovki;
  step?: string;
  email?: string;
};

/* ── Язык интерфейса ───────────────────────────────────────────── */

export async function adminSetLang(fd: FormData): Promise<void> {
  await zapomnitYazyk(ponyatYazyk(String(fd.get('lang') ?? '')));
  // Раздел целиком: язык меняет каждую надпись, а не одну страницу.
  revalidatePath('/admin', 'layout');
}

/* ── Вход ──────────────────────────────────────────────────────── */

export async function adminAskCode(_p: OtvetA, fd: FormData): Promise<OtvetA> {
  if (!bazaEst()) return { error: 'o.no_db' };
  const email = normPochta(String(fd.get('email') ?? ''));
  const r = await poprositKod(email, 'staff');
  if (!r.ok) {
    const slova: Record<string, Klyuch> = {
      ne_pochta: 'e.check_email',
      ne_sotrudnik: 'e.not_staff',
      chasto: 'e.often',
      net_bazy: 'o.no_db',
    };
    return { error: slova[r.pochemu] ?? 'e.send_fail', email };
  }
  return { step: 'code', email };
}

export async function adminLogin(_p: OtvetA, fd: FormData): Promise<OtvetA> {
  if (!bazaEst()) return { error: 'o.no_db' };
  const email = normPochta(String(fd.get('email') ?? ''));
  const r = await proveritKod(email, String(fd.get('code') ?? ''), 'staff');
  if (!r.ok) {
    const slova: Record<string, Klyuch> = {
      net_koda: 'e.no_code',
      ne_sovpal: 'e.wrong_code',
      popytki: 'e.attempts',
      istyok: 'e.expired',
    };
    return { error: slova[r.pochemu] ?? 'e.wrong_code', step: 'code', email };
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
  if (!s) return { error: 'e.session' };
  if (!shifrGotov()) return { error: 'e.no_key' };
  const zakaz = Number(fd.get('order') ?? 0);
  const slot = Number(fd.get('slot') ?? 0);
  if (!(await tolkoSvoy(zakaz, s.id))) return { error: 'e.not_yours' };

  const login = String(fd.get('login') ?? '').trim();
  const mailPass = String(fd.get('mailPass') ?? '');
  const spotifyPass = String(fd.get('spotifyPass') ?? '');
  if (!login || !mailPass || !spotifyPass) return { error: 'e.fill_three' };

  const ok = await zapisatVydachu({ slotId: slot, zakaz, staffId: s.id, login, mailPass, spotifyPass });
  if (!ok) return { error: 'e.save_creds' };
  revalidatePath(`/admin/orders/${zakaz}`);
  return { ok: 'k.creds_saved' };
}

export async function adminRenewDone(_p: OtvetA, fd: FormData): Promise<OtvetA> {
  const s = await ktoSotrudnik();
  if (!s) return { error: 'e.session' };
  const zakaz = Number(fd.get('order') ?? 0);
  const slot = Number(fd.get('slot') ?? 0);
  if (!(await tolkoSvoy(zakaz, s.id))) return { error: 'e.not_yours' };
  const ok = await otmetitSlotGotovym(slot, zakaz);
  if (!ok) return { error: 'e.mark_done' };
  revalidatePath(`/admin/orders/${zakaz}`);
  return { ok: 'k.marked' };
}

export async function adminFinish(_p: OtvetA, fd: FormData): Promise<OtvetA> {
  const s = await ktoSotrudnik();
  if (!s) return { error: 'e.session' };
  const zakaz = Number(fd.get('order') ?? 0);
  const r = await zavershitZakaz(zakaz, s.id);
  if (!r.ok) return { error: r.pochemu === 'Не все участники заполнены.' ? 'e.not_all_done' : 'e.not_yours' };
  revalidatePath('/admin');
  return { ok: 'k.order_closed' };
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
  if (!s) return { error: 'e.session' };
  const zakaz = Number(fd.get('order') ?? 0);
  const slot = Number(fd.get('slot') ?? 0);
  if (!(await tolkoSvoy(zakaz, s.id))) return { error: 'e.not_yours' };
  const u = await odna<{ email: string }>(
    'select u.email from shop_order o join app_user u on u.id = o.user_id where o.id = $1',
    [zakaz],
  );
  if (!u) return { error: 'o.no_order' };
  await pismoParolNePodoshyol(u.email, zakaz);
  await zapros('update order_slot set recovery_sent_at = now() where id = $1 and order_id = $2', [slot, zakaz]);
  revalidatePath(`/admin/orders/${zakaz}`);
  return { ok: 'k.recovery_sent' };
}

export async function adminCancel(_p: OtvetA, fd: FormData): Promise<OtvetA> {
  const s = await ktoSotrudnik();
  if (!s) return { error: 'e.session' };
  const zakaz = Number(fd.get('order') ?? 0);
  if (!(await tolkoSvoy(zakaz, s.id))) return { error: 'e.not_yours' };

  const prichina = String(fd.get('reason') ?? '').trim();
  const parolNePodoshyol = fd.get('badPassword') === 'on';
  if (parolNePodoshyol) {
    const nepislan = await odna<{ id: string }>(
      `select id from order_slot where order_id = $1 and mode = 'renew' and recovery_sent_at is null limit 1`,
      [zakaz],
    );
    if (nepislan) return { error: 'e.recovery_first' };
  }
  // ⚠️ ПРИЧИНА ОТМЕНЫ — ДАННЫЕ, А НЕ НАДПИСЬ: её видит КЛИЕНТ
  // в своём кабинете и в письме, и язык там русский всегда.
  const r = await otmenitZakaz(zakaz, prichina || 'Отменён оператором', s.id);
  if (!r.ok) return { error: 'e.cancel_fail' };
  revalidatePath('/admin');
  return { ok: 'k.order_cancelled' };
}

/* ── Настройки (только администратор) ──────────────────────────── */

export async function adminSetPrice(_p: OtvetA, fd: FormData): Promise<OtvetA> {
  const s = await ktoSotrudnik();
  if (!s || s.role !== 'admin') return { error: 'o.only_admin' };
  const plan = String(fd.get('plan') ?? '');
  const period = Number(fd.get('period') ?? 0);
  const rub = String(fd.get('price') ?? '').replace(',', '.').trim();
  if (!plan || !period) return { error: 'e.pick_plan' };
  if (rub === '') {
    await zapros('delete from plan_price where plan_id = $1 and period = $2', [plan, period]);
    revalidatePath('/');
    return { ok: 'k.price_removed' };
  }
  const n = Number(rub);
  if (!Number.isFinite(n) || n < 0) return { error: 'e.price_number' };
  await zapros(
    `insert into plan_price (plan_id, period, price_kop) values ($1, $2, $3)
     on conflict (plan_id, period) do update set price_kop = excluded.price_kop`,
    [plan, period, Math.round(n * 100)],
  );
  // Лендинг статический и обновляется по `revalidate`; после правки
  // цены он пересобирается сразу, а не через пять минут.
  revalidatePath('/');
  revalidatePath('/checkout');
  return { ok: 'k.price_saved' };
}

export async function adminSetCertDays(_p: OtvetA, fd: FormData): Promise<OtvetA> {
  const s = await ktoSotrudnik();
  if (!s || s.role !== 'admin') return { error: 'o.only_admin' };
  const n = Number(String(fd.get('days') ?? ''));
  if (!Number.isFinite(n) || n < 1) return { error: 'e.days_number' };
  await zadatNastroyku(SROK_SERTIFIKATA, String(Math.round(n)));
  return { ok: 'k.cert_days_saved' };
}

export async function adminAddStaff(_p: OtvetA, fd: FormData): Promise<OtvetA> {
  const s = await ktoSotrudnik();
  if (!s || s.role !== 'admin') return { error: 'o.only_admin' };
  const email = normPochta(String(fd.get('email') ?? ''));
  const role = String(fd.get('role') ?? 'operator') === 'admin' ? 'admin' : 'operator';
  if (!email.includes('@')) return { error: 'e.check_email' };
  await zapros(
    `insert into staff (email, role) values ($1, $2)
     on conflict (email) do update set role = excluded.role, disabled = false`,
    [email, role],
  );
  revalidatePath('/admin/staff');
  return { ok: 'k.staff_saved', polya: { email, role } };
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

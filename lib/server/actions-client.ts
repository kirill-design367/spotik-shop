'use server';

/**
 * Действия покупателя.
 *
 * Серверные действия, а не маршруты `/api/…`: у них по построению
 * есть защита от подделки запроса с чужого сайта, и лишнего JSON
 * туда-сюда возить не надо.
 */

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  ktoKlient,
  poprositKod,
  proveritKod,
  zavestiSessiyu,
  vyyti,
  normPochta,
} from './auth';
import { bazaEst } from './db';
import { sozdatZakaz, zakazPoSertifikatu, otmenitZakaz, type VvodUchastnika } from './orders';
import { vystavitSchet } from './payments';
import { nayti, POCHEMU_KOD } from './certificates';
import { katalog, naytiTarif } from './catalog';

export type Otvet = { oshibka?: string; ladno?: string; shag?: string; email?: string };

const NET_BAZY = 'Сервис временно недоступен. Попробуйте чуть позже.';

export async function deystviePrositKod(_prosh: Otvet, fd: FormData): Promise<Otvet> {
  if (!bazaEst()) return { oshibka: NET_BAZY };
  const email = normPochta(String(fd.get('email') ?? ''));
  const r = await poprositKod(email, 'client');
  if (!r.ok) {
    return {
      oshibka:
        r.pochemu === 'ne_pochta'
          ? 'Проверьте адрес почты.'
          : 'Код уже отправлен. Следующий можно запросить через минуту.',
      email,
    };
  }
  return { shag: 'kod', email, ladno: r.testovyRezhim ? 'test' : '' };
}

export async function deystvieVoyti(_prosh: Otvet, fd: FormData): Promise<Otvet> {
  if (!bazaEst()) return { oshibka: NET_BAZY };
  const email = normPochta(String(fd.get('email') ?? ''));
  const kod = String(fd.get('code') ?? '');
  const r = await proveritKod(email, kod, 'client');
  if (!r.ok) {
    const slova: Record<string, string> = {
      net_koda: 'Код не найден. Запросите новый.',
      ne_sovpal: 'Код не подошёл.',
      popytki: 'Попытки кончились. Запросите новый код.',
      istyok: 'Срок кода истёк. Запросите новый.',
    };
    return { oshibka: slova[r.pochemu] ?? 'Код не подошёл.', shag: 'kod', email };
  }
  await zavestiSessiyu('client', r.userId, null);
  const kuda = String(fd.get('next') ?? '/cabinet/');
  redirect(kuda.startsWith('/') ? kuda : '/cabinet/');
}

export async function deystvieVyyti(): Promise<void> {
  await vyyti('client');
  redirect('/');
}

/**
 * Оформление заказа.
 *
 * ⚠️ СОСТАВ УЧАСТНИКОВ ЧИТАЕТСЯ ИЗ ФОРМЫ, А ЧИСЛО МЕСТ — ИЗ ТАРИФА.
 * Доверять числу из формы нельзя: тогда «на одного» за 299 рублей
 * оформлялось бы на трёх.
 */
export async function deystvieOformit(_prosh: Otvet, fd: FormData): Promise<Otvet> {
  if (!bazaEst()) return { oshibka: NET_BAZY };
  const kto = await ktoKlient();
  if (!kto) return { oshibka: 'Сначала войдите по коду из письма.' };

  const planId = String(fd.get('plan') ?? '');
  const period = Number(fd.get('period') ?? 0);
  const spisok = await katalog();
  const tarif = naytiTarif(spisok, planId);
  if (!tarif) return { oshibka: 'Такого тарифа нет.' };

  const kind = tarif.gift ? 'certificate' : 'plan';
  const uchastniki: VvodUchastnika[] = [];
  if (kind === 'plan') {
    for (let i = 0; i < tarif.people; i++) {
      const mode = String(fd.get(`mode${i}`) ?? 'new') === 'renew' ? 'renew' : 'new';
      uchastniki.push({
        mode,
        login: String(fd.get(`login${i}`) ?? ''),
        password: String(fd.get(`password${i}`) ?? ''),
      });
    }
  }

  const itog = await sozdatZakaz({
    userId: kto.userId,
    planId,
    period,
    kind,
    uchastniki,
    soglasie: fd.get('consent') === 'on',
    tratitBalans: fd.get('balance') === 'on',
  });
  if (!itog.ok) return { oshibka: itog.pochemu };

  if (itog.kDoplate === 0) redirect(`/cabinet/?order=${itog.zakaz}`);
  const schet = await vystavitSchet(itog.zakaz, kto.userId);
  if (!schet.ok) return { oshibka: `${schet.pochemu} Заказ № ${itog.zakaz} сохранён и ждёт оплаты в кабинете.` };
  redirect(schet.adres);
}

/** Доплатить по уже созданному заказу — из кабинета. */
export async function deystvieOplatit(fd: FormData): Promise<void> {
  const kto = await ktoKlient();
  if (!kto) redirect('/cabinet/');
  const zakaz = Number(fd.get('order') ?? 0);
  const schet = await vystavitSchet(zakaz, kto.userId);
  if (!schet.ok) redirect('/cabinet/?error=pay');
  redirect(schet.adres);
}

export async function deystvieOtmenitSvoy(fd: FormData): Promise<void> {
  const kto = await ktoKlient();
  if (!kto) redirect('/cabinet/');
  const zakaz = Number(fd.get('order') ?? 0);
  // Отменить можно только СВОЙ и только неоплаченный: оплаченный
  // отменяет оператор, и там другая логика.
  const { odna } = await import('./db');
  const r = await odna<{ id: string }>(`select id from shop_order where id = $1 and user_id = $2 and status = 'new'`, [
    zakaz,
    kto.userId,
  ]);
  if (r) await otmenitZakaz(zakaz, 'Отменён покупателем до оплаты', null);
  revalidatePath('/cabinet');
  redirect('/cabinet/');
}

/* ── Сертификат ────────────────────────────────────────────────── */

export async function deystvieProveritKodSertifikata(_prosh: Otvet, fd: FormData): Promise<Otvet> {
  if (!bazaEst()) return { oshibka: NET_BAZY };
  const r = await nayti(String(fd.get('code') ?? ''));
  if (!r.ok) return { oshibka: POCHEMU_KOD[r.pochemu] };
  return { ladno: String(r.id), shag: 'vybor' };
}

export async function deystvieAktivirovat(_prosh: Otvet, fd: FormData): Promise<Otvet> {
  if (!bazaEst()) return { oshibka: NET_BAZY };
  const kto = await ktoKlient();
  if (!kto) return { oshibka: 'Сначала войдите по коду из письма.' };
  const r = await nayti(String(fd.get('code') ?? ''));
  if (!r.ok) return { oshibka: POCHEMU_KOD[r.pochemu] };

  const mode = String(fd.get('mode0') ?? 'new') === 'renew' ? 'renew' : 'new';
  const login = String(fd.get('login0') ?? '').trim();
  const password = String(fd.get('password0') ?? '');
  if (mode === 'renew' && (!login || !password)) {
    return { oshibka: 'Для продления укажите почту и пароль своего аккаунта Spotify.' };
  }
  if (fd.get('consent') !== 'on') return { oshibka: 'Нужно согласие на обработку персональных данных.' };

  const zakaz = await zakazPoSertifikatu({
    userId: kto.userId,
    planId: 'solo',
    period: r.period,
    certificateId: r.id,
    uchastnik: { mode, login, password },
  });
  redirect(`/cabinet/?order=${zakaz}`);
}

/**
 * Подтверждение тестовой оплаты.
 *
 * ⚠️ РАБОТАЕТ, ТОЛЬКО ПОКА ИМИТАТОР ВКЛЮЧЁН, и только для СВОЕГО
 * платежа. Зовёт ту же дверь, что и настоящее уведомление
 * Робокассы, — иначе проверялась бы не оплата, а кнопка.
 */
export async function deystviePodtverditTest(fd: FormData): Promise<void> {
  const { imitatorVklyuchyon } = await import('./payments');
  if (!imitatorVklyuchyon()) redirect('/cabinet/');
  const kto = await ktoKlient();
  if (!kto) redirect('/cabinet/');
  const platyozh = Number(fd.get('payment') ?? 0);
  const { odna } = await import('./db');
  const p = await odna<{ amount_kop: string }>(
    `select p.amount_kop from payment p join shop_order o on o.id = p.order_id
      where p.id = $1 and o.user_id = $2 and p.status = 'new'`,
    [platyozh, kto.userId],
  );
  if (p) {
    const { otmetitOplachennym } = await import('./orders');
    await otmetitOplachennym(platyozh, Number(p.amount_kop));
  }
  revalidatePath('/cabinet');
  redirect('/cabinet/');
}

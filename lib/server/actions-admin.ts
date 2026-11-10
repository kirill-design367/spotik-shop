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
  otmenaNazad,
  otmenitZakaz,
  otmetitPodpiskuOtmenyonnoy,
  proytiShag,
  shagNazad,
  vernutOtmenu,
  vernutVOchered,
  vzyatOtmenu,
  vzyatZakaz,
  zaprositOtmenuPodpiski,
} from './orders';
import { soobshchitKomande } from './notify';
import { pismoParolNePodoshyol } from './letters';
import { zavestiSsylku } from './vosstanovlenie';
import {
  ponyatPrichinu,
  prichinaKlientu,
  prichinaSPochtoy,
  slotAkkaunta,
  vidPismaOtmeny,
} from '@/lib/admin/prichiny';
import { zadatImyaTarifa } from './imena';
import { odna } from './db';
import { nastroyka, zadatNastroyku, RAZDACHA_MINUT, SROK_SERTIFIKATA, TG_BOT } from './settings';
import { RAZDACHA_MINUT_DO, RAZDACHA_MINUT_OT } from '@/lib/admin/razdacha';
import { novyToken, otpechatok, shifrGotov } from './crypto';
import { env } from './env';
import { log, pochtaVZhurnal } from './log';
import { katalogPolny } from './catalog';
import { akkauntyDlyaOtmeny, zakazDlyaAdminki } from './views';
import { imenaTarifov } from './imena';
import { dostupSotrudnika, vsePary, zapretyPar } from './dostup';
import { imyaTarifaIz, klyuchPary, srokDlyaSotrudnika } from '@/lib/plans';
import { CHASTOTY_OCHEREDI } from '@/lib/admin/chastoty';
import { zapomnitYazyk } from './yazyk';
import { ponyatYazyk, type Klyuch, type Podstanovki } from '@/lib/admin/slova';
import {
  izmenit as izmenitPromo,
  otklyuchit as otklyuchitPromo,
  zavesti as zavestiPromo,
  type OshibkaKoda,
} from './promokody';
import { kodPromo } from '@/lib/promokod';
import { nastoyashchayaData } from '../data';
import { dobavitOtzyv, sdvinut, smenitStatus, udalitOtzyv, type OshibkaOtzyva } from './otzyvy';

export type OtvetA = {
  error?: Klyuch;
  ok?: Klyuch;
  /** Подстановки в надпись: только данные, не текст. */
  polya?: Podstanovki;
  step?: string;
  email?: string;
  /** Ссылка привязки Telegram: показывается один раз, в ответе действия. */
  ssylka?: string;
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
      pochta: 'e.mail_down',
      adres: 'e.mail_addr',
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

/**
 * Взять заказ в работу.
 *
 * ⚠️ РАЗРЕШЁННЫЕ ТАРИФЫ ПРОВЕРЯЕТ НЕ ЭТО ДЕЙСТВИЕ, А САМО ВЗЯТИЕ
 * (`vzyatZakaz`), И ЭТО НЕ ПРИДИРКА. Проверка там стоит внутри
 * транзакции и под тем же `for update`, что и «свободен ли заказ»:
 * мимо неё пройти нечем. Здесь мы только приносим список запретов;
 * у администратора его нет вовсе — «Сам администратор может взять
 * любой заказ всегда».
 *
 * ⚠️ НЕ ВЗЯЛ — ВЕДЁМ ТУДА ЖЕ, И СТРАНИЦА САМА СКАЖЕТ ПОЧЕМУ.
 * Заказ чужого тарифа оператору не виден (`zakazDlyaAdminki`),
 * то есть он увидит «Заказ недоступен» — ровно то, что требует
 * постановка; отдельной ветки с отказом для этого не надо.
 */
export async function adminTake(fd: FormData): Promise<void> {
  const s = await ktoSotrudnik();
  if (!s) redirect('/admin/login/');
  const id = Number(fd.get('order') ?? 0);
  const zapreshcheno = s.role === 'admin' ? null : await zapretyPar(s.id);
  const vzyal = await vzyatZakaz(id, s.id, zapreshcheno);
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

/**
 * ОДНО ДЕЙСТВИЕ НА ВСЕ ШАГИ ЗАКАЗА.
 *
 * Постановка сорок второй итерации: «На экране нет двух сообщений
 * о состоянии одновременно». Прежде у экрана было ШЕСТЬ независимых
 * `useActionState`, и ответ каждого жил до следующей отправки своей
 * формы: «Отмечено выполненным» от первого аккаунта спокойно висело
 * рядом с отказом отмены. Свести их в одно сообщение подбором нельзя —
 * состояний шесть, и любое из них может быть непустым.
 *
 * ⚠️ ПОЭТОМУ ДЕЙСТВИЕ ОДНО, А ШАГ ПРИХОДИТ ПОЛЕМ `op`. Тогда
 * состояние у экрана тоже одно, и двух сообщений не бывает
 * ПО ПОСТРОЕНИЮ, а не потому, что мы аккуратно их гасим.
 *
 * ⚠️ ПРОВЕРКА «ЭТО ВАШ ЗАКАЗ» СТОИТ ОДИН РАЗ, ЗДЕСЬ, и её больше
 * негде забыть: мимо этой функции ни один шаг не проходит.
 */
export async function adminShag(_p: OtvetA, fd: FormData): Promise<OtvetA> {
  const s = await ktoSotrudnik();
  if (!s) return { error: 'e.session' };
  const zakaz = Number(fd.get('order') ?? 0);
  if (!(await tolkoSvoy(zakaz, s.id))) return { error: 'e.not_yours' };
  const op = String(fd.get('op') ?? '');

  /* ── Аккаунт пройден ───────────────────────────────────────────
     ⚠️ ПОСЛЕДНИЙ ШАГ ВЫПОЛНЯЕТ ЗАКАЗ — шага «Завершение» нет с пятьдесят
     третьей итерации (Р-169). Дата окончания у продления приходит
     с шагом своего аккаунта, обязательна и проверяется на сервере. */
  if (op === 'gotov' || op === 'vydacha') {
    let vydacha: { login: string; mailPass: string; spotifyPass: string } | undefined;
    if (op === 'vydacha') {
      if (!shifrGotov()) return { error: 'e.no_key' };
      const login = String(fd.get('login') ?? '').trim();
      const mailPass = String(fd.get('mailPass') ?? '');
      const spotifyPass = String(fd.get('spotifyPass') ?? '');
      if (!login || !mailPass || !spotifyPass) return { error: 'e.fill_three' };
      vydacha = { login, mailPass, spotifyPass };
    }
    const ends = String(fd.get('ends') ?? '').trim();
    const r = await proytiShag({
      zakaz,
      staffId: s.id,
      slotId: Number(fd.get('slot') ?? 0),
      ends: ends || null,
      vydacha,
    });
    if (!r.ok) {
      if (r.pochemu === 'nuzhna_data') return { error: 'e.need_date', polya: { n: r.n ?? 1 } };
      if (r.pochemu === 'net_klyucha') return { error: 'e.no_key' };
      if (r.pochemu === 'ne_tot_shag') return { error: op === 'vydacha' ? 'e.save_creds' : 'e.mark_done' };
      return { error: 'e.not_yours' };
    }
    revalidatePath(`/admin/orders/${zakaz}`);
    if (r.zakryt) {
      revalidatePath('/admin');
      return { ok: 'k.order_closed' };
    }
    return { ok: op === 'vydacha' ? 'k.creds_saved' : 'k.marked' };
  }

  /* ── Шаг назад ───────────────────────────────────────────────── */
  if (op === 'nazad') {
    const ok = await shagNazad(zakaz, s.id);
    if (!ok) return { error: 'e.no_back' };
    revalidatePath(`/admin/orders/${zakaz}`);
    return { ok: 'k.back' };
  }

  /* ── Отмена ──────────────────────────────────────────────────── */
  if (op === 'otmena') {
    /* ⚠️ ПРИЧИНА ОБЯЗАТЕЛЬНА И БЕРЁТСЯ ИЗ ЗАКРЫТОГО СПИСКА
       (постановка). Свободная строка давала пять разных формулировок
       одного и того же, а клиент видит её дословно. Текст клиенту
       всегда РУССКИЙ, каким бы ни был язык админки: его написали мы
       не для сотрудника (закон 40, `lib/admin/prichiny.ts`). */
    const kod = ponyatPrichinu(String(fd.get('reason') ?? ''));
    if (!kod) return { error: 'e.pick_reason' };
    const nomer = slotAkkaunta(kod);

    /* ⚠️ ПОЧТУ АККАУНТА БЕРЁМ ЧЕРЕЗ ВИД, А НЕ РАСШИФРОВЫВАЕМ
       ЗДЕСЬ. Читателей шифротекста ровно столько, сколько названо
       законом 35, и расшифровка живёт в `lib/server/views.ts`:
       завести её второй раз в действии значило бы завести второе
       место, где можно ошибиться в том, кому её показывать (Р-102).
       Вид отдаёт открытый текст только оператору, который ЭТОТ заказ
       взял, — а `tolkoSvoy` выше это уже проверил. */
    let slotId: number | null = null;
    let pochtaAkkaunta: string | null = null;
    if (nomer !== null) {
      const vid = await zakazDlyaAdminki(zakaz, await dostupSotrudnika(s));
      const sl = vid?.slots.find((x) => x.idx === nomer) ?? null;
      if (!sl) return { error: 'e.no_slot' };
      slotId = sl.id;
      pochtaAkkaunta = sl.clientLogin;
    }
    /* ⚠️ В БАЗУ ЛОЖИТСЯ ПРИЧИНА БЕЗ АДРЕСА, А АДРЕС ПОДСТАВЛЯЕТСЯ
       ПРИ ЧТЕНИИ. Открытый адрес в `cancel_reason` пережил бы
       семидневное стирание шифротекстов и уехал бы в ночную копию
       базы, а в карточке админки его увидел бы любой сотрудник,
       а не только взявший заказ (закон 35, Р-151). Клиенту его
       подставляет кабинет — законный читатель СВОИХ шифротекстов, —
       и один раз письмо, здесь же, из уже прочитанной величины.

       ⚠️ НОМЕР КЛАДЁТСЯ ТОЛЬКО У ПРИЧИН, КОТОРЫМ АДРЕС НУЖЕН.
       Тогда «номер задан» и значит «подставить адрес», и второго
       признака заводить не надо. У причин про пароль аккаунт назван
       прямо в тексте словами — им номер в заказе не нужен вовсе. */
    const tekst = prichinaKlientu(kod);
    const akkaunt =
      nomer !== null && prichinaSPochtoy(kod) ? { idx: nomer, pochta: pochtaAkkaunta } : null;

    /* ⚠️ КАКОЕ ПИСЬМО УЙДЁТ, ГОВОРИТ САМ СПИСОК ПРИЧИН, а не наш
       вывод из соседнего признака: письмо и «дописывается ли адрес» —
       разные величины, и однажды они разойдутся. */
    const pismo = vidPismaOtmeny(kod);
    if (pismo !== 'vosstanovlenie') {
      const r = await otmenitZakaz(
        zakaz,
        tekst,
        s.id,
        pismo === 'pochta_zanyata' ? 'pochta_zanyata' : 'obychno',
        'operator',
        akkaunt,
      );
      if (!r.ok) return { error: 'e.cancel_fail' };
      revalidatePath('/admin');
      return { ok: 'k.order_cancelled' };
    }

    /* ⚠️ ПИСЬМО «НЕ ПОДОШЁЛ ПАРОЛЬ» УХОДИТ САМО, и отдельной кнопки
       для него больше нет. Прежде порядок «сначала письмо, потом
       отмена» держался проверкой на сервере (закон 37); теперь
       нарушить его нельзя по построению — это один шаг. */
    if (slotId === null) return { error: 'e.no_slot' };
    const u = await odna<{ email: string }>(
      'select u.email from shop_order o join app_user u on u.id = o.user_id where o.id = $1',
      [zakaz],
    );
    if (!u) return { error: 'o.no_order' };
    /* ⚠️ ОТМЕНА ПЕРВОЙ, ПИСЬМО ВТОРЫМ. Не сошлось с отменой — письма
       не было вовсе; наоборот было бы хуже: человек получил бы
       инструкцию по заказу, который так и остался в работе. Вид
       `parol` при этом гасит обычное письмо об отмене: про отмену
       и про деньги на балансе сказано в самом письме о пароле. */
    const r = await otmenitZakaz(zakaz, tekst, s.id, 'parol');
    if (!r.ok) return { error: 'e.cancel_fail' };
    const ssylka = await zavestiSsylku(zakaz, slotId);
    await pismoParolNePodoshyol(u.email, ssylka);
    await zapros('update order_slot set recovery_sent_at = now() where id = $1 and order_id = $2', [slotId, zakaz]);
    revalidatePath('/admin');
    return { ok: 'k.cancelled_letter' };
  }

  return { error: 'e.bad_step' };
}

/* ── ОТМЕНА ПОДПИСКИ У ВЫПОЛНЕННОГО ЗАКАЗА ─────────────────────────────
   Сорок девятая итерация, пункт 9. Нажимает администратор, делает
   оператор — и это две разные двери с разными проверками. */

/**
 * «Отменить» у выполненного заказа — ТОЛЬКО АДМИНИСТРАТОР.
 *
 * ⚠️ ПОДТВЕРЖДЕНИЕ СПРАШИВАЕТ СТРАНИЦА (свой блок «Вы уверены?»,
 * а не `confirm()`, Р-145), а условия проверяет СЕРВЕР: заказ
 * выполнен, это тариф, отмены ещё не было — внутри транзакции,
 * под `for update` (`zaprositOtmenuPodpiski`).
 *
 * ⚠️ СООБЩЕНИЕ БОТУ — ПОСЛЕ ТРАНЗАКЦИИ: поход в сеть внутри неё
 * держал бы соединение с базой, а при откате сообщение ушло бы
 * о задаче, которой нет (то же правило, что у `posleOplaty`).
 */
export async function adminOtmenitVypolnenny(_p: OtvetA, fd: FormData): Promise<OtvetA> {
  const s = await ktoSotrudnik();
  if (!s) return { error: 'e.session' };
  if (s.role !== 'admin') return { error: 'o.only_admin' };
  const zakaz = Number(fd.get('order') ?? 0);
  const r = await zaprositOtmenuPodpiski(zakaz, s.id);
  if (!r.ok) {
    const slova: Record<typeof r.pochemu, Klyuch> = {
      net_zakaza: 'o.no_order',
      ne_vypolnen: 'e.not_done',
      sertifikat: 'e.cert_no_sub',
      uzhe: 'e.sub_already',
    };
    return { error: slova[r.pochemu] };
  }
  const z = await odna<{ plan_id: string; period: number }>('select plan_id, period from shop_order where id = $1', [
    zakaz,
  ]);
  const komu = r.operatorId
    ? ((await odna<{ email: string }>('select email from staff where id = $1', [r.operatorId]))?.email ?? null)
    : null;
  await soobshchitKomande({
    vid: 'otmena_podpiski',
    zakaz,
    tarif: imyaTarifaIz(await imenaTarifov(), z?.plan_id ?? '', true),
    srok: srokDlyaSotrudnika(z?.period ?? 0, true),
    akkaunty: await akkauntyDlyaOtmeny(zakaz),
    komu,
  });
  revalidatePath('/admin');
  return komu ? { ok: 'k.sub_task_to', polya: { kto: komu } } : { ok: 'k.sub_task_general' };
}

/**
 * Взять задачу «Отмена подписки» из общей очереди.
 *
 * ⚠️ ПАРА ПРОВЕРЯЕТСЯ ВНУТРИ ВЗЯТИЯ, а не здесь — как у заказа
 * (`vzyatOtmenu`, Р-155). Не взял — ведём в карточку, и она сама
 * скажет, что задача недоступна или уже у другого.
 */
export async function adminOtmenaVzyat(fd: FormData): Promise<void> {
  const s = await ktoSotrudnik();
  if (!s) redirect('/admin/login/');
  const id = Number(fd.get('order') ?? 0);
  const zapreshcheno = s.role === 'admin' ? null : await zapretyPar(s.id);
  await vzyatOtmenu(id, s.id, zapreshcheno);
  revalidatePath('/admin');
  redirect(`/admin/orders/${id}/`);
}

/**
 * ОДНО ДЕЙСТВИЕ НА ВСЕ ШАГИ ЗАДАЧИ — ровно как у заказа (закон 52):
 * на экране задачи одно состояние и одно сообщение по построению.
 * «Это ваша задача» проверяет каждая функция заказа сама — условием
 * `operator_id = $2` в том же запросе, что и перемена.
 */
export async function adminOtmenaShag(_p: OtvetA, fd: FormData): Promise<OtvetA> {
  const s = await ktoSotrudnik();
  if (!s) return { error: 'e.session' };
  const zakaz = Number(fd.get('order') ?? 0);
  const op = String(fd.get('op') ?? '');
  if (op === 'otmenena') {
    const r = await otmetitPodpiskuOtmenyonnoy(zakaz, s.id);
    if (!r.ok) return { error: 'e.not_yours' };
    revalidatePath('/admin');
    return { ok: r.zakryta ? 'k.sub_done' : 'k.sub_marked' };
  }
  if (op === 'nazad') {
    const ok = await otmenaNazad(zakaz, s.id);
    if (!ok) return { error: 'e.no_back' };
    revalidatePath(`/admin/orders/${zakaz}`);
    return { ok: 'k.back' };
  }
  if (op === 'vernut') {
    const ok = await vernutOtmenu(zakaz, s.id);
    if (!ok) return { error: 'e.not_yours' };
    revalidatePath('/admin');
    return { ok: 'k.sub_released' };
  }
  return { error: 'e.bad_step' };
}

/**
 * Частота самообновления очереди.
 *
 * ⚠️ ХРАНИТСЯ ЗА СОТРУДНИКОМ, А НЕ В КУКЕ — то же правило, что
 * у языка (Р-96): выбор обязан переехать с человеком на другую
 * машину. В Нейролавке он лежит в куке, потому что там у панели
 * нет ни строки скриптов и настройка вида привязана к браузеру;
 * у нас очередь и так клиентский компонент, а строка сотрудника
 * и так читается на каждый заход.
 *
 * ⚠️ СПИСОК ЗАКРЫТЫЙ. Значение приходит из формы, а частота опроса
 * с чужим числом — это либо страница, стучащаяся каждую миллисекунду,
 * либо очередь, которая не обновляется никогда.
 */
export async function adminSetQueueRate(_p: OtvetA, fd: FormData): Promise<OtvetA> {
  const s = await ktoSotrudnik();
  if (!s) return { error: 'e.session' };
  const sek = Number(fd.get('sec') ?? 0);
  if (!(CHASTOTY_OCHEREDI as readonly number[]).includes(sek)) return { error: 'e.bad_rate' };
  await zapros('update staff set queue_sec = $2 where id = $1', [s.id, sek]);
  revalidatePath('/admin');
  return { ok: 'k.rate_saved' };
}

/* ── Настройки (только администратор) ──────────────────────────── */

/**
 * Скидка на пару тариф × срок.
 *
 * ⚠️ ЦЕНА ЗАМОРАЖИВАЕТСЯ ПРИ СОЗДАНИИ ЗАКАЗА, и заботиться об этом
 * отдельно не нужно: `sozdatZakaz` берёт цену из каталога и кладёт
 * её в `shop_order.total_kop`, а чек и платёж считаются от неё же.
 * Снятая скидка на уже созданный заказ не влияет никак.
 */
export async function adminSetDiscount(_p: OtvetA, fd: FormData): Promise<OtvetA> {
  const s = await ktoSotrudnik();
  if (!s || s.role !== 'admin') return { error: 'o.only_admin' };
  const plan = String(fd.get('plan') ?? '');
  const period = Number(fd.get('period') ?? 0);
  if (!plan || !period) return { error: 'e.pick_plan' };
  const rub = String(fd.get('price') ?? '').replace(',', '.').trim();
  const doDaty = String(fd.get('until') ?? '').trim();
  if (rub === '' && doDaty === '') {
    await zapros('delete from plan_discount where plan_id = $1 and period = $2', [plan, period]);
    revalidatePath('/');
    return { ok: 'k.discount_removed' };
  }
  const n = Number(rub);
  if (!Number.isFinite(n) || n < 0) return { error: 'e.price_number' };
  if (!nastoyashchayaData(doDaty)) return { error: 'e.bad_date' };
  await zapros(
    `insert into plan_discount (plan_id, period, price_kop, until) values ($1, $2, $3, $4::date)
     on conflict (plan_id, period) do update set price_kop = excluded.price_kop, until = excluded.until`,
    [plan, period, Math.round(n * 100), doDaty],
  );
  revalidatePath('/');
  return { ok: 'k.discount_saved' };
}

/**
 * Доступность пары тариф × срок.
 *
 * ⚠️ ВКЛЮЧИТЬ ЯЧЕЙКУ БЕЗ ЦЕНЫ НЕЛЬЗЯ, и отказ честный. «Доступно»
 * значит «оформляется», а оформить без цены невозможно: включённая
 * пустая ячейка означала бы карточку, которая на выбранном сроке
 * молча ничего не показывает.
 */
export async function adminToggleCell(_p: OtvetA, fd: FormData): Promise<OtvetA> {
  const s = await ktoSotrudnik();
  if (!s || s.role !== 'admin') return { error: 'o.only_admin' };
  const plan = String(fd.get('plan') ?? '');
  const period = Number(fd.get('period') ?? 0);
  const vklyuchit = fd.get('on') === '1';
  if (!plan || !period) return { error: 'e.pick_plan' };
  if (vklyuchit) {
    const est = (await katalogPolny()).find((t) => t.id === plan)?.ceny.some((c) => c.period === period);
    if (!est) return { error: 'e.no_price_first' };
    await zapros('delete from plan_off where plan_id = $1 and period = $2', [plan, period]);
  } else {
    await zapros(
      'insert into plan_off (plan_id, period) values ($1, $2) on conflict do nothing',
      [plan, period],
    );
  }
  revalidatePath('/');
  return { ok: vklyuchit ? 'k.cell_on' : 'k.cell_off' };
}

/**
 * Галочка «Египет» у пары тариф × срок (сорок девятая итерация).
 *
 * ⚠️ ГАЛОЧКА НЕ ЗАВИСИТ ОТ ЦЕНЫ И ОТ ТОГО, ПРОДАЁТСЯ ЛИ ПАРА. Ставить
 * её можно и у пары без цены: Египет — свойство аккаунта, который
 * заводится на эту пару, а не цены. Пока пара не продаётся, плашку
 * просто негде показать.
 *
 * ⚠️ ЛЕНДИНГ СТАТИЧЕСКИЙ (закон 36), и без `revalidatePath('/')`
 * плашка доехала бы до главной только через пять минут.
 */
export async function adminToggleEgipet(_p: OtvetA, fd: FormData): Promise<OtvetA> {
  const s = await ktoSotrudnik();
  if (!s || s.role !== 'admin') return { error: 'o.only_admin' };
  const plan = String(fd.get('plan') ?? '');
  const period = Number(fd.get('period') ?? 0);
  if (!vsePary().some((p) => p.planId === plan && p.period === period)) return { error: 'e.pick_plan' };
  const vklyuchit = fd.get('egipet') === '1';
  if (vklyuchit) {
    await zapros('insert into plan_egypt (plan_id, period) values ($1, $2) on conflict do nothing', [plan, period]);
  } else {
    await zapros('delete from plan_egypt where plan_id = $1 and period = $2', [plan, period]);
  }
  revalidatePath('/');
  revalidatePath('/admin/settings');
  return { ok: vklyuchit ? 'k.egypt_on' : 'k.egypt_off' };
}

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

/**
 * НАЗВАНИЕ ТАРИФА.
 *
 * Постановка сорок второй итерации: «дать менять названия тарифов:
 * название на сайте (русское) и название для сотрудников
 * (английское)». Сорок третья добавила ТРЕТЬЕ поле — короткое имя
 * для карточки: «полное (сейчас „Индивидуальный") и короткое
 * для карточки на главной (сейчас „На одного")».
 *
 * ⚠️ РУССКОЕ И АНГЛИЙСКОЕ — ОБА ИЛИ НИ ОДНОГО. Половина имени
 * означала бы, что в русской админке тариф называется по-новому,
 * а в боте по-старому: с виду работает, а на деле это два разных
 * тарифа в одной таблице.
 *
 * ⚠️ КОРОТКОЕ НЕОБЯЗАТЕЛЬНО, и пустым оно остаётся законно: у тарифа
 * с коротким названием второму полю взяться неоткуда. Пустое значит
 * «на карточке стоит полное имя» — то же поведение, что было до этой
 * итерации. Но БЕЗ ПОЛНОГО его не бывает: оно полное уточняет,
 * а не заменяет.
 *
 * ⚠️ ЛЕНДИНГ ПЕРЕСОБИРАЕТСЯ СРАЗУ. Он статический с `revalidate`
 * (закон 36), и без `revalidatePath` новое имя доезжало бы до главной
 * через пять минут — то есть выглядело бы как «не сохранилось».
 */
export async function adminSetPlanName(_p: OtvetA, fd: FormData): Promise<OtvetA> {
  const s = await ktoSotrudnik();
  if (!s || s.role !== 'admin') return { error: 'o.only_admin' };
  const plan = String(fd.get('plan') ?? '');
  if (!plan) return { error: 'e.pick_plan' };
  const name = String(fd.get('name') ?? '').trim().slice(0, 60);
  const nameEn = String(fd.get('nameEn') ?? '').trim().slice(0, 60);
  /* ⚠️ КОРОТКОЕ ИМЯ КОРОЧЕ И ПО ПРАВИЛУ: 40 знаков против 60.
     Оно стоит на карточке тарифа, а её ширина на 320 px — около
     134 px; предел здесь не украшение, а честная граница поля. */
  const short = String(fd.get('short') ?? '').trim().slice(0, 40);
  if (Boolean(name) !== Boolean(nameEn)) return { error: 'e.name_empty' };
  /* ⚠️ КОРОТКОЕ БЕЗ ПОЛНОГО НЕ БЫВАЕТ: оно уточняет полное имя,
     а не заменяет его. Одно короткое означало бы тариф, который
     на карточке называется по-новому, а в письме по-старому. */
  if (short && !name) return { error: 'e.name_empty' };
  await zadatImyaTarifa(plan, name, nameEn, short);
  /* ⚠️ ПЕРЕСОБИРАЕМ ТОЛЬКО ЛЕНДИНГ, И БОЛЬШЕ НИЧЕГО НЕ НАДО.
     Оформление, сертификаты и кабинет динамические (`force-dynamic`)
     и читают каталог на каждый запрос; лендинг — единственная
     страница с `revalidate` (закон 36), и без этой строки новое имя
     доезжало бы до главной через пять минут, то есть выглядело бы
     как «не сохранилось». */
  revalidatePath('/');
  return { ok: name ? 'k.name_saved' : 'k.name_removed' };
}

export async function adminSetCertDays(_p: OtvetA, fd: FormData): Promise<OtvetA> {
  const s = await ktoSotrudnik();
  if (!s || s.role !== 'admin') return { error: 'o.only_admin' };
  const n = Number(String(fd.get('days') ?? ''));
  if (!Number.isFinite(n) || n < 1) return { error: 'e.days_number' };
  await zadatNastroyku(SROK_SERTIFIKATA, String(Math.round(n)));
  return { ok: 'k.cert_days_saved' };
}

/**
 * Время, за которое оператор должен взять предложенный заказ.
 *
 * ⚠️ ПРЕДЕЛЫ ПРОВЕРЯЕТ СЕРВЕР, а не `min`/`max` поля: атрибуты
 * снимаются в браузере за секунду, а ноль минут значил бы, что заказ
 * уходит от оператора раньше, чем до него дошло сообщение.
 */
export async function adminSetRazdachaMinut(_p: OtvetA, fd: FormData): Promise<OtvetA> {
  const s = await ktoSotrudnik();
  if (!s || s.role !== 'admin') return { error: 'o.only_admin' };
  const syroe = String(fd.get('minut') ?? '').trim();
  const n = Number(syroe);
  if (!/^\d+$/.test(syroe) || !Number.isInteger(n) || n < RAZDACHA_MINUT_OT || n > RAZDACHA_MINUT_DO) {
    return { error: 'rz.e_minut', polya: { ot: RAZDACHA_MINUT_OT, do: RAZDACHA_MINUT_DO } };
  }
  await zadatNastroyku(RAZDACHA_MINUT, String(n));
  revalidatePath('/admin/settings');
  return { ok: 'rz.minut_saved', polya: { n } };
}

/**
 * ПРИВЯЗКА TELEGRAM ОПЕРАТОРА: выдать ссылку или отвязать.
 *
 * Постановка: «в „Сотрудниках" у оператора кнопка „Привязать Telegram" —
 * одноразовая ссылка на бота. Оператор открывает её, бот запоминает его
 * чат. Отвязать может администратор».
 *
 * ⚠️ ОДНО ДЕЙСТВИЕ НА ОБЕ ОПЕРАЦИИ, ПОЛЕМ `op` — у карточки оператора
 * одно сообщение о результате, а не два (закон 52).
 *
 * ⚠️ ТОКЕН УХОДИТ НА ЭКРАН ОДИН РАЗ, В ОТВЕТЕ ДЕЙСТВИЯ, а в базе лежит
 * его отпечаток: ни перезагрузка страницы, ни ночная копия базы ссылку
 * не покажут. Новая ссылка гасит прежние неиспользованные — по старой,
 * пересланной кому-то, привязаться уже нельзя.
 *
 * ⚠️ ПРИВЯЗАТЬ МОЖНО ТОЛЬКО ОПЕРАТОРА: раздача предлагает заказы только
 * операторам, а администратор видит и берёт всё и без бота. И без токена
 * бота на сервере ссылку не выдаём вовсе — она вела бы в никуда.
 */
export async function adminTelegram(_p: OtvetA, fd: FormData): Promise<OtvetA> {
  const s = await ktoSotrudnik();
  if (!s || s.role !== 'admin') return { error: 'o.only_admin' };
  const id = Number(fd.get('id') ?? 0);
  const op = String(fd.get('op') ?? '');
  const kto = await odna<{ email: string; role: string }>('select email, role from staff where id = $1', [id]);
  if (!kto) return { error: 'e.check_email' };
  if (op === 'otvyazat') {
    /* ⚠️ ОТВЯЗКА ТОЛЬКО СНИМАЕТ ЧАТ. Открытое предложение этому
       оператору истекает на ближайшем ходе раздачи: он перестал быть
       пригодным, и решает это одно место — раздача, а не эта кнопка. */
    await zapros(
      `update staff set tg_chat_id = null, tg_username = null, tg_imya = null, tg_privyazan_at = null where id = $1`,
      [id],
    );
    await zapros('delete from tg_privyazka where staff_id = $1 and used_at is null', [id]);
    log.info('Telegram отвязан', { staff: pochtaVZhurnal(kto.email) });
    revalidatePath('/admin/staff');
    return { ok: 'tg.otvyazan', polya: { email: kto.email }, step: String(id) };
  }
  if (op !== 'privyazat') return { error: 'e.bad_step' };
  if (kto.role !== 'operator') return { error: 'tg.e_ne_operator' };
  if (!env.telegramToken) return { error: 'tg.e_net_bota' };
  const token = novyToken();
  await zapros('delete from tg_privyazka where staff_id = $1 and used_at is null', [id]);
  await zapros(
    `insert into tg_privyazka (token_hash, staff_id, expires_at) values ($1, $2, now() + interval '24 hours')`,
    [otpechatok(token), id],
  );
  const bot = (await nastroyka(TG_BOT, '')).trim();
  log.info('выдана ссылка привязки Telegram', { staff: pochtaVZhurnal(kto.email) });
  /* Имени бота нет — значит `getMe` ещё ни разу не ответил. Тогда
     вместо ссылки команда, которую оператор отправит боту сам. */
  if (!/^[A-Za-z0-9_]{3,64}$/.test(bot)) {
    return { ok: 'tg.komanda', polya: { kod: `/start ${token}` }, step: String(id) };
  }
  return { ok: 'tg.ssylka', step: String(id), ssylka: `https://t.me/${bot}?start=${token}` };
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

/**
 * ТАРИФЫ, КОТОРЫЕ МОЖЕТ ВЫПОЛНЯТЬ ОПЕРАТОР.
 *
 * Постановка сорок шестой итерации: «Администратор выбирает
 * галочками, какие тарифы может выполнять каждый оператор».
 *
 * ⚠️ В БАЗУ ЛОЖАТСЯ ЗАПРЕТЫ, А ПРИХОДЯТ РАЗРЕШЕНИЯ, и это не
 * путаница, а прямое следствие требования «новый оператор
 * по умолчанию получает все тарифы»: пустая таблица обязана значить
 * «можно всё» (см. миграцию 013 и Р-116). Форма отдаёт отмеченные
 * галочки — их и вычитаем из состава тарифов.
 *
 * ⚠️ СОСТАВ ТАРИФОВ БЕРЁТСЯ ИЗ `lib/plans.ts`, А НЕ ИЗ КАТАЛОГА.
 * Каталог знает про цены, скидки и выключенные пары — от всего
 * этого галочки обязаны не зависеть вовсе: «Переименование тарифа,
 * смена цены, скидки, скрытие тарифа на сайте галочки не
 * сбрасывают». Состав же лежит в коде и от базы не зависит
 * (`lib/server/catalog.ts`).
 *
 * ⚠️ ПЕРЕПИСЫВАЕМ ЦЕЛИКОМ, ОДНОЙ ТРАНЗАКЦИЕЙ НЕ НАДО: две строки
 * идут подряд, и между ними состояние «запретов нет» означает
 * «разрешено всё» — то есть в худшем случае оператор на долю
 * секунды видит чуть больше, а не меньше. Потерять доступ
 * к взятому заказу он при этом не может: свой заказ виден всегда,
 * о тарифе его никто не спрашивает (`dostup.ts`).
 */
export async function adminSetStaffPlans(_p: OtvetA, fd: FormData): Promise<OtvetA> {
  const s = await ktoSotrudnik();
  if (!s || s.role !== 'admin') return { error: 'o.only_admin' };
  const id = Number(fd.get('id') ?? 0);
  const kto = await odna<{ email: string; role: string }>('select email, role from staff where id = $1', [id]);
  if (!kto) return { error: 'e.check_email' };
  /* ⚠️ РАЗРЕШЕНИЯ ПРИХОДЯТ СПИСКОМ ОТМЕЧЕННЫХ ГАЛОЧЕК, А В БАЗУ
     ЛОЖАТСЯ ЗАПРЕТЫ, и переворот идёт здесь: «все пары минус
     отмеченные». Отсюда даром выходит и защита от чужого значения
     в форме — выдуманная пара просто не совпадёт ни с одной
     настоящей и в запреты не попадёт, ронять на ней нечего.

     ⚠️ ПАРА ЕДЕТ ОДНОЙ СТРОКОЙ (`klyuchPary`), потому что у галочки
     одно значение; собирает и разбирает её одно место в `lib/plans.ts`,
     общее с разметкой. */
  const razresheno = new Set(fd.getAll('pair').map((x) => String(x)));
  const zapreshcheno = vsePary().filter((p) => !razresheno.has(klyuchPary(p.planId, p.period)));
  await zapros('delete from staff_plan_off where staff_id = $1', [id]);
  if (zapreshcheno.length) {
    await zapros(
      `insert into staff_plan_off (staff_id, plan_id, period)
         select $1, z.plan_id, z.period
           from unnest($2::text[], $3::int[]) as z (plan_id, period)
         on conflict do nothing`,
      [id, zapreshcheno.map((z) => z.planId), zapreshcheno.map((z) => z.period)],
    );
  }
  revalidatePath('/admin/staff');
  revalidatePath('/admin');
  return { ok: 'f.plans_saved', polya: { email: kto.email } };
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
    /* ⚠️ ЕГО НЕЗАКРЫТЫЕ ЗАДАЧИ «ОТМЕНА ПОДПИСКИ» УХОДЯТ В ОБЩУЮ
       ОЧЕРЕДЬ (сорок девятая итерация). Постановка: «если оператора
       больше нет — в общую очередь». Задача, приписанная отключённому,
       иначе висела бы у него навсегда: войти и сделать её ему нечем,
       а другим она не видна. */
    await zapros('update sub_cancel set operator_id = null where operator_id = $1 and done_at is null', [id]);
  }
  revalidatePath('/admin/staff');
  redirect('/admin/staff/');
}

// ── промокоды (Р-167) ──────────────────────────────────────────────

/**
 * ⚠️ ТОЛЬКО АДМИНИСТРАТОРУ, и проверка стоит в каждом действии:
 * серверное действие — обычная точка входа, мимо страницы в него
 * попасть можно. Скидка — это деньги сервиса, а деньги исполнителю
 * не видны с сорок второй итерации (Р-148, Р-155).
 */
const OSHIBKA_PROMO: Record<OshibkaKoda, Klyuch> = {
  net_koda: 'pr.e_kod',
  zanyat: 'pr.e_zanyat',
  nevernaya_skidka: 'pr.e_skidka',
  net_sroka: 'pr.e_srok',
  nevernye_aktivacii: 'pr.e_aktivacii',
  net: 'pr.e_net',
  malo_aktivaciy: 'pr.e_malo',
};

function poliyaPromo(fd: FormData) {
  return {
    skidkaProc: Number(String(fd.get('skidka') ?? '').trim()),
    doDaty: String(fd.get('do') ?? '').trim(),
    aktivaciy: Number(String(fd.get('aktivaciy') ?? '').trim()),
  };
}

export async function adminPromoZavesti(_p: OtvetA, fd: FormData): Promise<OtvetA> {
  const s = await ktoSotrudnik();
  if (!s || s.role !== 'admin') return { error: 'o.only_admin' };
  const r = await zavestiPromo({ kod: String(fd.get('kod') ?? ''), ...poliyaPromo(fd) }, s.id);
  if ('oshibka' in r) return { error: OSHIBKA_PROMO[r.oshibka] };
  revalidatePath('/admin/promo/');
  return { ok: 'pr.zaveden', polya: { kod: r.kod } };
}

export async function adminPromoIzmenit(_p: OtvetA, fd: FormData): Promise<OtvetA> {
  const s = await ktoSotrudnik();
  if (!s || s.role !== 'admin') return { error: 'o.only_admin' };
  const r = await izmenitPromo(String(fd.get('kod') ?? ''), poliyaPromo(fd));
  if ('oshibka' in r) return { error: OSHIBKA_PROMO[r.oshibka] };
  revalidatePath('/admin/promo/');
  return { ok: 'pr.izmenen', polya: { kod: r.kod } };
}

export async function adminPromoOtklyuchit(_p: OtvetA, fd: FormData): Promise<OtvetA> {
  const s = await ktoSotrudnik();
  if (!s || s.role !== 'admin') return { error: 'o.only_admin' };
  const kod = String(fd.get('kod') ?? '');
  const vykl = fd.get('kak') === '1';
  if (!(await otklyuchitPromo(kod, vykl))) return { error: 'pr.e_net' };
  revalidatePath('/admin/promo/');
  return { ok: vykl ? 'pr.otklyuchen' : 'pr.vklyuchen', polya: { kod: kodPromo(kod) } };
}

// ── отзывы (пятьдесят четвёртая итерация) ──────────────────────────

const OSHIBKA_OTZYVA: Record<OshibkaOtzyva, Klyuch> = {
  imya: 'rv.e_imya',
  imya_dlinno: 'rv.e_imya_dlinno',
  tekst: 'rv.e_tekst',
  tekst_dlinno: 'rv.e_tekst_dlinno',
  data: 'rv.e_data',
  data_pozzhe: 'rv.e_data_pozzhe',
  tarif: 'rv.e_tarif',
  net: 'rv.e_net',
  nelzya: 'rv.e_nelzya',
};

/**
 * ВСЕ ДЕЙСТВИЯ С ОТЗЫВАМИ — ОДНО ДЕЙСТВИЕ С ПОЛЕМ `op`, и сообщение
 * на экране одно по построению (то же устройство, что у шагов заказа,
 * закон 52). `step` говорит странице, где его показать: у формы
 * добавления или над списками.
 *
 * ⚠️ ТОЛЬКО АДМИНИСТРАТОРУ, и проверка стоит здесь: серверное действие —
 * обычная точка входа.
 *
 * ⚠️ КАЖДОЕ ДЕЙСТВИЕ ПЕРЕСОБИРАЕТ ГЛАВНУЮ. Лендинг статический
 * (закон 36), и без `revalidatePath('/')` опубликованный отзыв доехал бы
 * до него через пять минут — то есть выглядел бы как «не сработало».
 * Пересобирать и тогда, когда видимое на главной не изменилось
 * (порядок скрытых), дешевле, чем выяснять это каждый раз. Раскладка
 * админки — ради счётчика «Отзывы (N)» в меню.
 */
export async function adminOtzyv(_p: OtvetA, fd: FormData): Promise<OtvetA> {
  const s = await ktoSotrudnik();
  if (!s || s.role !== 'admin') return { error: 'o.only_admin' };
  const op = String(fd.get('op') ?? '');
  const gotovo = (ok: Klyuch, step: string): OtvetA => {
    revalidatePath('/');
    revalidatePath('/admin', 'layout');
    return { ok, step };
  };

  if (op === 'dobavit') {
    const srazu = fd.get('srazu') === 'on';
    const r = await dobavitOtzyv(
      {
        imya: String(fd.get('imya') ?? ''),
        tekst: String(fd.get('tekst') ?? ''),
        data: String(fd.get('data') ?? '').trim(),
        planId: String(fd.get('plan') ?? ''),
        srazu,
      },
      s.id,
    );
    if ('oshibka' in r) return { error: OSHIBKA_OTZYVA[r.oshibka], step: 'dobavit' };
    return gotovo(srazu ? 'rv.dobavlen' : 'rv.dobavlen_skryt', 'dobavit');
  }

  const id = Number(fd.get('id') ?? 0);
  if (!Number.isSafeInteger(id) || id <= 0) return { error: 'rv.e_net', step: 'spisok' };
  if (op === 'opublikovat' || op === 'skryt') {
    const r = await smenitStatus(id, op === 'opublikovat' ? 'opublikovan' : 'skryt', s.id);
    if ('oshibka' in r) return { error: OSHIBKA_OTZYVA[r.oshibka], step: 'spisok' };
    return gotovo(op === 'opublikovat' ? 'rv.opublikovan' : 'rv.skryt_ok', 'spisok');
  }
  if (op === 'vyshe' || op === 'nizhe') {
    const r = await sdvinut(id, op === 'vyshe' ? -1 : 1);
    if ('oshibka' in r) return { error: OSHIBKA_OTZYVA[r.oshibka], step: 'spisok' };
    return gotovo('rv.sdvinut', 'spisok');
  }
  if (op === 'udalit') {
    const r = await udalitOtzyv(id);
    if ('oshibka' in r) return { error: OSHIBKA_OTZYVA[r.oshibka], step: 'spisok' };
    return gotovo('rv.udalen', 'spisok');
  }
  return { error: 'rv.e_net', step: 'spisok' };
}

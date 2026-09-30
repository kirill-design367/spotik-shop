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
  shagNazad,
  vernutVOchered,
  vzyatZakaz,
  zapisatVydachu,
  zavershitZakaz,
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
import { zadatNastroyku, SROK_SERTIFIKATA } from './settings';
import { shifrGotov } from './crypto';
import { katalogPolny } from './catalog';
import { zakazDlyaAdminki } from './views';
import { dostupSotrudnika, vsePary, zapretyPar } from './dostup';
import { klyuchPary } from '@/lib/plans';
import { CHASTOTY_OCHEREDI } from '@/lib/admin/chastoty';
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

  /* ── Аккаунт пройден ─────────────────────────────────────────── */
  if (op === 'gotov') {
    const ok = await otmetitSlotGotovym(Number(fd.get('slot') ?? 0), zakaz);
    if (!ok) return { error: 'e.mark_done' };
    revalidatePath(`/admin/orders/${zakaz}`);
    return { ok: 'k.marked' };
  }

  /* ── Старый заказ: доступы заводит оператор ──────────────────── */
  if (op === 'vydacha') {
    if (!shifrGotov()) return { error: 'e.no_key' };
    const login = String(fd.get('login') ?? '').trim();
    const mailPass = String(fd.get('mailPass') ?? '');
    const spotifyPass = String(fd.get('spotifyPass') ?? '');
    if (!login || !mailPass || !spotifyPass) return { error: 'e.fill_three' };
    const ok = await zapisatVydachu({
      slotId: Number(fd.get('slot') ?? 0),
      zakaz,
      staffId: s.id,
      login,
      mailPass,
      spotifyPass,
    });
    if (!ok) return { error: 'e.save_creds' };
    revalidatePath(`/admin/orders/${zakaz}`);
    return { ok: 'k.creds_saved' };
  }

  /* ── Шаг назад ───────────────────────────────────────────────── */
  if (op === 'nazad') {
    const ok = await shagNazad(zakaz, s.id);
    if (!ok) return { error: 'e.no_back' };
    revalidatePath(`/admin/orders/${zakaz}`);
    return { ok: 'k.back' };
  }

  /* ── Завершение ──────────────────────────────────────────────── */
  if (op === 'zavershit') {
    /* ⚠️ ДАТА У ПРОДЛЕНИЯ ОБЯЗАТЕЛЬНА, И ПРОВЕРЯЕТСЯ ЭТО НА СЕРВЕРЕ.
       Поле в разметке человек правит в браузере за секунду, а от этой
       даты считается письмо за три дня до конца подписки (закон 44):
       пустая дата означала бы либо молчание, либо письмо не в тот
       день. У нового аккаунта официальной даты взять негде — там
       срок по-прежнему считается от выдачи. */
    const slots = await zapros<{ id: string; mode: string; idx: number }>(
      'select id, mode, idx from order_slot where order_id = $1 order by idx',
      [zakaz],
    );
    const daty: Record<number, string> = {};
    for (const sl of slots) {
      const v = String(fd.get(`ends_${sl.id}`) ?? '').trim();
      if (sl.mode !== 'renew') continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return { error: 'e.need_date', polya: { n: sl.idx + 1 } };
      daty[Number(sl.id)] = v;
    }
    const r = await zavershitZakaz(zakaz, s.id, daty);
    if (!r.ok) return { error: r.pochemu === 'Не все участники заполнены.' ? 'e.not_all_done' : 'e.not_yours' };
    revalidatePath('/admin');
    return { ok: 'k.order_closed' };
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(doDaty)) return { error: 'e.bad_date' };
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
  }
  revalidatePath('/admin/staff');
  redirect('/admin/staff/');
}

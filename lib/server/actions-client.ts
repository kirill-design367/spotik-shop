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
import { utmIzKuki } from './utm';
import { vystavitSchet, vystavitSchetPopolneniya } from './payments';
import { proverit as proveritPromo, steretPromoKuku } from './promokody';
import { kodPromo, otkazSlovami } from '@/lib/promokod';
import { nayti, POCHEMU_KOD } from './certificates';
import { katalog, naytiTarif } from './catalog';
import { prinyatObrashchenie } from './podderzhka';
import { ostavitOtzyv } from './otzyvy';
import { otklyuchitPodpisku } from './avtoplatezh';

export type Otvet = {
  oshibka?: string;
  ladno?: string;
  shag?: string;
  email?: string;
  /**
   * Куда уйти БРАУЗЕРОМ. Только внешний адрес платёжной формы.
   *
   * ⚠️ НА РОБОКАССУ УВОДИТ КЛИЕНТ, А НЕ `redirect()` ИЗ ДЕЙСТВИЯ,
   * и это починка настоящей поломки: нажатие «назад» со страницы
   * оплаты роняло сайт «Application error: a client-side exception
   * has occurred» (Р-143). Серверное действие не умеет уходить
   * на чужой домен обычным перенаправлением — оно отдаёт адрес
   * роутеру Next, и тот сам двигает `window.location`, оставляя
   * в истории запись, которой на возврате уже нечего показать.
   * Адрес, отданный сюда, переводит навигацию в обычный
   * `location.assign` с обычной страницы оформления: в истории
   * остаётся GET-запрос страницы, и возврат открывает её как всегда.
   */
  kuda?: string;
  /**
   * Что подарено по проверенному коду сертификата. Приходит на шаге
   * «код принят»: до него мы не знаем ни тарифа, ни числа участников,
   * а форма активации обязана показать ровно столько полей, сколько
   * мест в подаренном тарифе (Р-93).
   */
  dar?: { chto: string; mest: number };
};

const NET_BAZY = 'Сервис временно недоступен. Попробуйте чуть позже.';

/**
 * Кто сейчас вошёл — только почта и только для подстановки в форму
 * поддержки.
 *
 * ⚠️ ЭТО ДЕЙСТВИЕ, А НЕ ЧТЕНИЕ КУКИ В РАСКЛАДКЕ, и причина одна:
 * `cookies()` в корневой раскладке перевёл бы НА ПОСЧИТАННЫЙ ОТВЕТ
 * все страницы сайта, включая лендинг, — то есть отменил бы закон 36
 * ради подстановки одного поля. Действие зовётся, только когда
 * человек открыл форму, и на скорость первого экрана не влияет
 * никак.
 */
export async function deystvieKtoYa(): Promise<{ email: string | null }> {
  if (!bazaEst()) return { email: null };
  const kto = await ktoKlient();
  return { email: kto?.email ?? null };
}

/**
 * Обращение в поддержку.
 *
 * ⚠️ ОТВЕТ СПОКОЙНЫЙ И ОДИН И ТОТ ЖЕ. Человек написал в поддержку
 * не затем, чтобы узнать, что у него не то в поле; всё, что мы можем
 * честно сказать, — «принято, ответим в рабочее время».
 *
 * ⚠️ ПОЧТА АККАУНТА ПОДСТАВЛЯЕТСЯ САМА, но «от кого» берётся
 * НЕ ИЗ ФОРМЫ, а из сессии: поле формы правится в браузере, а подпись
 * под обращением должна значить то, что она значит.
 */
export async function deystvieObrashchenie(_prosh: Otvet, fd: FormData): Promise<Otvet> {
  const kto = await ktoKlient();
  const itog = await prinyatObrashchenie({
    tekst: String(fd.get('tekst') ?? ''),
    svyaz: String(fd.get('svyaz') ?? ''),
    lovushka: String(fd.get('website') ?? ''),
    otkryto: Number(fd.get('otkryto') ?? 0),
    ot: kto?.email ?? null,
    userId: kto?.userId ?? null,
  });
  if (!itog.ok) return { oshibka: itog.pochemu };
  return { shag: 'prinyato' };
}

export async function deystviePrositKod(_prosh: Otvet, fd: FormData): Promise<Otvet> {
  if (!bazaEst()) return { oshibka: NET_BAZY };
  const email = normPochta(String(fd.get('email') ?? ''));
  const r = await poprositKod(email, 'client');
  if (!r.ok) {
    return {
      oshibka:
        r.pochemu === 'ne_pochta'
          ? 'Проверьте адрес почты.'
          : r.pochemu === 'adres'
            ? 'Почта не приняла этот адрес. Проверьте, нет ли в нём опечатки.'
            : r.pochemu === 'pochta'
              ? 'Письмо с кодом не ушло: почтовый сервис сейчас не отвечает. Попробуйте ещё раз через пару минут или напишите нам в поддержку — кнопка справа внизу.'
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
  redirect(svoyAdres(String(fd.get('next') ?? '')));
}

/**
 * Куда вернуть человека после входа.
 *
 * ⚠️ ОДНОГО «НАЧИНАЕТСЯ СО СЛЕША» МАЛО. Адрес `//chuzhoy.site`
 * начинается со слеша и при этом уводит НА ЧУЖОЙ ДОМЕН: браузер
 * читает его как «протокол текущий, узел чужой». То же делает
 * `/\chuzhoy.site` — обратную косую браузер нормализует в прямую.
 * Ссылку с таким `next` можно прислать письмом: человек входит
 * на нашем сайте и оказывается на чужом сразу после входа — на этом
 * и строится кража следующего шага.
 *
 * Поэтому ведущий слеш обязан быть РОВНО ОДИН. Схемы (`http:`)
 * при этом не проверяем: до первого слеша не осталось ни знака.
 */
function svoyAdres(kuda: string): string {
  const po = '/cabinet/';
  if (!kuda.startsWith('/')) return po;
  if (kuda.startsWith('//') || kuda.startsWith('/\\')) return po;
  return kuda;
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

  /* ⚠️ СЕРТИФИКАТ — ЭТО ПРИЗНАК ЗАКАЗА, А НЕ ОТДЕЛЬНЫЙ ТАРИФ (Р-93).
     Тариф и срок у него настоящие: цена берётся у них, и они же
     зашиваются в код. Участников покупатель не выбирает вовсе. */
  const kind = fd.get('gift') === '1' ? 'certificate' : 'plan';
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
    /* Метки читает ДЕЙСТВИЕ, а не страница: `cookies()` на лендинге
       перевёл бы первый экран на посчитанный ответ (закон 36). */
    utm: await utmIzKuki(),
    /* Промокод проверяется ЗАНОВО внутри транзакции заказа: ответ
       кнопки «Применить» был предварительным (Р-167). */
    promo: String(fd.get('promo') ?? ''),
    /* Галочка «Продлевать автоматически». Выключатель и вид заказа
       проверяет `sozdatZakaz` сам: поле правится в браузере. */
    avto: fd.get('avto') === 'on',
  });
  if (!itog.ok) return { oshibka: itog.pochemu };
  /* Заказ с кодом из промо-ссылки оформлен — кука больше не нужна:
     иначе на следующем оформлении форма применила бы тот же код снова
     и упёрлась бы в «уже использовали». Стирается ДО перенаправления:
     куки, поставленные действием, уезжают и с ним. */
  await steretPromoKuku(String(fd.get('promo') ?? ''));

  if (itog.kDoplate === 0) redirect(`/cabinet/?order=${itog.zakaz}`);
  const schet = await vystavitSchet(itog.zakaz, kto.userId);
  if (!schet.ok) return { oshibka: `${schet.pochemu} Заказ № ${itog.zakaz} сохранён и ждёт оплаты в кабинете.` };
  /* ⚠️ АДРЕС ОТДАЁТСЯ НАРУЖУ, А НЕ `redirect(schet.adres)`: уходить
     на чужой домен обязан сам браузер — см. `kuda` выше и Р-143. */
  return { kuda: schet.adres };
}

/**
 * ПРОВЕРКА ПРОМОКОДА на оформлении — по кнопке «Применить» (Р-167).
 *
 * ⚠️ ОТВЕТ ПРЕДВАРИТЕЛЬНЫЙ И В БАЗУ НЕ ПИШЕТ НИЧЕГО, кроме счётчика
 * неудач для предела частоты: активация тратится при оформлении.
 * Отдаётся ровно бит и процент — ни срока, ни остатка активаций:
 * перебором по этому ответу узнаётся только то, что узнаётся вводом
 * кода в поле. Скидку в рублях форма считает ТОЙ ЖЕ функцией
 * `skidkaKop` из `lib/promokod`, что и сервер.
 */
export type OtvetPromo = { kod: string; skidkaProc: number } | { oshibka: string };

export async function deystvieProveritPromo(vvod: string): Promise<OtvetPromo> {
  if (!bazaEst()) return { oshibka: NET_BAZY };
  const kto = await ktoKlient();
  if (!kto) return { oshibka: 'Сначала войдите по коду из письма.' };
  if (!kodPromo(vvod)) return { oshibka: otkazSlovami('net') };
  const itog = await proveritPromo(vvod, kto.userId);
  if (!itog.godit) return { oshibka: otkazSlovami(itog.pochemu) };
  return { kod: itog.kod, skidkaProc: itog.skidkaProc };
}

/**
 * ПОПОЛНЕНИЕ БАЛАНСА из кабинета (Р-168).
 *
 * ⚠️ СУММА ПРИХОДИТ В РУБЛЯХ ИЗ ФОРМЫ И ПРОВЕРЯЕТСЯ ЗДЕСЬ: поле
 * человек правит в браузере. Деньги на баланс кладёт не это действие,
 * а проверенное уведомление Робокассы (закон 34): отсюда уходит только
 * адрес платёжной формы, и браузер идёт туда сам (Р-143).
 */
export async function deystviePopolnit(_prosh: Otvet, fd: FormData): Promise<Otvet> {
  if (!bazaEst()) return { oshibka: NET_BAZY };
  const kto = await ktoKlient();
  if (!kto) return { oshibka: 'Сначала войдите по коду из письма.' };
  const syroe = String(fd.get('summa') ?? '').replace(/\s+/g, '').replace(',', '.');
  const rub = Number(syroe);
  if (!syroe || !Number.isFinite(rub) || !Number.isInteger(rub)) {
    return { oshibka: 'Укажите сумму целыми рублями.' };
  }
  const schet = await vystavitSchetPopolneniya(kto.userId, rub * 100);
  if (!schet.ok) return { oshibka: schet.pochemu };
  return { kuda: schet.adres };
}

/**
 * Доплатить по уже созданному заказу — из кабинета.
 *
 * ⚠️ ТОТ ЖЕ ПОРЯДОК, ЧТО У ОФОРМЛЕНИЯ: адрес платёжной формы уходит
 * наружу, а браузер идёт туда сам. Прежняя редакция делала
 * `redirect(schet.adres)` и ломала возврат назад ровно так же
 * (Р-143) — а из кабинета возвращаются чаще, чем из оформления.
 */
export async function deystvieOplatit(_prosh: Otvet, fd: FormData): Promise<Otvet> {
  const kto = await ktoKlient();
  if (!kto) return { oshibka: 'Сначала войдите по коду из письма.' };
  const zakaz = Number(fd.get('order') ?? 0);
  const schet = await vystavitSchet(zakaz, kto.userId);
  if (!schet.ok) return { oshibka: schet.pochemu };
  return { kuda: schet.adres };
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
  if (r) await otmenitZakaz(zakaz, 'Отменён покупателем до оплаты', null, 'obychno', 'klient');
  revalidatePath('/cabinet');
  redirect('/cabinet/');
}

/**
 * ОТКЛЮЧИТЬ АВТОПЛАТЁЖ из кабинета — одним нажатием, без подтверждения
 * (постановка: «Отключается одним нажатием»). Та же кнопка до первого
 * платежа зовётся «Не включать автоплатёж»: после неё «Оплатить»
 * выставляет счёт без `Recurring` (поправка money-8).
 *
 * ⚠️ РАБОТАЕТ ПРИ ЛЮБОМ ПОЛОЖЕНИИ ВЫКЛЮЧАТЕЛЯ (поправка money-7):
 * отказ от подписки закон велит принимать всегда. Владельца проверяет
 * `otklyuchitPodpisku` — номер подписки пришёл из скрытого поля.
 */
export async function deystvieOtklyuchitAvto(fd: FormData): Promise<void> {
  const kto = await ktoKlient();
  if (!kto) redirect('/cabinet/');
  const id = Number(fd.get('avto') ?? 0);
  if (Number.isInteger(id) && id > 0) await otklyuchitPodpisku(id, kto.userId, 'klient');
  revalidatePath('/cabinet');
  redirect('/cabinet/');
}

/**
 * ОТЗЫВ К ВЫПОЛНЕННОМУ ЗАКАЗУ (пятьдесят четвёртая итерация).
 *
 * ⚠️ ВСЕ ПРОВЕРКИ — В `ostavitOtzyv`, А НЕ ЗДЕСЬ И НЕ В ФОРМЕ: номер
 * заказа и галочка согласия приходят из браузера. Здесь только сессия:
 * отзыв оставляет вошедший, и заказ обязан быть его.
 *
 * ⚠️ ГЛАВНАЯ НЕ ПЕРЕСОБИРАЕТСЯ: отзыв клиента уходит на модерацию
 * и на сайте не виден, пока его не опубликует администратор, —
 * а уж тот зовёт `revalidatePath('/')` сам.
 */
export async function deystvieOtzyv(_prosh: Otvet, fd: FormData): Promise<Otvet> {
  if (!bazaEst()) return { oshibka: NET_BAZY };
  const kto = await ktoKlient();
  if (!kto) return { oshibka: 'Сессия закончилась — войдите снова по коду из письма.' };
  const itog = await ostavitOtzyv({
    userId: kto.userId,
    orderId: Number(fd.get('order') ?? 0),
    /* ⚠️ ПОЛЯ НАЗВАНЫ `otzyv_*`, А НЕ `imya`/`tekst`: `tekst` — поле
       формы поддержки, которая стоит в том же кабинете, и сторож
       находит её по имени. */
    imya: String(fd.get('otzyv_imya') ?? ''),
    tekst: String(fd.get('otzyv_tekst') ?? ''),
    soglasie: fd.get('soglasie_otzyv') === 'on',
  });
  if ('oshibka' in itog) return { oshibka: itog.oshibka };
  revalidatePath('/cabinet');
  return { ladno: 'otzyv' };
}

/* ── Сертификат ────────────────────────────────────────────────── */

export async function deystvieProveritKodSertifikata(_prosh: Otvet, fd: FormData): Promise<Otvet> {
  if (!bazaEst()) return { oshibka: NET_BAZY };
  const r = await nayti(String(fd.get('code') ?? ''));
  if (!r.ok) return { oshibka: POCHEMU_KOD[r.pochemu] };
  return { ladno: String(r.id), shag: 'vybor', dar: { chto: r.chto, mest: r.mest } };
}

/**
 * Активация.
 *
 * ⚠️ ТАРИФ, СРОК И ЧИСЛО УЧАСТНИКОВ БЕРУТСЯ ИЗ КОДА, А НЕ ИЗ ФОРМЫ
 * (Р-93). Форма говорит только, какой аккаунт заводить каждому:
 * поле `mest` в разметке человек правит в браузере за секунду.
 */
export async function deystvieAktivirovat(_prosh: Otvet, fd: FormData): Promise<Otvet> {
  if (!bazaEst()) return { oshibka: NET_BAZY };
  const kto = await ktoKlient();
  if (!kto) return { oshibka: 'Сначала войдите по коду из письма.' };
  const r = await nayti(String(fd.get('code') ?? ''));
  if (!r.ok) return { oshibka: POCHEMU_KOD[r.pochemu] };

  const uchastniki: VvodUchastnika[] = [];
  for (let i = 0; i < r.mest; i++) {
    const mode = String(fd.get(`mode${i}`) ?? 'new') === 'renew' ? 'renew' : 'new';
    const login = String(fd.get(`login${i}`) ?? '').trim();
    const password = String(fd.get(`password${i}`) ?? '');
    if (mode === 'renew' && (!login || !password)) {
      return {
        oshibka:
          r.mest > 1
            ? `Участник ${i + 1}: для продления укажите почту и пароль своего аккаунта Spotify.`
            : 'Для продления укажите почту и пароль своего аккаунта Spotify.',
        shag: 'vybor',
        ladno: String(r.id),
        dar: { chto: r.chto, mest: r.mest },
      };
    }
    uchastniki.push({ mode, login, password });
  }
  if (fd.get('consent') !== 'on') {
    return {
      oshibka: 'Нужно согласие на обработку персональных данных.',
      shag: 'vybor',
      ladno: String(r.id),
      dar: { chto: r.chto, mest: r.mest },
    };
  }

  const zakaz = await zakazPoSertifikatu({
    userId: kto.userId,
    planId: r.planId,
    period: r.period,
    certificateId: r.id,
    uchastniki,
    utm: await utmIzKuki(),
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
    `select p.amount_kop from payment p left join shop_order o on o.id = p.order_id
      where p.id = $1 and coalesce(o.user_id, p.user_id) = $2 and p.status = 'new'`,
    [platyozh, kto.userId],
  );
  if (p) {
    const { otmetitOplachennym } = await import('./orders');
    await otmetitOplachennym(platyozh, Number(p.amount_kop));
  }
  revalidatePath('/cabinet');
  redirect('/cabinet/');
}

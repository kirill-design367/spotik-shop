import '../shop.css';
import PodderzhkaForma from '@/components/shop/PodderzhkaForma';
import type { Metadata } from 'next';
import LoginBox from '@/components/shop/LoginBox';
import KabinetZhivoy from '@/components/shop/KabinetZhivoy';
import Kopirovat from '@/components/shop/Kopirovat';
import Svorachivanie from '@/components/shop/Svorachivanie';
import { ktoKlient } from '@/lib/server/auth';
import { balans, moiZakazy } from '@/lib/server/views';
import { moiSertifikaty } from '@/lib/server/certificates';
import { bazaEst } from '@/lib/server/db';
import { otpechatokKabineta } from '@/lib/server/otpechatok';
import { rubli } from '@/lib/server/money';
import { deystvieOplatit, deystvieOtmenitSvoy, deystvieVyyti } from '@/lib/server/actions-client';
import type { Status } from '@/lib/server/orders';

export const metadata: Metadata = { title: 'Личный кабинет — Spotik Shop', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const ZNACHOK: Record<Status, string> = {
  new: 'badge',
  paid: 'badge badge--paid',
  in_work: 'badge badge--work',
  done: 'badge badge--done',
  cancelled: 'badge badge--cancel',
};

/**
 * ШКАЛА СТАТУСОВ: оплачен → в работе → готово.
 *
 * ⚠️ ТРИ ШАГА, А НЕ ПЯТЬ. Статусов в базе пять, но «новый» — это ещё
 * не заказ в работе (он ждёт оплаты, и вместо шкалы там кнопка
 * «Оплатить»), а «отменён» — не шаг пути, а его конец. Шкала рисуется
 * только у тех, кто по пути идёт.
 */
const SHAGI: [Status, string][] = [
  ['paid', 'Оплачен'],
  ['in_work', 'В работе'],
  ['done', 'Готово'],
];
const PORYADOK: Record<Status, number> = { new: -1, paid: 0, in_work: 1, done: 2, cancelled: -1 };

/** Сколько дней осталось до даты, с точностью до суток. */
function dneyDo(kogda: Date): number {
  return Math.ceil((kogda.getTime() - Date.now()) / 86_400_000);
}

function dniSlovami(n: number): string {
  const s = Math.abs(n) % 100;
  const e = s % 10;
  if (s > 10 && s < 20) return 'дней';
  if (e === 1) return 'день';
  if (e >= 2 && e <= 4) return 'дня';
  return 'дней';
}

/**
 * ЛИЧНЫЙ КАБИНЕТ.
 *
 * Четыре вещи из постановки и ничего сверх: заказы со статусами,
 * выданные логины и пароли по готовым заказам, баланс, сертификаты
 * с кодами.
 *
 * ⚠️ ВЫДАННЫЕ ДОСТУПЫ ЛЕЖАТ ЗДЕСЬ, А НЕ В ПИСЬМЕ. Письмо остаётся
 * в ящике навсегда и по пути не шифруется; кабинет закрыт сессией
 * и одноразовым кодом.
 */
export default async function Cabinet({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  /* ⚠️ ОТКАЗ В ОПЛАТЕ ОБЯЗАН БЫТЬ ВИДЕН. Пока ключей Робокассы нет,
     кнопка «Оплатить» возвращает человека сюда, и без этой строки
     он видел бы только тот же кабинет — как будто нажатие
     не сработало. */
  const neOplatili = (Array.isArray(sp.error) ? sp.error[0] : sp.error) === 'pay';
  if (!bazaEst()) {
    return (
      <main id="main" className="page" tabIndex={-1}>
        <h1 className="page__h">Личный кабинет</h1>
        <p className="err">Сервис временно недоступен. Попробуйте чуть позже.</p>
        <a className="page__back" href="/">← На главную</a>
      </main>
    );
  }
  const kto = await ktoKlient();
  if (!kto) {
    return (
      <main id="main" className="page" tabIndex={-1}>
        <a className="page__back" href="/">← На главную</a>
        <h1 className="page__h">Личный кабинет</h1>
        <p className="page__lead">Здесь лежат ваши заказы, доступы, баланс и сертификаты.</p>
        <LoginBox next="/cabinet/" />
      </main>
    );
  }

  const [zakazy, sert, bal] = await Promise.all([
    moiZakazy(kto.userId),
    moiSertifikaty(kto.userId),
    balans(kto.userId),
  ]);

  return (
    <main id="main" className="page" tabIndex={-1}>
      <a className="page__back" href="/">← На главную</a>
      <h1 className="page__h">Личный кабинет</h1>

      {neOplatili && (
        <p className="err">
          Оплата картой ещё не подключена: магазин Робокассы не настроен. Заказ сохранён
          и ждёт оплаты здесь же.
        </p>
      )}

      {/* ── ШАПКА КАБИНЕТА: ПОЧТА И ВЫХОД ────────────────────────────────
          Почту можно скопировать в один тап: это тот адрес, на который
          придут письма и по которому человек входит, и диктовать его
          по памяти он не обязан. */}
      <div className="cab__top">
        <span className="cab__mail">{kto.email}</span>
        <Kopirovat chto={kto.email} chego="почту" />
        <form action={deystvieVyyti}>
          <button type="submit" className="btn btn--ghost btn--sm">Выйти</button>
        </form>
      </div>

      {/* Кабинет обновляется сам: опрос отпечатка раз в пятнадцать
          секунд и `router.refresh()` на изменение. Сам компонент
          рисует только две строки — «сессия кончилась» и «доступы
          выданы»; всё остальное по-прежнему рисует сервер. */}
      <KabinetZhivoy nachalo={await otpechatokKabineta(kto.userId)} />

      {/* ⚠️ БАЛАНС — СВОЯ КАРТОЧКА, А НЕ СТРОКА В ШАПКЕ (постановка
          тридцать шестой итерации). Появляется он одним способом —
          возвратом за отменённый заказ, — и человеку надо видеть,
          что деньги не пропали, а лежат и тратятся при следующем
          оформлении. Нулевой баланс не показываем вовсе: пустая
          строка «0 ₽» только пугает. */}
      {bal > 0 ? (
        <div className="panel cab__balans">
          <div>
            <span className="panel__h" style={{ margin: 0, display: 'block' }}>Баланс</span>
            <p className="panel__note" style={{ marginTop: 4 }}>
              Спишется при следующем оформлении — галочкой в «К оплате».
            </p>
          </div>
          <span className="cab__balance tnum">{rubli(bal)}</span>
        </div>
      ) : null}

      <h2 className="cab__h2">Заказы</h2>
      {!zakazy.length ? (
        /* ⚠️ ПУСТОЕ СОСТОЯНИЕ — НЕ СТРОКА «ЗАКАЗОВ НЕТ», а приглашение:
           человек, впервые вошедший в кабинет, обязан понять, что
           делать дальше. */
        <div className="panel cab__pusto">
          <p className="cab__pusto-h">Пока пусто — и это нормально</p>
          <p className="panel__note" style={{ marginTop: 0 }}>
            Выберите тариф и срок, оплатите картой или через СБП — доступ появится
            здесь. Обычно это 5–10 минут в рабочее время, с 10:00 до 22:00 по Москве.
          </p>
          <div className="cab__pusto-knopki">
            <a className="btn" href="/#pricing">Выбрать тариф</a>
            <a className="btn btn--ghost" href="/certificate/">Активировать сертификат</a>
          </div>
        </div>
      ) : (
        zakazy.map((z) => {
          const shag = PORYADOK[z.status];
          const ostalos = z.konchaetsya ? dneyDo(z.konchaetsya) : null;
          return (
            /* Карточка схлопывается, когда покупатель отменяет заказ:
               серверное действие следом перерисует кабинет уже без неё. */
            <Svorachivanie key={z.id}>
              <article className="order-card">
                <div className="order-card__head">
                  <div>
                    {/* ⚠️ НОМЕРА ЗАКАЗА ЗДЕСЬ НЕТ И НЕ БУДЕТ (постановка
                        тридцать шестой итерации): клиенту он не нужен
                        ни для чего, а в поддержке заказ находят
                        по почте. Номер остался в админке и в чате. */}
                    <div className="order-card__name">
                      {z.nazvanie} · {z.srok}
                      {z.poSertifikatu ? ' · по сертификату' : ''}
                    </div>
                    <div className="order-card__id">{z.sozdan.toLocaleDateString('ru-RU')}</div>
                  </div>
                  <span className={ZNACHOK[z.status]}>{z.statusSlovami}</span>
                </div>

                {/* ШКАЛА: где заказ сейчас. Рисуется, только пока он идёт
                    по пути, — у неоплаченного и отменённого шага нет. */}
                {shag >= 0 ? (
                  <ol className="shkala" aria-label="Что происходит с заказом">
                    {SHAGI.map(([k, t], i) => (
                      <li key={k} className="shkala__sh" data-on={i <= shag ? '' : undefined}>
                        <span className="shkala__tochka" aria-hidden="true" />
                        <span className="shkala__t">{t}</span>
                      </li>
                    ))}
                  </ol>
                ) : null}

                {z.status === 'new' && z.kDoplate > 0 ? (
                  <div className="order-card__knopki">
                    <form action={deystvieOplatit}>
                      <input type="hidden" name="order" value={z.id} />
                      <button type="submit" className="btn btn--sm">Оплатить {rubli(z.kDoplate)}</button>
                    </form>
                    {/* ⚠️ ПРИЗНАК `data-otmena` ЛОВИТ ОБЁРТКА: по нему
                        карточка схлопывается. Без него отмена сработает
                        всё равно — просто без плавного ухода. */}
                    <form action={deystvieOtmenitSvoy} data-otmena="">
                      <input type="hidden" name="order" value={z.id} />
                      <button type="submit" className="btn btn--ghost btn--sm">Отменить</button>
                    </form>
                  </div>
                ) : null}

                {/* ⚠️ ПРИЧИНА ОТМЕНЫ ОСТАЁТСЯ ТОЛЬКО У ОТМЕНЫ ОПЕРАТОРОМ.
                    Отменённые самим покупателем сюда не доходят вовсе —
                    их не отдаёт `moiZakazy`. */}
                {z.status === 'cancelled' ? (
                  <p className="panel__note">
                    {z.prichinaOtmeny ? `Причина: ${z.prichinaOtmeny} ` : ''}
                    Деньги за заказ лежат на балансе — спишутся при следующем оформлении.
                  </p>
                ) : null}

                {/* ДАТА ОКОНЧАНИЯ И ОСТАТОК ДНЕЙ. Кнопка «Продлить»
                    открывает оформление уже заполненным: тот же тариф,
                    тот же срок, режим «продлить существующий» и почта
                    аккаунта — её страница читает по номеру заказа сама
                    (закон 44). */}
                {z.konchaetsya && z.status === 'done' ? (
                  <div className="srok">
                    <p className="srok__t">
                      Доступ действует до {z.konchaetsya.toLocaleDateString('ru-RU')}
                      {ostalos !== null && ostalos > 0
                        ? ` — осталось ${ostalos} ${dniSlovami(ostalos)}`
                        : ''}
                      .
                    </p>
                    <a
                      className="btn btn--sm"
                      href={`/checkout/?plan=${encodeURIComponent(z.planId)}&period=${z.period}&renew=${z.id}&mode=renew`}
                    >
                      Продлить
                    </a>
                  </div>
                ) : null}

                {/* ⚠️ ЧТО ПОКАЗАНО ПО НОВОМУ АККАУНТУ — ПОЧТА, А НЕ ЛОГИН
                    С ПАРОЛЕМ. С тридцать четвёртой итерации аккаунт заводит
                    оператор на данные КЛИЕНТА: выдавать нечего, доступ
                    у человека с самого начала, и единственное, что ему
                    нужно знать, — на какую почту включили Premium.
                    ⚠️ СТАРЫЕ ЗАКАЗЫ НЕ ТРОНУТЫ: там, где оператор доступы
                    ВЫДАВАЛ, они по-прежнему видны строкой ниже. */}
                {z.status === 'done' && z.slots.some((s) => s.pochta && !s.login) ? (
                  <div className="creds">
                    {z.slots
                      .filter((s) => s.pochta && !s.login)
                      .map((s) => (
                        <div key={s.idx} className="cred">
                          {z.slots.length > 1 ? <span className="cred__k">Аккаунт {s.idx + 1}</span> : null}
                          <span className="cred__k">
                            {s.mode === 'new' ? 'Premium включён на почте' : 'Premium продлён на почте'}
                          </span>
                          <span className="cred__stroka">
                            <b>{s.pochta}</b>
                            <Kopirovat chto={s.pochta!} chego="почту аккаунта" />
                          </span>
                        </div>
                      ))}
                  </div>
                ) : null}

                {/* Выданные доступы: только там, где оператор их завёл. */}
                {z.slots.some((s) => s.login) ? (
                  <div className="creds">
                    {z.slots
                      .filter((s) => s.login)
                      .map((s) => (
                        <div key={s.idx} className="cred">
                          {z.slots.length > 1 ? <span className="cred__k">Аккаунт {s.idx + 1}</span> : null}
                          <span className="cred__k">Логин</span>
                          <b>{s.login}</b>
                          {s.mailPass ? (
                            <>
                              <span className="cred__k">Пароль от почты</span>
                              <b>{s.mailPass}</b>
                            </>
                          ) : null}
                          {s.spotifyPass ? (
                            <>
                              <span className="cred__k">Пароль Spotify</span>
                              <b>{s.spotifyPass}</b>
                            </>
                          ) : null}
                        </div>
                      ))}
                  </div>
                ) : null}

                {z.sekretyStyorty && z.status === 'done' ? (
                  <p className="panel__note">
                    Доступы стёрты с сервера через семь дней после закрытия заказа — так надёжнее.
                    Если вы их не сохранили, напишите нам.
                  </p>
                ) : null}
              </article>
            </Svorachivanie>
          );
        })
      )}

      <h2 className="cab__h2">Сертификаты</h2>
      {/* Активация живёт и здесь: человек, которому подарили код, чаще
          всего уже вошёл в кабинет. */}
      <div className="cab__sert-verh">
        <a className="btn btn--ghost btn--sm" href="/certificate/">Активировать сертификат</a>
        <a className="btn btn--ghost btn--sm" href="/sertifikaty/">Подарить сертификат</a>
      </div>
      {!sert.length ? (
        <p className="empty">Своих сертификатов пока нет.</p>
      ) : (
        /* ⚠️ ТАРИФ И СРОК ВИДНЫ РЯДОМ С КОДОМ (Р-93): сертификатов
           у человека может быть несколько и на разные тарифы,
           а по одному коду их не различить. */
        sert.map((s) => (
          <div key={s.id} className={s.ispolzovan ? 'cert cert--used' : 'cert'}>
            <span className="cert__stroka">
              <span className="cert__code">{s.kod ?? `…${s.tail}`}</span>
              {s.kod && !s.ispolzovan ? <Kopirovat chto={s.kod} chego="код сертификата" /> : null}
            </span>
            <span className="cert__meta">
              {s.chto}
              {' · '}
              {s.ispolzovan
                ? 'активирован'
                : `действует до ${s.srokDo.toLocaleDateString('ru-RU')}`}
            </span>
          </div>
        ))
      )}

      {/* ⚠️ БЛОК «НУЖНА ПОМОЩЬ?» — ТА ЖЕ ФОРМА, ЧТО В ПЛАШКЕ, и это
          один компонент, а не два: два разошлись бы на первой правке.
          Здесь она стоит В ПОТОКЕ, а не накладкой: человек пришёл
          в кабинет с вопросом по своему заказу, и открывать ради
          этого окно поверх экрана незачем. Почта аккаунта известна
          странице, поэтому подставляется сразу. */}
      <h2 className="cab__h2">Нужна помощь?</h2>
      <div className="panel pd__pomoshch">
        <p className="panel__note" style={{ marginTop: 0 }}>
          Напишите, что случилось, — ответим в рабочее время, с 10:00 до 22:00 по Москве.
        </p>
        <PodderzhkaForma pochta={kto.email} />
      </div>
    </main>
  );
}

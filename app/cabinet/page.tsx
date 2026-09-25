import '../shop.css';
import PodderzhkaForma from '@/components/shop/PodderzhkaForma';
import type { Metadata } from 'next';
import LoginBox from '@/components/shop/LoginBox';
import KabinetZhivoy from '@/components/shop/KabinetZhivoy';
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

      <div className="cab__top">
        <span className="cab__mail">{kto.email}</span>
        <span className="cab__balance tnum">Баланс: {rubli(bal)}</span>
        <form action={deystvieVyyti}>
          <button type="submit" className="btn btn--ghost btn--sm">Выйти</button>
        </form>
      </div>

      {/* Кабинет обновляется сам: опрос отпечатка раз в пятнадцать
          секунд и `router.refresh()` на изменение. Сам компонент
          рисует только две строки — «сессия кончилась» и «доступы
          выданы»; всё остальное по-прежнему рисует сервер. */}
      <KabinetZhivoy nachalo={await otpechatokKabineta(kto.userId)} />

      <h2 className="panel__h">Заказы</h2>
      {!zakazy.length ? (
        <p className="empty">Заказов пока нет. <a href="/">Выбрать тариф</a></p>
      ) : (
        zakazy.map((z) => (
          <article key={z.id} className="order-card">
            <div className="order-card__head">
              <div>
                <div className="order-card__id">Заказ № {z.id} · {z.sozdan.toLocaleDateString('ru-RU')}</div>
                <div className="order-card__name">
                  {z.nazvanie} · {z.srok}
                  {z.poSertifikatu ? ' · по сертификату' : ''}
                </div>
              </div>
              <span className={ZNACHOK[z.status]}>{z.statusSlovami}</span>
            </div>

            {z.status === 'new' && z.kDoplate > 0 ? (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
                <form action={deystvieOplatit}>
                  <input type="hidden" name="order" value={z.id} />
                  <button type="submit" className="btn btn--sm">Оплатить {rubli(z.kDoplate)}</button>
                </form>
                <form action={deystvieOtmenitSvoy}>
                  <input type="hidden" name="order" value={z.id} />
                  <button type="submit" className="btn btn--ghost btn--sm">Отменить</button>
                </form>
              </div>
            ) : null}

            {z.status === 'cancelled' && z.prichinaOtmeny ? (
              <p className="panel__note">Причина: {z.prichinaOtmeny}</p>
            ) : null}

            {/* ⚠️ ДАТА ОКОНЧАНИЯ — ПРОСТАЯ СТРОКА, и это постановка:
                «в кабинете показать дату окончания обычной строкой,
                оформление придёт следующей задачей». Стоит она только
                у закрытых заказов: пока доступ не выдан, кончаться
                нечему. */}
            {z.konchaetsya && z.status === 'done' ? (
              <p className="panel__note">
                Доступ действует до {z.konchaetsya.toLocaleDateString('ru-RU')}. За три дня
                до конца пришлём письмо со ссылкой на продление.
              </p>
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
                      <b>{s.pochta}</b>
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
        ))
      )}

      <h2 className="panel__h" style={{ marginTop: 40 }}>Сертификаты</h2>
      {!sert.length ? (
        <p className="empty">Сертификатов нет.</p>
      ) : (
        /* ⚠️ ТАРИФ И СРОК ВИДНЫ РЯДОМ С КОДОМ (Р-93): сертификатов
           у человека может быть несколько и на разные тарифы,
           а по одному коду их не различить. */
        sert.map((s) => (
          <div key={s.id} className={s.ispolzovan ? 'cert cert--used' : 'cert'}>
            <span className="cert__code">{s.kod ?? `…${s.tail}`}</span>
            <span className="cert__meta">
              {s.chto}
              {' · '}
              {s.ispolzovan
                ? 'активирован'
                : `действует до ${s.srokDo.toLocaleDateString('ru-RU')} · активировать: spotik.shop/certificate/`}
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
      <h2 className="panel__h" style={{ marginTop: 40 }}>Нужна помощь?</h2>
      <div className="panel pd__pomoshch">
        <p className="panel__note" style={{ marginTop: 0 }}>
          Напишите, что случилось, — ответим в рабочее время, с 10:00 до 22:00 по Москве.
        </p>
        <PodderzhkaForma pochta={kto.email} />
      </div>
    </main>
  );
}

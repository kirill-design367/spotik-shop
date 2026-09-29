'use client';

import { useActionState, useEffect, useState } from 'react';
import type { StrokaOcheredi } from '@/lib/server/views';
import { adminSetQueueRate, adminTake, type OtvetA } from '@/lib/server/actions-admin';
import { CHASTOTY_OCHEREDI } from '@/lib/admin/chastoty';
import { slovar, type Yazyk } from '@/lib/admin/slova';
import { imyaTarifaIz, srokKratkoDlyaSotrudnika, type ImenaTarifov } from '@/lib/plans';
import { poMoskve } from '@/lib/admin/vremya';

/**
 * Очередь заказов, которая обновляется сама.
 *
 * ⚠️ ОПРОС, А НЕ ПОТОК СОБЫТИЙ, и это выбор. Приложение на сервере
 * одно, операторов единицы, а поток событий держит открытым
 * соединение на каждого и требует своего пути через nginx. Опрос
 * стоит одного запроса и одной строки кода.
 *
 * ⚠️ ЧАСТОТУ ВЫБИРАЕТ САМ ОПЕРАТОР, И ВЫБОР ЖИВЁТ ЗА НИМ. Набор
 * взят из админки Нейролавки — выкл, 10 с, 30 с, 1 мин, 5 мин, —
 * потому что постановка прямо велела посмотреть, как сделано там.
 * Хранение другое: там кука (у панели нет ни строки скриптов, и это
 * настройка вида на этом браузере), у нас строка сотрудника —
 * то же правило, что у языка (Р-96).
 *
 * ⚠️ ОБНОВЛЯЕТСЯ ТОЛЬКО ВИДИМАЯ ВКЛАДКА. Оператор держит админку
 * открытой весь день; фоновая вкладка опрашивала бы сервер зря.
 */
export default function Queue({
  rows,
  y,
  sek,
  imena,
  admin,
}: {
  rows: StrokaOcheredi[];
  y: Yazyk;
  /** Частота опроса в секундах; 0 — выключено. */
  sek: number;
  /**
   * Названия тарифов, заданные в админке.
   *
   * ⚠️ ЕДУТ ПРОПОМ, А НЕ ЧИТАЮТСЯ ЗДЕСЬ. Очередь обновляется сама,
   * то есть это клиентский компонент, а имена лежат в базе: серверный
   * модуль сюда не протащить. Карта снимается один раз на странице
   * и дальше не меняется — цены и названия правит администратор,
   * и его правка доезжает перезагрузкой раздела.
   */
  imena: ImenaTarifov;
  /**
   * Показывать ли колонку с почтой сотрудника.
   *
   * ⚠️ РАЗМЕТКА ЗДЕСЬ БОЛЬШЕ НИЧЕГО НЕ ПРЯЧЕТ: с сорок шестой
   * итерации `operator` приходит `null` всем, кроме администратора,
   * а заказы, взятые другим, оператору не приходят вовсе. Колонка
   * поэтому просто не рисуется там, где рисовать в ней нечего.
   * (Прежнее исключение — «почта держателя ездит всем с двадцать
   * седьмой итерации» — отменено постановкой: «Подписи „взял:
   * {почта}" у оператора нет нигде».)
   */
  admin: boolean;
}) {
  const t = slovar(y);
  const [spisok, setSpisok] = useState(rows);
  const [live, setLive] = useState(true);

  const [rt, setRate] = useActionState<OtvetA, FormData>(adminSetQueueRate, {});

  const chastotaSlovami = (n: number) =>
    n === 0 ? t('q.rate_off') : n < 60 ? t('q.rate_sec', { n }) : t('q.rate_min', { n: n / 60 });

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const r = await fetch('/api/admin/queue/', { cache: 'no-store' });
        if (!r.ok) throw new Error(String(r.status));
        const d = (await r.json()) as { rows: StrokaOcheredi[] };
        if (!stop) {
          setSpisok(d.rows);
          setLive(true);
        }
      } catch {
        if (!stop) setLive(false);
      }
    };
    /* Ноль — «выключено»: ни таймера, ни подписки на видимость.
       Оператор всё ещё может обновить страницу руками. */
    if (sek <= 0) return;
    const id = setInterval(tick, sek * 1000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      stop = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [sek]);

  const vybor = (
    <form action={setRate} className="ad__rate">
      <span className="hint">{t('q.rate')}:</span>
      {rt.error ? <span className="err">{t(rt.error)}</span> : null}
      {CHASTOTY_OCHEREDI.map((n) =>
        n === sek ? (
          <b key={n}>{chastotaSlovami(n)}</b>
        ) : (
          <button key={n} type="submit" name="sec" value={n} className="ad__rate-btn">
            {chastotaSlovami(n)}
          </button>
        ),
      )}
    </form>
  );

  if (!spisok.length)
    return (
      <>
        {vybor}
        <p className="hint">{t('q.empty')}</p>
      </>
    );

  return (
    <>
      {vybor}
      <p className="ad__live">{sek <= 0 ? t('q.rate_off') : live ? t('q.live') : t('q.lost')}</p>
      <div className="ad__scroll">
        <table>
          <thead>
            <tr>
              <th>{t('t.num')}</th>
              <th>{t('t.plan')}</th>
              <th>{t('t.accounts')}</th>
              <th>{t('t.term')}</th>
              <th>{t('t.paid')}</th>
              <th>{t('t.state')}</th>
              {admin ? <th>{t('t.staff')}</th> : null}
              <th />
            </tr>
          </thead>
          <tbody>
            {spisok.map((r) => (
              <tr key={r.id} data-mine={r.moy ? '' : undefined}>
                <td>
                  <a href={`/admin/orders/${r.id}/`}>{r.id}</a>
                </td>
                <td>
                  {/* ⚠️ НАЗВАНИЕ ТАРИФА — НАДПИСЬ, А НЕ ДАННЫЕ: в английской
                      админке оно тоже английское (закон 40 с тридцать
                      девятой итерации). Сервер отдаёт `planId`, переводит
                      страница — как любой другой ключ. */}
                  {imyaTarifaIz(imena, r.planId, y === 'en')}
                  {/* ⚠️ ПОМЕТКА «ПОДАРОЧНЫЙ» ОБЯЗАТЕЛЬНА (Р-93): такой заказ
                      оплачен ЗАРАНЕЕ, покупателем сертификата, и денег
                      за ним не числится вовсе. Без пометки оператор
                      читает нулевую сумму как поломку. */}
                  {r.bySertificate ? <span className="ad__tag ad__tag--gift">{t('q.gift')}</span> : null}
                </td>
                <td>{r.people}</td>
                <td>{srokKratkoDlyaSotrudnika(r.period, y === 'en')}</td>
                <td className="tnum">{r.paidAt ? poMoskve(r.paidAt, y === 'en') : '—'}</td>
                <td>
                  {r.status === 'paid' ? (
                    <span className="ad__tag ad__tag--paid">{t('q.new')}</span>
                  ) : (
                    <span className="ad__tag ad__tag--work">
                      {/* ⚠️ «ВАШ ИЛИ ЧУЖОЙ» РЕШАЕТ СЕРВЕР, А НЕ СЛИЧЕНИЕ
                          ПОЧТ: у оператора почты держателя нет вовсе,
                          и сличать было бы нечего. Ветка с чужой почтой
                          достаётся только администратору — оператору
                          такие строки не приходят. */}
                      {r.moy ? t('q.yours') : t('q.taken', { kto: r.operator ?? '—' })}
                    </span>
                  )}
                </td>
                {/* ⚠️ «КТО ВЗЯЛ» — ЭТО ТЕКУЩИЙ ДЕРЖАТЕЛЬ, и берётся он
                    из строки заказа: у заказа В РАБОТЕ это один и тот же
                    человек. У непринятого держателя нет вовсе, и клетка
                    честно пустая (постановка, пункт 6). */}
                {admin ? <td>{r.operator ?? '—'}</td> : null}
                <td>
                  {r.status === 'paid' ? (
                    <form action={adminTake}>
                      <input type="hidden" name="order" value={r.id} />
                      <button type="submit" className="btn btn--sm">{t('q.take')}</button>
                    </form>
                  ) : (
                    <a className="btn btn--ghost btn--sm" href={`/admin/orders/${r.id}/`}>{t('q.open')}</a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

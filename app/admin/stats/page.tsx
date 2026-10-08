import { redirect } from 'next/navigation';
import UtmGen from '@/components/admin/UtmGen';
import { env } from '@/lib/server/env';
import { ktoSotrudnik } from '@/lib/server/auth';
import { bazaEst } from '@/lib/server/db';
import { BYSTRYE, ponyatPeriod, svodka, type TarifSotrudnika } from '@/lib/server/stats';
import { rubli } from '@/lib/server/money';
import { yazykSotrudnika } from '@/lib/server/yazyk';
import { slovar, type Klyuch } from '@/lib/admin/slova';
import { imyaTarifaIz, srokKratkoDlyaSotrudnika } from '@/lib/plans';
import { imenaTarifov } from '@/lib/server/imena';

export const dynamic = 'force-dynamic';

/**
 * СТАТИСТИКА.
 *
 * ⚠️ С СОРОК ВТОРОЙ ИТЕРАЦИИ ОНА ОТКРЫТА И ИСПОЛНИТЕЛЮ — постановка:
 * «Дать сотруднику доступ к статистике продаж — в том же виде, что
 * у администратора». Прежняя проверка роли снята; «в том же виде»
 * взято буквально, поэтому генератор ссылок с метками остался тоже.
 *
 * ⚠️ А С СОРОК ШЕСТОЙ ИТЕРАЦИИ ВЫРУЧКИ ЗДЕСЬ У НЕГО НЕТ ТОЖЕ, и это
 * прямая постановка: «У оператора убери всё про деньги и рекламу…
 * Убирай на сервере: данные о деньгах не должны уходить оператору
 * вообще, а не прятаться разметкой». То есть «в том же виде»
 * из сорок второй итерации сузилось: раздел по-прежнему открыт
 * обеим ролям, но деньги и генератор рекламных ссылок в нём —
 * администраторские.
 *
 * ⚠️ А С СОРОК ДЕВЯТОЙ ОПЕРАТОР ВИДИТ ЗДЕСЬ ТОЛЬКО СЕБЯ: «только его
 * выполненные заказы за выбранный период — по почте, с которой он
 * вошёл: общее число и разбивку „По тарифам и срокам". Общих цифр
 * по всему сервису у него нет… Отбор — на сервере». Раздел открыт
 * обеим ролям по-прежнему, но у оператора это его личный отчёт,
 * а не отчёт сервиса (Р-159).
 *
 * ⚠️ ЧИСЛА НЕТ — ЗНАЧИТ НЕТ И СТРОКИ. Сервер отдаёт `null` вместо
 * суммы (`lib/server/stats.ts`), и страница рисует строку выручки
 * только там, где число пришло: спрячь мы её стилем — сумма всё
 * равно лежала бы в разметке (то же, что с деньгами заказа, Р-148).
 *
 * ⚠️ ПЕРИОД ОДИН НА ВЕСЬ ЭКРАН, И ОН НАПИСАН. Прежде первая таблица
 * показывала сутки, неделю и месяц сразу, а таблицы тарифов
 * и источников молча считались за 30 суток: два разных периода
 * на одной странице, и второй не был назван нигде.
 *
 * ⚠️ ВСЕ ЦИФРЫ ИЗ БАЗЫ (см. lib/server/stats.ts). Красота тут
 * вторична по постановке, поэтому раздел — это таблицы и ничего
 * больше: ни графиков, ни своих стилей сверх тех, что уже есть
 * в админке.
 */
export default async function AdminStats({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const s = await ktoSotrudnik();
  const y = await yazykSotrudnika(s);
  const t = slovar(y);
  const adres = env.siteUrl;
  if (!bazaEst()) return <p className="err">{t('o.no_db')}</p>;
  if (!s) redirect('/admin/login/');

  const sp = await searchParams;
  const odin = (k: string) => (Array.isArray(sp[k]) ? (sp[k]?.[0] ?? '') : (sp[k] ?? ''));
  const period = ponyatPeriod(odin('p'), odin('ot'), odin('do'));

  /* ⚠️ БЛОК ПО СОТРУДНИКАМ — ТОЛЬКО АДМИНИСТРАТОРУ (постановка,
     пункт 5), и признак едет в ВЫБОРКУ: чужие почты исполнителю
     не отдаются вовсе, а не прячутся разметкой (Р-148). Сам раздел
     статистики при этом открыт обеим ролям с сорок второй итерации
     (Р-147) — это разные вещи. */
  const admin = s.role === 'admin';
  /* ⚠️ КТО СПРАШИВАЕТ, ЕДЕТ В ВЫБОРКУ ЦЕЛИКОМ (сорок девятая итерация,
     пункт 4): оператору сервер отдаёт только его выполненные заказы,
     а общих цифр по сервису не считает вовсе. */
  const [d, imena] = await Promise.all([svodka(period, { admin, staffId: s.id }), imenaTarifov()]);
  const imyaPerioda: Record<string, Klyuch> = { day: 'ss.day', week: 'ss.week', month: 'ss.month' };
  const vremya = (min: number) => t('ss.hm', { h: Math.floor(min / 60), m: min % 60 });
  const vybran = period.vid === 'daty' ? '' : period.vid;
  const en = y === 'en';
  /* ⚠️ РАЗБИВКА ПО ТАРИФАМ И СРОКАМ — ОДНО МЕСТО НА ОБЕ КОЛОНКИ
     (пятидесятая итерация): «Индивидуальный — 14 (1 мес — 12 шт,
     3 мес — 2 шт) · На двоих — 3 (1 мес — 3 шт)», и «тот же формат —
     в колонке „Отменил по тарифам"». Собери её дважды — и колонки
     разошлись бы видом на первой же правке.
     Название тарифа и срок — надписи, в английской админке они
     английские (закон 40, Р-139); «шт» тоже надпись и живёт
     в словаре. */
  const razbivka = (spisok: TarifSotrudnika[]) =>
    spisok
      .map(
        (x) =>
          `${imyaTarifaIz(imena, x.planId, en)} — ${x.zakazov} (${x.sroki
            .map((r) => t('ss.srok_n', { srok: srokKratkoDlyaSotrudnika(r.period, en), n: r.zakazov }))
            .join(', ')})`,
      )
      .join(' · ');

  return (
    <>
      <h1>{t('ss.h')}</h1>

      {/* ── ВЫБОР ПЕРИОДА ─────────────────────────────────────────
          ⚠️ БЫСТРЫЕ ПЕРИОДЫ — ССЫЛКИ, А НЕ КНОПКИ ФОРМЫ, и это даёт
          адрес, который можно сохранить и переслать. Даты — обычная
          форма GET по той же причине.
          ⚠️ ФОРМА `method="get"` БЕЗ `action`: она отправляет на ЭТУ
          же страницу и стирает `p` из адреса сама — иначе выбранные
          даты спорили бы с оставшимся быстрым периодом, и какой
          из двух прав, решал бы порядок разбора. */}
      <div className="ad__card">
        <h3>{t('ss.period')}</h3>
        <div className="ad__rate">
          {BYSTRYE.map((b) => (
            <span key={b.kluch}>
              {vybran === b.kluch ? (
                <b>{t(imyaPerioda[b.kluch]!)}</b>
              ) : (
                <a href={`/admin/stats/?p=${b.kluch}`}>{t(imyaPerioda[b.kluch]!)}</a>
              )}
            </span>
          ))}
        </div>
        <form method="get" className="ad__form" style={{ maxWidth: 'none' }}>
          <div className="ad__row" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 200px)) max-content' }}>
            <label>
              {t('ss.ot')}
              <input type="date" name="ot" defaultValue={period.vid === 'daty' ? period.ot : ''} />
            </label>
            <label>
              {t('ss.do')}
              <input type="date" name="do" defaultValue={period.vid === 'daty' ? (period.do ?? '') : ''} />
            </label>
            <label>
              <span aria-hidden="true">&nbsp;</span>
              <button type="submit" className="btn btn--sm">{t('ss.show')}</button>
            </label>
          </div>
        </form>
        <p className="hint" style={{ margin: 0 }}>{t(admin ? 'ss.period_note' : 'ss.period_note_my')}</p>
      </div>

      {/* ⚠️ ОБЩИЕ ЦИФРЫ ПО СЕРВИСУ — ТОЛЬКО АДМИНИСТРАТОРУ (сорок
          девятая итерация, пункт 4): «Общих цифр по всему сервису
          у него нет: общего числа заказов, очереди, среднего времени,
          сертификатов». Признак тот же, что у выручки: `null` значит
          «спрашивал не администратор», и чисел в разметке нет вовсе —
          их не считали. */}
      {d.obshchee ? (
        <>
          <div className="ad__card">
            <dl className="ad__kv">
              {/* ⚠️ ВЫПОЛНЕННЫЕ ПО ДАТЕ ВЫПОЛНЕНИЯ, А НЕ ОПЛАЧЕННЫЕ
                  (пятидесятая итерация, вопрос 106), и надпись говорит
                  это сама: «Заказов» рядом с таблицей выполненных
                  читалось бы как другое число. */}
              <dt>{t('ss.orders_done')}</dt>
              <dd className="tnum">{d.obshchee.zakazov}</dd>
              <dt>{t('ss.revenue')}</dt>
              <dd className="tnum">{rubli(d.obshchee.vyruchkaKop)}</dd>
            </dl>
            <p className="hint">{t('ss.revenue_note')}</p>
          </div>

          <div className="ad__card">
            <dl className="ad__kv">
              <dt>{t('ss.queue')}</dt>
              <dd className="tnum">
                {d.obshchee.vOcheredi} <span className="hint">{t('ss.queue_note')}</span>
              </dd>
              <dt>{t('ss.avg')}</dt>
              <dd>
                {d.obshchee.srednyayaMinut === null ? (
                  <span className="hint">{t('ss.avg_none')}</span>
                ) : (
                  <>
                    <span className="tnum">{vremya(d.obshchee.srednyayaMinut)}</span>{' '}
                    <span className="hint">{t('ss.avg_note')}</span>
                  </>
                )}
              </dd>
              <dt>{t('ss.certs')}</dt>
              <dd className="tnum">
                {t('ss.certs_bought')}: {d.obshchee.sertifikatovKupleno} · {t('ss.certs_used')}:{' '}
                {d.obshchee.sertifikatovAktivirovano} <span className="hint">({t('ss.certs_all')})</span>
              </dd>
            </dl>
          </div>
        </>
      ) : (
        /* ⚠️ У ОПЕРАТОРА — ЕГО ВЫПОЛНЕННЫЕ ЗАКАЗЫ ЗА ПЕРИОД, и только
           они. Считает их сервер по журналу: «по почте, с которой он
           вошёл» — это его номер в событии «выполнил». */
        <div className="ad__card">
          <dl className="ad__kv">
            <dt>{t('ss.my_done')}</dt>
            <dd className="tnum">{d.vypolneno}</dd>
          </dl>
          <p className="hint">{t('ss.my_done_note')}</p>
        </div>
      )}

      <div className="ad__card">
        <h3>{t('ss.by_plan')}</h3>
        {/* Что именно здесь считается — названо прямо: «только
            выполненные, по времени выполнения» (сорок девятая
            итерация, пункт 1). */}
        <p className="hint">{admin ? t('ss.by_plan_note') : t('ss.by_plan_note_my')}</p>
        {!d.tarify.length ? (
          <p className="hint">{t('ss.none')}</p>
        ) : (
          <div className="ad__scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('t.plan')}</th>
                  <th>{t('t.term')}</th>
                  <th>{t('ss.orders')}</th>
                  {/* Заказы по тарифам исполнителю оставлены прямой
                      постановкой — «сами заказы по тарифам оставь», —
                      а выручка ушла вместе с числом. */}
                  {admin ? <th>{t('ss.revenue')}</th> : null}
                </tr>
              </thead>
              <tbody>
                {d.tarify.map((r) => (
                  <tr key={`${r.planId}-${r.period}`}>
                    <td>{imyaTarifaIz(imena, r.planId, y === 'en')}</td>
                    <td>{srokKratkoDlyaSotrudnika(r.period, y === 'en')}</td>
                    <td className="tnum">{r.zakazov}</td>
                    {/* ⚠️ КЛЕТКА И ЗАГОЛОВОК ИДУТ ЗА ОДНИМ И ТЕМ ЖЕ
                        ПРИЗНАКОМ: разойдись они — в таблице стало бы
                        разное число столбцов в шапке и в теле. */}
                    {admin ? (
                      <td className="tnum">{r.vyruchkaKop === null ? '—' : rubli(r.vyruchkaKop)}</td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── ПО СОТРУДНИКАМ ────────────────────────────────────────
          Постановка: «почта сотрудника, сколько заказов он выполнил,
          с разбивкой по тарифам», и рядом столько же про отменённые.
          Период — тот же, что выбран выше на экране: он один на всю
          страницу (Р-147). Отмены самим покупателем сюда не попадают
          по построению — у них нет сотрудника (см. `stats.ts`). */}
      {/* ⚠️ КОЛОНКИ ОТМЕН СКРЫТЫ ПО УМОЛЧАНИЮ И ВКЛЮЧАЮТСЯ ГАЛОЧКОЙ
          (сорок девятая итерация, пункт 3). Переключает их ЧИСТЫЙ CSS
          через `:has()`: галочка и таблица лежат в одной карточке,
          и скрипт тут не нужен вовсе — страница серверная. Данные при
          этом в разметке есть: это не секрет, а вид, и решает его тот,
          кто смотрит (числа отмен и так видит только администратор). */}
      {d.poSotrudnikam ? (
        <div className="ad__card ss-staff">
          <h3>{t('ss.by_staff')}</h3>
          <label className="ad__check">
            <input type="checkbox" className="ss-staff__pokaz" />
            <span>{t('ss.show_cancels')}</span>
          </label>
          {!d.poSotrudnikam.length ? (
            <p className="hint">{t('ss.none')}</p>
          ) : (
            <div className="ad__scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t('t.staff')}</th>
                    <th>{t('ss.done_n')}</th>
                    <th>{t('ss.done_plans')}</th>
                    <th className="ss-otm">{t('ss.cancelled_n')}</th>
                    <th className="ss-otm">{t('ss.cancelled_plans')}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.poSotrudnikam.map((r) => (
                    <tr key={r.email}>
                      <td>{r.email}</td>
                      <td className="tnum">{r.zakazov}</td>
                      {/* Названия тарифов — надписи, и в английской
                          админке они английские (закон 40). */}
                      <td>{razbivka(r.tarify)}</td>
                      <td className="tnum ss-otm">{r.otmen}</td>
                      <td className="ss-otm">{razbivka(r.tarifyOtmen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="hint">{t('ss.by_staff_note')}</p>
        </div>
      ) : null}

      {/* ⚠️ ИСТОЧНИКИ — ТОЛЬКО АДМИНИСТРАТОРУ (сорок седьмая итерация).
          Признак здесь ОДИН и тот же, что у выручки: `null` значит
          «спрашивал не администратор», и данных в разметке нет вовсе —
          их не считали (Р-155). */}
      {d.istochniki ? (
      <div className="ad__card">
        <h3>{t('ss.sources')}</h3>
        <p className="hint">{t('ss.sources_note')}</p>
        {!d.istochniki.length ? (
          <p className="hint">{t('ss.none')}</p>
        ) : (
          <div className="ad__scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('ss.source')}</th>
                  <th>{t('ss.orders')}</th>
                  <th>{t('ss.share')}</th>
                </tr>
              </thead>
              <tbody>
                {d.istochniki.map((r) => (
                  <tr key={r.istochnik ?? '—'}>
                    {/* Значение метки — данные, и оно не переводится;
                        переводится только слово «без меток». */}
                    <td>{r.istochnik ?? <span className="hint">{t('ss.source_direct')}</span>}</td>
                    <td className="tnum">{r.zakazov}</td>
                    <td className="tnum">{r.dolya} %</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      ) : null}

      {/* ⚠️ ГЕНЕРАТОР СТОИТ В СТАТИСТИКЕ, А НЕ В НАСТРОЙКАХ, и это
          не случайность: метки из собранной ссылки приезжают ровно
          в ту таблицу источников, что выше. Ссылку собирают, глядя
          на то, что уже работает.

          ⚠️ И С СОРОК ШЕСТОЙ ИТЕРАЦИИ ОН ТОЛЬКО У АДМИНИСТРАТОРА
          («раздел „Ссылка с метками" целиком»). Здесь разметки
          довольно и убирать нечего с сервера: генератор ничего
          не читает — он собирает адрес из того, что человек сам
          набрал в полях. */}
      {admin ? <UtmGen y={y} adres={adres} /> : null}
    </>
  );
}

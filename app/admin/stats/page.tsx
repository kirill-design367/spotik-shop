import { redirect } from 'next/navigation';
import UtmGen from '@/components/admin/UtmGen';
import { env } from '@/lib/server/env';
import { ktoSotrudnik } from '@/lib/server/auth';
import { bazaEst } from '@/lib/server/db';
import { BYSTRYE, ponyatPeriod, svodka } from '@/lib/server/stats';
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
 * ⚠️ ДЕНЬГИ ЗАКАЗА ИСПОЛНИТЕЛЮ ПРИ ЭТОМ НЕ ВИДНЫ (пункт 10 той же
 * постановки), и это не противоречие: там речь о КАРТОЧКЕ ОДНОГО
 * заказа — сколько заплатил вот этот человек и чем, — а здесь
 * о выручке сервиса. Первое ему в работе не нужно, второе просили
 * показать прямо.
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

  const [d, imena] = await Promise.all([svodka(period), imenaTarifov()]);
  const imyaPerioda: Record<string, Klyuch> = { day: 'ss.day', week: 'ss.week', month: 'ss.month' };
  const vremya = (min: number) => t('ss.hm', { h: Math.floor(min / 60), m: min % 60 });
  const vybran = period.vid === 'daty' ? '' : period.vid;

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
        <p className="hint" style={{ margin: 0 }}>{t('ss.period_note')}</p>
      </div>

      <div className="ad__card">
        <dl className="ad__kv">
          <dt>{t('ss.orders')}</dt>
          <dd className="tnum">{d.zakazov}</dd>
          <dt>{t('ss.revenue')}</dt>
          <dd className="tnum">{rubli(d.vyruchkaKop)}</dd>
        </dl>
        <p className="hint">{t('ss.revenue_note')}</p>
      </div>

      <div className="ad__card">
        <dl className="ad__kv">
          <dt>{t('ss.queue')}</dt>
          <dd className="tnum">
            {d.vOcheredi} <span className="hint">{t('ss.queue_note')}</span>
          </dd>
          <dt>{t('ss.avg')}</dt>
          <dd>
            {d.srednyayaMinut === null ? (
              <span className="hint">{t('ss.avg_none')}</span>
            ) : (
              <>
                <span className="tnum">{vremya(d.srednyayaMinut)}</span>{' '}
                <span className="hint">{t('ss.avg_note')}</span>
              </>
            )}
          </dd>
          <dt>{t('ss.certs')}</dt>
          <dd className="tnum">
            {t('ss.certs_bought')}: {d.sertifikatovKupleno} · {t('ss.certs_used')}:{' '}
            {d.sertifikatovAktivirovano} <span className="hint">({t('ss.certs_all')})</span>
          </dd>
        </dl>
      </div>

      <div className="ad__card">
        <h3>{t('ss.by_plan')}</h3>
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
                  <th>{t('ss.revenue')}</th>
                </tr>
              </thead>
              <tbody>
                {d.tarify.map((r) => (
                  <tr key={`${r.planId}-${r.period}`}>
                    <td>{imyaTarifaIz(imena, r.planId, y === 'en')}</td>
                    <td>{srokKratkoDlyaSotrudnika(r.period, y === 'en')}</td>
                    <td className="tnum">{r.zakazov}</td>
                    <td className="tnum">{rubli(r.vyruchkaKop)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="ad__card">
        <h3>{t('ss.sources')}</h3>
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

      {/* ⚠️ ГЕНЕРАТОР СТОИТ В СТАТИСТИКЕ, А НЕ В НАСТРОЙКАХ, и это
          не случайность: метки из собранной ссылки приезжают ровно
          в ту таблицу источников, что выше. Ссылку собирают, глядя
          на то, что уже работает. */}
      <UtmGen y={y} adres={adres} />
    </>
  );
}

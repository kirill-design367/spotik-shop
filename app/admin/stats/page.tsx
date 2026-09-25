import { redirect } from 'next/navigation';
import UtmGen from '@/components/admin/UtmGen';
import { env } from '@/lib/server/env';
import { ktoSotrudnik } from '@/lib/server/auth';
import { bazaEst } from '@/lib/server/db';
import { svodka } from '@/lib/server/stats';
import { rubli } from '@/lib/server/money';
import { yazykSotrudnika } from '@/lib/server/yazyk';
import { slovar, type Klyuch } from '@/lib/admin/slova';
import { imyaTarifa, srokKratkoDlyaSotrudnika } from '@/lib/plans';

export const dynamic = 'force-dynamic';

/**
 * СТАТИСТИКА.
 *
 * ⚠️ ТОЛЬКО АДМИНИСТРАТОРУ, и проверка стоит ровно там же, где
 * в остальных закрытых разделах: сначала база, потом вход, потом
 * роль. Исполнителю здесь не нужно ничего — ему нужна очередь.
 *
 * ⚠️ ВСЕ ЦИФРЫ ИЗ БАЗЫ (см. lib/server/stats.ts). Красота тут
 * вторична по постановке, поэтому раздел — это таблицы и ничего
 * больше: ни графиков, ни своих стилей сверх тех, что уже есть
 * в админке.
 */
export default async function AdminStats() {
  const s = await ktoSotrudnik();
  const y = await yazykSotrudnika(s);
  const t = slovar(y);
  const adres = env.siteUrl;
  if (!bazaEst()) return <p className="err">{t('o.no_db')}</p>;
  if (!s) redirect('/admin/login/');
  if (s.role !== 'admin') return <p className="err">{t('o.only_admin')}</p>;

  const d = await svodka();
  const imyaPerioda: Record<string, Klyuch> = { day: 'ss.day', week: 'ss.week', month: 'ss.month' };
  const vremya = (min: number) => t('ss.hm', { h: Math.floor(min / 60), m: min % 60 });

  return (
    <>
      <h1>{t('ss.h')}</h1>

      <div className="ad__card">
        <div className="ad__scroll">
          <table>
            <thead>
              <tr>
                <th />
                <th>{t('ss.orders')}</th>
                <th>{t('ss.revenue')}</th>
              </tr>
            </thead>
            <tbody>
              {d.periody.map((p) => (
                <tr key={p.kluch}>
                  <td>{t(imyaPerioda[p.kluch]!)}</td>
                  <td className="tnum">{p.zakazov}</td>
                  <td className="tnum">{rubli(p.vyruchkaKop)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
            {t('ss.certs_bought')}: {d.sertifikatovKupleno} · {t('ss.certs_used')}: {d.sertifikatovAktivirovano}
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
                    <td>{imyaTarifa(r.planId, y === 'en')}</td>
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

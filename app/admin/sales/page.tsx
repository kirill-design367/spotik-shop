import { redirect } from 'next/navigation';
import { ktoSotrudnik } from '@/lib/server/auth';
import { bazaEst } from '@/lib/server/db';
import { NA_STRANICE, ponyatFiltr, prodazhi } from '@/lib/server/prodazhi';
import { imenaTarifov } from '@/lib/server/imena';
import { SROKI } from '@/lib/server/catalog';
import { yazykSotrudnika } from '@/lib/server/yazyk';
import { slovar, sostoyanie } from '@/lib/admin/slova';
import { DARIMYE, imyaTarifaIz, srokKratkoDlyaSotrudnika } from '@/lib/plans';
import { poMoskve } from '@/lib/admin/vremya';
import { rubli } from '@/lib/server/money';
import { NE_PEREVODIT, iliNadpis } from '@/components/Bukvalno';

export const dynamic = 'force-dynamic';

/**
 * ПРОДАЖИ — база всех заказов (Р-171).
 *
 * ⚠️ ФИЛЬТРЫ — ФОРМА `method="get"` БЕЗ `action`, а страницы — ссылки
 * с теми же параметрами: адрес выборки можно сохранить и переслать,
 * а «назад» в браузере возвращает к ней же (то же устройство, что
 * у периода статистики, Р-147).
 *
 * ⚠️ ТОЛЬКО АДМИНИСТРАТОРУ: почты всех клиентов и суммы всех заказов.
 */
export default async function AdminSales({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const s = await ktoSotrudnik();
  const y = await yazykSotrudnika(s);
  const t = slovar(y);
  const en = y === 'en';
  if (!bazaEst()) return <p className="err">{t('o.no_db')}</p>;
  if (!s) redirect('/admin/login/');
  if (s.role !== 'admin') return <p className="err">{t('o.only_admin')}</p>;

  const sp = await searchParams;
  const ploskie: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) ploskie[k] = (Array.isArray(v) ? v[0] : v) ?? '';
  const f = ponyatFiltr(ploskie);
  const [{ vsego, stroki }, imena] = await Promise.all([prodazhi(f), imenaTarifov()]);
  const stranic = Math.max(1, Math.ceil(vsego / NA_STRANICE));

  const adres = (stranica: number) => {
    const q = new URLSearchParams();
    if (f.ot) q.set('ot', f.ot);
    if (f.do) q.set('do', f.do);
    if (f.plan) q.set('plan', f.plan);
    if (f.period) q.set('srok', String(f.period));
    if (f.status) q.set('st', f.status);
    if (f.q) q.set('q', f.q);
    if (stranica > 1) q.set('s', String(stranica));
    const str = q.toString();
    return '/admin/sales/' + (str ? '?' + str : '');
  };

  const STATUSY = ['new', 'paid', 'in_work', 'done', 'cancelled'] as const;

  return (
    <>
      <h1>{t('sl.h')}</h1>
      <p className="hint">{t('sl.hint')}</p>

      <div className="ad__card">
        <form method="get" className="ad__form" style={{ maxWidth: 'none' }}>
          <div className="ad__row ad__row--4">
            <label>
              {t('ss.ot')}
              <input type="date" name="ot" defaultValue={f.ot ?? ''} />
            </label>
            <label>
              {t('ss.do')}
              <input type="date" name="do" defaultValue={f.do ?? ''} />
            </label>
            <label>
              {t('t.plan')}
              <select name="plan" defaultValue={f.plan ?? ''}>
                <option value="">{t('sl.all')}</option>
                {DARIMYE.map((p) => (
                  <option key={p.id} value={p.id}>
                    {imyaTarifaIz(imena, p.id, en)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('t.term')}
              <select name="srok" defaultValue={f.period ? String(f.period) : ''}>
                <option value="">{t('sl.all')}</option>
                {SROKI.map((x) => (
                  <option key={x.key} value={x.key}>
                    {srokKratkoDlyaSotrudnika(x.key, en)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('t.state')}
              <select name="st" defaultValue={f.status ?? ''}>
                <option value="">{t('sl.all')}</option>
                {STATUSY.map((x) => (
                  <option key={x} value={x}>
                    {sostoyanie(t, x)}
                  </option>
                ))}
                <option value="podpiska">{t('sc.tag')}</option>
              </select>
            </label>
            <label className="ad__row-shire">
              {t('sl.q')}
              <input
                type="search"
                name="q"
                defaultValue={f.q}
                placeholder={t('sl.q_ph')}
                autoComplete="off"
                spellCheck={false}
                translate="no"
              />
            </label>
          </div>
          <div className="ad__knopki">
            <button type="submit" className="btn btn--sm">
              {t('ss.show')}
            </button>
            <a className="btn btn--ghost btn--sm" href="/admin/sales/">
              {t('sl.sbros')}
            </a>
          </div>
          <p className="hint">{t('sl.q_hint')}</p>
        </form>
      </div>

      <p className="hint">{t('sl.found', { n: vsego })}</p>

      {!stroki.length ? (
        <p className="hint">{t('ss.none')}</p>
      ) : (
        <div className="ad__scroll">
          <table>
            <thead>
              <tr>
                <th>{t('t.num')}</th>
                <th>{t('t.paid')}</th>
                <th>{t('t.plan')}</th>
                <th>{t('t.term')}</th>
                <th>{t('t.client')}</th>
                <th>{t('t.state')}</th>
                <th>{t('t.staff')}</th>
                <th>{t('sl.sum')}</th>
                <th>{t('sl.promo')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {stroki.map((r) => (
                <tr key={r.id}>
                  <td className="tnum">{r.id}</td>
                  <td className="tnum">{r.paidAt ? poMoskve(r.paidAt, en) : <span className="hint">—</span>}</td>
                  <td>
                    {imyaTarifaIz(imena, r.planId, en)}
                    {r.kind === 'certificate' ? <span className="ad__tag ad__tag--gift">{t('sl.cert')}</span> : null}
                    {r.bySertificate ? <span className="ad__tag ad__tag--gift">{t('q.gift')}</span> : null}
                  </td>
                  <td>{srokKratkoDlyaSotrudnika(r.period, en)}</td>
                  <td {...NE_PEREVODIT}>{r.client}</td>
                  <td>
                    {sostoyanie(t, r.status)}
                    {r.otmenaPodpiski ? <span className="ad__tag ad__tag--otmena">{t('sc.tag')}</span> : null}
                  </td>
                  <td>{iliNadpis(r.staff, '—')}</td>
                  <td className="tnum">{rubli(r.totalKop)}</td>
                  <td>{iliNadpis(r.promoKod, '—')}</td>
                  <td>
                    <a className="btn btn--ghost btn--sm" href={`/admin/orders/${r.id}/`}>
                      {t('q.open')}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {stranic > 1 ? (
        <nav className="ad__stranicy" aria-label={t('sl.pages')}>
          {f.stranica > 1 ? <a href={adres(f.stranica - 1)}>← {t('sl.prev')}</a> : <span />}
          <span className="tnum">{t('sl.page', { n: f.stranica, m: stranic })}</span>
          {f.stranica < stranic ? <a href={adres(f.stranica + 1)}>{t('sl.next')} →</a> : <span />}
        </nav>
      ) : null}
    </>
  );
}

import './admin.css';
import type { Metadata } from 'next';
import { ktoSotrudnik } from '@/lib/server/auth';
import { adminLogout } from '@/lib/server/actions-admin';
import { yazykSotrudnika } from '@/lib/server/yazyk';
import { slovar } from '@/lib/admin/slova';
import VyborYazyka from '@/components/admin/VyborYazyka';

/**
 * ⚠️ ЗАГОЛОВОК ВКЛАДКИ ТОЖЕ НАДПИСЬ, И ОН ТОЖЕ ПЕРЕВОДИТСЯ. Статичный
 * `metadata` был бы единственным местом раздела, где язык не менялся
 * бы вовсе, — а постановка требует «все надписи интерфейса».
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = slovar(await yazykSotrudnika(await ktoSotrudnik()));
  return { title: t('nav.title'), robots: { index: false, follow: false } };
}
export const dynamic = 'force-dynamic';

/**
 * Каркас админки.
 *
 * ⚠️ `lang` У РАЗДЕЛА ТЕПЕРЬ ПОДВИЖНЫЙ. До этой итерации интерфейс
 * был только английским, и атрибут стоял `en` намертво. Теперь
 * языков два, и атрибут обязан идти за выбором: иначе экранный
 * диктор читал бы русские надписи по-английски — ровно та же беда,
 * от которой этот атрибут и заводился.
 *
 * Своего `<html>` здесь нет намеренно: второй корневой макет — это
 * два места, где может разъехаться `<head>`, ради одного раздела.
 * Шапку сайта снимает `SiteChrome` по адресу.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const s = await ktoSotrudnik();
  const y = await yazykSotrudnika(s);
  const t = slovar(y);
  return (
    <main id="main" className="ad" lang={y} tabIndex={-1}>
      <div className="ad__bar">
        <span className="ad__brand">SPOTIK · admin</span>
        {s ? (
          <>
            <nav className="ad__nav">
              <a href="/admin/">{t('nav.queue')}</a>
              {s.role === 'admin' ? <a href="/admin/settings/">{t('nav.prices')}</a> : null}
              {s.role === 'admin' ? <a href="/admin/certificates/">{t('nav.certs')}</a> : null}
              {s.role === 'admin' ? <a href="/admin/staff/">{t('nav.staff')}</a> : null}
              {s.role === 'admin' ? <a href="/admin/stats/">{t('nav.stats')}</a> : null}
              <a href="/">{t('nav.site')}</a>
            </nav>
            <span className="ad__who">
              {s.email} · {s.role === 'admin' ? t('f.role_admin') : t('f.role_op')}
            </span>
            {/* ⚠️ ПЕРЕКЛЮЧАТЕЛЬ ВИДЕН ВСЕГДА — постановка, — поэтому
                он стоит и до входа, ниже по разметке: там сотрудника
                ещё нет, и язык помнит кука. */}
            <VyborYazyka y={y} />
            <form action={adminLogout}>
              <button type="submit" className="btn btn--ghost btn--sm">{t('nav.logout')}</button>
            </form>
          </>
        ) : (
          <VyborYazyka y={y} />
        )}
      </div>
      {children}
    </main>
  );
}

import './admin.css';
import type { Metadata } from 'next';
import { ktoSotrudnik } from '@/lib/server/auth';
import { adminLogout } from '@/lib/server/actions-admin';

export const metadata: Metadata = { title: 'Admin — Spotik Shop', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/**
 * Каркас админки.
 *
 * ⚠️ РАЗДЕЛ ПОМЕЧЕН `lang="en"`: интерфейс там английский
 * по постановке, а документ у сайта русский. Без этого экранный
 * диктор читал бы английские слова по-русски.
 *
 * Своего `<html>` здесь нет намеренно: второй корневой макет — это
 * два места, где может разъехаться `<head>`, ради одного раздела.
 * Шапку сайта снимает `SiteChrome` по адресу.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const s = await ktoSotrudnik();
  return (
    <main id="main" className="ad" lang="en" tabIndex={-1}>
      <div className="ad__bar">
        <span className="ad__brand">SPOTIK · admin</span>
        {s ? (
          <>
            <nav className="ad__nav">
              <a href="/admin/">Queue</a>
              {s.role === 'admin' ? <a href="/admin/settings/">Prices</a> : null}
              {s.role === 'admin' ? <a href="/admin/staff/">Staff</a> : null}
              <a href="/">Site</a>
            </nav>
            <span className="ad__who">
              {s.email} · {s.role}
            </span>
            <form action={adminLogout}>
              <button type="submit" className="btn btn--ghost btn--sm">Log out</button>
            </form>
          </>
        ) : null}
      </div>
      {children}
    </main>
  );
}

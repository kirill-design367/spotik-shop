import { redirect } from 'next/navigation';
import Staff, { type Chelovek } from '@/components/admin/Staff';
import { ktoSotrudnik } from '@/lib/server/auth';
import { bazaEst, zapros } from '@/lib/server/db';
import { yazykSotrudnika } from '@/lib/server/yazyk';
import { slovar } from '@/lib/admin/slova';

export const dynamic = 'force-dynamic';

export default async function AdminStaff() {
  const s = await ktoSotrudnik();
  const y = await yazykSotrudnika(s);
  const t = slovar(y);
  if (!bazaEst()) return <p className="err">{t('o.no_db')}</p>;
  if (!s) redirect('/admin/login/');
  if (s.role !== 'admin') return <p className="err">{t('o.only_admin')}</p>;

  const rows = await zapros<{ id: string; email: string; role: string; disabled: boolean }>(
    'select id, email, role, disabled from staff order by role, email',
  );
  const list: Chelovek[] = rows.map((r) => ({
    id: Number(r.id),
    email: r.email,
    role: r.role,
    disabled: r.disabled,
    me: Number(r.id) === s.id,
  }));
  return <Staff list={list} y={y} />;
}

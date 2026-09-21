import { redirect } from 'next/navigation';
import Staff, { type Chelovek } from '@/components/admin/Staff';
import { ktoSotrudnik } from '@/lib/server/auth';
import { bazaEst, zapros } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

export default async function AdminStaff() {
  if (!bazaEst()) return <p className="err">No database configured on this server.</p>;
  const s = await ktoSotrudnik();
  if (!s) redirect('/admin/login/');
  if (s.role !== 'admin') return <p className="err">Administrators only.</p>;

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
  return <Staff list={list} />;
}

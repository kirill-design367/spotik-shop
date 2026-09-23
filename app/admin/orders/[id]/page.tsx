import { redirect } from 'next/navigation';
import OrderWork from '@/components/admin/OrderWork';
import { ktoSotrudnik } from '@/lib/server/auth';
import { zakazDlyaAdminki } from '@/lib/server/views';
import { bazaEst } from '@/lib/server/db';
import { yazykSotrudnika } from '@/lib/server/yazyk';
import { slovar } from '@/lib/admin/slova';

export const dynamic = 'force-dynamic';

export default async function AdminOrder({ params }: { params: Promise<{ id: string }> }) {
  const s = await ktoSotrudnik();
  const y = await yazykSotrudnika(s);
  const t = slovar(y);
  if (!bazaEst()) return <p className="err">{t('o.no_db')}</p>;
  if (!s) redirect('/admin/login/');
  const { id } = await params;
  const z = await zakazDlyaAdminki(Number(id), s.id, s.role === 'admin');
  if (!z) return <p className="err">{t('o.no_order')}</p>;
  return (
    <>
      <h1>{t('z.h', { n: z.id })}</h1>
      <p className="hint">
        <a href="/admin/">{t('z.back')}</a>
      </p>
      <OrderWork z={z} staffId={s.id} y={y} />
    </>
  );
}

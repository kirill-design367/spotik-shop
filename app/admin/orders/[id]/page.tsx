import { redirect } from 'next/navigation';
import OrderWork from '@/components/admin/OrderWork';
import { ktoSotrudnik } from '@/lib/server/auth';
import { zakazDlyaAdminki } from '@/lib/server/views';
import { bazaEst } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

export default async function AdminOrder({ params }: { params: Promise<{ id: string }> }) {
  if (!bazaEst()) return <p className="err">No database configured on this server.</p>;
  const s = await ktoSotrudnik();
  if (!s) redirect('/admin/login/');
  const { id } = await params;
  const z = await zakazDlyaAdminki(Number(id), s.id, s.role === 'admin');
  if (!z) return <p className="err">Order not found.</p>;
  return (
    <>
      <h1>Order #{z.id}</h1>
      <p className="hint">
        <a href="/admin/">← back to the queue</a>
      </p>
      <OrderWork z={z} staffId={s.id} />
    </>
  );
}

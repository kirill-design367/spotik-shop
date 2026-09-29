import { redirect } from 'next/navigation';
import OrderWork from '@/components/admin/OrderWork';
import { ktoSotrudnik } from '@/lib/server/auth';
import { zakazDlyaAdminki } from '@/lib/server/views';
import { dostupSotrudnika } from '@/lib/server/dostup';
import { bazaEst } from '@/lib/server/db';
import { yazykSotrudnika } from '@/lib/server/yazyk';
import { slovar } from '@/lib/admin/slova';
import { imenaTarifov } from '@/lib/server/imena';

export const dynamic = 'force-dynamic';

export default async function AdminOrder({ params }: { params: Promise<{ id: string }> }) {
  const s = await ktoSotrudnik();
  const y = await yazykSotrudnika(s);
  const t = slovar(y);
  if (!bazaEst()) return <p className="err">{t('o.no_db')}</p>;
  if (!s) redirect('/admin/login/');
  const { id } = await params;
  /* ⚠️ ПРЯМАЯ ССЫЛКА ПРОВЕРЯЕТСЯ ТЕМ ЖЕ УСЛОВИЕМ, ЧТО И ОЧЕРЕДЬ
     (постановка сорок шестой итерации): заказ, взятый другим,
     и заказ чужого тарифа оператору не отдаются вовсе — ни имени,
     ни почты, ни структуры. Надпись при этом РАЗНАЯ ПО РОЛИ:
     у администратора условие пустое, и `null` у него означает ровно
     «заказа нет»; оператору обе беды выглядят одинаково, и это
     не оплошность, а отсутствие оракула «есть ли такой заказ». */
  const d = await dostupSotrudnika(s);
  const z = await zakazDlyaAdminki(Number(id), d);
  if (!z) return <p className="err">{t(d.admin ? 'o.no_order' : 'o.no_access')}</p>;
  const imena = await imenaTarifov();
  return (
    <>
      <h1>{t('z.h', { n: z.id })}</h1>
      <p className="hint">
        <a href="/admin/">{t('z.back')}</a>
      </p>
      <OrderWork z={z} staffId={s.id} y={y} imena={imena} />
    </>
  );
}

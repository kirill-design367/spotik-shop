import { redirect } from 'next/navigation';
import Prices, { type Stroka } from '@/components/admin/Prices';
import { ktoSotrudnik } from '@/lib/server/auth';
import { bazaEst, zapros } from '@/lib/server/db';
import { katalogPoUmolchaniyu, SROKI } from '@/lib/server/catalog';
import { srokSertifikataDney } from '@/lib/server/settings';
import { PLANS } from '@/lib/plans';

export const dynamic = 'force-dynamic';

export default async function AdminSettings() {
  if (!bazaEst()) return <p className="err">No database configured on this server.</p>;
  const s = await ktoSotrudnik();
  if (!s) redirect('/admin/login/');
  if (s.role !== 'admin') return <p className="err">Administrators only.</p>;

  const izBazy = new Map<string, number>();
  for (const r of await zapros<{ plan_id: string; period: number; price_kop: string }>(
    'select plan_id, period, price_kop from plan_price',
  )) {
    izBazy.set(`${r.plan_id}-${r.period}`, Number(r.price_kop));
  }
  const umolchaniya = new Map<string, number>();
  for (const t of katalogPoUmolchaniyu()) for (const c of t.ceny) umolchaniya.set(`${t.id}-${c.period}`, c.kop);

  const rows: Stroka[] = [];
  for (const p of PLANS) {
    for (const s2 of SROKI) {
      const k = `${p.id}-${s2.key}`;
      const baz = izBazy.get(k);
      const um = umolchaniya.get(k);
      const kop = baz ?? um;
      rows.push({
        planId: p.id,
        planName: p.name,
        period: s2.key,
        label: s2.label,
        rub: kop === undefined ? '' : String(kop / 100),
        iz: baz !== undefined ? 'база' : um !== undefined ? 'умолчание' : '—',
      });
    }
  }

  return <Prices rows={rows} days={await srokSertifikataDney()} />;
}

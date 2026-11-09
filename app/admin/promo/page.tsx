import { redirect } from 'next/navigation';
import Promokody, { type KodNaEkrane } from '@/components/admin/Promokody';
import { ktoSotrudnik } from '@/lib/server/auth';
import { bazaEst } from '@/lib/server/db';
import { primeneniya, vse } from '@/lib/server/promokody';
import { yazykSotrudnika } from '@/lib/server/yazyk';
import { slovar } from '@/lib/admin/slova';

export const dynamic = 'force-dynamic';

/**
 * ПРОМОКОДЫ — раздел админки (Р-167).
 *
 * Те же настройки, что в Нейролавке: код (пустой — придумается сам),
 * скидка в процентах, день, до которого код работает, и число
 * активаций. Сверх Нейролавки — правка: её попросила постановка.
 *
 * ⚠️ ТОЛЬКО АДМИНИСТРАТОРУ: скидка — это деньги сервиса. Проверка
 * стоит и здесь, и в каждом действии.
 */
export default async function AdminPromo() {
  const s = await ktoSotrudnik();
  const y = await yazykSotrudnika(s);
  const t = slovar(y);
  if (!bazaEst()) return <p className="err">{t('o.no_db')}</p>;
  if (!s) redirect('/admin/login/');
  if (s.role !== 'admin') return <p className="err">{t('o.only_admin')}</p>;

  const kody = await vse();
  const spisok: KodNaEkrane[] = await Promise.all(
    kody.map(async (k) => ({
      kod: k.kod,
      skidkaProc: k.skidkaProc,
      doDaty: k.doDaty,
      aktivaciy: k.aktivaciy,
      ispolzovano: k.ispolzovano,
      ostalos: k.ostalos,
      otklyuchen: k.otklyuchen,
      pochemu: k.pochemu,
      primeneniya: (await primeneniya(k.kod, 30)).map((a) => ({
        orderId: a.orderId,
        email: a.email,
        skidkaKop: a.skidkaKop,
        kogda: a.createdAt.toISOString(),
        vernulas: Boolean(a.snyataV),
      })),
    })),
  );
  /* Срок по умолчанию — месяц вперёд, как в Нейролавке: код,
     истекающий в момент заведения, — готовая ловушка. День по Москве. */
  const cherezMesyac = new Date(Date.now() + 30 * 24 * 3600_000 + 3 * 3600_000).toISOString().slice(0, 10);

  return <Promokody y={y} spisok={spisok} poUmolchaniyuDo={cherezMesyac} />;
}

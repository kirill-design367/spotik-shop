import { redirect } from 'next/navigation';
import Staff, { type Chelovek } from '@/components/admin/Staff';
import { ktoSotrudnik } from '@/lib/server/auth';
import { bazaEst, zapros } from '@/lib/server/db';
import { niktoNeMozhet, vsePary, vseZaprety } from '@/lib/server/dostup';
import { imenaTarifov } from '@/lib/server/imena';
import { yazykSotrudnika } from '@/lib/server/yazyk';
import { slovar } from '@/lib/admin/slova';
import { klyuchPary, DARIMYE, PERIODS } from '@/lib/plans';
import { katalog } from '@/lib/server/catalog';

export const dynamic = 'force-dynamic';

export default async function AdminStaff() {
  const s = await ktoSotrudnik();
  const y = await yazykSotrudnika(s);
  const t = slovar(y);
  if (!bazaEst()) return <p className="err">{t('o.no_db')}</p>;
  if (!s) redirect('/admin/login/');
  if (s.role !== 'admin') return <p className="err">{t('o.only_admin')}</p>;

  const [rows, zaprety, imena, katalogSaita] = await Promise.all([
    zapros<{ id: string; email: string; role: string; disabled: boolean }>(
      'select id, email, role, disabled from staff order by role, email',
    ),
    vseZaprety(),
    imenaTarifov(),
    /* ⚠️ КАТАЛОГ НУЖЕН РОВНО ДЛЯ ПРЕДУПРЕЖДЕНИЯ: «по каждой паре
       „тариф × срок", КОТОРАЯ ПРОДАЁТСЯ НА САЙТЕ». Он уже не отдаёт
       ни выключенную в админке пару, ни пару без цены (Р-116,
       закон 50), и второй раз выводить это здесь было бы вторым
       источником. Галочек он при этом не касается: их двенадцать
       всегда, потому что скрытие тарифа на сайте их не сбрасывает. */
    katalog(),
  ]);
  const prodayutsya = katalogSaita.flatMap((t) => t.ceny.map((c) => ({ planId: t.id, period: c.period })));
  const list: Chelovek[] = rows.map((r) => ({
    id: Number(r.id),
    email: r.email,
    role: r.role,
    disabled: r.disabled,
    me: Number(r.id) === s.id,
    /* ⚠️ НА СТРАНИЦУ ЕДУТ РАЗРЕШЕНИЯ, А В БАЗЕ ЛЕЖАТ ЗАПРЕТЫ,
       и переворачивается это здесь, один раз. Галочка на экране
       значит «может выполнять», а «ничего не сказано» в базе значит
       «может всё» (миграции 013 и 014): у нового оператора запретов
       нет ни одного, и отмеченными приезжают все двенадцать пар сами. */
    pary: vsePary()
      .filter(
        (para) =>
          !zaprety.some(
            (z) => z.staffId === Number(r.id) && z.planId === para.planId && z.period === para.period,
          ),
      )
      .map((para) => klyuchPary(para.planId, para.period)),
  }));

  /* Тарифы, которых не может выполнить ни один действующий оператор.
     Считает это `dostup.ts` — там же, где живёт само правило. */
  const nikto = niktoNeMozhet(
    rows.filter((r) => r.role === 'operator').map((r) => ({ id: Number(r.id), disabled: r.disabled })),
    zaprety,
    prodayutsya,
  );

  return (
    <Staff
      list={list}
      y={y}
      imena={imena}
      tarify={DARIMYE.map((p) => p.id)}
      sroki={PERIODS.map((s) => s.key as number)}
      nikto={nikto}
    />
  );
}

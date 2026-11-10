import { redirect } from 'next/navigation';
import OtzyvyAdminki from '@/components/admin/Otzyvy';
import { ktoSotrudnik } from '@/lib/server/auth';
import { bazaEst } from '@/lib/server/db';
import { imenaTarifov } from '@/lib/server/imena';
import { otzyvyDlyaAdminki, segodnyaPoMoskve } from '@/lib/server/otzyvy';
import { yazykSotrudnika } from '@/lib/server/yazyk';
import { slovar } from '@/lib/admin/slova';
import { DARIMYE, imyaTarifaIz } from '@/lib/plans';

export const dynamic = 'force-dynamic';

/**
 * ОТЗЫВЫ — раздел админки (пятьдесят четвёртая итерация).
 *
 * Постановка: «Лев добавляет отзывы вручную (имя или ник, текст, дата,
 * тариф — по желанию), публикует, скрывает, меняет порядок. Там же
 * модерация отзывов от клиентов».
 *
 * ⚠️ ТОЛЬКО АДМИНИСТРАТОРУ: публикация на главной — решение за сервис,
 * а на модерации лежат тексты клиентов. Проверка роли стоит и здесь,
 * и в действии; меню только не зовёт сюда того, кого не пустят.
 */
export default async function AdminOtzyvy() {
  const s = await ktoSotrudnik();
  const y = await yazykSotrudnika(s);
  const t = slovar(y);
  if (!bazaEst()) return <p className="err">{t('o.no_db')}</p>;
  if (!s) redirect('/admin/login/');
  if (s.role !== 'admin') return <p className="err">{t('o.only_admin')}</p>;

  const [spiski, imena] = await Promise.all([otzyvyDlyaAdminki(), imenaTarifov()]);
  /* Имена тарифов — на языке сотрудника и из таблицы имён (Р-142, Р-139):
     в английской админке «Duo», в русской — то, что задано в «Ценах». */
  const tarify = DARIMYE.map((p) => ({ id: p.id, imya: imyaTarifaIz(imena, p.id, y === 'en') }));
  return <OtzyvyAdminki y={y} spiski={spiski} tarify={tarify} segodnya={segodnyaPoMoskve()} />;
}

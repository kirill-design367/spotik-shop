import { redirect } from 'next/navigation';
import Prices, { type Stroka } from '@/components/admin/Prices';
import { ktoSotrudnik } from '@/lib/server/auth';
import { bazaEst, zapros } from '@/lib/server/db';
import { katalogPoUmolchaniyu, skidkiIVyklyuchennye, SROKI } from '@/lib/server/catalog';
import { srokSertifikataDney } from '@/lib/server/settings';
import { DARIMYE, imyaTarifa, srokDlyaSotrudnika } from '@/lib/plans';
import { yazykSotrudnika } from '@/lib/server/yazyk';
import { slovar } from '@/lib/admin/slova';

export const dynamic = 'force-dynamic';

export default async function AdminSettings() {
  const s = await ktoSotrudnik();
  const y = await yazykSotrudnika(s);
  const t = slovar(y);
  if (!bazaEst()) return <p className="err">{t('o.no_db')}</p>;
  if (!s) redirect('/admin/login/');
  if (s.role !== 'admin') return <p className="err">{t('o.only_admin')}</p>;

  const izBazy = new Map<string, number>();
  for (const r of await zapros<{ plan_id: string; period: number; price_kop: string }>(
    'select plan_id, period, price_kop from plan_price',
  )) {
    izBazy.set(`${r.plan_id}-${r.period}`, Number(r.price_kop));
  }
  const umolchaniya = new Map<string, number>();
  for (const p of katalogPoUmolchaniyu()) for (const c of p.ceny) umolchaniya.set(`${p.id}-${c.period}`, c.kop);

  /* ⚠️ КАРТОЧКИ СЕРТИФИКАТА ЗДЕСЬ НЕТ ВОВСЕ (Р-93): своей цены
     у сертификата больше не бывает, он стоит ровно столько, сколько
     подаренный тариф. Осталась только настройка срока жизни кода. */
  const { skidki, vyklyucheny } = await skidkiIVyklyuchennye();
  const rows: Stroka[] = [];
  for (const p of DARIMYE) {
    for (const s2 of SROKI) {
      const k = `${p.id}-${s2.key}`;
      const baz = izBazy.get(k);
      const um = umolchaniya.get(k);
      const kop = baz ?? um;
      rows.push({
        planId: p.id,
        /* ⚠️ НАЗВАНИЕ ТАРИФА И СРОК — НАДПИСИ, А НЕ ДАННЫЕ ЗАКАЗА
           (закон 40 с тридцать девятой итерации): в английской
           админке они английские. */
        planName: imyaTarifa(p.id, y === 'en'),
        period: s2.key,
        label: srokDlyaSotrudnika(s2.key, y === 'en'),
        rub: kop === undefined ? '' : String(kop / 100),
        /* ⚠️ ОТКУДА ВЗЯЛАСЬ ЦЕНА — ЭТО НАДПИСЬ, А НЕ ДАННЫЕ: она
           переводится, поэтому сюда едет признак, а не слово. */
        iz: baz !== undefined ? 'baza' : um !== undefined ? 'umolchanie' : 'net',
        skidkaRub: (() => {
          const d = skidki.find((x) => x.planId === p.id && x.period === s2.key);
          return d ? String(d.kop / 100) : '';
        })(),
        skidkaDo: skidki.find((x) => x.planId === p.id && x.period === s2.key)?.until ?? '',
        /* ⚠️ «ПРОДАЁМ» — ЭТО ЦЕНА ЕСТЬ И ЯЧЕЙКА НЕ ВЫКЛЮЧЕНА.
           Без цены продавать нечего, и включённая пустая ячейка
           означала бы карточку, которая на этом сроке молчит. */
        prodayom:
          kop !== undefined && !vyklyucheny.some((v) => v.planId === p.id && v.period === s2.key),
      });
    }
  }

  return <Prices rows={rows} days={await srokSertifikataDney()} y={y} />;
}

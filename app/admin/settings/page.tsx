import { redirect } from 'next/navigation';
import Prices, { type Stroka } from '@/components/admin/Prices';
import { ktoSotrudnik } from '@/lib/server/auth';
import { bazaEst, zapros } from '@/lib/server/db';
import { egipetskiePary, katalogPoUmolchaniyu, skidkiIVyklyuchennye, SROKI } from '@/lib/server/catalog';
import { srokSertifikataDney } from '@/lib/server/settings';
import { DARIMYE, imyaTarifaIz, srokDlyaSotrudnika } from '@/lib/plans';
import { imenaSyrye, imenaTarifov } from '@/lib/server/imena';
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
  const egipet = await egipetskiePary();
  const imena = await imenaTarifov();
  /* ⚠️ ПОЛЯ ЗАПОЛНЕНЫ ДЕЙСТВУЮЩИМ ИМЕНЕМ, А НЕ ПУСТЫЕ. Пустое поле
     читалось бы как «имени нет», а имя есть всегда — либо своё,
     либо из кода. Очистить оба и сохранить — это и есть «вернуть
     как было», и так сказано в подсказке. */
  /* ⚠️ КОРОТКОЕ ИМЯ БЕРЁТСЯ СЫРЫМ ИЗ БАЗЫ, А НЕ ДЕЙСТВУЮЩИМ.
     Не задано — поле пустое, и правка одного полного имени
     не тащит за собой старое короткое (Р-152). Строки в базе нет
     вовсе — показываем короткое имя ИЗ КОДА, и только если оно там
     есть: у «На двоих» и «На троих» его нет вовсе, и подставлять
     туда полное имя значило бы сохранить его явным коротким —
     после чего первое же переименование до карточки не доехало бы.
     Пустое поле там и значит «на карточке полное имя». */
  const syrye = await imenaSyrye();
  const plany = DARIMYE.map((p) => ({
    id: p.id,
    name: imena[p.id]?.name ?? p.name,
    nameEn: imena[p.id]?.nameEn ?? p.nameEn,
    short: syrye[p.id] ? syrye[p.id].short : (p.short ?? ''),
  }));
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
        planName: imyaTarifaIz(imena, p.id, y === 'en'),
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
        /* ⚠️ ГАЛОЧКА СТОИТ У ВСЕХ ДВЕНАДЦАТИ ПАР, ВКЛЮЧАЯ НЕПРОДАВАЕМЫЕ:
           Египет — свойство аккаунта на паре, а не её цены, и снятая
           с продажи пара обязана вернуться с той же отметкой. */
        egipet: egipet.some((e) => e.planId === p.id && e.period === s2.key),
      });
    }
  }

  return <Prices rows={rows} plany={plany} days={await srokSertifikataDney()} y={y} />;
}

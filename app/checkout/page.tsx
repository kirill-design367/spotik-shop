import '../shop.css';
import type { Metadata } from 'next';
import CheckoutForm, { type Vvod } from '@/components/shop/CheckoutForm';
import LoginBox from '@/components/shop/LoginBox';
import { ktoKlient } from '@/lib/server/auth';
import { katalog, naytiTarif, srokPolno } from '@/lib/server/catalog';
import { balans } from '@/lib/server/views';
import { bazaEst } from '@/lib/server/db';

export const metadata: Metadata = { title: 'Оформление — Spotik Shop', robots: { index: false, follow: false } };
/** Страница зависит от куки, поэтому статической быть не может. */
export const dynamic = 'force-dynamic';

/**
 * ОФОРМЛЕНИЕ ЗАКАЗА.
 *
 * Тариф и срок выбраны на лендинге и приходят в адресе; здесь их
 * можно поменять, но начинается страница с того, что человек уже
 * выбрал — переспрашивать выбор, который он только что сделал,
 * это лишний экран.
 *
 * ⚠️ ВХОД ЖИВЁТ ПРЯМО ЗДЕСЬ, БЕЗ УХОДА СО СТРАНИЦЫ — постановка.
 * Пока человек не вошёл, форма заказа не показывается вовсе:
 * заказ привязан к человеку, и «оформить, а потом привязать»
 * означало бы заводить заказы без владельца.
 */
export default async function Checkout({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const odin = (k: string) => (Array.isArray(sp[k]) ? sp[k]?.[0] : sp[k]) ?? '';

  if (!bazaEst()) {
    return (
      <main id="main" className="page" tabIndex={-1}>
        <h1 className="page__h">Оформление</h1>
        <p className="err">Сервис временно недоступен. Попробуйте чуть позже.</p>
        <a className="page__back" href="/">← На главную</a>
      </main>
    );
  }

  const spisok = await katalog();
  const planId = odin('plan') || 'solo';
  const tarif = naytiTarif(spisok, planId) ?? spisok[0]!;
  const zapros = Number(odin('period'));
  const sroki = tarif.ceny.map((c) => ({ period: c.period, kop: c.kop, label: srokPolno(c.period) }));
  const period = sroki.find((s) => s.period === zapros)?.period ?? sroki[sroki.length - 1]?.period ?? 1;
  const kto = await ktoKlient();

  if (!sroki.length) {
    return (
      <main id="main" className="page" tabIndex={-1}>
        <a className="page__back" href="/">← На главную</a>
        <h1 className="page__h">{tarif.name}</h1>
        <p className="err">
          На этот тариф цена пока не назначена, оформить его нельзя. Выберите другой на главной.
        </p>
      </main>
    );
  }

  const vvod: Vvod = {
    planId: tarif.id,
    planName: tarif.name,
    people: tarif.people,
    sertifikat: tarif.gift,
    sroki,
    periodPoUmolchaniyu: period,
    rezhimPoUmolchaniyu: odin('mode') === 'renew' ? 'renew' : 'new',
    balansKop: kto ? await balans(kto.userId) : 0,
  };

  return (
    <main id="main" className="page" tabIndex={-1}>
      <a className="page__back" href="/">← На главную</a>
      <h1 className="page__h">{tarif.name}</h1>
      <p className="page__lead">{tarif.note}</p>

      {kto ? (
        <>
          <p className="cab__mail">
            Заказ оформляется на {kto.email}. <a href="/cabinet/">Личный кабинет</a>
          </p>
          <CheckoutForm vvod={vvod} />
        </>
      ) : (
        <LoginBox
          next={`/checkout/?plan=${tarif.id}&period=${period}${odin('mode') ? `&mode=${odin('mode')}` : ''}`}
          zagolovok="Сначала вход — на эту же почту придёт доступ"
        />
      )}
    </main>
  );
}

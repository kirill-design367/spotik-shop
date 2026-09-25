import '../shop.css';
import type { Metadata } from 'next';
import CheckoutForm, { type Vvod } from '@/components/shop/CheckoutForm';
import Celi from '@/components/shop/Celi';
import { CELI } from '@/lib/metrika';
import LoginBox from '@/components/shop/LoginBox';
import { ktoKlient } from '@/lib/server/auth';
import { katalog, naytiTarif, srokPolno } from '@/lib/server/catalog';
import { balans, pochtyZakaza } from '@/lib/server/views';
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
 *
 * ⚠️ СЕРТИФИКАТ — ЭТО ПРИЗНАК `gift=1` НА ТОМ ЖЕ ТАРИФЕ, а не
 * отдельный тариф (Р-93). Страница та же, цена та же, участников
 * не спрашиваем: их выберет получатель, когда введёт код.
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
  const podarok = odin('gift') === '1';
  const planId = odin('plan') || 'solo';
  const tarif = naytiTarif(spisok, planId) ?? spisok[0]!;
  const zapros = Number(odin('period'));
  const sroki = tarif.ceny.map((c) => ({ period: c.period, kop: c.kop, label: srokPolno(c.period) }));
  /* ⚠️ БЕЗ ЯВНОГО СРОКА В АДРЕСЕ ОТКРЫВАЕТСЯ САМЫЙ КОРОТКИЙ, А НЕ САМЫЙ
     ДЛИННЫЙ. Раньше умолчанием был последний срок из списка, то есть
     год: человек, пришедший по ссылке без срока, видел самую крупную
     сумму. Постановка тридцать шестой итерации ставит месяц и здесь,
     и на лендинге. */
  const period = sroki.find((s) => s.period === zapros)?.period ?? sroki[0]?.period ?? 1;
  const kto = await ktoKlient();

  const zagolovok = podarok ? `Сертификат в подарок · ${tarif.name}` : tarif.name;

  if (!sroki.length) {
    return (
      <main id="main" className="page" tabIndex={-1}>
        <a className="page__back" href="/">← На главную</a>
        <h1 className="page__h">{zagolovok}</h1>
        <p className="err">
          На этот тариф цена пока не назначена, оформить его нельзя. Выберите другой на главной.
        </p>
      </main>
    );
  }

  /* ⚠️ ССЫЛКА «ПРОДЛИТЬ» ИЗ ПИСЬМА НЕСЁТ НОМЕР ЗАКАЗА, А НЕ ПОЧТУ.
     Почта аккаунта Spotify лежит в базе шифротекстом ровно затем,
     чтобы не гулять открытым текстом; письмо живёт в ящике вечно
     и пересылается кому угодно. Поэтому адрес читает САМА страница,
     у владельца заказа и через то же единственное место, где
     расшифровка разрешена (закон 35). Чужой номер отдаёт пустой
     список и не подставляет ничего. */
  const prodlit = Number(odin('renew'));
  const pochty = kto && prodlit > 0 ? await pochtyZakaza(kto.userId, prodlit) : [];

  const vvod: Vvod = {
    planId: tarif.id,
    planName: podarok ? `Сертификат · ${tarif.name}` : tarif.name,
    people: tarif.people,
    sertifikat: podarok,
    sroki,
    periodPoUmolchaniyu: period,
    rezhimPoUmolchaniyu: odin('mode') === 'renew' || pochty.length ? 'renew' : 'new',
    pochtyPoUmolchaniyu: pochty,
    balansKop: kto ? await balans(kto.userId) : 0,
  };

  return (
    <main id="main" className="page" tabIndex={-1}>
      {/* ⚠️ ЦЕЛЬ СТОИТ ЗДЕСЬ, А НЕ ПОД УСЛОВИЕМ ВХОДА. «Начато
          оформление» — это приход на страницу заказа: человек уже
          выбрал тариф и нажал кнопку. Повесь мы её на показ формы —
          в отчёт попадали бы только вошедшие, то есть воронка
          потеряла бы ровно тот шаг, где люди и отваливаются. */}
      <Celi imya={CELI.oformlenieNachato} />
      <a className="page__back" href="/">← На главную</a>
      <h1 className="page__h">{zagolovok}</h1>
      <p className="page__lead">
        {podarok
          ? `Сертификат стоит ровно столько, сколько сам тариф: ${tarif.note.charAt(0).toLowerCase()}${tarif.note.slice(1)}`
          : tarif.note}
      </p>

      {kto ? (
        <>
          <p className="cab__mail">
            Заказ оформляется на {kto.email}. <a href="/cabinet/">Личный кабинет</a>
          </p>
          <CheckoutForm vvod={vvod} />
        </>
      ) : (
        <LoginBox
          /* ⚠️ В АДРЕС УХОДИТ РАЗОБРАННЫЙ РЕЖИМ, А НЕ СЫРАЯ СТРОКА
             ИЗ АДРЕСНОЙ СТРОКИ: тариф и срок здесь уже сверены
             с каталогом, и `mode` — единственное, что шло дальше
             как есть. Уйти на чужой домен он не мог (адрес
             начинается с `/checkout/?`), но дописать своих
             параметров — вполне. */
          next={`/checkout/?plan=${tarif.id}&period=${period}${podarok ? '&gift=1' : prodlit > 0 ? `&renew=${prodlit}` : vvod.rezhimPoUmolchaniyu === 'renew' ? '&mode=renew' : ''}`}
          zagolovok={podarok ? 'Сначала вход — на эту же почту придёт код сертификата' : 'Сначала вход — на эту же почту придёт доступ'}
        />
      )}
    </main>
  );
}

import CertificateForm from './CertificateForm';
import LoginBox from './LoginBox';
import PodarokForm from './PodarokForm';
import Vkladki from './Vkladki';
import { ktoKlient } from '@/lib/server/auth';
import { katalog } from '@/lib/server/catalog';
import { bazaEst } from '@/lib/server/db';

/**
 * СТРАНИЦА СЕРТИФИКАТОВ — ОДНА НА ДВА АДРЕСА.
 *
 * ⚠️ АДРЕСОВ ДВА, И ЭТО НЕ ДУБЛИРОВАНИЕ. `/sertifikaty/` — новый адрес
 * из меню, он открывается на «Подарить». `/certificate/` — старый,
 * он стоит в письмах, в кабинете и в ссылках, которые люди уже
 * сохранили; он открывается на «Активировать». Содержимое у них одно
 * и то же и собирается здесь: две копии разошлись бы на первой правке.
 */
export default async function Sertifikaty({ nachalnaya }: { nachalnaya: 'podarit' | 'aktivirovat' }) {
  if (!bazaEst()) {
    return (
      <main id="main" className="page" tabIndex={-1}>
        <h1 className="page__h">Сертификаты</h1>
        <p className="err">Сервис временно недоступен. Попробуйте чуть позже.</p>
        <a className="page__back" href="/">← На главную</a>
      </main>
    );
  }
  const [kto, spisok] = await Promise.all([ktoKlient(), katalog()]);
  /* Дарить можно только то, что вообще оформляется: тариф без единой
     цены в подарок не годится ровно так же, как и себе. */
  const darimye = spisok.filter((t) => t.ceny.length > 0);

  return (
    <main id="main" className="page" tabIndex={-1}>
      <a className="page__back" href="/">← На главную</a>
      <h1 className="page__h">Сертификаты</h1>
      <p className="page__lead">
        Любой тариф можно подарить: сертификат стоит ровно столько же, а тариф и срок
        зашиты в его коде. Получатель вводит код здесь же — платить ему ничего не нужно.
      </p>

      <Vkladki
        nachalnaya={nachalnaya}
        podarit={<PodarokForm tarify={darimye} />}
        aktivirovat={
          <>
            {!kto ? <LoginBox next="/certificate/" zagolovok="Вход — на эту почту придёт доступ" /> : null}
            <CertificateForm voshyol={Boolean(kto)} />
          </>
        }
      />
    </main>
  );
}

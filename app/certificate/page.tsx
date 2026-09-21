import '../shop.css';
import type { Metadata } from 'next';
import CertificateForm from '@/components/shop/CertificateForm';
import LoginBox from '@/components/shop/LoginBox';
import { ktoKlient } from '@/lib/server/auth';
import { bazaEst } from '@/lib/server/db';

export const metadata: Metadata = { title: 'Активация сертификата — Spotik Shop', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function Certificate() {
  if (!bazaEst()) {
    return (
      <main id="main" className="page" tabIndex={-1}>
        <h1 className="page__h">Сертификат</h1>
        <p className="err">Сервис временно недоступен. Попробуйте чуть позже.</p>
      </main>
    );
  }
  const kto = await ktoKlient();
  return (
    <main id="main" className="page" tabIndex={-1}>
      <a className="page__back" href="/">← На главную</a>
      <h1 className="page__h">Активация сертификата</h1>
      <p className="page__lead">
        Введите код с сертификата, войдите по коду из письма — и выберите, заводить новый
        аккаунт или продлить свой. Платить ничего не нужно.
      </p>
      {!kto ? <LoginBox next="/certificate/" zagolovok="Вход — на эту почту придёт доступ" /> : null}
      <CertificateForm voshyol={Boolean(kto)} />
    </main>
  );
}

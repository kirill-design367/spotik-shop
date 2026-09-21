import '../../shop.css';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Оплата не прошла — Spotik Shop', robots: { index: false, follow: false } };

export default function PayFail() {
  return (
    <main id="main" className="page" tabIndex={-1}>
      <h1 className="page__h">Оплата не прошла</h1>
      <p className="page__lead">
        Деньги не списаны. Заказ сохранён и ждёт оплаты в личном кабинете — попробовать
        можно ещё раз, ничего заполнять заново не нужно.
      </p>
      <a className="btn" href="/cabinet/">В личный кабинет</a>
    </main>
  );
}

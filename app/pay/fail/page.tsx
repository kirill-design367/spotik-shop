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
      {/* Та же ПЛАШКА, что и в оформлении: обрыв на странице банка
          при включённом VPN выглядит как поломка нашего сайта, и здесь
          человек уже на неё наткнулся. См. CheckoutForm. Подложка
          здесь берётся от `--surface`: плашка лежит прямо на фоне
          страницы, а не внутри панели. */}
      <p className="panel__note panel__note--plate">
        Если у вас включён VPN, выключите его на время оплаты — банк может не
        пропустить платёж.
      </p>
      <a className="btn" href="/cabinet/">В личный кабинет</a>
    </main>
  );
}

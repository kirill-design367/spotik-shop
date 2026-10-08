import '../../shop.css';
import type { Metadata } from 'next';
import { VPN_OPLATA_TEKST } from '@/lib/plans';

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
      <p className="panel__note panel__note--plate">{VPN_OPLATA_TEKST}</p>
      {/* Та же пара кнопок, что на успешной странице: вернуться
          на сайт со страницы оплаты нечем, кроме этой ссылки. */}
      <div className="page__knopki">
        <a className="btn" href="/cabinet/">В личный кабинет</a>
        <a className="btn btn--ghost" href="/">Вернуться на сайт</a>
      </div>
    </main>
  );
}

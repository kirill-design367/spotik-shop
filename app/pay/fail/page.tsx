import '../../shop.css';
import type { Metadata } from 'next';
import { VPN_OPLATA_TEKST } from '@/lib/plans';
import { odna } from '@/lib/server/db';
import { ktoKlient } from '@/lib/server/auth';

export const metadata: Metadata = { title: 'Оплата не прошла — Spotik Shop', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/**
 * ⚠️ СЮДА ПРИХОДИТ И НЕУДАВШЕЕСЯ ПОПОЛНЕНИЕ БАЛАНСА (Р-168): Fail URL
 * в кабинете Робокассы один на магазин. Говорить человеку, пополнявшему
 * баланс, что «заказ сохранён», значило бы рассказывать про заказ,
 * которого он не оформлял.
 *
 * Номер счёта на этом адресе Робокасса не подписывает, поэтому он
 * решает ТОЛЬКО СЛОВА, и только для своего: счёт ищется среди платежей
 * вошедшего человека. Подтверждать или менять здесь нечего — страница
 * ничего и не трогает (закон 34).
 */
export default async function PayFail({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const syroe = sp.InvId ?? sp.inv_id;
  const nomer = Number(Array.isArray(syroe) ? syroe[0] : syroe);
  const kto = Number.isSafeInteger(nomer) && nomer > 0 ? await ktoKlient() : null;
  const popolnenie = kto
    ? await odna<{ id: string }>(`select id from payment where id = $1 and kind = 'topup' and user_id = $2`, [
        nomer,
        kto.userId,
      ]).catch(() => null) // база моргнула — страница обязана открыться с обычным текстом
    : null;

  return (
    <main id="main" className="page" tabIndex={-1}>
      <h1 className="page__h">Оплата не прошла</h1>
      {popolnenie ? (
        <p className="page__lead">
          Деньги не списаны, баланс не пополнен. Попробовать можно ещё раз — в личном кабинете,
          кнопкой «Пополнить баланс».
        </p>
      ) : (
        <p className="page__lead">
          Деньги не списаны. Заказ сохранён и ждёт оплаты в личном кабинете — попробовать
          можно ещё раз, ничего заполнять заново не нужно.
        </p>
      )}
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

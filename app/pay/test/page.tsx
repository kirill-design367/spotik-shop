import '../../shop.css';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { odna } from '@/lib/server/db';
import { ktoKlient } from '@/lib/server/auth';
import { imitatorVklyuchyon } from '@/lib/server/payments';
import { rubli } from '@/lib/server/money';
import { deystviePodtverditTest } from '@/lib/server/actions-client';

export const metadata: Metadata = { title: 'Тестовая оплата — Spotik Shop', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/**
 * ТЕСТОВАЯ ОПЛАТА — только в проверках и только на своей машине.
 *
 * ⚠️ СТРАНИЦЫ НЕ СУЩЕСТВУЕТ, ЕСЛИ ИМИТАТОР ВЫКЛЮЧЕН: настоящий 404,
 * а не страница со словами «не найдено». На боевом сервере секрета
 * нет вовсе, поэтому её там нет; появятся ключи Робокассы — не будет
 * и при забытом секрете. Нажатие зовёт ТУ ЖЕ дверь, что и настоящее
 * уведомление: проверяется вся цепочка целиком.
 */
export default async function PayTest({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!imitatorVklyuchyon()) notFound();
  const sp = await searchParams;
  const platyozh = Number(Array.isArray(sp.payment) ? sp.payment[0] : sp.payment);
  const kto = await ktoKlient();
  const p =
    kto && platyozh
      ? await odna<{ amount_kop: string; order_id: string; status: string }>(
          `select p.amount_kop, p.order_id, p.status
             from payment p join shop_order o on o.id = p.order_id
            where p.id = $1 and o.user_id = $2`,
          [platyozh, kto.userId],
        )
      : null;

  return (
    <main id="main" className="page" tabIndex={-1}>
      <h1 className="page__h">Тестовая оплата</h1>
      <p className="err">
        Настоящая оплата ещё не подключена: у магазина нет ключей Робокассы. Эта страница
        подтверждает платёж вручную и нужна только для проверки.
      </p>
      {!p ? (
        <p className="empty">Счёт не найден. <a href="/cabinet/">В личный кабинет</a></p>
      ) : p.status === 'paid' ? (
        <p className="ok">Этот счёт уже подтверждён. <a href="/cabinet/">В личный кабинет</a></p>
      ) : (
        <form action={deystviePodtverditTest} className="panel">
          <p className="sum sum--total">
            <span>Заказ № {p.order_id}</span>
            <span className="tnum">{rubli(Number(p.amount_kop))}</span>
          </p>
          <input type="hidden" name="payment" value={platyozh} />
          <button type="submit" className="btn btn--wide">Подтвердить оплату (тест)</button>
        </form>
      )}
    </main>
  );
}

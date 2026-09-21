import '../../shop.css';
import type { Metadata } from 'next';
import { odna } from '@/lib/server/db';
import { ktoKlient } from '@/lib/server/auth';
import { nastroyki, proveritVozvrat } from '@/lib/server/robokassa';

export const metadata: Metadata = { title: 'Оплата — Spotik Shop', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/**
 * ВОЗВРАТ ЧЕЛОВЕКА ПОСЛЕ ОПЛАТЫ.
 *
 * ⚠️ ЭТА СТРАНИЦА НИЧЕГО НЕ ПОДТВЕРЖДАЕТ И НИЧЕГО НЕ МЕНЯЕТ —
 * прямое требование постановки. Статус «оплачен» ставит ТОЛЬКО
 * проверенное уведомление Робокассы на ResultURL. Браузер сюда
 * приводит и человека, у которого платёж не прошёл, и того, кто
 * открыл ссылку из истории.
 *
 * Подпись возврата мы всё же проверяем — но лишь затем, чтобы
 * показать номер заказа: по непроверенной ссылке можно попросить
 * чужой.
 */
export default async function PayOk({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const pary: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) pary[k] = Array.isArray(v) ? (v[0] ?? '') : (v ?? '');

  const kto = await ktoKlient();
  const platyozh = proveritVozvrat(nastroyki(), pary);
  let zakaz: number | null = null;
  let oplachen = false;
  if (platyozh && kto) {
    const r = await odna<{ order_id: string; status: string }>(
      `select p.order_id, o.status
         from payment p join shop_order o on o.id = p.order_id
        where p.id = $1 and o.user_id = $2`,
      [platyozh, kto.userId],
    );
    if (r) {
      zakaz = Number(r.order_id);
      oplachen = r.status !== 'new';
    }
  }

  return (
    <main id="main" className="page" tabIndex={-1}>
      <h1 className="page__h">Спасибо</h1>
      {oplachen ? (
        <p className="ok">
          Оплата подтверждена{zakaz ? `, заказ № ${zakaz} принят в работу` : ''}. Доступ появится
          в личном кабинете.
        </p>
      ) : (
        <p className="page__lead">
          {zakaz ? `Заказ № ${zakaz}. ` : ''}Платёж отправлен. Подтверждение приходит от банка
          в течение нескольких минут — статус заказа обновится в кабинете сам.
        </p>
      )}
      <a className="btn" href="/cabinet/">В личный кабинет</a>
    </main>
  );
}

/**
 * Свой имитатор уведомления об оплате.
 *
 * ⚠️ ПОКА КЛЮЧЕЙ РОБОКАССЫ НЕТ, ОПЛАТУ НАДО ЧЕМ-ТО ПРОВЕРЯТЬ —
 * прямая постановка. Имитатор зовёт ТУ ЖЕ дверь, что и настоящее
 * уведомление (`otmetitOplachennym`), поэтому проверяется вся
 * цепочка целиком: статус заказа, письмо, сертификат, очередь
 * оператору.
 *
 * ⚠️ ДВА ЗАМКА, И ОБА ОБЯЗАТЕЛЬНЫ. Путь существует, только если
 * в окружении задан отдельный секрет И настоящая Робокасса ещё
 * не настроена. Как только появятся боевые ключи, имитатор отвечает
 * 404, даже если секрет забыли убрать: «режим отладки по флажку»
 * рано или поздно остаётся включённым на бою.
 */

import { env } from '@/lib/server/env';
import { imitatorVklyuchyon } from '@/lib/server/payments';
import { otmetitOplachennym } from '@/lib/server/orders';
import { sovpali } from '@/lib/server/crypto';
import { log } from '@/lib/server/log';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  if (!imitatorVklyuchyon()) return new Response('not found', { status: 404 });
  const u = new URL(req.url);
  const secret = u.searchParams.get('secret') ?? req.headers.get('x-spotik-secret') ?? '';
  if (!sovpali(secret, env.payFakeSecret)) return new Response('forbidden', { status: 403 });

  const platyozh = Number(u.searchParams.get('payment') ?? 0);
  if (!platyozh) return new Response('payment is required', { status: 400 });
  // Сумма по умолчанию — ВЫСТАВЛЕННАЯ. Иначе имитатор подтверждал бы
  // платёж на ноль, а недоплата оплатой не считается.
  const { odna } = await import('@/lib/server/db');
  const p = await odna<{ amount_kop: string }>('select amount_kop from payment where id = $1', [platyozh]);
  if (!p) return new Response('no such payment', { status: 404 });
  const summa = Number(u.searchParams.get('sum_kop') ?? 0) || Number(p.amount_kop);

  log.warn('ИМИТАТОР ОПЛАТЫ: подтверждаем платёж вручную', { payment: platyozh, amount_kop: summa });
  await otmetitOplachennym(platyozh, summa);
  return new Response(`OK${platyozh}`, { status: 200, headers: { 'content-type': 'text/plain' } });
}

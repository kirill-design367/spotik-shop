/**
 * Очередь заказов в JSON — для самообновляющегося списка в админке.
 *
 * ⚠️ ОТДЕЛЬНЫЙ МАРШРУТ, А НЕ ПЕРЕЗАГРУЗКА СТРАНИЦЫ: постановка
 * требует, чтобы список новых оплаченных заказов обновлялся сам,
 * без перезагрузки. Отдаётся только то, что и так видно в таблице:
 * ни одного персонального поля, ни одного секрета.
 */

import { ktoSotrudnik } from '@/lib/server/auth';
import { ochered } from '@/lib/server/views';
import { bazaEst } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const s = await ktoSotrudnik();
  if (!s) return new Response('forbidden', { status: 403 });
  if (!bazaEst()) return Response.json({ rows: [] });
  return Response.json({ rows: await ochered(), at: new Date().toISOString() });
}

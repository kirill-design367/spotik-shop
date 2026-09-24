/**
 * ResultURL Робокассы.
 *
 * ⚠️ ЭТО ЕДИНСТВЕННОЕ МЕСТО, ГДЕ ЗАКАЗ СТАНОВИТСЯ ОПЛАЧЕННЫМ.
 * Подпись проверяется паролем №2, который знают только Робокасса
 * и наш сервер; всё остальное — включая возврат человека
 * на страницу успеха — ничего не подтверждает.
 *
 * ⚠️ ОТВЕЧАТЬ НАДО РОВНО `OK<номер>` И ТОЛЬКО ПРИ УСПЕХЕ. Робокасса
 * повторяет уведомление, пока не получит эту строку, и повтор —
 * это норма, а не сбой: обработка идемпотентна.
 *
 * ⚠️ ПРИНИМАЕМ И POST, И GET. В кабинете магазина метод выбирается
 * настройкой, и «у нас только POST» — это полдня на поиск причины,
 * по которой оплата не доходит.
 */

import { nastroyki, otvetPrinyato, POCHEMU_SLOVAMI, razobrat } from '@/lib/server/robokassa';
import { otmetitOplachennym } from '@/lib/server/orders';
import { log } from '@/lib/server/log';

export const dynamic = 'force-dynamic';

async function obrabotat(pary: Record<string, string>): Promise<Response> {
  const r = razobrat(nastroyki(), pary);
  if (!r.vzyali) {
    // ⚠️ В ЖУРНАЛ УХОДЯТ ТОЛЬКО ИМЕНА ПОЛЕЙ, а не значения:
    // Робокасса кладёт в уведомление и почту плательщика.
    //
    // ⚠️ ЗАПРОС БЕЗ ЕДИНОГО ПОЛЯ — ЭТО НЕ УВЕДОМЛЕНИЕ, И ОШИБКОЙ
    // ЕГО ЗВАТЬ НЕЛЬЗЯ. Так стучится наша же проверка выкладки
    // (она требует отказа), так ходят сканеры, так Робокасса
    // проверяет, жив ли адрес. Пока эти запросы писались тем же
    // ERR, что и настоящая беда, журнал был полон ложных ошибок —
    // и в них потерялось бы единственное НАСТОЯЩЕЕ уведомление,
    // у которого не сошлась подпись. Отказ при этом остаётся
    // прежним: 400 и ни байта тела.
    if (!r.imena.length) {
      log.info('пустой запрос на ResultURL: ни одного поля — проверка доступности или сканер, а не уведомление');
      return new Response('bad sign', { status: 400 });
    }
    log.error('уведомление Робокассы не принято', { why: r.pochemu, words: POCHEMU_SLOVAMI[r.pochemu], fields: r.imena.join(',') });
    return new Response('bad sign', { status: 400 });
  }
  await otmetitOplachennym(r.nomer, r.summaKop);
  log.info('уведомление Робокассы принято', { payment: r.nomer, amount_kop: r.summaKop });
  return new Response(otvetPrinyato(r.nomer), { status: 200, headers: { 'content-type': 'text/plain' } });
}

function izURL(u: URL): Record<string, string> {
  const out: Record<string, string> = {};
  u.searchParams.forEach((v, k) => (out[k] = v));
  return out;
}

export async function POST(req: Request): Promise<Response> {
  const tip = req.headers.get('content-type') ?? '';
  const pary = izURL(new URL(req.url));
  if (tip.includes('application/x-www-form-urlencoded') || tip.includes('multipart/form-data')) {
    const fd = await req.formData();
    fd.forEach((v, k) => (pary[k] = String(v)));
  }
  return obrabotat(pary);
}

export async function GET(req: Request): Promise<Response> {
  return obrabotat(izURL(new URL(req.url)));
}

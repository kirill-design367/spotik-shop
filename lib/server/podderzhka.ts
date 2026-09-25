/**
 * Обращения в поддержку.
 *
 * ⚠️ ФОРМА ПУБЛИЧНАЯ, И ЗА НЕЙ СТОИТ СЛУЖЕБНЫЙ ЧАТ. Значит она —
 * готовая труба для спама: без ограничения частоты чат завалят
 * за час, и настоящее обращение потеряется среди мусора. Поэтому
 * защит здесь три, и все три дешёвые:
 *
 *   1. ЧАСТОТА ПО АДРЕСУ: три обращения за десять минут и десять
 *      за сутки. Счётчик тот же, что у кода сертификата (Р-107):
 *      таблица без внешнего ключа, строка живёт двое суток
 *      и уходит уборкой;
 *   2. ЛОВУШКА ДЛЯ БОТА: поле, которого человек не видит вовсе.
 *      Заполнено — значит форму заполнял не человек, а обходчик,
 *      который просто пишет во все поля подряд. Ответ при этом
 *      ОБЫЧНЫЙ, «принято»: скажи мы «вы бот», и обходчик научился бы
 *      это поле пропускать;
 *   3. ВРЕМЯ НА ЗАПОЛНЕНИЕ: форма открылась меньше трёх секунд
 *      назад — это не человек. Величину пишет браузер, то есть
 *      обойти её можно; она и не задумана как замок, а отсекает
 *      самых простых обходчиков даром.
 *
 * ⚠️ ТЕКСТ ОБРАЩЕНИЯ НИГДЕ НЕ ХРАНИТСЯ. Он уходит в чат и всё:
 * заводить у себя базу чужих писем, в которых бывает что угодно
 * вплоть до пароля, — это новое место, где эти данные могут утечь.
 * В счётчике лежит только адрес и время.
 */

import { headers } from 'next/headers';
import { bazaEst, odna, zapros } from './db';
import { log } from './log';
import { soobshchitKomande } from './notify';
import { svyazNeVerna } from '@/lib/proverka';

/** Сколько обращений можно отправить. */
const ZA_DESYAT_MINUT = 3;
const ZA_SUTKI = 10;
/**
 * Меньше этого времени на заполнение — не человек.
 *
 * ⚠️ ВЕЛИЧИНА МАЛЕНЬКАЯ НАМЕРЕННО. Первая редакция брала три секунды
 * и на первом же прогоне отбила НАСТОЯЩУЮ отправку: сторож заполняет
 * форму мгновенно, а человек, у которого текст уже в буфере, уложится
 * в три секунды без труда — и обращение пропало бы молча, потому что
 * машинному ответ отдаётся обычный. Секунды с небольшим хватает,
 * чтобы отсечь обходчика, который шлёт форму, не открывая её.
 */
const MINIMUM_MS = 1200;

export type ItogObrashcheniya = { ok: true } | { ok: false; pochemu: string };

/** Тот же разбор адреса, что у лимита на код сертификата (Р-107). */
async function adresKlienta(): Promise<string> {
  const h = await headers();
  const realny = (h.get('x-real-ip') ?? '').trim();
  if (realny) return realny.slice(0, 64);
  const posledny = (h.get('x-forwarded-for') ?? '').split(',').pop()?.trim() ?? '';
  if (posledny) return posledny.slice(0, 64);
  return 'bez-adresa';
}

export async function prinyatObrashchenie(opts: {
  tekst: string;
  svyaz: string;
  lovushka: string;
  otkryto: number;
  ot: string | null;
  userId: number | null;
}): Promise<ItogObrashcheniya> {
  const tekst = opts.tekst.trim();
  if (tekst.length < 10) return { ok: false, pochemu: 'Опишите проблему хотя бы одним предложением' };
  if (tekst.length > 4000) return { ok: false, pochemu: 'Слишком длинно: не больше 4000 знаков' };
  const bedaSvyazi = svyazNeVerna(opts.svyaz);
  if (bedaSvyazi) return { ok: false, pochemu: bedaSvyazi };

  /* ⚠️ ЛОВУШКА И СЛИШКОМ БЫСТРОЕ ЗАПОЛНЕНИЕ ОТВЕЧАЮТ «ПРИНЯТО».
     Обходчик, которому сказали «вы бот», чинит свой обход за день;
     обходчик, которому сказали «спасибо», уходит довольный, а в чат
     не попадает ничего. */
  const bot = Boolean(opts.lovushka.trim()) || (opts.otkryto > 0 && Date.now() - opts.otkryto < MINIMUM_MS);
  if (bot) {
    log.warn('обращение отбито как машинное', { lovushka: Boolean(opts.lovushka.trim()) });
    return { ok: true };
  }

  const adres = await adresKlienta();
  if (bazaEst()) {
    const r = await odna<{ desyat: string; sutki: string }>(
      `select
         count(*) filter (where created_at > now() - interval '10 minutes')::text as desyat,
         count(*)::text as sutki
       from support_try
      where adres = $1 and created_at > now() - interval '1 day'`,
      [adres],
    );
    if (Number(r?.sutki ?? 0) >= ZA_SUTKI || Number(r?.desyat ?? 0) >= ZA_DESYAT_MINUT) {
      log.warn('обращения слишком часто', { adres });
      return { ok: false, pochemu: 'Обращение уже отправлено. Следующее можно отправить чуть позже.' };
    }
    await zapros('insert into support_try (adres, user_id) values ($1, $2)', [adres, opts.userId]);
  }

  await soobshchitKomande({ vid: 'obrashchenie', tekst, svyaz: opts.svyaz.trim(), ot: opts.ot });
  return { ok: true };
}

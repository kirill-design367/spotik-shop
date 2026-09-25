import '../../shop.css';
import type { Metadata } from 'next';
import { odna } from '@/lib/server/db';
import { ktoKlient } from '@/lib/server/auth';
import { nastroyki, proveritVozvrat } from '@/lib/server/robokassa';
import Celi from '@/components/shop/Celi';
import { CELI, type TovarZakaza } from '@/lib/metrika';
import { katalog, naytiTarif, srokPolno } from '@/lib/server/catalog';

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
  let podarok = false;
  let tovary: TovarZakaza[] = [];
  let vsegoRub = 0;
  if (platyozh && kto) {
    const r = await odna<{
      order_id: string;
      status: string;
      kind: string;
      plan_id: string;
      period: number;
      total_kop: string;
    }>(
      `select p.order_id, o.status, o.kind, o.plan_id, o.period, o.total_kop
         from payment p join shop_order o on o.id = p.order_id
        where p.id = $1 and o.user_id = $2`,
      [platyozh, kto.userId],
    );
    if (r) {
      zakaz = Number(r.order_id);
      oplachen = r.status !== 'new';
      podarok = r.kind === 'certificate';
    }
    /* ⚠️ СОСТАВ ЗАКАЗА СОБИРАЕТСЯ ТОЛЬКО ДЛЯ ОПЛАЧЕННОГО. Электронная
       коммерция обязана совпадать с деньгами, а «оплачен» здесь
       и значит «уведомление Робокассы проверено» (закон 34): по этой
       странице судить об оплате нельзя, и мы о ней не судим —
       мы читаем статус, поставленный уведомлением.

       ⚠️ И ВЫРУЧКА БЕРЁТСЯ ИЗ `total_kop`, А НЕ ИЗ ЦЕНЫ КАТАЛОГА:
       цену в админке правят, а заказ уже оплачен по своей. Каталог
       нужен ровно за названием тарифа. */
    if (r && oplachen) {
      const tarif = naytiTarif(await katalog(), r.plan_id);
      vsegoRub = Number(r.total_kop) / 100;
      tovary = [
        {
          id: `${r.plan_id}-${r.period}`,
          name: `${tarif?.name ?? r.plan_id}, ${srokPolno(r.period).toLowerCase()}`,
          price: vsegoRub,
          quantity: 1,
          category: podarok ? 'Сертификат' : 'Подписка',
        },
      ];
    }
  }

  return (
    <main id="main" className="page" tabIndex={-1}>
      {/* ⚠️ ГАЛОЧКА РИСУЕТСЯ SVG И ОЖИВАЕТ ЧИСТЫМ CSS: `stroke-dasharray`
          плюс `stroke-dashoffset`, то есть одна композитная величина
          и ни строчки скрипта. При «уменьшить движение» она просто
          стоит нарисованной — см. `shop.css`. */}
      <div className="spasibo">
        <svg className="galka" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
          <circle className="galka__krug" cx="32" cy="32" r="29" />
          <path className="galka__put" d="M19 33.5 L28 42.5 L45.5 23" />
        </svg>
        <h1 className="page__h" style={{ marginBottom: 6 }}>
          {oplachen ? 'Оплата прошла' : 'Спасибо'}
        </h1>
        <p className="page__lead" style={{ margin: 0 }}>
          {oplachen
            ? 'Заказ принят в работу. Дальше всё делаем мы.'
            : 'Платёж отправлен. Подтверждение от банка приходит за несколько минут — статус заказа обновится в кабинете сам.'}
        </p>
      </div>

      {oplachen && zakaz ? (
        <Celi
          imya={podarok ? [CELI.oplataProshla, CELI.sertifikatKuplen] : CELI.oplataProshla}
          zakaz={zakaz}
          vsegoRub={vsegoRub}
          tovary={tovary}
        />
      ) : null}

      {/* ⚠️ НОМЕРА ЗАКАЗА НА ЭТОЙ СТРАНИЦЕ БОЛЬШЕ НЕТ (постановка
          тридцать шестой итерации). Он стоял здесь как доказательство
          того, что платёж дошёл до нужного заказа, но человеку это
          ничего не даёт: заказ у него один и он его только что
          оформил. */}
      <ol className="shagi">
        <li className="shagi__sh">
          <span className="shagi__n" aria-hidden="true">1</span>
          <span>
            <b>Заказ у оператора.</b> Он заводит или продлевает аккаунт на те данные,
            которые вы указали.
          </span>
        </li>
        <li className="shagi__sh">
          <span className="shagi__n" aria-hidden="true">2</span>
          <span>
            <b>Включаем Premium.</b> {podarok
              ? 'Для сертификата этого шага нет: код придёт сразу.'
              : 'Ничего делать не нужно — просто подождите.'}
          </span>
        </li>
        <li className="shagi__sh">
          <span className="shagi__n" aria-hidden="true">3</span>
          <span>
            <b>{podarok ? 'Код появится в кабинете' : 'Доступ появится в кабинете'}</b> — и туда же
            придёт письмо на вашу почту.
          </span>
        </li>
      </ol>

      <p className="panel__note panel__note--plate">
        Обычно это 5–10 минут. Сервис работает с 10:00 до 22:00 по Москве — если заказ
        пришёл позже, его возьмут утром.
      </p>

      <a className="btn" href="/cabinet/">В личный кабинет</a>
    </main>
  );
}

import '../../shop.css';
import type { Metadata } from 'next';
import { bazaEst } from '@/lib/server/db';
import { podpiskaPoTokenu, type PodpiskaPoTokenu } from '@/lib/server/avtoplatezh';
import { deystvieOtklyuchitAvtoPoTokenu } from '@/lib/server/actions-client';

export const metadata: Metadata = {
  title: 'Автоплатёж — Spotik Shop',
  robots: { index: false, follow: false },
};
/** Страница читает токен из адреса и базу — статической быть не может. */
export const dynamic = 'force-dynamic';

/**
 * ОТКЛЮЧИТЬ АВТОПЛАТЁЖ ПО ССЫЛКЕ ИЗ ПИСЬМА (пятьдесят четвёртая итерация).
 *
 * Постановка: письмо о списании несёт «ссылку на отключение». Без входа:
 * человек, которому пришло письмо, должен суметь отказаться одним
 * нажатием, не вспоминая, как войти в кабинет (376-ФЗ: отказ —
 * в любой момент и просто).
 *
 * ⚠️ GET НЕ МЕНЯЕТ НИЧЕГО. Ссылку из письма открывают и сканеры почты,
 * и предпросмотр почтовой программы; отключает только нажатие —
 * POST серверного действия. Поэтому здесь кнопка, а не «уже отключено».
 *
 * ⚠️ СТРАНИЦА ПОД `/cabinet`, И ЭТО НЕ ДЛЯ ВХОДА: на этом префиксе нет
 * счётчика Метрики (Р-103), а токен лежит в адресе — вебвизору его
 * видеть незачем.
 *
 * ⚠️ НИ НОМЕРА ЗАКАЗА, НИ ПОЧТЫ АККАУНТА: только тариф и срок (закон 48;
 * письмо могут переслать, а страница открывается без входа).
 */
export default async function AvtoplatezhPoSsylke({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const t = (Array.isArray(sp.t) ? (sp.t[0] ?? '') : (sp.t ?? '')).slice(0, 200);
  const r: PodpiskaPoTokenu = bazaEst() ? await podpiskaPoTokenu(t) : { ok: false, pochemu: 'net' };

  return (
    <main id="main" className="page" tabIndex={-1}>
      <a className="page__back" href="/cabinet/">
        ← В личный кабинет
      </a>
      <h1 className="page__h">Автоплатёж</h1>

      {!r.ok ? (
        <>
          <p className="page__lead">
            {r.pochemu === 'istyok'
              ? 'Срок этой ссылки истёк — она действует тридцать дней. Отключить автоплатёж можно в личном кабинете.'
              : 'Ссылка не работает. Проверьте, что открыли её целиком из письма. Отключить автоплатёж можно и в личном кабинете.'}
          </p>
          <div className="page__knopki">
            <a className="btn btn--ghost" href="/cabinet/">
              В личный кабинет
            </a>
          </div>
        </>
      ) : r.status === 'vklyuchen' || r.status === 'zhdyot_oplaty' ? (
        <>
          <p className="page__lead">
            Подписка: {r.chto}. Отключите автоплатёж — и списаний по ней больше не будет; продлить можно будет
            вручную.
          </p>
          <div className="panel">
            <form action={deystvieOtklyuchitAvtoPoTokenu}>
              <input type="hidden" name="t" value={t} />
              <button type="submit" className="btn">
                Отключить автоплатёж
              </button>
            </form>
          </div>
          <div className="page__knopki">
            <a className="btn btn--ghost" href="/cabinet/">
              В личный кабинет
            </a>
          </div>
        </>
      ) : (
        <>
          <p className="page__lead">
            {r.status === 'ne_karta'
              ? `Автоплатёж по подписке «${r.chto}» не включился — списаний по ней нет.`
              : `Автоплатёж по подписке «${r.chto}» отключён. Списаний по ней больше не будет.`}
          </p>
          <div className="page__knopki">
            <a className="btn btn--ghost" href="/cabinet/">
              В личный кабинет
            </a>
          </div>
        </>
      )}
    </main>
  );
}

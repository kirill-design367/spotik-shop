import '../shop.css';
import type { Metadata } from 'next';
import KnopkaVSpotify from '@/components/shop/KnopkaVSpotify';
import { bazaEst } from '@/lib/server/db';
import { poTokenu } from '@/lib/server/vosstanovlenie';

export const metadata: Metadata = {
  title: 'Восстановление пароля Spotify — Spotik Shop',
  robots: { index: false, follow: false },
};
/** Страница читает токен из адреса и базу — статической быть не может. */
export const dynamic = 'force-dynamic';

/**
 * ВОССТАНОВЛЕНИЕ ПАРОЛЯ SPOTIFY ПО ССЫЛКЕ ИЗ ПИСЬМА.
 *
 * Постановка сорок второй итерации: «на странице — почта аккаунта
 * Spotify этого заказа и одна кнопка „Скопировать почту и перейти
 * в Spotify". Под кнопкой — одна строка подсказки».
 *
 * ⚠️ ПОЧТА ЗДЕСЬ РАСШИФРОВЫВАЕТСЯ БЕЗ СЕССИИ, НА СИЛУ ТОКЕНА, —
 * и это названное расширение закона 35: третий читатель, которому
 * отдана РОВНО ОДНА величина. Пароль по токену не отдаётся никуда
 * и никогда. Разбор — в `lib/server/vosstanovlenie.ts` и в Р-144.
 *
 * ⚠️ ОТКАЗ НЕ РАЗЛИЧАЕТ «ТАКОГО ТОКЕНА НЕТ» И «ЧУЖОЙ ТОКЕН»: обе
 * беды — это «ссылка не работает», и рассказывать пришедшему
 * с выдуманным токеном, что заказ существует, незачем. Различается
 * только истёкший срок: человеку надо знать, что дело в сроке,
 * а не в нём.
 */
export default async function Vosstanovlenie({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const t = Array.isArray(sp.t) ? (sp.t[0] ?? '') : (sp.t ?? '');
  const r = bazaEst() ? await poTokenu(t) : ({ ok: false, pochemu: 'net' } as const);

  return (
    <main id="main" className="page" tabIndex={-1}>
      <a className="page__back" href="/">← На главную</a>
      <h1 className="page__h">Не подошёл пароль от Spotify</h1>

      {!r.ok ? (
        <>
          <p className="page__lead">
            {r.pochemu === 'istyok'
              ? 'Срок этой ссылки истёк — она действует семь дней. Напишите нам, и мы пришлём новую.'
              : 'Ссылка не работает. Проверьте, что открыли её целиком из письма, или напишите нам.'}
          </p>
          <div className="page__knopki">
            <a className="btn btn--ghost" href="/">Вернуться на сайт</a>
          </div>
        </>
      ) : (
        <>
          <p className="page__lead">
            Задайте новый пароль в Spotify, а потом оформите заказ заново и укажите его.
          </p>
          <div className="panel">
            <h2 className="panel__h">Почта аккаунта Spotify</h2>
            {/* Почта стоит обычным выделяемым текстом: если буфер
                в браузере закрыт, человек всё равно может её взять. */}
            <p className="pochta-krupno">{r.pochta}</p>
            <KnopkaVSpotify pochta={r.pochta} />
            <p className="panel__note">Вставьте почту в поле и нажмите «Получить ссылку»</p>
          </div>
          <div className="page__knopki">
            <a className="btn btn--ghost" href="/">Вернуться на сайт</a>
          </div>
        </>
      )}
    </main>
  );
}

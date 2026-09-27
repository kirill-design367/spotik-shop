'use client';

/** Официальная страница восстановления пароля Spotify. */
const SPOTIFY = 'https://accounts.spotify.com/ru/password-reset';

/**
 * «Скопировать почту и перейти в Spotify» — одна кнопка на два дела.
 *
 * ⚠️ ПОРЯДОК ВАЖЕН: СНАЧАЛА БУФЕР, ПОТОМ ОКНО, И БЕЗ `await` МЕЖДУ
 * НИМИ. `navigator.clipboard.writeText` возвращает обещание, и если
 * дождаться его перед `window.open`, жест пользователя успевает
 * «истечь» — браузер считает открытие окна непрошеным и блокирует
 * его. Запись в буфер начинается синхронно внутри жеста, поэтому
 * достаточно её ЗАПУСТИТЬ.
 *
 * ⚠️ БЕЗ БУФЕРА НЕ ЛОМАЕТСЯ. `navigator.clipboard` есть только
 * на защищённом соединении и не во всяком браузере — то же правило,
 * что у `Kopirovat`: не скопировалось, значит человек берёт почту
 * со страницы глазами, она рядом и выделяется.
 *
 * ⚠️ ОКНО БЛОКИРОВАНО — ИДЁМ В ТОЙ ЖЕ ВКЛАДКЕ. Иначе нажатие
 * не делает ничего, а это худшее из состояний.
 */
export default function KnopkaVSpotify({ pochta }: { pochta: string }) {
  return (
    <button
      type="button"
      className="btn btn--wide"
      onClick={() => {
        try {
          void navigator.clipboard?.writeText(pochta);
        } catch {
          /* Буфера нет — почта на странице, её можно выделить. */
        }
        const okno = window.open(SPOTIFY, '_blank', 'noopener,noreferrer');
        if (!okno) window.location.assign(SPOTIFY);
      }}
    >
      Скопировать почту и перейти в Spotify
    </button>
  );
}

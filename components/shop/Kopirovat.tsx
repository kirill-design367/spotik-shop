'use client';

import { useState } from 'react';

/**
 * Копирование в один тап.
 *
 * ⚠️ БЕЗ `navigator.clipboard` НЕ ЛОМАЕТСЯ: он есть только
 * на защищённом соединении, а сайт открывают и по http на своём
 * сервере, и в старом браузере. Нет его — кнопки нет вовсе, и текст
 * рядом с ней остаётся обычным выделяемым текстом.
 */
export default function Kopirovat({ chto, chego }: { chto: string; chego: string }) {
  const [gotovo, setGotovo] = useState(false);
  return (
    <button
      type="button"
      className="kop"
      aria-label={`Скопировать ${chego}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(chto);
          setGotovo(true);
          window.setTimeout(() => setGotovo(false), 1600);
        } catch {
          /* Буфера нет — молчим: текст рядом, его можно выделить. */
        }
      }}
    >
      {gotovo ? 'Скопировано' : 'Копировать'}
    </button>
  );
}

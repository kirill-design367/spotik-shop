'use client';

import { useEffect, useRef } from 'react';
import { cel, pokupka, type TovarZakaza } from '@/lib/metrika';

/**
 * Цели Метрики, которые достигаются САМИМ ПОКАЗОМ страницы.
 *
 * ⚠️ ЦЕЛЬ ОТПРАВЛЯЕТСЯ РОВНО ОДИН РАЗ ЗА ПОКАЗ. `useEffect` с пустым
 * списком зависимостей в строгом режиме разработки вызывается дважды,
 * и без защёлки «оплата прошла» удваивалась бы в отчёте — но только
 * в разработке, то есть беда была бы невидимой на бою и заметной
 * в цифрах.
 *
 * ⚠️ И ЦЕЛЬ НИКОГДА НЕ РОНЯЕТ СТРАНИЦУ: счётчика может не быть
 * вовсе — его нет в кабинете и в админке по постановке, и его режет
 * любой блокировщик. Вся защита в `lib/metrika.ts`.
 */
export default function Celi({
  imya,
  zakaz,
  vsegoRub,
  tovary,
}: {
  imya: string | string[];
  /** Для электронной коммерции: заполняется только на успешной оплате. */
  zakaz?: number;
  vsegoRub?: number;
  tovary?: TovarZakaza[];
}) {
  /* ⚠️ ЗАЩЁЛКА ЖИВЁТ В `useRef`, А НЕ В САМОМ ЭФФЕКТЕ. Объявленная
     внутри, она создавалась бы заново на каждом вызове и не защёлкивала
     бы ничего вовсе: `let bylo = false; if (bylo) return;` — это всегда
     ложь. А защёлкивать надо по двум причинам сразу. Первая: в строгом
     режиме разработки React вызывает эффект ДВАЖДЫ, и «оплата прошла»
     удваивалась бы в отчёте — беда невидимая на бою и заметная только
     в цифрах. Вторая: `tovary` — массив, собранный в разметке заново,
     и React сравнивает зависимости ПО ССЫЛКЕ; любая перерисовка
     страницы отправила бы покупку ещё раз. */
  const otpravleno = useRef(false);

  useEffect(() => {
    if (otpravleno.current) return;
    otpravleno.current = true;
    for (const i of Array.isArray(imya) ? imya : [imya]) cel(i);
    if (zakaz && tovary?.length) pokupka(zakaz, vsegoRub ?? 0, tovary);
  }, [imya, zakaz, vsegoRub, tovary]);
  return null;
}

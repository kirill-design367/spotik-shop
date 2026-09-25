'use client';

import { useState, type ReactNode } from 'react';

/**
 * Карточка, которая схлопывается на отмену.
 *
 * ⚠️ СОДЕРЖИМОЕ ПО-ПРЕЖНЕМУ РИСУЕТ СЕРВЕР. Оно приходит сюда детьми,
 * то есть остаётся серверным деревом: выданные доступы не уезжают
 * в клиентский компонент пропами, и второго места, где решается,
 * кому их показывать, не заводится (Р-87, Р-102).
 *
 * ⚠️ СХЛОПЫВАНИЕ ЛОВИТ СОБЫТИЕ ОТПРАВКИ, А НЕ НАЖАТИЕ. Кнопка отмены
 * лежит внутри серверной формы, и повесить на неё обработчик отсюда
 * нечем; всплывающий `submit` от формы с признаком `data-otmena`
 * ловится на обёртке. Дальше серверное действие само перерисует
 * кабинет уже без этой карточки — схлопывание только закрывает
 * те доли секунды, пока оно идёт.
 *
 * Едут `grid-template-rows` и `opacity`; высота не читается ни разу.
 */
export default function Svorachivanie({ children }: { children: ReactNode }) {
  const [uhodit, setUhodit] = useState(false);
  return (
    <div
      className="svorach"
      data-uhodit={uhodit ? '' : undefined}
      onSubmitCapture={(e) => {
        const f = e.target as HTMLElement;
        if (f instanceof HTMLFormElement && f.dataset.otmena !== undefined) setUhodit(true);
      }}
    >
      <div>{children}</div>
    </div>
  );
}

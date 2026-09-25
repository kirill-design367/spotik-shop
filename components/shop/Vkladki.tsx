'use client';

import { useState, type ReactNode } from 'react';

/**
 * ДВЕ ВКЛАДКИ СТРАНИЦЫ СЕРТИФИКАТОВ: «Подарить» и «Активировать».
 *
 * ⚠️ ОБА СОДЕРЖИМЫХ ПРИХОДЯТ ПРОПАМИ И РИСУЮТСЯ СЕРВЕРОМ. Этот
 * компонент клиентский только затем, чтобы держать одно число —
 * какая вкладка открыта; всё остальное (каталог, вход, форма
 * активации) собирает страница. Перенеси мы сюда содержимое — оно
 * поехало бы в клиентский чанк целиком.
 *
 * ⚠️ НЕАКТИВНАЯ ВКЛАДКА СНИМАЕТСЯ ИЗ ДЕРЕВА, а не прячется стилем:
 * в ней лежат поля `email` и `code`, и спрятанные они остались бы
 * в порядке обхода табом и в дереве доступности.
 */
export default function Vkladki({
  nachalnaya,
  podarit,
  aktivirovat,
}: {
  nachalnaya: 'podarit' | 'aktivirovat';
  podarit: ReactNode;
  aktivirovat: ReactNode;
}) {
  const [tab, setTab] = useState<'podarit' | 'aktivirovat'>(nachalnaya);
  return (
    <>
      <div className="tabs" role="tablist" aria-label="Сертификаты">
        {(
          [
            ['podarit', 'Подарить'],
            ['aktivirovat', 'Активировать'],
          ] as const
        ).map(([k, t]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className="tabs__btn"
            onClick={() => setTab(k)}
          >
            {t}
          </button>
        ))}
      </div>
      <div>{tab === 'podarit' ? podarit : aktivirovat}</div>
    </>
  );
}

'use client';

import { useId, useState } from 'react';
import { BEZ_ZAPISI } from '@/lib/metrika';

/**
 * Поля данных аккаунта: почта и пароль.
 *
 * ⚠️ СООБЩЕНИЯ ОБ ОШИБКЕ — НАШИ, А НЕ БРАУЗЕРНЫЕ. Всплывающая
 * подсказка `required` приходит системным шрифтом, на языке системы
 * и в чужом визуальном языке — на странице, где всё остальное набрано
 * нашим. Поэтому у форм стоит `noValidate`, а проверку ведёт
 * `lib/proverka` — тот же модуль, что и на сервере.
 *
 * ⚠️ ГЛАЗ ЕСТЬ У КАЖДОГО ПОЛЯ ПАРОЛЯ. Человек вводит пароль, который
 * потом сам же будет набирать в Spotify: не показать его — значит
 * почти гарантировать опечатку, а опечатка здесь стоит заказа.
 *
 * ⚠️ ПОДСКАЗКА ЕСТЬ ТОЛЬКО У ПОЧТЫ, И ЭТО НЕ НЕДОДЕЛКА. Пароли
 * не подсказываются ни при каких условиях: они лежат шифротекстом
 * ровно затем, чтобы не оказываться на экране лишний раз (закон 35),
 * и открытый пароль в выпадающем списке был бы третьим местом,
 * где он виден. Почту человек и так знает — подсказка экономит ему
 * набор, а не открывает тайну.
 */

export function Pole({
  imya,
  podpis,
  tip = 'text',
  znachenie,
  menyat,
  beda,
  podskazka,
  avto,
  pochty,
  zagolovokPochty,
}: {
  imya: string;
  podpis: string;
  tip?: 'text' | 'email';
  znachenie: string;
  menyat: (v: string) => void;
  beda?: string | null;
  podskazka?: string;
  avto?: string;
  /** Почты из прошлых заказов этого же кабинета. Пусто — списка нет. */
  pochty?: string[];
  zagolovokPochty?: string;
}) {
  const id = useId();
  const [fokus, setFokus] = useState(false);
  const spisok = pochty ?? [];
  const otkryt = fokus && spisok.length > 0;
  return (
    /* ⚠️ ФОКУС СТЕРЕЖЁТ ОБЁРТКА, А НЕ САМО ПОЛЕ. `blur` у поля
       срабатывает РАНЬШЕ, чем нажатие по подсказке, и список успевал
       закрыться до того, как выбор доходил. Здесь `onBlur` ловится
       всплытием и смотрит, КУДА ушёл фокус: остался внутри обёртки —
       список открыт. Плюс у самой подсказки снят `mousedown`: тогда
       фокус не уходит вовсе, и в Safari, где кнопка по нажатию
       фокуса не получает, это единственное, что работает. Таймеров
       нет ни одного — они дали бы гонку. */
    <div
      className="field"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFokus(false);
      }}
    >
      <label className="field__label" htmlFor={id}>{podpis}</label>
      <input
        id={id}
        type={tip}
        name={imya}
        value={znachenie}
        onChange={(e) => menyat(e.target.value)}
        onFocus={() => setFokus(true)}
        autoComplete={avto ?? 'off'}
        className={BEZ_ZAPISI}
        aria-invalid={beda ? true : undefined}
        aria-describedby={podskazka || beda ? `${id}-p` : undefined}
      />
      {/* Список ВСЕГДА в разметке и схлопывается переходом
          `grid-template-rows: 0fr → 1fr` — тот же приём, что
          у «Изменить» выше: высоту списка иначе пришлось бы мерить
          из JS. Закрытый выведен из обхода клавиатурой `inert`. */}
      {spisok.length ? (
        <div className="pochty" data-on={otkryt ? '' : undefined}>
          <div className="pochty__nutro" {...(otkryt ? {} : { inert: '' as unknown as boolean })}>
            <p className="pochty__z">{zagolovokPochty ?? 'Ваши почты из прошлых заказов'}</p>
            {spisok.map((p) => (
              <button
                key={p}
                type="button"
                className="pochty__p"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  menyat(p);
                  setFokus(false);
                }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {beda ? (
        <p className="field__beda" id={`${id}-p`}>{beda}</p>
      ) : podskazka ? (
        <p className="field__hint" id={`${id}-p`}>{podskazka}</p>
      ) : null}
    </div>
  );
}

export function PoleParolya({
  imya,
  podpis,
  znachenie,
  menyat,
  beda,
  podskazka,
}: {
  imya: string;
  podpis: string;
  znachenie: string;
  menyat: (v: string) => void;
  beda?: string | null;
  podskazka?: string;
}) {
  const id = useId();
  const [vidno, setVidno] = useState(false);
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>{podpis}</label>
      <div className="field__box">
        <input
          id={id}
          type={vidno ? 'text' : 'password'}
          name={imya}
          value={znachenie}
          onChange={(e) => menyat(e.target.value)}
          autoComplete="off"
          className={`${BEZ_ZAPISI} field__vvod--sglazom`}
          aria-invalid={beda ? true : undefined}
          aria-describedby={podskazka || beda ? `${id}-p` : undefined}
        />
        <button
          type="button"
          className="field__glaz"
          onClick={() => setVidno((v) => !v)}
          aria-pressed={vidno}
          aria-label={vidno ? 'Скрыть пароль' : 'Показать пароль'}
        >
          {/* Знак рисуем сами: чужих иконочных шрифтов в проекте нет. */}
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path
              d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
            {vidno ? <path d="M4 20 20 4" stroke="currentColor" strokeWidth="1.6" /> : null}
          </svg>
        </button>
      </div>
      {beda ? (
        <p className="field__beda" id={`${id}-p`}>{beda}</p>
      ) : podskazka ? (
        <p className="field__hint" id={`${id}-p`}>{podskazka}</p>
      ) : null}
    </div>
  );
}

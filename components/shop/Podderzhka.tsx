'use client';

import type { ComponentType } from 'react';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Плашка «Поддержка» в правом нижнем углу — на всех страницах.
 *
 * ⚠️ САМА ФОРМА ТЯНЕТСЯ ОТДЕЛЬНЫМ ЧАНКОМ И ТОЛЬКО ПРИ ОТКРЫТИИ.
 * Плашка стоит в корневой раскладке, то есть попадает в критический
 * путь ВСЕХ страниц, включая лендинг: положи мы форму рядом — за неё
 * платил бы первый экран, который двадцать шесть итераций доводили
 * до 90+ (Р-103, та же причина, по которой счётчик Метрики стоит
 * инлайном, а не клиентским компонентом).
 *
 * ⚠️ НА ЛЕНДИНГЕ ПЛАШКА ПОЯВЛЯЕТСЯ ПОСЛЕ ПЕРВОГО ЭКРАНА — постановка:
 * там она перекрывала бы вордмарк, а на первом экране приём ровно
 * один, и это слово. Позиция читается из `#scroller`, а не из окна:
 * документ у нас неподвижен (Р-37).
 */
/**
 * ⚠️ ЧАНК ФОРМЫ ГРУЗИТСЯ ДО ОТКРЫТИЯ, А НЕ ВМЕСТЕ С НИМ, И ЭТО ПРИЧИНА
 * РЫВКА, А НЕ УКРАШЕНИЕ.
 *
 * Прежде форма стояла `next/dynamic`, и первый кадр накладки рисовался
 * БЕЗ НЕЁ: в окне была одна шапка. Чанк приезжал через кадр-другой,
 * форма монтировалась, окно вырастало — а прижато оно на телефоне
 * НИЗОМ, значит росло вверх. Это и читалось как «появилось и резко
 * прыгнуло выше».
 *
 * Теперь модуль берётся руками и в двух местах: как только плашка
 * стала видна (человек ещё листает) и на первое касание кнопки.
 * Само окно открывается ТОЛЬКО когда модуль уже есть, поэтому конечная
 * высота известна на первом же кадре и расти окну нечем.
 */
type FormaProps = { pochta?: string | null; zakryt?: () => void };

export default function Podderzhka() {
  const put = usePathname() ?? '/';
  /* Лендинг — единственное место, где плашка ждёт первого экрана. */
  const posleHiro = put === '/';
  /* ⚠️ В АДМИНКЕ ПЛАШКИ НЕТ. Поддержка — для покупателей; сотруднику
     писать самому себе незачем, а лишний элемент поверх рабочего
     экрана мешает. Отступление от «на всех страницах» названо
     в отчёте. */
  const vAdminke = put.startsWith('/admin');
  const [vidna, setVidna] = useState(!posleHiro);
  const [otkryto, setOtkryto] = useState(false);
  const forma = useRef<ComponentType<FormaProps> | null>(null);
  const gruzitsya = useRef<Promise<void> | null>(null);
  const [gotova, setGotova] = useState(false);

  const zagruzit = useCallback(() => {
    if (!gruzitsya.current) {
      gruzitsya.current = import('./PodderzhkaForma')
        .then((m) => {
          forma.current = m.default;
        })
        .catch(() => {
          /* Не доехал чанк — окно всё равно откроется, в нём будет
             честная строка с почтой поддержки, а не пустота. */
          gruzitsya.current = null;
        });
    }
    return gruzitsya.current;
  }, []);

  /* Плашка показалась — чанк греется. К моменту нажатия он уже лежит,
     и открытие идёт в тот же кадр. */
  useEffect(() => {
    if (!vidna) return;
    void zagruzit();
  }, [vidna, zagruzit]);

  const otkryt = useCallback(async () => {
    await zagruzit();
    setGotova(true);
    setOtkryto(true);
  }, [zagruzit]);

  useEffect(() => {
    if (!posleHiro) return;
    const sc = document.getElementById('scroller');
    if (!sc) return;
    const proverit = () => setVidna(sc.scrollTop > window.innerHeight * 0.9);
    proverit();
    sc.addEventListener('scroll', proverit, { passive: true });
    return () => sc.removeEventListener('scroll', proverit);
  }, [posleHiro]);

  /* Esc закрывает, как и у меню: это накладка, и вести себя она
     обязана как накладка. */
  useEffect(() => {
    if (!otkryto) return;
    const klavisha = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOtkryto(false);
    };
    document.addEventListener('keydown', klavisha);
    return () => document.removeEventListener('keydown', klavisha);
  }, [otkryto]);

  if (vAdminke) return null;

  return (
    <>
      <button
        type="button"
        className="pd__knopka"
        data-vidna={vidna ? '' : undefined}
        aria-hidden={vidna ? undefined : true}
        tabIndex={vidna ? 0 : -1}
        onPointerDown={() => void zagruzit()}
        onClick={() => void otkryt()}
      >
        {/* Наушники нарисованы нами: дуга сверху, чашки по бокам.
            Ни одного чужого знака — закон 16. */}
        <svg className="pd__ikonka" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M3.6 14.4v-2a8.4 8.4 0 0 1 16.8 0v2"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinecap="round"
          />
          <rect x="1.5" y="13.1" width="5.2" height="8.4" rx="2.6" fill="currentColor" />
          <rect x="17.3" y="13.1" width="5.2" height="8.4" rx="2.6" fill="currentColor" />
        </svg>
        Поддержка
      </button>
      {otkryto ? (
        <div className="pd__nakladka" role="dialog" aria-modal="true" aria-label="Обращение в поддержку">
          <div className="pd__okno">
            <div className="pd__shapka">
              <h2 className="panel__h" style={{ margin: 0 }}>Оставить обращение</h2>
              <button type="button" className="pd__krest" onClick={() => setOtkryto(false)} aria-label="Закрыть">
                ✕
              </button>
            </div>
            {gotova && forma.current ? (
              <forma.current zakryt={() => setOtkryto(false)} />
            ) : (
              <p className="panel__note">
                Форма не загрузилась. Напишите нам на{' '}
                <a href="mailto:lev.menashe@yandex.ru">lev.menashe@yandex.ru</a>.
              </p>
            )}
          </div>
          {/* Клик мимо окна закрывает — обычное поведение накладки. */}
          <button type="button" className="pd__fon" onClick={() => setOtkryto(false)} aria-label="Закрыть" />
        </div>
      ) : null}
    </>
  );
}

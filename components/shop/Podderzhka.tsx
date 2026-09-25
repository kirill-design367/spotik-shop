'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

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
const Forma = dynamic(() => import('./PodderzhkaForma'), { ssr: false });

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
        onClick={() => setOtkryto(true)}
      >
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
            <Forma zakryt={() => setOtkryto(false)} />
          </div>
          {/* Клик мимо окна закрывает — обычное поведение накладки. */}
          <button type="button" className="pd__fon" onClick={() => setOtkryto(false)} aria-label="Закрыть" />
        </div>
      ) : null}
    </>
  );
}

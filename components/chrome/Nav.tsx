'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { scrollToId, scroller } from '@/lib/scroll';
import WordmarkMark from '@/components/wordmark/WordmarkMark';

/**
 * Навигация хиро и мобильное меню.
 *
 * ── ШАПКА ЭТО НАКЛАДКА ─────────────────────────────────────────────────────
 * Она вышла из потока: на мобильной слово занимает весь экран, и шапка
 * лежит поверх него. Цвет она не переключает по скроллу, а СМЕШИВАЕТСЯ
 * с тем, что под ней (mix-blend-mode: difference) — на зелёном слове
 * читается тёмной, на тёмном фоне светлой. Подробности в components.css.
 *
 * ── БУРГЕР В ДВЕ ПОЛОСЫ ────────────────────────────────────────────────────
 * Две, а не три: так просил арт-директор. Полосы короткие и плотные,
 * тач-цель при этом полные 44 px — габарит знака и габарит цели
 * разведены намеренно.
 *
 * ── НАКЛАДКА МЕНЮ ──────────────────────────────────────────────────────────
 * Полноэкранная, плотная, через портал в body: внутри хиро она оказалась бы
 * в его контексте наложения, и следующие секции перекрыли бы её.
 * Прокрутка под накладкой заблокирована — у контейнера снимается overflow.
 *
 * Слева — СЛОТ ПОД ЛОГОТИП. Знак клиент разрабатывает отдельно, поэтому
 * место под него зарезервировано жёстко (122×26 на мобильном, 164×35
 * на десктопе): готовый логотип встанет внутрь без переверстки.
 */
const LINKS: [id: string, label: string][] = [
  ['pricing', 'Тарифы'],
  ['how', 'Как это работает'],
  ['gift', 'Сертификат'],
  ['faq', 'Вопросы'],
];

export default function Nav() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const burgerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setMounted(true), []);

  const close = useCallback(() => {
    setOpen(false);
    burgerRef.current?.focus();
  }, []);

  /* Пока накладка открыта: страница под ней не едет, Esc закрывает,
     фокус уходит на крестик. Возврат фокуса на бургер — в close(). */
  useEffect(() => {
    if (!open) return;
    const sc = scroller();
    const prev = sc?.style.overflow ?? '';
    if (sc) sc.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (sc) sc.style.overflow = prev;
    };
  }, [open, close]);

  const go = (id: string) => () => {
    setOpen(false);
    scrollToId(id);
  };

  const overlay = (
    <div className="menu" data-open={open ? '1' : undefined} aria-hidden={!open}>
      <div className="menu__bar shell">
        <div className="logo-slot" data-logo-slot="reserved">
          <span className="logo-slot__text">SPOTIK</span>
        </div>
        <button ref={closeRef} type="button" className="menu__close" onClick={close}>
          <span className="sr-only">Закрыть меню</span>
          <span className="menu__cross" aria-hidden="true" />
        </button>
      </div>

      <nav className="menu__list" aria-label="Меню разделов">
        {LINKS.map(([id, label], i) => (
          <button
            key={id}
            type="button"
            className="menu__item"
            style={{ ['--i' as string]: i }}
            onClick={go(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="menu__foot shell">
        <WordmarkMark className="menu__mark" />
        <p className="menu__contacts">
          <a href="mailto:lev.menashe@yandex.ru">lev.menashe@yandex.ru</a>
          <a href="tel:+79503738046" className="tnum">
            +7 950 373-80-46
          </a>
        </p>
      </div>
    </div>
  );

  return (
    <nav className="nav" aria-label="Основная навигация">
      <div className="nav__inner shell">
        <div className="logo-slot" data-logo-slot="reserved">
          <a
            className="logo-slot__text"
            href="#hero"
            onClick={(e) => {
              e.preventDefault();
              scrollToId('hero');
            }}
          >
            SPOTIK
          </a>
        </div>

        <div className="nav__links">
          {LINKS.map(([id, label]) => (
            <button key={id} type="button" className="nav__link" onClick={() => scrollToId(id)}>
              {label}
            </button>
          ))}
        </div>

        <button
          ref={burgerRef}
          type="button"
          className="nav__burger"
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          <span className="sr-only">Открыть меню</span>
          <span className="nav__burger-bars" aria-hidden="true" />
        </button>
      </div>

      {mounted ? createPortal(overlay, document.body) : null}
    </nav>
  );
}

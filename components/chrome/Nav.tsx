'use client';

import { scrollToId } from '@/lib/scroll';

/**
 * Навигация хиро.
 *
 * Слева — СЛОТ ПОД ЛОГОТИП. Знак клиент разрабатывает отдельно, поэтому
 * место под него зарезервировано жёстко: у .logo-slot фиксированные
 * габариты (122×26 на мобильном, 164×35 на десктопе). Когда логотип будет
 * готов, он встаёт внутрь слота вместо текста — переверстки не потребуется.
 */
export default function Nav() {
  const go = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    scrollToId(id);
  };

  return (
    <nav className="nav" aria-label="Основная навигация">
      <div className="nav__inner shell">
        <div className="logo-slot" data-logo-slot="reserved">
        <a className="logo-slot__text" href="#hero" onClick={go('hero')}>
          SPOTIK
        </a>
      </div>

        <div className="nav__links">
        <button type="button" className="nav__link" onClick={() => scrollToId('pricing')}>
          Тарифы
        </button>
        <button type="button" className="nav__link" onClick={() => scrollToId('how')}>
          Как это работает
        </button>
        <button type="button" className="nav__link" onClick={() => scrollToId('gift')}>
          Сертификат
        </button>
        <button type="button" className="nav__link" onClick={() => scrollToId('faq')}>
          Вопросы
        </button>
      </div>

        {/*
          На десктопе кнопки в шапке нет: к тарифам ведёт пункт меню.
          Ниже 900 px меню спрятано, и тогда кнопка — единственный путь,
          поэтому она скрывается не разметкой, амедиазапросом.
        */}
        <button type="button" className="btn btn--sm nav__cta" onClick={() => scrollToId('pricing')}>
          Выбрать тариф
        </button>
      </div>
    </nav>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { onLayoutChange, onScrollY, scrollToId, scroller } from '@/lib/scroll';
import { PAD_OVER_INK, VIEW_OVER_INK, WM_INK_TIGHT } from '@/lib/wordmark';
import WordmarkMark from '@/components/wordmark/WordmarkMark';

/**
 * Навигация хиро и мобильное меню.
 *
 * ── ШАПКА ЕДЕТ ПО ВСЕЙ СТРАНИЦЕ ────────────────────────────────────────────
 * Она стоит наверху экрана липкостью (`position: sticky`), а не прибита
 * к вьюпорту: у прибитого элемента цепочка прокрутки идёт в документ,
 * а документ у нас неподвижен — колесо и палец над шапкой не ехали бы
 * никуда. Высота у неё ноль, полосу рисует абсолютный .nav__inner,
 * поэтому в потоке она места не занимает.
 * Цвет она не переключает классом по скроллу: над зелёным её
 * красит градиент с ПОДВИЖНОЙ КРОМКОЙ, и кромка едет вместе с зелёным
 * краем пиксель в пиксель. Подробности в components.css и в CLAUDE.md, Р-42.
 *
 * Геометрия зелёных областей считается АНАЛИТИЧЕСКИ из величин, снятых
 * один раз: в кадре не читается ни одного прямоугольника. Читать их здесь
 * было бы дороже всего остального вместе взятого — морф в том же кадре
 * пишет шесть атрибутов, и любое чтение после записи выталкивает
 * принудительный пересчёт раскладки.
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
  const navRef = useRef<HTMLElement>(null);
  const burgerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setMounted(true), []);

  /*
   * ПОДВИЖНАЯ КРОМКА ЗЕЛЁНОГО.
   *
   * Зелёного на странице ровно два: слово в хиро и поле футера. У обоих
   * верхняя граница — горизонтальная линия, поэтому «где начинается
   * зелёное внутри полосы шапки» это одно число, а не форма.
   *
   *   • ФУТЕР. Зелёное идёт от его верхнего края и до конца страницы.
   *   • ХИРО. Пока сцена прилипла, верх чернил стоит НИЖЕ шапки (сцена
   *     держит поле в её высоту), и пересечения нет вовсе. Слово проходит
   *     под шапкой только когда сцена отлипла и уезжает вверх — а к этому
   *     моменту морф уже дожат, и высота чернил равна сжатой. Значит
   *     и верх, и низ чернил в этот момент считаются точно.
   */
  useEffect(() => {
    const nav = navRef.current;
    const sc = scroller();
    if (!nav || !sc) return;

    let navH = 0;
    let stickEnd = 0;
    let inkTopStuck = 0;
    let inkTight = 0;
    let footTop = Infinity;
    let blend = false;
    let last = '';

    const measure = () => {
      /* Высота полосы берётся у .nav__inner: у самой шапки высота ноль,
         она только держит место наверху экрана. */
      const inner = nav.firstElementChild as HTMLElement | null;
      navH = inner?.offsetHeight ?? 0;
      /* Собственное смещение каждого крашеного элемента от верха полосы.
         Считается от бокса САМОЙ шапки, а не от вьюпорта: во время входа
         шапка сдвинута трансформом, и разность его снимает. */
      const navTop = nav.getBoundingClientRect().top;
      nav.querySelectorAll<HTMLElement>('.nav-paint').forEach((el) => {
        el.style.setProperty('--y0', `${el.getBoundingClientRect().top - navTop}px`);
      });
      const base = sc.getBoundingClientRect().top - sc.scrollTop;
      const hero = document.getElementById('hero');
      const stage = hero?.querySelector<HTMLElement>('.hero__stage');
      const wm = hero?.querySelector<HTMLElement>('.wm--hero');
      if (hero && stage && wm) {
        const heroTop = hero.getBoundingClientRect().top - base;
        stickEnd = heroTop + hero.offsetHeight - stage.offsetHeight;
        const ink = wm.offsetHeight / VIEW_OVER_INK;
        inkTopStuck = parseFloat(getComputedStyle(stage).paddingTop) + ink * PAD_OVER_INK;
        inkTight = ink * WM_INK_TIGHT;
      }
      const footer = document.getElementById('footer');
      footTop = footer ? footer.getBoundingClientRect().top - base : Infinity;
    };

    const paint = (y: number) => {
      // хиро: слово входит в полосу только после отлипания сцены
      const exit = y - stickEnd;
      let g1 = navH;
      let g2 = navH;
      let on = false;
      if (exit > 0) {
        const top = inkTopStuck - exit;
        const bottom = top + inkTight;
        if (top < navH && bottom > 0) {
          g1 = top < 0 ? 0 : top;
          g2 = bottom > navH ? navH : bottom;
          on = true;
        }
      }
      if (!on) {
        const top = footTop - y;
        if (top < navH) {
          g1 = top < 0 ? 0 : top;
          g2 = navH;
          on = true;
        }
      }
      const next = `${g1.toFixed(1)}|${g2.toFixed(1)}`;
      if (next !== last) {
        last = next;
        nav.style.setProperty('--g1', `${g1}px`);
        nav.style.setProperty('--g2', `${g2}px`);
      }
      if (on !== blend) {
        blend = on;
        nav.toggleAttribute('data-blend', on);
      }
    };

    measure();
    const offLayout = onLayoutChange(() => measure());
    const offScroll = onScrollY(paint);
    return () => {
      offLayout();
      offScroll();
    };
  }, []);

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
    <nav ref={navRef} className="nav" aria-label="Основная навигация">
      <div className="nav__inner shell">
        <div className="logo-slot" data-logo-slot="reserved">
          <a
            className="logo-slot__text nav-paint nav-paint--text"
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
            <button
              key={id}
              type="button"
              className="nav__link nav-paint nav-paint--text nav-paint--dim"
              onClick={() => scrollToId(id)}
            >
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
          <span className="nav__burger-bars nav-paint" aria-hidden="true" />
        </button>
      </div>

      {mounted ? createPortal(overlay, document.body) : null}
    </nav>
  );
}

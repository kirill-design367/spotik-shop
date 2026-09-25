'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { onLayoutChange, scrollToId, scrollToTop, scroller } from '@/lib/scroll';
import WordmarkMark from '@/components/wordmark/WordmarkMark';
import { glyphShapes, rectShape } from '@/lib/inkshape';

/**
 * Шапка страницы и мобильное меню.
 *
 * ── ШАПКА ЕДЕТ ПО ВСЕЙ СТРАНИЦЕ ────────────────────────────────────────────
 * Она стоит наверху экрана липкостью (`position: sticky`), а не прибита
 * к вьюпорту: у прибитого элемента цепочка прокрутки идёт в документ,
 * а документ у нас неподвижен — колесо и палец над шапкой не ехали бы
 * никуда. Высота у неё ноль, полосу рисует абсолютный .nav__band,
 * поэтому в потоке она места не занимает.
 *
 * ── ИНВЕРСИЯ: ШАПКА НИЧЕГО НЕ ЗНАЕТ О СТРАНИЦЕ ─────────────────────────────
 * Три итерации подряд шапка ПЫТАЛАСЬ УГАДАТЬ, что под ней: список
 * селекторов «что считать зелёным», габариты светлых строк, контуры слова,
 * кромка поля футера. Любая дырка в этой модели — зелёное, которого нет
 * в списке, — давала белый логотип на зелёном, и сторож молчал, потому
 * что проверял ровно те места, которые называла та же модель. Разбор
 * в Р-47.
 *
 * Теперь модели нет вообще. Чернила шапки не красятся: их рисует слой,
 * который берёт СВОЙ СОБСТВЕННЫЙ ФОН и прогоняет его через ахроматическую
 * выворотку. Что под ним лежит — неважно и не спрашивается:
 *
 *     тёмный фон  #121212 → #FFFFFF   (18.7:1)
 *     зелёное     #1DB954 → #000000   (8.1:1)
 *     белый набор #FFFFFF → #000000   (21:1)
 *
 * Цвета ахроматические по построению: `grayscale` стоит первым, поэтому
 * розового не получить ни над чем. В кадре прокрутки шапка не делает
 * НИЧЕГО — фигура статична, и пересчитывается она только при смене
 * раскладки.
 *
 * ── ЧЕРНИЛА КАК ФИГУРА ─────────────────────────────────────────────────────
 * Выворотку надо ограничить формой чернил, а `backdrop-filter` обрезается
 * только `clip-path` (маска его ГАСИТ, Р-46). Поэтому в обрезку кладётся
 * тот же текст тем же шрифтом, кеглем, начертанием, осью насыщенности
 * и трекингом, поставленный по строчному боксу из `Range`. Полосы бургера —
 * два прямоугольника.
 *
 * ── ЕСЛИ ВЫВОРОТКА НЕ ПОДДЕРЖИВАЕТСЯ ───────────────────────────────────────
 * Живые элементы шапки остаются на месте и красятся обычным белым. Слой
 * выворотки включается только под `@supports` И только после того, как
 * фигура собрана (атрибут `data-ink`). Не выполнился скрипт, не поддержан
 * `backdrop-filter` — шапка просто светлая, как была, и ничего не пропадает.
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
/**
 * Пункты меню.
 *
 * ⚠️ ИХ ПЯТЬ С ТРИДЦАТЬ ШЕСТОЙ ИТЕРАЦИИ, И ДВА ПОСЛЕДНИХ — НАСТОЯЩИЕ
 * АДРЕСА, А НЕ ЯКОРЯ. Сертификаты уехали с лендинга на свою страницу,
 * а личный кабинет и раньше жил отдельным адресом, но в меню его
 * не было вовсе. Поэтому у пункта появился третий элемент — `href`:
 * есть он — рисуется ссылка, нет — кнопка, которая едет к якорю.
 *
 * ⚠️ «ЛИЧНЫЙ КАБИНЕТ» ВЕДЁТ НА `/cabinet/` И НЕ СПРАШИВАЕТ, ВОШЁЛ ЛИ
 * ЧЕЛОВЕК. Спросить здесь нечем: шапка стоит в корневой раскладке
 * и обращаться к кукам не имеет права (закон 36 — первое же
 * `cookies()` там переводит лендинг на посчитанный ответ). Да и незачем:
 * сам кабинет показывает вход, когда сессии нет.
 */
const LINKS: [id: string, label: string, href?: string][] = [
  ['pricing', 'Тарифы'],
  ['how', 'Как это работает'],
  ['faq', 'Вопросы'],
  ['sertifikaty', 'Сертификаты', '/sertifikaty/'],
  ['cabinet', 'Личный кабинет', '/cabinet/'],
];

/* Полосы бургера: две по 5 px с просветом 4, общий бокс 26×14, концы
   скруглены на 2 px. Числа живут здесь и в правилах
   `.nav__burger-bars` — и больше нигде. */
const BURGER_BARS: [number, number][] = [
  [0, 5],
  [9, 14],
];
/** Скругление концов полос. Обязано совпадать с `border-radius` в CSS. */
const BURGER_R = 2;

/**
 * Переход к якорю ИЗ ЛЮБОЙ страницы.
 *
 * Шапка стоит везде, кроме админки, а якоря живут на лендинге:
 * с `/checkout/` нажатие на «Тарифы» не делало раньше ничего вовсе.
 * Отсюда две ветки: на лендинге едем прокруткой, снаружи — уходим
 * на главную с хэшем.
 */
function kYakoryu(id: string) {
  if (typeof window !== 'undefined' && window.location.pathname !== '/') {
    window.location.href = `/#${id}`;
    return;
  }
  scrollToId(id);
}

export default function Nav() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const inkRootRef = useRef<HTMLDivElement>(null);
  const inkRef = useRef<SVGClipPathElement>(null);
  const inkDimRef = useRef<SVGClipPathElement>(null);
  const burgerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const nav = navRef.current;
    const inkRoot = inkRootRef.current;
    const ink = inkRef.current;
    const inkDim = inkDimRef.current;
    if (!nav || !inkRoot || !ink || !inkDim) return;

    /* ── СЛОЙ ВЫВОРОТКИ ЛЕЖИТ ВНЕ ШАПКИ, И ЭТО НЕ ВКУСОВЩИНА ────────────
       У `.nav` есть анимация входа, а она трогает `opacity`. Элемент
       с такой анимацией становится BACKDROP ROOT: фон для `backdrop-filter`
       внутри него ПУСТОЙ, и слой не рисует вообще ничего. Анимация
       с `fill-mode: both` остаётся «заполняющей» навсегда, поэтому после
       входа это не проходит само. Слой вынесен в соседний липкий элемент
       без единой анимации. См. Р-47.

       Пока вход играет, слой выключен: иначе чернила появились бы сразу,
       а живые элементы — только на 0.78 с. Включается он по концу входа,
       и подмена незаметна: над тёмным фоном выворотка даёт ровно #FFFFFF,
       то есть тот же цвет, которым красится живой текст. */
    let entered = false;
    let shaped = false;
    const apply = () => {
      const on = entered && shaped;
      nav.toggleAttribute('data-ink', on);
      inkRoot.toggleAttribute('data-ink', on);
    };
    const markEntered = () => { entered = true; apply(); };
    const running = nav.getAnimations
      ? nav.getAnimations().filter((a) => a.playState !== 'finished')
      : [];
    if (!running.length) entered = true;
    else {
      Promise.all(running.map((a) => a.finished.catch(() => {}))).then(markEntered);
      /* Страховка: если анимация не доиграет (вкладка в фоне), чернила
         всё равно обязаны появиться. */
      window.setTimeout(markEntered, 2500);
    }

    /* Фигура чернил собирается общим модулем: механизм выворотки
       на странице один, и собирать фигуру для него надо одинаково
       в шапке, в бегущей строке и в шагах блока 3. См. lib/inkshape. */
    /* Наведение на пункт меню: его фигура переезжает из приглушённой
       обрезки в яркую. Это два вызова на событие указателя, а не работа
       в кадре. */
    /* `<g>` в модели содержимого `clipPath` нет, и завёрнутые в него
       контуры не обрезают ничего: раскладываем литеры по одной. */
    const spread = (into: SVGClipPathElement, kids: SVGTextElement[]) => {
      for (const k of kids) into.appendChild(k);
      return kids;
    };
    const shapeOf = new Map<HTMLElement, SVGTextElement[]>();
    const move = (el: HTMLElement, into: SVGClipPathElement) => {
      for (const k of shapeOf.get(el) ?? []) into.appendChild(k);
    };
    const enter = (e: Event) => move(e.currentTarget as HTMLElement, ink);
    const leave = (e: Event) => move(e.currentTarget as HTMLElement, inkDim);
    let hooked: HTMLElement[] = [];

    const build = () => {
      for (const el of hooked) {
        el.removeEventListener('pointerenter', enter);
        el.removeEventListener('pointerleave', leave);
      }
      hooked = [];
      shapeOf.clear();
      ink.replaceChildren();
      inkDim.replaceChildren();

      const band = nav.querySelector<HTMLElement>('.nav__band');
      if (!band) return;
      /* Высота уходит ПЕРЕМЕННОЙ, а не в сам элемент: у корня слоя
         высота обязана остаться нулевой, иначе он занимает место
         в потоке и сдвигает хиро на высоту шапки. */
      const row = band.querySelector<HTMLElement>('.nav__row');
      inkRoot.style.setProperty('--nav-ink-h', `${row?.offsetHeight ?? 0}px`);
      const b = band.getBoundingClientRect();
      const ox = b.left;
      const oy = b.top;

      const logo = nav.querySelector<HTMLElement>('.logo-slot__text');
      if (logo) spread(ink, glyphShapes(logo, ox, oy));

      for (const el of nav.querySelectorAll<HTMLElement>('.nav__link')) {
        const kids = spread(inkDim, glyphShapes(el, ox, oy));
        if (!kids.length) continue;
        shapeOf.set(el, kids);
        el.addEventListener('pointerenter', enter);
        el.addEventListener('pointerleave', leave);
        hooked.push(el);
      }

      /* Бургер рисует один бокс 26×14, две полосы из него вырезает маска
         на 0…5 и 9…14. Здесь те же две полосы прямоугольниками, и числа
         обязаны совпадать с маской в CSS: разойдутся — выворотка встанет
         не на полосы, а рядом, и цветовой сторож этого не заметит. */
      const bars = nav.querySelector<HTMLElement>('.nav__burger-bars');
      if (bars && bars.offsetParent !== null) {
        const r = bars.getBoundingClientRect();
        for (const [y0, y1] of BURGER_BARS) ink.appendChild(rectShape(r, ox, oy, y0, y1, BURGER_R));
      }

      /* Слой выворотки включается ТОЛЬКО когда фигура собрана: пока её нет,
         живые элементы красятся обычным белым и шапка не пропадает. */
      shaped = ink.childNodes.length > 0;
      apply();
    };

    build();
    const offLayout = onLayoutChange(build);
    /* Шрифты доезжают после первой раскладки и двигают строчные боксы. */
    document.fonts?.ready.then(build).catch(() => {});
    return () => {
      offLayout();
      for (const el of hooked) {
        el.removeEventListener('pointerenter', enter);
        el.removeEventListener('pointerleave', leave);
      }
    };
  }, []);

  /* Модальность запоминаем сами: браузер на programmatic focus() рисует
     кольцо и после касания, а эвристика у Chrome и Safari разная. */
  const byPointer = useRef(false);
  useEffect(() => {
    const down = () => { byPointer.current = true; };
    const key = () => {
      byPointer.current = false;
      burgerRef.current?.removeAttribute('data-quiet');
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', key, true);
    };
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    const burger = burgerRef.current;
    if (!burger) return;
    /* Фокус возвращается ВСЕГДА — иначе с клавиатуры человек окажется
       в начале документа. Гасим только кольцо и только когда закрыли
       пальцем. */
    if (byPointer.current) burger.setAttribute('data-quiet', '');
    else burger.removeAttribute('data-quiet');
    burger.focus();
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

  const overlay = (
    <div className="menu" data-open={open ? '1' : undefined} aria-hidden={!open}>
      <div className="menu__bar shell">
        <div className="logo-slot" data-logo-slot="reserved">
          <a
            className="logo-slot__text"
            href="/"
            aria-label="Spotik Shop, на главную"
            onClick={(e) => {
              close();
              if (window.location.pathname !== '/') return;
              e.preventDefault();
              scrollToTop();
            }}
          >
            SPOTIK
          </a>
        </div>
        <button ref={closeRef} type="button" className="menu__close" onClick={close}>
          <span className="sr-only">Закрыть меню</span>
          {/* ТОТ ЖЕ ЗНАК, что у бургера, пиксель в пиксель и в том же
              состоянии: накладка появляется затуханием, и в эти
              180 мс видны оба. Разойдись они формой — читалось бы
              как подмена. */}
          <span className="nav__burger-bars" aria-hidden="true">
            <span />
            <span />
          </span>
        </button>
      </div>

      <nav className="menu__list" aria-label="Меню разделов">
        {LINKS.map(([id, label, href], i) =>
          href ? (
            <a key={id} className="menu__item" style={{ ['--i' as string]: i }} href={href}>
              {label}
            </a>
          ) : (
            <button
              key={id}
              type="button"
              className="menu__item"
              style={{ ['--i' as string]: i }}
              onClick={() => {
                setOpen(false);
                kYakoryu(id);
              }}
            >
              {label}
            </button>
          ),
        )}
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
    <>
      <nav ref={navRef} className="nav" aria-label="Основная навигация">
        <div className="nav__band">
          <div className="nav__row shell">
            {/* ⚠️ ЛОГОТИП ВЕДЁТ НА ГЛАВНУЮ, А НЕ К ЯКОРЮ `#hero`,
                и это была настоящая поломка, а не придирка: на всех
                страницах, кроме лендинга, якоря `#hero` не существует
                вовсе, `scrollToId` молча выходил, а `preventDefault`
                уже случился — нажатие не делало НИЧЕГО. Теперь адрес
                настоящий (`/`), и на внутренних страницах работает сам
                браузер; перехватываем мы только лендинг, где переход
                на себя же перезагрузил бы страницу вместо прокрутки.

                ⚠️ И ССЫЛКА ЗАНИМАЕТ ВЕСЬ СЛОТ. Прежняя была шириной
                по тексту: справа от литеры K оставалась полоса слота,
                на которую человек и целится, а нажатие там не ловилось
                ничем. */}
            <div className="logo-slot" data-logo-slot="reserved">
              <a
                className="logo-slot__text"
                href="/"
                aria-label="Spotik Shop, на главную"
                onClick={(e) => {
                  if (window.location.pathname !== '/') return;
                  e.preventDefault();
                  scrollToTop();
                }}
              >
                SPOTIK
              </a>
            </div>

            {/* ⚠️ ССЫЛКА И КНОПКА НЕСУТ ОДИН И ТОТ ЖЕ КЛАСС `nav__link`:
                по нему собирается фигура выворотки шапки. Заведи ссылке
                свой класс — и её чернила остались бы некрашеными,
                а цветовой сторож этого не увидит (Р-46). */}
            <div className="nav__links">
              {LINKS.map(([id, label, href]) =>
                href ? (
                  <a key={id} className="nav__link" href={href}>
                    {label}
                  </a>
                ) : (
                  <button key={id} type="button" className="nav__link" onClick={() => kYakoryu(id)}>
                    {label}
                  </button>
                ),
              )}
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
              {/* ДВЕ НАСТОЯЩИЕ ПОЛОСЫ, а не маска на одном боксе: маску
                  не повернуть по отдельности, а превращение в крестик —
                  это поворот и сдвиг ТЕХ ЖЕ полос. Внешний бокс остался
                  прежним 26×14: по нему собирается фигура выворотки. */}
              <span className="nav__burger-bars" aria-hidden="true">
                <span />
                <span />
              </span>
            </button>
          </div>
        </div>
      </nav>

      {/* Два слоя выворотки: яркий для знака и бургера, приглушённый
          для пунктов меню. Оба ничего не рисуют — они показывают
          собственный фон, вывернутый наизнанку. Лежат ВНЕ шапки:
          её анимация входа сделала бы их фон пустым. */}
      <div ref={inkRootRef} className="nav-ink" aria-hidden="true">
        <div className="nav-ink__layer nav-ink__layer--bright" />
        <div className="nav-ink__layer nav-ink__layer--dim" />
      </div>

      <svg className="nav__clip" aria-hidden="true" focusable="false">
        {/* Фигуры кладутся ПРЯМО в обрезку: `<g>` в её модели содержимого
            нет, и завёрнутые в него контуры молча не обрезают ничего. */}
        <clipPath ref={inkRef} id="nav-c-ink" clipPathUnits="userSpaceOnUse" />
        <clipPath ref={inkDimRef} id="nav-c-ink-dim" clipPathUnits="userSpaceOnUse" />
      </svg>

      {mounted ? createPortal(overlay, document.body) : null}
    </>
  );
}

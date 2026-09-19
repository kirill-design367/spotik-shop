'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { onLayoutChange, onScrollY, scrollToId, scroller } from '@/lib/scroll';
import {
  footRise,
  WM_BOX_HEIGHT,
  WM_PAD,
  WM_VIEW_HEIGHT,
  WM_WIDTH,
} from '@/lib/wordmark';
import WordmarkMark from '@/components/wordmark/WordmarkMark';

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
 * ── ИНВЕРСИЯ: ДВЕ КОПИИ И ОБРЕЗКА, А НЕ СМЕШИВАНИЕ ─────────────────────────
 * Копий две, светлая и тёмная, наложены пиксель в пиксель. Обрезки тоже
 * две и взаимодополняющие: тёмная видна ровно над зелёным, светлая ровно
 * над остальным. Общей границы у них нет и наложения нет, поэтому нет
 * ни шва, ни ореола.
 *
 * Зелёное считается ТРЕМЯ источниками:
 *   • слово в хиро — по КОНТУРАМ литер. Габарит не годится: между литерами
 *     фон тёмный, и тёмная шапка там пропала бы. Контуры берутся живыми,
 *     из тех же атрибутов d, что рисует морф, — рассинхрону взяться неоткуда;
 *   • поле футера — прямоугольник от его верхнего края, МИНУС чёрное слово
 *     на нём: над словом шапка обязана остаться светлой;
 *   • зелёные акценты середины — прямоугольники, снятые один раз
 *     при раскладке.
 *
 * Всё это складывается в ОДИН атрибут d на обрезку, с правилом evenodd:
 * дочерние элементы clipPath объединяются, а не вычитаются, поэтому дырки
 * можно получить только внутри одного пути. Общий масштаб и сдвиг несёт
 * `transform` самого clipPath — тогда контуры литер кладутся в обрезку
 * ровно как есть, без пересчёта координат в кадре.
 *
 * Геометрия считается АНАЛИТИЧЕСКИ из величин, снятых один раз: в кадре
 * не читается ни одного прямоугольника. Читать их здесь было бы дороже
 * всего остального вместе взятого — морф в том же кадре пишет шесть
 * атрибутов d, и любое чтение после записи выталкивает принудительный
 * пересчёт раскладки. Подробности в CLAUDE.md, Р-43.
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

/**
 * Кандидаты в «зелёные акценты». Список ЯВНЫЙ, но решает не он, а замер:
 * в него попадает только то, у чего фактический фон оказался зелёным.
 * Поэтому переключатель срока отдаёт ровно активную кнопку, а выключенная
 * «Оформить» не отдаёт ничего.
 */
const GREEN_CANDIDATES = '.btn, .seg__btn, .row__hot';
const GREEN_RGB = 'rgb(29, 185, 84)';
/** Прямоугольник заведомо больше любого экрана: светлая копия до JS цела. */
const ALL = 'M-9999 -9999H9999V9999H-9999Z';

type Rect = { top: number; left: number; w: number; h: number; hero: boolean };

export default function Nav() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const lightRef = useRef<HTMLElement>(null);
  const darkRef = useRef<HTMLDivElement>(null);
  const greenRef = useRef<SVGClipPathElement>(null);
  const restRef = useRef<SVGClipPathElement>(null);
  const greenPathRef = useRef<SVGPathElement>(null);
  const restPathRef = useRef<SVGPathElement>(null);
  const burgerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const nav = lightRef.current;
    const dark = darkRef.current;
    const sc = scroller();
    const greenClip = greenRef.current;
    const restClip = restRef.current;
    const greenPath = greenPathRef.current;
    const restPath = restPathRef.current;
    if (!nav || !dark || !sc || !greenClip || !restClip || !greenPath || !restPath) return;

    let navH = 0;
    let vw = 0;
    /* хиро: где стоит слой слова, пока сцена прилипла, и где она отлипает */
    let heroLeft = 0;
    let heroW = 0;
    let heroH = 0;
    let heroTopStuck = 0;
    let stickEnd = 0;
    /* футер: слой и верхний край зелёного поля — в координатах содержимого */
    let footLeft = 0;
    let footW = 0;
    let footH = 0;
    let footWmTop = 0;
    let footTop = Infinity;
    /* сдвиг текстов хиро к концу хода: зелёная кнопка едет вместе с ними */
    let heroShift = 0;
    let rects: Rect[] = [];
    let heroPaths: SVGPathElement[] = [];
    let footPaths: SVGPathElement[] = [];
    let lastLetters = '';
    let lastRaw = '';
    let lastGreen = '';
    let lastRest = '';
    let lastTf = '';
    let lastHas = true;

    const measure = () => {
      const row = nav.querySelector<HTMLElement>('.nav__row');
      navH = row?.offsetHeight ?? 0;
      vw = sc.clientWidth;
      const base = sc.getBoundingClientRect().top - sc.scrollTop;

      const hero = document.getElementById('hero');
      const stage = hero?.querySelector<HTMLElement>('.hero__stage');
      const heroSvg = hero?.querySelector<SVGSVGElement>('.wm--hero .wm__svg');
      if (hero && stage && heroSvg) {
        const heroTop = hero.getBoundingClientRect().top - base;
        stickEnd = heroTop + hero.offsetHeight - stage.offsetHeight;
        const r = heroSvg.getBoundingClientRect();
        heroLeft = r.left;
        heroW = r.width;
        heroH = r.height;
        /* Пока сцена прилипла, её верх на нуле, значит верх слоя — это
           поле сцены под шапку. Дальше слой уезжает вместе со сценой. */
        heroTopStuck = parseFloat(getComputedStyle(stage).paddingTop) || 0;
        heroPaths = [...heroSvg.querySelectorAll<SVGPathElement>('.wm__letter path')];
        /* Тексты хиро (а с ними и зелёная кнопка) к концу хода подняты
           на долю высоты слоя. В полосу шапки они попадают только после
           отлипания, то есть уже с дожатым ходом, — значит сдвиг здесь
           постоянный и читать его в кадре не нужно. */
        const wmH = heroH / (WM_VIEW_HEIGHT / WM_BOX_HEIGHT);
        heroShift = wmH * footRise(1);
      }

      const footer = document.getElementById('footer');
      const footSvg = footer?.querySelector<SVGSVGElement>('.wm--footer .wm__svg');
      footTop = footer ? footer.getBoundingClientRect().top - base : Infinity;
      if (footSvg) {
        const r = footSvg.getBoundingClientRect();
        footLeft = r.left;
        footW = r.width;
        footH = r.height;
        footWmTop = r.top - base;
        footPaths = [...footSvg.querySelectorAll<SVGPathElement>('.wm__letter path')];
      }

      rects = [...document.querySelectorAll<HTMLElement>(GREEN_CANDIDATES)]
        .filter((el) => getComputedStyle(el).backgroundColor === GREEN_RGB)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return {
            top: r.top - base,
            left: r.left,
            w: r.width,
            h: r.height,
            hero: !!el.closest('.hero__foot'),
          };
        });
      lastGreen = lastRest = lastTf = lastLetters = lastRaw = '';
      lastHas = true;
    };

    /** Живые контуры литер — их же рисует морф, второй копии данных нет. */
    const letters = (paths: SVGPathElement[]): string => {
      const raw = paths[0]?.getAttribute('d') ?? '';
      if (raw === lastRaw) return lastLetters;
      lastRaw = raw;
      let out = '';
      for (let i = 0; i < paths.length; i += 1) out += paths[i].getAttribute('d') ?? '';
      lastLetters = out;
      return out;
    };

    const paint = (y: number) => {
      /* ── КАКОЕ СЛОВО СЕЙЧАС В ПОЛОСЕ ──────────────────────────────────
         Хиро и футер не пересекаются во времени, поэтому набор путей
         обрезки один на оба. */
      const heroTop = (y <= stickEnd ? 0 : stickEnd - y) + heroTopStuck;
      const heroIn = heroPaths.length === 6 && heroTop < navH && heroTop + heroH > 0;
      const footWmY = footWmTop - y;
      const footIn = !heroIn && footPaths.length === 6 && footWmY < navH && footWmY + footH > 0;

      /* Общий масштаб и сдвиг: контуры кладутся в обрезку как есть,
         а в экранные пиксели их переводит transform самого clipPath. */
      let sx = 1;
      let sy = 1;
      let tx = 0;
      let ty = 0;
      let d = '';
      if (heroIn) {
        sx = heroW / WM_WIDTH;
        sy = heroH / WM_VIEW_HEIGHT;
        tx = heroLeft;
        ty = heroTop + WM_PAD * sy;
        d = letters(heroPaths);
      } else if (footIn) {
        sx = footW / WM_WIDTH;
        sy = footH / WM_BOX_HEIGHT;
        tx = footLeft;
        ty = footWmY;
        d = letters(footPaths);
      }

      /* ── ПРЯМОУГОЛЬНИКИ, ПЕРЕСЧИТАННЫЕ В ТУ ЖЕ СИСТЕМУ ────────────────── */
      const box = (x: number, top: number, w: number, h: number) => {
        const y0 = top < 0 ? 0 : top;
        const y1 = top + h > navH ? navH : top + h;
        if (y1 <= y0 || w <= 0) return;
        const ux = (x - tx) / sx;
        const uy = (y0 - ty) / sy;
        const uw = w / sx;
        const uh = (y1 - y0) / sy;
        d += `M${ux.toFixed(2)} ${uy.toFixed(2)}h${uw.toFixed(2)}v${uh.toFixed(2)}h${(-uw).toFixed(2)}Z`;
      };

      // поле футера: от его верхнего края и ниже, во всю ширину
      const fieldTop = footTop - y;
      if (fieldTop < navH) box(0, fieldTop, vw, navH - fieldTop + 1);
      // зелёные акценты середины
      for (let i = 0; i < rects.length; i += 1) {
        const r = rects[i];
        const top = r.top - y + (r.hero ? heroShift : 0);
        if (top < navH && top + r.h > 0) box(r.left, top, r.w, r.h);
      }

      const green = d;
      /* Светлая копия — дополнение: рамка во всю полосу, и всё зелёное
         в ней дырки. Правило evenodd делает это одним путём. */
      const rest = `M${(-tx / sx).toFixed(2)} ${(-ty / sy).toFixed(2)}h${(vw / sx).toFixed(2)}v${(navH / sy).toFixed(2)}h${(-vw / sx).toFixed(2)}Z${d}`;

      /* Зелёного в полосе нет — значит и считать нечего: тёмная копия
         не рисуется, а светлой снимается обрезка целиком. Так выглядит
         бо́льшая часть страницы, и платить за неё маской незачем. */
      const has = green.length > 0;
      if (has !== lastHas) {
        lastHas = has;
        nav.toggleAttribute('data-clip', has);
        dark.toggleAttribute('data-clip', has);
      }
      if (!has) return;

      const tf = `translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${sx.toFixed(6)} ${sy.toFixed(6)})`;
      if (tf !== lastTf) {
        lastTf = tf;
        greenClip.setAttribute('transform', tf);
        restClip.setAttribute('transform', tf);
      }
      if (green !== lastGreen) {
        lastGreen = green;
        greenPath.setAttribute('d', green);
      }
      if (rest !== lastRest) {
        lastRest = rest;
        restPath.setAttribute('d', rest);
      }
    };

    measure();
    const offLayout = onLayoutChange(measure);
    const offScroll = onScrollY(paint);
    /* Переключатель срока красит кнопку зелёным на лету, а высоту страницы
       при этом не меняет — наблюдатель размера такого не видит. Пересчёт
       откладываем на кадр: к нему состояние уже применено. */
    const onTap = () => requestAnimationFrame(() => { measure(); paint(sc.scrollTop); });
    document.addEventListener('pointerup', onTap, true);
    document.addEventListener('keyup', onTap, true);
    return () => {
      offLayout();
      offScroll();
      document.removeEventListener('pointerup', onTap, true);
      document.removeEventListener('keyup', onTap, true);
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
            onClick={() => {
              setOpen(false);
              scrollToId(id);
            }}
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

  /**
   * Одна и та же полоса рисуется дважды. У тёмной копии нет ни обработчиков,
   * ни фокуса, ни имени в дереве доступности: она декорация, а весь смысл —
   * у светлой.
   */
  const band = (dark: boolean) => (
    <div className="nav__band">
      <div className="nav__row shell">
        <div className="logo-slot" data-logo-slot="reserved">
          <a
            className="logo-slot__text"
            href="#hero"
            tabIndex={dark ? -1 : undefined}
            onClick={(e) => {
              e.preventDefault();
              if (!dark) scrollToId('hero');
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
              className="nav__link"
              tabIndex={dark ? -1 : undefined}
              onClick={() => {
                if (!dark) scrollToId(id);
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          ref={dark ? undefined : burgerRef}
          type="button"
          className="nav__burger"
          tabIndex={dark ? -1 : undefined}
          aria-expanded={dark ? undefined : open}
          aria-haspopup={dark ? undefined : 'dialog'}
          onClick={() => {
            if (!dark) setOpen(true);
          }}
        >
          <span className="sr-only">Открыть меню</span>
          <span className="nav__burger-bars" aria-hidden="true" />
        </button>
      </div>
    </div>
  );

  return (
    <>
      <nav ref={lightRef} className="nav nav--light" aria-label="Основная навигация">
        {band(false)}
      </nav>
      <div ref={darkRef} className="nav nav--dark" aria-hidden="true">{band(true)}</div>
      <svg className="nav__clip" aria-hidden="true" focusable="false">
        {/* Пока JS не выполнился, зелёного нет, а «остального» — весь экран:
            светлая шапка видна целиком, и это верное состояние покоя. */}
        <clipPath ref={greenRef} id="nav-green" clipPathUnits="userSpaceOnUse">
          <path ref={greenPathRef} clipRule="evenodd" d="" />
        </clipPath>
        <clipPath ref={restRef} id="nav-rest" clipPathUnits="userSpaceOnUse">
          <path ref={restPathRef} clipRule="evenodd" d={ALL} />
        </clipPath>
      </svg>
      {mounted ? createPortal(overlay, document.body) : null}
    </>
  );
}

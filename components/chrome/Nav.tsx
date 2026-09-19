'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { onLayoutChange, scrollToId, scroller } from '@/lib/scroll';
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
const LINKS: [id: string, label: string][] = [
  ['pricing', 'Тарифы'],
  ['how', 'Как это работает'],
  ['gift', 'Сертификат'],
  ['faq', 'Вопросы'],
];

const NS = 'http://www.w3.org/2000/svg';

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

    /* Метрики шрифта берём из канваса тем же объявлением, что у элемента:
       базовая линия считается по обычному правилу половинного интерлиньяжа
       от СТРОЧНОГО бокса, а не от бокса элемента (слот под логотип выше
       самой строки, и отсчёт от бокса уехал бы выше глифов). */
    const metrics = new Map<string, { asc: number; desc: number }>();
    const ctx2d = document.createElement('canvas').getContext('2d');
    const fontBox = (font: string) => {
      const had = metrics.get(font);
      if (had) return had;
      let box = { asc: 0, desc: 0 };
      if (ctx2d) {
        ctx2d.font = font;
        const m = ctx2d.measureText('Нg');
        box = { asc: m.fontBoundingBoxAscent || 0, desc: m.fontBoundingBoxDescent || 0 };
      }
      metrics.set(font, box);
      return box;
    };

    /* ФИГУРА СОБИРАЕТСЯ ПОЛИТЕРНО, и это не педантизм. Строка целиком,
       поставленная одним `<text>`, накапливает расхождение по трекингу:
       в HTML апрош добавляется после КАЖДОГО знака, включая последний,
       и к шестой литере набегает почти пиксель — правый штрих K выходил
       из обрезки, и вдоль него шла недокрашенная колонка. Здесь каждая
       литера ставится в СВОЁ измеренное место, а апрош в фигуру
       не попадает вовсе: он уже учтён в измерении.

       Отсчёт идёт от ПОЛОСЫ ШАПКИ, а не от вьюпорта: вход двигает её
       трансформом на 14 px, и координаты, снятые в тот момент, запеклись
       бы со сдвигом. */
    const textShape = (el: HTMLElement, ox: number, oy: number): SVGGElement | null => {
      const cs = getComputedStyle(el);
      const raw = (el.textContent ?? '').trim();
      if (!raw || cs.visibility === 'hidden' || cs.display === 'none') return null;
      const node = el.firstChild;
      if (!node || node.nodeType !== 3) return null;
      const text = node.textContent ?? '';
      const range = document.createRange();
      range.selectNodeContents(el);
      const line = [...range.getClientRects()].find((r) => r.width > 0.5 && r.height > 0.5);
      if (!line) return null;
      const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const { asc, desc } = fontBox(font);
      const baseline = line.top - oy + (line.height - asc - desc) / 2 + asc;
      const up = cs.textTransform === 'uppercase';

      const group = document.createElementNS(NS, 'g');
      for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (!ch.trim()) continue;
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const r = range.getBoundingClientRect();
        if (r.width < 0.1) continue;
        const glyph = document.createElementNS(NS, 'text');
        glyph.setAttribute('x', (r.left - ox).toFixed(2));
        glyph.setAttribute('y', baseline.toFixed(2));
        glyph.setAttribute('font-family', cs.fontFamily);
        glyph.setAttribute('font-size', cs.fontSize);
        glyph.setAttribute('font-weight', cs.fontWeight);
        glyph.setAttribute('font-style', cs.fontStyle);
        /* Насыщенность логотипа задана ОСЬЮ, а не `font-weight`: без неё
           фигура выходит на два веса светлее и глифы не накрывает. */
        if (cs.fontVariationSettings && cs.fontVariationSettings !== 'normal') {
          glyph.style.fontVariationSettings = cs.fontVariationSettings;
        }
        if (cs.fontStretch && cs.fontStretch !== 'normal') glyph.style.fontStretch = cs.fontStretch;
        glyph.textContent = up ? ch.toLocaleUpperCase('ru') : ch;
        group.appendChild(glyph);
      }
      return group.childNodes.length ? group : null;
    };

    /* Наведение на пункт меню: его фигура переезжает из приглушённой
       обрезки в яркую. Это два вызова на событие указателя, а не работа
       в кадре. */
    /* `<g>` в модели содержимого `clipPath` нет, и завёрнутые в него
       контуры не обрезают ничего: раскладываем литеры по одной. */
    const spread = (into: SVGClipPathElement, group: SVGGElement | null) => {
      if (!group) return [];
      const kids = [...group.childNodes] as SVGTextElement[];
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
      if (logo) spread(ink, textShape(logo, ox, oy));

      for (const el of nav.querySelectorAll<HTMLElement>('.nav__link')) {
        const kids = spread(inkDim, textShape(el, ox, oy));
        if (!kids.length) continue;
        shapeOf.set(el, kids);
        el.addEventListener('pointerenter', enter);
        el.addEventListener('pointerleave', leave);
        hooked.push(el);
      }

      /* Бургер рисует один бокс 24×12, две полосы из него вырезает маска
         на 0…4 и 8…12. Здесь те же две полосы прямоугольниками. */
      const bars = nav.querySelector<HTMLElement>('.nav__burger-bars');
      if (bars && bars.offsetParent !== null) {
        const r = bars.getBoundingClientRect();
        for (const [y0, y1] of [[0, 4], [8, 12]]) {
          const bar = document.createElementNS(NS, 'rect');
          bar.setAttribute('x', (r.left - ox).toFixed(2));
          bar.setAttribute('y', (r.top - oy + y0).toFixed(2));
          bar.setAttribute('width', r.width.toFixed(2));
          bar.setAttribute('height', String(y1 - y0));
          ink.appendChild(bar);
        }
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

  return (
    <>
      <nav ref={navRef} className="nav" aria-label="Основная навигация">
        <div className="nav__band">
          <div className="nav__row shell">
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

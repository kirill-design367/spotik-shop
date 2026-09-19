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
 * ── ИНВЕРСИЯ РАБОТАЕТ ВЕЗДЕ, И КОПИЙ ДЛЯ ЭТОГО ТРИ ─────────────────────────
 * Под шапкой бывает три разных фона, и каждому нужен свой ответ:
 *
 *   ЗЕЛЁНОЕ — слово в хиро, поле футера, акценты середины. Цвет известен,
 *             поэтому копия просто ТЁМНАЯ, `--ink` на зелёном 7.2:1.
 *   СПЛОШНОЙ ТЁМНЫЙ ФОН — тоже известен, копия просто СВЕТЛАЯ, `--white`
 *             на `--ink` 18.7:1. Это большая часть страницы.
 *   КРУПНЫЙ СВЕТЛЫЙ НАБОР блоков 2–6 — а вот тут фон НЕ ОДИН: внутри
 *             строки чередуются светлые глифы и тёмные просветы, и по
 *             габариту строки его не разгадать. Здесь работает копия
 *             с `difference`: над глифом она уходит в тёмное, над
 *             просветом в светлое — попиксельно и точно.
 *
 * Розового, которым расплачивалось смешивание в Р-39, не возникает нигде:
 * над зелёным `difference`-копия просто не рисуется, её маска там пустая.
 *
 * ── ПОЧЕМУ МАСКИ, А НЕ ОБРЕЗКА ─────────────────────────────────────────────
 * У `clipPath` дети ОБЪЕДИНЯЮТСЯ, поэтому дырки приходилось собирать
 * в один путь с `evenodd`, а три взаимодополняющие области так не выразить
 * вовсе. Маска складывается ПОРЯДКОМ РИСОВАНИЯ: белое добавляет, чёрное
 * вычитает, и `<use>` внутри неё работает (в `clipPath` — нет). Поэтому
 * фигуры лежат в ОДНОМ месте и пишутся один раз, а три маски ссылаются
 * на них с разной заливкой.
 *
 * Тёмная маска берёт зелёное с обводкой: её область на пиксель ШИРЕ,
 * чем вычитание у двух других. Перекрытие нужно, чтобы на сглаженном
 * краю глифа не осталось полоски, где светлая копия уже рисует, а тёмная
 * ещё нет. Тёмная непрозрачна и лежит выше — она это перекрытие закрывает.
 *
 * Геометрия считается АНАЛИТИЧЕСКИ из величин, снятых один раз: в кадре
 * не читается ни одного прямоугольника. Подробности в CLAUDE.md, Р-46.
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

/**
 * Что считать СВЕТЛЫМ НАБОРОМ. Здесь список не решает почти ничего:
 * он только сужает обход, а отбирает ЯРКОСТЬ фактического цвета текста.
 * Поэтому тёмные подписи на зелёном (реквизиты футера, надпись на кнопке)
 * сюда не попадают сами собой, и список не приходится держать в голове
 * при каждой правке блоков.
 */
const TEXT_CANDIDATES =
  'h1,h2,h3,h4,p,li,span,a,button,em,b,strong,dt,dd,small,time,label,summary,figcaption';
/** Порог яркости: выше — считаем светлым. `--dim` (#B3B3B3) = 0.45. */
const LIGHT_LUM = 0.22;

type Rect = { top: number; left: number; w: number; h: number; hero: boolean };

/** Относительная яркость по WCAG — по ней и решаем, светлый текст или нет. */
function luminance(css: string): number {
  const m = css.match(/\d+(\.\d+)?/g);
  if (!m || m.length < 3) return 0;
  const [r, g, b] = m.slice(0, 3).map((v) => {
    const s = +v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export default function Nav() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const plainRef = useRef<HTMLElement>(null);
  const invertRef = useRef<HTMLDivElement>(null);
  const darkRef = useRef<HTMLDivElement>(null);
  const litRef = useRef<HTMLDivElement>(null);
  const greenRef = useRef<SVGGElement>(null);
  const greenPathRef = useRef<SVGPathElement>(null);
  const lightPathRef = useRef<SVGPathElement>(null);
  const lightClipRef = useRef<SVGPathElement>(null);
  const inkRef = useRef<SVGClipPathElement>(null);
  const inkDimRef = useRef<SVGClipPathElement>(null);
  const burgerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const plain = plainRef.current;
    const invert = invertRef.current;
    const dark = darkRef.current;
    const sc = scroller();
    const lit = litRef.current;
    const greenG = greenRef.current;
    const greenPath = greenPathRef.current;
    const lightPath = lightPathRef.current;
    const lightClip = lightClipRef.current;
    const ink = inkRef.current;
    const inkDim = inkDimRef.current;
    if (!plain || !invert || !dark || !sc || !lit) return;
    if (!greenG || !greenPath || !lightPath || !lightClip || !ink || !inkDim) return;

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
    /* сдвиг текстов хиро к концу хода: всё, что в них лежит, едет с ними */
    let heroShift = 0;
    let greens: Rect[] = [];
    let lights: Rect[] = [];
    let heroPaths: SVGPathElement[] = [];
    let footPaths: SVGPathElement[] = [];
    let lastLetters = '';
    let lastRaw = '';
    let lastGreen = '';
    let lastLight = '';
    let lastTf = '';
    let lastFlags = '';

    const boxOf = (el: Element, base: number): Rect => {
      const r = el.getBoundingClientRect();
      return {
        top: r.top - base,
        left: r.left,
        w: r.width,
        h: r.height,
        hero: !!el.closest('.hero__foot'),
      };
    };

    /* ── ЧЕРНИЛА ШАПКИ КАК ФИГУРА ─────────────────────────────────────
       Инвертирующая копия ничего не рисует: она показывает СВОЙ ФОН,
       вывернутый наизнанку, и вырезан этот фон ровно по контурам
       глифов. Значит контуры надо иметь фигурой, а обрезка в SVG
       умеет `<text>` (в отличие от `<use>`, Р-46). Мы кладём в неё
       тот же текст тем же шрифтом и кеглем, что рисует живая копия,
       и ставим его по ТОЙ ЖЕ строке: базовая линия берётся из Range,
       то есть из настоящего строчного бокса, а не из бокса элемента.
       Метрики шрифта — из канваса, тем же объявлением шрифта. */
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

    const NS = 'http://www.w3.org/2000/svg';
    const textShape = (el: HTMLElement): SVGTextElement | null => {
      const cs = getComputedStyle(el);
      const raw = (el.textContent ?? '').trim();
      if (!raw || cs.visibility === 'hidden') return null;
      const range = document.createRange();
      range.selectNodeContents(el);
      const line = [...range.getClientRects()].find((r) => r.width > 0.5 && r.height > 0.5);
      if (!line) return null;
      const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const { asc, desc } = fontBox(font);
      const node = document.createElementNS(NS, 'text');
      node.setAttribute('x', line.left.toFixed(2));
      node.setAttribute('y', (line.top + (line.height - asc - desc) / 2 + asc).toFixed(2));
      node.setAttribute('font-family', cs.fontFamily);
      node.setAttribute('font-size', cs.fontSize);
      node.setAttribute('font-weight', cs.fontWeight);
      node.setAttribute('font-style', cs.fontStyle);
      if (cs.letterSpacing && cs.letterSpacing !== 'normal') {
        node.setAttribute('letter-spacing', cs.letterSpacing);
      }
      node.textContent = cs.textTransform === 'uppercase' ? raw.toLocaleUpperCase('ru') : raw;
      return node;
    };

    const buildInk = () => {
      ink.replaceChildren();
      inkDim.replaceChildren();
      const logo = plain.querySelector<HTMLElement>('.logo-slot__text');
      const logoShape = logo ? textShape(logo) : null;
      if (logoShape) ink.appendChild(logoShape);
      /* Пункты меню приглушены (`--dim`), и приглушение обязано пережить
         инверсию — поэтому у них своя фигура и своя, чуть притушенная,
         выворотка. Подробности величины — в CSS. */
      for (const el of plain.querySelectorAll<HTMLElement>('.nav__link')) {
        const shape = textShape(el);
        if (shape) inkDim.appendChild(shape);
      }
      /* Бургер рисует один бокс 24×12, две полосы из него вырезает маска
         на 0…4 и 8…12. Здесь те же две полосы прямоугольниками. */
      const bars = plain.querySelector<HTMLElement>('.nav__burger-bars');
      if (bars && bars.offsetParent !== null) {
        const r = bars.getBoundingClientRect();
        for (const [y0, y1] of [[0, 4], [8, 12]]) {
          const bar = document.createElementNS(NS, 'rect');
          bar.setAttribute('x', r.left.toFixed(2));
          bar.setAttribute('y', (r.top + y0).toFixed(2));
          bar.setAttribute('width', r.width.toFixed(2));
          bar.setAttribute('height', String(y1 - y0));
          ink.appendChild(bar);
        }
      }
    };

    const measure = () => {
      const row = plain.querySelector<HTMLElement>('.nav__row');
      navH = row?.offsetHeight ?? 0;
      vw = sc.clientWidth;
      lit.style.height = `${navH}px`;
      buildInk();
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
        /* Тексты хиро к концу хода подняты на долю высоты слоя. В полосу
           шапки они попадают только после отлипания, то есть уже с дожатым
           ходом, — значит сдвиг постоянный и читать его в кадре не нужно. */
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

      greens = [...document.querySelectorAll<HTMLElement>(GREEN_CANDIDATES)]
        .filter((el) => getComputedStyle(el).backgroundColor === GREEN_RGB)
        .map((el) => boxOf(el, base));

      /* Светлый набор. Шапку и накладку исключаем: иначе она сама себе
         фон и инвертируется относительно собственных копий. */
      lights = [];
      for (const el of document.querySelectorAll<HTMLElement>(TEXT_CANDIDATES)) {
        if (el.closest('.nav') || el.closest('.menu')) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        if (luminance(getComputedStyle(el).color) < LIGHT_LUM) continue;
        /* только элементы с СОБСТВЕННЫМ текстом: обёртки дали бы
           прямоугольник во весь блок и стёрли бы весь смысл */
        let own = false;
        for (const n of el.childNodes) {
          if (n.nodeType === 3 && (n.textContent ?? '').trim()) { own = true; break; }
        }
        if (!own) continue;
        lights.push(boxOf(el, base));
      }

      lastGreen = lastLight = lastTf = lastLetters = lastRaw = lastFlags = '';
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
         один на оба. */
      const heroTop = (y <= stickEnd ? 0 : stickEnd - y) + heroTopStuck;
      const heroIn = heroPaths.length === 6 && heroTop < navH && heroTop + heroH > 0;
      const footWmY = footWmTop - y;
      const footIn = !heroIn && footPaths.length === 6 && footWmY < navH && footWmY + footH > 0;

      /* Общий масштаб и сдвиг: контуры кладутся в маску как есть,
         а в экранные пиксели их переводит transform группы. */
      let sx = 1;
      let sy = 1;
      let tx = 0;
      let ty = 0;
      let green = '';
      if (heroIn) {
        sx = heroW / WM_WIDTH;
        sy = heroH / WM_VIEW_HEIGHT;
        tx = heroLeft;
        ty = heroTop + WM_PAD * sy;
        green = letters(heroPaths);
      } else if (footIn) {
        sx = footW / WM_WIDTH;
        sy = footH / WM_BOX_HEIGHT;
        tx = footLeft;
        ty = footWmY;
        green = letters(footPaths);
      }

      /* Габариты зелёного в пикселях полосы: по ним из светлого набора
         вычёркиваются строки, которые на зелёное налезли. Точность тут
         не нужна и вредна — это сторож от розового, а не рисунок. */
      const gBox: number[][] = [];
      if (heroIn || footIn) gBox.push([tx, ty, tx + WM_WIDTH * sx, ty + WM_VIEW_HEIGHT * sy]);

      /* Прямоугольники зелёного пересчитываются в ту же систему. */
      const boxG = (x: number, top: number, w: number, h: number) => {
        const y0 = top < 0 ? 0 : top;
        const y1 = top + h > navH ? navH : top + h;
        if (y1 <= y0 || w <= 0) return;
        gBox.push([x, y0, x + w, y1]);
        const ux = (x - tx) / sx;
        const uy = (y0 - ty) / sy;
        green += `M${ux.toFixed(2)} ${uy.toFixed(2)}h${(w / sx).toFixed(2)}v${((y1 - y0) / sy).toFixed(2)}h${(-w / sx).toFixed(2)}Z`;
      };
      const fieldTop = footTop - y;
      if (fieldTop < navH) boxG(0, fieldTop, vw, navH - fieldTop + 1);
      for (let i = 0; i < greens.length; i += 1) {
        const r = greens[i];
        const top = r.top - y + (r.hero ? heroShift : 0);
        if (top < navH && top + r.h > 0) boxG(r.left, top, r.w, r.h);
      }

      /* Светлый набор — прямо в пикселях полосы, ему система координат
         слова не нужна. Строк две: по ТОЧНОЙ обрезается инвертирующая
         копия, по ПОДЖАТОЙ на пиксель вычитается светлая. Так на кромке
         области получается перекрытие, а не щель: обе копии рисуют один
         и тот же глиф, и верхняя его закрывает. */
      let light = '';
      let lightIn = '';
      for (let i = 0; i < lights.length; i += 1) {
        const r = lights[i];
        const top = r.top - y + (r.hero ? heroShift : 0);
        if (top >= navH || top + r.h <= 0) continue;
        const y0 = top < 0 ? 0 : top;
        const y1 = top + r.h > navH ? navH : top + r.h;
        let onGreen = false;
        for (let k = 0; k < gBox.length; k += 1) {
          const b = gBox[k];
          if (r.left < b[2] && r.left + r.w > b[0] && y0 < b[3] && y1 > b[1]) { onGreen = true; break; }
        }
        if (onGreen) continue;
        light += `M${r.left.toFixed(1)} ${y0.toFixed(1)}h${r.w.toFixed(1)}v${(y1 - y0).toFixed(1)}h${(-r.w).toFixed(1)}Z`;
        const iw = r.w - 2;
        const ih = y1 - y0 - 2;
        if (iw > 0 && ih > 0) {
          lightIn += `M${(r.left + 1).toFixed(1)} ${(y0 + 1).toFixed(1)}h${iw.toFixed(1)}v${ih.toFixed(1)}h${(-iw).toFixed(1)}Z`;
        }
      }

      const flags = `${green ? 1 : 0}${light ? 1 : 0}`;
      if (flags !== lastFlags) {
        lastFlags = flags;
        plain.toggleAttribute('data-mask', !!(green || light));
        invert.toggleAttribute('data-on', !!light);
        dark.toggleAttribute('data-on', !!green);
      }
      if (!green && !light) return;

      const tf = `translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${sx.toFixed(6)} ${sy.toFixed(6)})`;
      if (tf !== lastTf) {
        lastTf = tf;
        greenG.setAttribute('transform', tf);
      }
      if (green !== lastGreen) {
        lastGreen = green;
        greenPath.setAttribute('d', green);
      }
      if (light !== lastLight) {
        lastLight = light;
        lightPath.setAttribute('d', lightIn);
        lightClip.setAttribute('d', light);
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
   * Одна и та же полоса рисуется трижды. Смысл и вся интерактивность —
   * только у первой копии; две другие декоративны, у них нет ни фокуса,
   * ни обработчиков, ни имени в дереве доступности.
   */
  const band = (live: boolean) => (
    <div className="nav__band">
      <div className="nav__row shell">
        <div className="logo-slot" data-logo-slot="reserved">
          <a
            className="logo-slot__text"
            href="#hero"
            tabIndex={live ? undefined : -1}
            onClick={(e) => {
              e.preventDefault();
              if (live) scrollToId('hero');
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
              tabIndex={live ? undefined : -1}
              onClick={() => {
                if (live) scrollToId(id);
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          ref={live ? burgerRef : undefined}
          type="button"
          className="nav__burger"
          tabIndex={live ? undefined : -1}
          aria-expanded={live ? open : undefined}
          aria-haspopup={live ? 'dialog' : undefined}
          onClick={() => {
            if (live) setOpen(true);
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
      <nav ref={plainRef} className="nav nav--plain" aria-label="Основная навигация">
        {band(true)}
      </nav>
      {/* Инвертирующая копия НИЧЕГО НЕ РИСУЕТ: она показывает свой же фон,
          вывернутый наизнанку, и вырезан он по контурам чернил шапки. */}
      <div ref={invertRef} className="nav nav--invert" aria-hidden="true">
        <div ref={litRef} className="nav__band nav__lit">
          <div className="nav__ink" />
          <div className="nav__ink nav__ink--dim" />
        </div>
      </div>
      <div ref={darkRef} className="nav nav--dark" aria-hidden="true">{band(false)}</div>
      <svg className="nav__clip" aria-hidden="true" focusable="false">
        <defs>
          {/* Фигуры лежат ОДИН раз; маски ссылаются на них с разной
              заливкой. Обводка у зелёного не масштабируется вместе
              со словом — иначе по вертикали она растянулась бы вчетверо. */}
          {/* evenodd: контуры литер, наложенные на прямоугольник зелёного
              поля футера, становятся в нём ДЫРКАМИ — над чёрным словом
              шапка обязана остаться светлой. В хиро прямоугольника нет,
              и правило там ни на что не влияет, кроме просветов внутри
              самих литер, где оно как раз и нужно. */}
          <g ref={greenRef} id="nav-shape-green">
            <path ref={greenPathRef} d="" fillRule="evenodd" vectorEffect="non-scaling-stroke" />
          </g>
          <g id="nav-shape-light">
            <path ref={lightPathRef} d="" />
          </g>
        </defs>
        {/* Светлая копия: вся полоса минус зелёное минус светлый набор. */}
        <mask id="nav-m-plain" maskUnits="userSpaceOnUse" x="-500" y="-500" width="20000" height="2000">
          <rect x="-500" y="-500" width="20000" height="2000" fill="#fff" />
          <use href="#nav-shape-light" fill="#000" />
          <use href="#nav-shape-green" fill="#000" />
        </mask>
        {/* Инвертирующая копия обрезается ДВАЖДЫ и в двух местах сразу:
            снаружи — светлым набором, внутри — контурами чернил шапки.
            Пересечение выражается только вложением: у обрезки дети
            объединяются, а маской выворотку не обрезать вовсе — она
            её просто гасит (проверено опытом, Р-46). */}
        <clipPath id="nav-c-light" clipPathUnits="userSpaceOnUse">
          <path ref={lightClipRef} d="" />
        </clipPath>
        {/* Фигуры кладутся ПРЯМО в обрезку: `<g>` в её модели содержимого
            нет, и завёрнутые в него контуры молча не обрезают ничего. */}
        <clipPath ref={inkRef} id="nav-c-ink" clipPathUnits="userSpaceOnUse" />
        <clipPath ref={inkDimRef} id="nav-c-ink-dim" clipPathUnits="userSpaceOnUse" />
        {/* Тёмная копия: зелёное, расширенное обводкой на пиксель. */}
        <mask id="nav-m-dark" maskUnits="userSpaceOnUse" x="-500" y="-500" width="20000" height="2000">
          <use href="#nav-shape-green" fill="#fff" stroke="#fff" strokeWidth="2" />
        </mask>
      </svg>
      {mounted ? createPortal(overlay, document.body) : null}
    </>
  );
}

'use client';

import { useEffect, useRef } from 'react';
import { MORPH_DAMP_TOUCH_MS, finePointer, onLayoutChange, onScrollY, scroller } from '@/lib/scroll';
import { prefersReducedMotion } from '@/lib/motion';

export type Step = { t: string; d: string };

/**
 * БЛОК ПОРЯДКА — МАРШРУТ, А НЕ СХЕМА.
 *
 * По блоку идёт зелёная линия. Она петляет попеременно вправо и влево,
 * УХОДЯ ЗА КРАЙ ЭКРАНА и возвращаясь к следующей точке. По мере
 * прокрутки линия подсвечивается от начала к концу — как прокладываемый
 * путь; прокрутил назад — гаснет обратно. На пяти точках стоят шаги:
 * когда подсветка доходит до точки, загорается узел света и появляется
 * крупный номер.
 *
 * ── ПУТЬ ГЕНЕРИРУЕТСЯ ОТ ФАКТИЧЕСКОЙ ГЕОМЕТРИИ, А НЕ РИСУЕТСЯ РУКАМИ ──────
 * Точки маршрута обязаны стоять ровно на вертикальных центрах номеров,
 * иначе номер и подсветка разъезжаются с линией. Поэтому путь собирается
 * в JS ПРИ РАСКЛАДКЕ: берутся измеренные центры, а между ними
 * выписываются ДВЕ ЯВНЫЕ КУБИЧЕСКИЕ ДУГИ с заданными касательными.
 * Ни сплайна по набору точек, ни «дрожи пера» из таблицы случайных
 * чисел больше нет: и то, и другое читалось как небрежная ломаная.
 *
 * ── СВЕТОДИОД: ЧЕТЫРЕ ОБВОДКИ, НИ ОДНОГО ФИЛЬТРА ──────────────────────────
 * ⚠️ ДВАДЦАТЬ ВТОРАЯ ИТЕРАЦИЯ. «Не просто зелёная штриховка»: пройденная
 * часть СВЕТИТСЯ — яркое, почти белое ядро и мягкий ореол вокруг.
 * Непройденная — еле различимый пунктир.
 *
 * Ореол набирается НАЛОЖЕНИЕМ, а не размытием: один и тот же путь
 * обведён четыре раза, от широкой и почти прозрачной обводки к узкой
 * и яркой. Размытие здесь взять неоткуда — ни `filter`, ни `blur`
 * на пути, у которого каждый кадр меняется обрезка: фильтр считался бы
 * заново на каждом кадре. Тот же принцип, что у подсветки карточек.
 *
 *     ореол 18 — прозрачность 0.06;
 *     ореол 11 — 0.10;
 *     ореол  6 — 0.16;
 *     ядро  2.6 — почти белый зелёный, в полную силу.
 *
 * ВСЕ ЧЕТЫРЕ ОБРЕЗАЮТСЯ ОДНИМ АТРИБУТОМ. `stroke-dasharray`
 * и `stroke-dashoffset` НАСЛЕДУЮТСЯ, а `pathLength="1"` стоит
 * на каждом пути: значит смещение достаточно записать на общей группе,
 * и в кадре по-прежнему одна запись атрибута.
 *
 * ⚠️ ПРОТИВОФАЗНЫЙ ПУНКТИР В ЦВЕТ ФОНА УБРАН ВМЕСТЕ С ПРЕРЫВИСТОСТЬЮ
 * ПРОЙДЕННОЙ ЧАСТИ. Он был единственным местом на странице, где фон
 * ПЕРЕЧИСЛЕН (`--ink`) вместо того, чтобы браться сам, — то есть ровно
 * тот сорт модели, который запрещён в шапке (Р-47). Светящаяся лента
 * сплошная по смыслу, и вырезать из неё нечего.
 *
 * ⚠️ МАСКУ ВОЗВРАЩАТЬ НЕЛЬЗЯ. Замер двадцатой итерации: статичная
 * маска-пунктир стоила 2.2 % кадров дороже 16.9 мс на 1920 и 7.1 %
 * на 2560 против 0.0 % без неё. Масштабируется она по площади,
 * а площадь у маршрута — весь блок.
 *
 * ── ЛИНИЯ ВЫХОДИТ ЗА КРАЯ ЭКРАНА ──────────────────────────────────────────
 * Петли уходят за левый и правый край вьюпорта и возвращаются. Для
 * этого холст шире блока: `--bleed` считается при раскладке так, чтобы
 * SVG накрывал весь экран плюс запас, а секция подрезана
 * `overflow-x: clip` — иначе появилась бы горизонтальная прокрутка.
 * Обрезка идёт ровно по краю экрана, и это и есть приём.
 *
 * ── ЧТО СЧИТАЕТСЯ В КАДРЕ ──────────────────────────────────────────────────
 * Одна запись атрибута и пять записей переменной. Ни одного чтения
 * геометрии: и центры шагов, и длины вдоль пути сняты при раскладке.
 *
 * ── БЕЗ СКРИПТА И ПРИ «УМЕНЬШИТЬ ДВИЖЕНИЕ» ────────────────────────────────
 * Номера и шаги лежат в разметке и по умолчанию видны целиком (`--n: 1`
 * задаёт CSS). Линия — декорация: её `d` собирается из геометрии, и без
 * скрипта её просто нет. При «уменьшить движение» линия подсвечена
 * целиком, подписки не заводится.
 */

/**
 * РЕЛЬЕФ ШАГОВ (двадцать первая итерация).
 *
 * Шаги больше не стоят колонкой. У каждого своё смещение по горизонтали,
 * свой отбой сверху и свой кегль, и ни один ряд не идёт по возрастанию
 * или по убыванию — только вразнобой. Ровная колонка читалась как
 * список; рельеф читается как рельеф, а оправдывает разброс маршрут:
 * линия проходит через все пять точек и связывает их.
 *
 * Все три таблицы — ПЯТЬ ЧИСЕЛ НА ПЯТЬ ШАГОВ, и разбирать их нужно
 * вместе: смещение задаёт, где стоит точка маршрута, отбой — сколько
 * воздуха до предыдущего шага, кегль — вес шага в кадре.
 */
/** Доли ширины, на которых стоят точки маршрута — они же отступ шага. */
const STEP_X = [0.055, 0.3, 0.1, 0.44, 0.17];
/** На узком экране разброс МЕЛЬЧЕ, но остаётся: ровная колонка там тоже не годится. */
const STEP_X_NARROW = 0.52;
/** Дополнительный отбой сверху, в долях ширины блока (первому не нужен). */
const STEP_GAP = [0, 0.075, 0.125, 0.06, 0.105];
/** Множитель кегля. Крупных два — третий и первый, остальные мельче. */
const STEP_SIZE = [1.12, 0.78, 1.32, 0.74, 0.96];
/**
 * ⚠️ ПЕТЛИ ИДУТ ЗА КРАЙ ЭКРАНА, И РИТМ У НИХ РОВНЫЙ.
 *
 * Прежняя таблица `LOOP_X` задавала четыре разные доли ширины блока,
 * а поверх лежала «дрожь пера» — таблица случайных сдвигов контрольных
 * точек. Вместе это читалось как небрежная ломаная, а не как маршрут.
 * И то, и другое снято: петли уходят строго попеременно вправо и влево,
 * на одинаковый вынос ЗА КРАЙ ВЬЮПОРТА, и возвращаются.
 */
const LOOP_SIDE = [1, -1, 1, -1];
/** Насколько дальняя точка петли заходит за край экрана, доля выноса холста. */
const LOOP_OUT = 0.55;

/** На узком экране вынос холста меньше, но за край петля уходит всё равно. */
const NARROW = 720;

type Pt = { x: number; y: number };

/** Точка на кубике — нужна только для подсчёта длины при раскладке. */
function at(p1: Pt, c1: Pt, c2: Pt, p2: Pt, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p1.x + b * c1.x + c * c2.x + d * p2.x,
    y: a * p1.y + b * c1.y + c * c2.y + d * p2.y,
  };
}

type Built = { d: string; frac: number[]; yTab: number[]; fTab: number[] };
type Seg = { p1: Pt; c1: Pt; c2: Pt; p2: Pt };

/**
 * Собирает путь через точки шагов и считает, на какой доле длины
 * они стоят.
 *
 * ⚠️ ПУТЬ БОЛЬШЕ НЕ СГЛАЖИВАЕТСЯ СПЛАЙНОМ ПО НАБОРУ ТОЧЕК. Catmull-Rom
 * удобен тем, что проходит через свои точки, но касательную в них
 * задаёт СОСЕД: стоило петле уйти далеко вбок — и касательная
 * в самой точке маршрута заваливалась горизонтально, линия уезжала
 * вбок прямо на высоте заголовка и резала строку. С этим боролись
 * тремя блуждающими точками на петлю (Р-60) и полосами между
 * коробками шагов (Р-64), и оба приёма — заплаты на чужой касательной.
 *
 * Теперь кубики выписываются ЯВНО, и касательная задана, а не выведена.
 * В трёх местах она ВЕРТИКАЛЬНА по построению:
 *
 *     в точке шага     — линия выходит из неё строго ВНИЗ;
 *     в вершине петли  — это горизонтальный экстремум, там касательная
 *                        обязана быть вертикальной, иначе видно излом;
 *     в следующей точке шага — линия входит в неё строго СВЕРХУ.
 *
 * Отсюда две дуги на перегон и ни одного излома на всём маршруте.
 *
 * ⚠️ ВЕРТИКАЛЬНОЕ ПЛЕЧО ОБЯЗАНО ПЕРЕКРЫТЬ ТЕКСТ ШАГА. Линия идёт вниз
 * вдоль левого поля, и вбок ей можно уходить только НИЖЕ описания.
 * Поэтому плечо берётся не долей перегона, а большим из двух: половина
 * перегона и «до низа содержимого плюс запас». Это то же условие,
 * что раньше держала полоса между коробками, но выраженное прямо.
 */
function buildPath(
  W: number,
  h: number,
  bleed: number,
  over: number,
  vw: number,
  ax: number[],
  ys: number[],
  boxes: { top: number; bottom: number }[],
): Built {
  const anchors: Pt[] = ys.map((y, i) => ({ x: ax[i] + bleed, y }));
  /* Края экрана в системе координат холста и вершины петель за ними. */
  const outR = over + vw + over * LOOP_OUT;
  const outL = over - over * LOOP_OUT;

  const segs: Seg[] = [];
  const mark: number[] = [0]; // доля длины у точек маршрута, накапливается ниже

  /* Заход сверху: короткая вертикаль над первой точкой. */
  const lead = Math.max(30, (ys[1] - ys[0]) * 0.32);
  const start: Pt = { x: anchors[0].x, y: Math.max(2, ys[0] - lead) };
  segs.push({
    p1: start,
    c1: { x: start.x, y: start.y + lead * 0.5 },
    c2: { x: anchors[0].x, y: anchors[0].y - lead * 0.5 },
    p2: anchors[0],
  });

  for (let i = 1; i < anchors.length; i += 1) {
    const a = anchors[i - 1];
    const b = anchors[i];
    const far = LOOP_SIDE[i - 1] > 0 ? outR : outL;

    /* ⚠️ ВБОК ЛИНИЯ УХОДИТ ТОЛЬКО НИЖЕ ТЕКСТА, И ЭТО ОТДЕЛЬНЫЙ
       ПРЯМОЙ УЧАСТОК, А НЕ ПЛЕЧО КАСАТЕЛЬНОЙ. Вертикальная касательная
       в точке шага гарантирует лишь НАПРАВЛЕНИЕ выхода: уже к трети
       дуги кубика по горизонтали пройдено больше двадцати процентов,
       а по вертикали — только треть. При вершине петли за краем экрана
       этих двадцати процентов хватает, чтобы перечеркнуть описание.
       Поэтому из точки шага линия идёт ПРЯМО ВНИЗ до низа своего
       содержимого и только там начинает уходить вбок; в следующую
       точку входит так же — прямой вертикалью сверху. */
    let g1 = boxes[i - 1].bottom + 22;
    let g2 = boxes[i].top - 22;
    if (g2 - g1 < 40) {
      /* ⚠️ ЗАПАСНАЯ ВЕТКА ОСТАЁТСЯ В ПРОМЕЖУТКЕ МЕЖДУ ТЕКСТАМИ, а не
         уходит на середину перегона. Прежняя брала середину между
         ТОЧКАМИ шагов — то есть ровно середину абзаца, — и на узком
         экране, где промежутки короткие, линия перечёркивала описание
         (3 строки из 40). Середина промежутка хуже не бывает: она
         в худшем случае совпадает с его краем. */
      const c = (boxes[i - 1].bottom + boxes[i].top) / 2;
      g1 = c - 20;
      g2 = c + 20;
    }
    g1 = Math.min(Math.max(g1, a.y + 24), b.y - 24);
    g2 = Math.min(Math.max(g2, g1 + 40), b.y - 12);
    const ga: Pt = { x: a.x, y: g1 };
    const gb: Pt = { x: b.x, y: g2 };
    const ym = (g1 + g2) / 2;
    const d1 = Math.max(24, ym - g1);
    const d2 = Math.max(24, g2 - ym);
    const mid: Pt = { x: far, y: ym };

    /* прямая вертикаль из шага вниз */
    segs.push({
      p1: a,
      c1: { x: a.x, y: a.y + (g1 - a.y) * 0.4 },
      c2: { x: a.x, y: a.y + (g1 - a.y) * 0.8 },
      p2: ga,
    });
    /* дуга к вершине петли: касательная вертикальна на обоих концах */
    segs.push({ p1: ga, c1: { x: ga.x, y: g1 + d1 * 0.62 }, c2: { x: far, y: ym - d1 * 0.5 }, p2: mid });
    segs.push({ p1: mid, c1: { x: far, y: ym + d2 * 0.5 }, c2: { x: gb.x, y: g2 - d2 * 0.62 }, p2: gb });
    /* прямая вертикаль в следующий шаг сверху */
    segs.push({
      p1: gb,
      c1: { x: b.x, y: g2 + (b.y - g2) * 0.4 },
      c2: { x: b.x, y: g2 + (b.y - g2) * 0.8 },
      p2: b,
    });
    mark.push(segs.length);
  }

  /* Хвост уходит вниз вдоль поля последнего шага. */
  const last = anchors[anchors.length - 1];
  const tailY = Math.min(h - 2, Math.max(boxes[4].bottom + 24, last.y + 90));
  const tail = Math.max(30, tailY - last.y);
  segs.push({
    p1: last,
    c1: { x: last.x, y: last.y + tail * 0.5 },
    c2: { x: last.x + (LOOP_SIDE[3] > 0 ? -1 : 1) * Math.min(90, W * 0.03), y: tailY - tail * 0.3 },
    p2: { x: last.x + (LOOP_SIDE[3] > 0 ? -1 : 1) * Math.min(130, W * 0.045), y: tailY },
  });

  // ── сборка пути и длин ────────────────────────────────────────────────
  let d = `M${segs[0].p1.x.toFixed(1)} ${segs[0].p1.y.toFixed(1)}`;
  const lenAt: number[] = [0];
  const ys2: number[] = [segs[0].p1.y];
  const ls2: number[] = [0];
  let len = 0;
  for (const sg of segs) {
    d +=
      `C${sg.c1.x.toFixed(1)} ${sg.c1.y.toFixed(1)} ` +
      `${sg.c2.x.toFixed(1)} ${sg.c2.y.toFixed(1)} ` +
      `${sg.p2.x.toFixed(1)} ${sg.p2.y.toFixed(1)}`;
    let prev = sg.p1;
    for (let q = 1; q <= 14; q += 1) {
      const cur = at(sg.p1, sg.c1, sg.c2, sg.p2, q / 14);
      len += Math.hypot(cur.x - prev.x, cur.y - prev.y);
      prev = cur;
      /* Таблица «высота → доля длины». Высота идёт СТРОГО ВВЕРХ:
         петля местами поднимается, и по немонотонной таблице не искать.
         ⚠️ Просто нарастающего максимума мало: на подъёме появлялись
         участки с ОДИНАКОВОЙ высотой, а на них подсветка стояла,
         пока страница ехала, — замер ловил это как ступеньки. Микрошаг
         убирает площадки и за шестьсот отсчётов набирает меньше пикселя. */
      ys2.push(Math.max(ys2[ys2.length - 1] + 1e-3, cur.y));
      ls2.push(len);
    }
    lenAt.push(len);
  }

  const frac = mark.map((i) => (len > 0 ? lenAt[i] / len : 0));
  const fTab = len > 0 ? ls2.map((v) => v / len) : ls2.map(() => 0);
  return { d, frac, yTab: ys2, fTab };
}

/**
 * Доля длины пути на заданной высоте внутри блока.
 *
 * ⚠️ ПОДСВЕТКА ИДЁТ ЗА ЛИНИЕЙ ОТСЧЁТА, А НЕ ЗА ДОЛЕЙ ПРОКРУТКИ, и это
 * не украшение. Длина пути растёт неравномерно: там, где петля уходит
 * далеко вправо, на тот же пиксель высоты приходится вдвое больше
 * линии. Линейная связь «доля блока → доля длины» поэтому отставала
 * от того места экрана, где человек читает, и пятый шаг загорался,
 * когда блок уже уходил вверх. Теперь подсвечено ровно то, что выше
 * линии отсчёта, и скорость линии равна скорости страницы.
 */
function fracAtY(b: Built, y: number): number {
  const { yTab, fTab } = b;
  if (!yTab.length) return 0;
  if (y <= yTab[0]) return 0;
  if (y >= yTab[yTab.length - 1]) return 1;
  let lo = 0;
  let hi = yTab.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (yTab[mid] <= y) lo = mid;
    else hi = mid;
  }
  const dy = yTab[hi] - yTab[lo];
  const t = dy > 0 ? (y - yTab[lo]) / dy : 0;
  return fTab[lo] + (fTab[hi] - fTab[lo]) * t;
}

/**
 * Ширина окна, за которое номер проявляется полностью.
 *
 * ⚠️ У ПОСЛЕДНЕГО ШАГА ОКНО УЗКОЕ, И ЭТО ОБЯЗАТЕЛЬНО. После пятой точки
 * хвоста осталось меньше пяти процентов длины, и при общем окне номер
 * «05» доходил только до 0.73 яркости — на конце хода он просто
 * не успевал загореться. Окно каждого шага обрезается тем, что осталось
 * до конца пути.
 */
const WIN = 0.055;

/**
 * ЛИНИЯ ОТСЧЁТА — 78 % ВЫСОТЫ ЭКРАНА, то есть заметно ниже середины.
 * Шаг загорается, пока он ещё в нижней половине кадра, а не когда
 * доехал до середины; к моменту, когда блок уходит вверх, маршрут
 * пройден целиком. Прежние 0.72/0.34 задавали не линию, а два края
 * хода, и хвост маршрута доигрывал уже за нижней границей блока.
 */
const REF_Y = 0.78;

export default function Route({ steps }: { steps: Step[] }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const dimRef = useRef<SVGPathElement>(null);
  const litRef = useRef<SVGGElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const svg = svgRef.current;
    const lit = litRef.current;
    const sc = scroller();
    if (!root || !svg || !lit || !sc) return;

    let items: HTMLElement[] = [];
    let frac: number[] = [];
    let wins: number[] = [];
    let built: Built | null = null;
    let top = 0;
    let vh = 1;

    const measure = () => {
      /* Геометрия снимается ЗДЕСЬ и только здесь. */
      items = Array.from(root.querySelectorAll<HTMLElement>('.rstep'));
      if (items.length !== 5) return;

      /* ⚠️ РЕЛЬЕФ ВЫСТАВЛЯЕТСЯ ПЕРВЫМ, ДО ЧТЕНИЯ ЦЕНТРОВ. Смещение,
         отбой и кегль меняют раскладку шага: от них зависят переносы
         строк, а от переносов — высота. Померив центры до них, мы
         клали бы точки маршрута по вчерашней раскладке. Зависят они
         только от ширины, поэтому считаются заранее. */
      const w0 = Math.max(1, Math.round(root.getBoundingClientRect().width));
      const narrow0 = w0 < NARROW;
      const pad = Math.min(46, w0 * 0.03);
      const right = Math.max(24, w0 * 0.04);
      for (let i = 0; i < items.length; i += 1) {
        const ax0 = w0 * (narrow0 ? STEP_X[i] * STEP_X_NARROW : STEP_X[i]);
        const sx = ax0 + pad;
        items[i].style.setProperty('--sx', `${sx.toFixed(1)}px`);
        /* ⚠️ У ПРОМЕЖУТКА МЕЖДУ ШАГАМИ ЕСТЬ НИЖНИЙ ПРЕДЕЛ, И ЗАДАЁТ ЕГО
           МАРШРУТ. Петля обязана уходить вбок НИЖЕ текста предыдущего
           шага и возвращаться ВЫШЕ текста следующего: на это нужна
           свободная полоса. На узком экране доли ширины давали 21…44 px,
           полоса вырождалась, и линия резала описание. Доли остаются —
           они и есть рельеф, — но снизу подпёрты. */
        const gapMin = narrow0 ? 96 : 40;
        const sg = i === 0 ? 0 : Math.max(gapMin, STEP_GAP[i] * Math.min(w0, 1200));
        items[i].style.setProperty('--sg', `${sg.toFixed(0)}px`);
        items[i].style.setProperty('--ss', STEP_SIZE[i].toFixed(2));
        items[i].style.setProperty('--sw', `${Math.max(180, w0 - sx - right).toFixed(0)}px`);
      }

      const shift = sc.getBoundingClientRect().top - sc.scrollTop;
      const box = root.getBoundingClientRect();
      const w = Math.max(1, Math.round(box.width));
      const h = Math.max(1, Math.round(box.height));

      const ys = items.map((el) => {
        const r = el.getBoundingClientRect();
        // точка стоит на центре НОМЕРА, а не всего шага: описание длиннее
        // заголовка, и центр строки уезжал бы вниз от цифры
        const num = el.querySelector<HTMLElement>('.rstep__num');
        const nr = num ? num.getBoundingClientRect() : r;
        return nr.top - box.top + nr.height / 2;
      });

      /* ⚠️ КОРОБКА ШАГА СЧИТАЕТСЯ ПО СОДЕРЖИМОМУ, А НЕ ПО САМОМУ ШАГУ.
         Шаги в потоке стоят вплотную: между боксами лежит только
         внешний отбой, и на узком экране это десять пикселей — полоса
         вырождалась, петля уходила в запасную ветку и резала абзац.
         По содержимому в ту же полосу попадают ещё и оба внутренних
         поля, и её хватает везде. */
      const boxes = items.map((el) => {
        let top = Infinity;
        let bottom = -Infinity;
        for (const kid of el.querySelectorAll<HTMLElement>('.rstep__num, .rstep__body')) {
          const r = kid.getBoundingClientRect();
          if (r.height < 1) continue;
          top = Math.min(top, r.top - box.top);
          bottom = Math.max(bottom, r.bottom - box.top);
        }
        const r = el.getBoundingClientRect();
        return Number.isFinite(top)
          ? { top, bottom }
          : { top: r.top - box.top, bottom: r.bottom - box.top };
      });

      /* ⚠️ ХОЛСТ ШИРЕ БЛОКА, И ЭТО ЕСТЬ ПРИЁМ. Петля обязана уйти
         ЗА КРАЙ ЭКРАНА и вернуться, а блок лежит внутри полей
         страницы. Поэтому SVG вылезает из блока на `--bleed` с каждой
         стороны: половина того, что блок не добирает до ширины экрана,
         плюс запас `over` уже за самим экраном. Секция подрезана
         `overflow-x: clip`, и обрезка идёт ровно по краю экрана. */
      const vw = Math.max(1, sc.clientWidth);
      const over = Math.max(56, Math.min(200, vw * (w < NARROW ? 0.2 : 0.13)));
      const bleed = Math.max(0, (vw - w) / 2) + over;
      const W = w + bleed * 2;
      root.style.setProperty('--bleed', `${bleed.toFixed(1)}px`);

      const ax = STEP_X.map((f) => w * (w < NARROW ? f * STEP_X_NARROW : f));
      built = buildPath(W, h, bleed, over, vw, ax, ys, boxes);
      frac = built.frac;
      wins = frac.map((f) => Math.max(0.012, Math.min(WIN, (1 - f) * 0.6)));
      svg.setAttribute('viewBox', `0 0 ${W.toFixed(1)} ${h}`);
      dimRef.current?.setAttribute('d', built.d);
      for (const el of lit.querySelectorAll('path')) el.setAttribute('d', built.d);

      // точки на линии — ровно там, где стоят номера
      for (let i = 0; i < items.length; i += 1) {
        items[i].style.setProperty('--dot-x', `${ax[i].toFixed(1)}px`);
        items[i].style.setProperty('--dot-y', `${ys[i].toFixed(1)}px`);
      }

      /* Дальше ход подсветки считается не долей блока, а линией
         отсчёта: нужны только верх блока на странице и высота экрана. */
      top = box.top - shift;
      vh = sc.clientHeight;
    };

    const put = (p: number) => {
      /* ⚠️ ШЕСТЬ ЗНАКОВ, А НЕ ЧЕТЫРЕ. На хвосте хода демпфер подходит
         к единице шагами около 3·10⁻⁵, и при четырёх знаках соседние
         кадры печатались ОДИНАКОВО — сторож честно читал это как
         «скролл ехал, подсветка стояла» (5 кадров из 35 на мобильной).
         Стояла не подсветка, а наше округление. */
      lit.setAttribute('stroke-dashoffset', (1 - p).toFixed(6));
      for (let i = 0; i < items.length; i += 1) {
        const n0 = (p - frac[i]) / wins[i];
        const n = n0 <= 0 ? 0 : n0 >= 1 ? 1 : n0;
        items[i].style.setProperty('--n', n.toFixed(3));
      }
    };

    measure();

    /* При «уменьшить движение» линия подсвечена целиком, номера и шаги
       видны сразу: подписки просто не заводится. */
    if (prefersReducedMotion()) {
      const still = () => {
        measure();
        put(1);
      };
      still();
      return onLayoutChange(still);
    }

    /* Демпфер — только на касаниях: на точном указателе позицию уже ведёт
       Lenis, и второе сглаживание поверх него — это та самая тяжесть.
       На касаниях позиция приходит ступенями инерции, и без демпфера
       подсветка шла бы рывками. Тот же приём, что у формы вордмарка. */
    const damp = !finePointer();
    let target = 0;
    let cur = NaN;
    let raf = 0;
    let prev = 0;

    const tick = (now: number) => {
      raf = 0;
      const dt = Math.min(64, now - prev);
      prev = now;
      cur += (target - cur) * (1 - Math.exp(-dt / MORPH_DAMP_TOUCH_MS));
      if (Math.abs(target - cur) < 1e-4) cur = target;
      put(cur);
      if (cur !== target) raf = requestAnimationFrame(tick);
    };

    const read = (y: number) => {
      if (!built) return;
      /* Линия отсчёта в системе координат блока — и сразу доля длины
         пути на этой высоте. */
      const p = fracAtY(built, y + vh * REF_Y - top);
      if (!damp) {
        put(p);
        return;
      }
      target = p;
      if (Number.isNaN(cur)) {
        cur = p;
        put(p);
        return;
      }
      if (cur === target || raf) return;
      prev = performance.now();
      raf = requestAnimationFrame(tick);
    };

    const offLayout = onLayoutChange(measure);
    const offScroll = onScrollY(read);
    return () => {
      offLayout();
      offScroll();
      if (raf) cancelAnimationFrame(raf);
      root.style.removeProperty('--bleed');
      for (const el of items) {
        for (const prop of ['--n', '--dot-x', '--dot-y', '--sx', '--sg', '--ss', '--sw']) {
          el.style.removeProperty(prop);
        }
      }
    };
  }, [steps]);

  return (
    <div ref={rootRef} className="route">
      <svg ref={svgRef} className="route__svg" aria-hidden="true" preserveAspectRatio="none">
        {/* Непройденная часть: еле различимый пунктир. */}
        <path ref={dimRef} className="route__dim" />
        {/* Пройденная часть — светодиод. Обрезка одна на все четыре
            обводки: `stroke-dasharray` и `stroke-dashoffset`
            наследуются, а `pathLength` стоит на каждом пути. */}
        <g ref={litRef} className="route__lit" strokeDasharray="1 1" strokeDashoffset="1">
          <path className="route__halo route__halo--3" pathLength="1" />
          <path className="route__halo route__halo--2" pathLength="1" />
          <path className="route__halo route__halo--1" pathLength="1" />
          <path className="route__core" pathLength="1" />
        </g>
      </svg>

      <ol className="route__list">
        {steps.map((s, i) => (
          <li key={s.t} className="rstep">
            <span className="rstep__dot" aria-hidden="true" />
            <span className="rstep__num tnum" aria-hidden="true">
              {i + 1}
            </span>
            <span className="rstep__body">
              <span className="rstep__t">
                <span className="sr-only">Шаг {i + 1}. </span>
                {s.t}
              </span>
              <span className="rstep__d">{s.d}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

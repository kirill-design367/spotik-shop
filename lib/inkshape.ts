/**
 * ФИГУРА ЧЕРНИЛ ДЛЯ ВЫВОРОТКИ — ОДИН МОДУЛЬ НА ВСЮ СТРАНИЦУ.
 *
 * Механизм инверсии на странице ровно один и описан в Р-47: слой берёт
 * СВОЙ СОБСТВЕННЫЙ ФОН и прогоняет его через ахроматическую выворотку,
 * обрезанную по форме чернил. Слой ничего не знает о том, что под ним,
 * и знать не должен — всякая модель «где что лежит» дырява, а сторож,
 * построенный на той же модели, дырку не увидит.
 *
 * Обрезает выворотку ТОЛЬКО `clip-path`: маска её не ограничивает,
 * а гасит целиком (Р-46). Значит форму чернил надо выразить фигурами
 * SVG, и вот этим здесь и занимаемся.
 *
 * Правила, купленные опытом и стоившие по итерации каждая:
 *
 *   • `<g>` и `<use>` внутри `clipPath` НЕ РАБОТАЮТ. Группы нет в модели
 *     содержимого, ссылка убрана из неё в SVG2. Фигуры кладутся в обрезку
 *     напрямую, поэтому здесь возвращается ПЛОСКИЙ СПИСОК узлов.
 *   • Строка целиком одним `<text>` накапливает расхождение по трекингу:
 *     в HTML апрош добавляется после КАЖДОГО знака, включая последний.
 *     Поэтому фигура собирается по кускам, и каждый кусок ставится
 *     в своё ИЗМЕРЕННОЕ место.
 *   • Насыщенность может быть задана ОСЬЮ (`font-variation-settings`),
 *     а не `font-weight`: без неё копия выходит на два веса светлее
 *     и настоящие глифы накрывает наполовину.
 *   • Координаты нельзя снимать во время анимации входа: фигура запеклась
 *     бы со сдвигом, а цвет при этом остался бы правильным — то есть
 *     цветовой сторож промолчал бы. Отсчёт идёт от бокса ЖИВОГО элемента,
 *     который несёт тот же трансформ.
 */
const NS = 'http://www.w3.org/2000/svg';

const boxes = new Map<string, { asc: number; desc: number }>();
let ctx2d: CanvasRenderingContext2D | null | undefined;

/**
 * Метрики шрифта тем же объявлением, что у элемента. Базовая линия
 * считается по обычному правилу половинного интерлиньяжа ОТ СТРОЧНОГО
 * БОКСА, а не от бокса элемента: слот под логотип выше самой строки,
 * и отсчёт от бокса уехал бы выше глифов.
 */
function fontBox(font: string): { asc: number; desc: number } {
  const had = boxes.get(font);
  if (had) return had;
  if (ctx2d === undefined) ctx2d = document.createElement('canvas').getContext('2d');
  let box = { asc: 0, desc: 0 };
  if (ctx2d) {
    ctx2d.font = font;
    const m = ctx2d.measureText('Нg');
    box = { asc: m.fontBoundingBoxAscent || 0, desc: m.fontBoundingBoxDescent || 0 };
  }
  boxes.set(font, box);
  return box;
}

/** Куском фигуры может быть литера или слово: это размен точности на число узлов. */
export type ShapeUnit = 'char' | 'word';

/**
 * Куски текста для обмера. Литера — точнее всего и нужна там, где трекинг
 * крупный (логотип, надписи прописными). Слово — там, где знаков сотни
 * и каждая литера отдельным `<text>` встала бы в тысячи узлов: внутри
 * слова апрош в SVG и в HTML одинаков, поэтому расхождению взяться
 * неоткуда, а число узлов падает в шесть-восемь раз.
 */
function pieces(text: string, unit: ShapeUnit): [number, number][] {
  const out: [number, number][] = [];
  if (unit === 'char') {
    for (let i = 0; i < text.length; i += 1) if (text[i].trim()) out.push([i, i + 1]);
    return out;
  }
  let i = 0;
  while (i < text.length) {
    while (i < text.length && !text[i].trim()) i += 1;
    const from = i;
    while (i < text.length && text[i].trim()) i += 1;
    if (i > from) out.push([from, i]);
  }
  return out;
}

/**
 * Фигура чернил одного элемента с текстом: плоский список `<text>`,
 * поставленных по измеренным местам, в системе координат (ox, oy).
 *
 * Возвращает пустой список, если элемент скрыт, пуст или в нём не один
 * текстовый узел: фигура обязана быть точной или отсутствовать вовсе —
 * приблизительная накрыла бы глифы наполовину, а цветовой сторож
 * этого не видит.
 */
export function glyphShapes(
  el: HTMLElement,
  ox: number,
  oy: number,
  unit: ShapeUnit = 'char',
): SVGTextElement[] {
  const cs = getComputedStyle(el);
  if (cs.visibility === 'hidden' || cs.display === 'none') return [];
  const node = el.firstChild;
  if (!node || node.nodeType !== 3) return [];
  const text = node.textContent ?? '';
  if (!text.trim()) return [];

  const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const { asc, desc } = fontBox(font);
  const up = cs.textTransform === 'uppercase';
  const range = document.createRange();
  const out: SVGTextElement[] = [];

  for (const [from, to] of pieces(text, unit)) {
    range.setStart(node, from);
    range.setEnd(node, to);
    const r = range.getBoundingClientRect();
    if (r.width < 0.1 || r.height < 0.1) continue;
    /* Базовая линия считается от СОБСТВЕННОГО бокса куска, а не от бокса
       элемента: тогда многострочный текст раскладывается сам собой —
       у каждой строки свой бокс и своя линия. */
    const glyph = document.createElementNS(NS, 'text');
    glyph.setAttribute('x', (r.left - ox).toFixed(2));
    glyph.setAttribute('y', (r.top - oy + (r.height - asc - desc) / 2 + asc).toFixed(2));
    glyph.setAttribute('font-family', cs.fontFamily);
    glyph.setAttribute('font-size', cs.fontSize);
    glyph.setAttribute('font-weight', cs.fontWeight);
    glyph.setAttribute('font-style', cs.fontStyle);
    if (cs.fontVariationSettings && cs.fontVariationSettings !== 'normal') {
      glyph.style.fontVariationSettings = cs.fontVariationSettings;
    }
    if (cs.fontStretch && cs.fontStretch !== 'normal') glyph.style.fontStretch = cs.fontStretch;
    /* Апрош внутри куска обязан совпасть с HTML: у слова из восьми знаков
       он набегает в пиксель, и правый штрих последней литеры вышел бы
       из обрезки. */
    if (unit === 'word' && cs.letterSpacing && cs.letterSpacing !== 'normal') {
      glyph.style.letterSpacing = cs.letterSpacing;
    }
    const piece = text.slice(from, to);
    glyph.textContent = up ? piece.toLocaleUpperCase('ru') : piece;
    out.push(glyph);
  }
  return out;
}

/** Прямоугольник в ту же систему координат — для полос бургера и им подобных. */
export function rectShape(r: DOMRect, ox: number, oy: number, y0 = 0, y1 = r.height): SVGRectElement {
  const box = document.createElementNS(NS, 'rect');
  box.setAttribute('x', (r.left - ox).toFixed(2));
  box.setAttribute('y', (r.top - oy + y0).toFixed(2));
  box.setAttribute('width', r.width.toFixed(2));
  box.setAttribute('height', (y1 - y0).toFixed(2));
  return box;
}

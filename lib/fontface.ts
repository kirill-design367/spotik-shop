/**
 * ОБЪЯВЛЕНИЯ ШРИФТОВ.
 *
 * Почему они здесь, а не в CSS. basePath из next.config подставляется только
 * в разметку; абсолютный url('/fonts/...') внутри CSS остаётся как есть и на
 * GitHub Pages даёт 404 — страница открывается, но без единого шрифта.
 * Относительный путь тоже не годится: webpack пытается разрешить его как
 * модуль и роняет сборку.
 *
 * Поэтому объявления собираются здесь строкой с явным префиксом и уходят
 * инлайном в <head>. Побочная выгода: критические @font-face не ждут
 * загрузки отдельного CSS-файла.
 *
 * ── ДВАДЦАТЬ ПЕРВАЯ ИТЕРАЦИЯ: ГАРНИТУРУ ВЫБИРАЕТ АРТ-ДИРЕКТОР ─────────────
 * Кандидатов четыре, они собраны сабсетами все сразу и стоят рядом
 * на служебной странице /fonts. Боевой — ровно один, и задаёт его
 * константа SITE ниже: весь сайт набран семейством «Spotik Text»,
 * и смена кандидата не трогает ни одной строки вёрстки.
 *
 * Шрифта для вордмарка здесь нет и не должно быть: слово SPOTIK запечено
 * в контуры (lib/wordmark.data.ts) и в критическом пути весит ноль байт.
 * Unbounded в наборный текст не допускается — он только исходник контуров.
 *
 * Сабсеты разложены по unicode-range: браузер тянет только то, что встретил.
 */

export const RANGE = {
  cyrillic: 'U+0400-045F, U+2116',
  latin: 'U+0020-00FF, U+2013-2014, U+2018-201E, U+2022, U+2026',
  ruble: 'U+20BD',
} as const;

/** Кандидаты в наборную гарнитуру. Диапазон веса прочитан из fvar бинарника. */
export const CANDIDATES = [
  {
    slug: 'inter',
    name: 'Inter',
    wght: [100, 900] as const,
    author: 'Rasmus Andersson',
    note:
      'Нейтральный гротеск без единого завитка. Плотный, с большой строчной, ' +
      'уверенно держит крупные прописные. Кириллица рисованная, Ж Ф Щ спокойные. ' +
      'Девять весов по оси.',
  },
  {
    slug: 'onest',
    name: 'Onest',
    wght: [100, 900] as const,
    author: 'Nikita Klimov',
    note:
      'Кириллица здесь первична, а не приделана: рисовался от неё. Чуть мягче ' +
      'и человечнее Inter, ритм в абзаце ровный. Девять весов.',
  },
  {
    slug: 'manrope',
    name: 'Manrope',
    wght: [200, 800] as const,
    author: 'Михаил Шаранда',
    note:
      'Геометричный, с характером: открытые апертуры, узнаваемые «а» и «у». ' +
      'Крупный кегль держит, но нейтральным его не назвать. Семь весов.',
  },
  {
    slug: 'geologica',
    name: 'Geologica',
    wght: [100, 900] as const,
    author: 'Ivan Gladkikh',
    note:
      'Самый плотный и самый техничный из четырёх, узкие формы, много текста ' +
      'в строке. На мелком кегле суховат. Девять весов.',
  },
  {
    slug: 'golos',
    name: 'Golos Text',
    wght: [400, 900] as const,
    author: 'Paratype',
    note:
      'Стоял на сайте до этой итерации. Кириллица родная, но весов только ' +
      'от обычного до чёрного: светлых начертаний у него нет вовсе.',
  },
] as const;

export type Candidate = (typeof CANDIDATES)[number];

/**
 * БОЕВАЯ ГАРНИТУРА. Одна строка — и весь сайт меняет набор.
 * До решения арт-директора стоит Inter: он единственный из четырёх
 * одновременно нейтрален, плотен и держит крупные прописные.
 */
export const SITE = 'inter';

const site = CANDIDATES.find((c) => c.slug === SITE)!;

function face(base: string, family: string, file: string, range: string, wght: readonly number[]) {
  return (
    `@font-face{font-family:'${family}';` +
    `src:url('${base}/fonts/${file}') format('woff2-variations');` +
    `font-weight:${wght[0]} ${wght[1]};` +
    `font-display:swap;` +
    `unicode-range:${range}}`
  );
}

function trio(base: string, family: string, slug: string, wght: readonly number[]) {
  return [
    face(base, family, `${slug}-cyrillic.woff2`, RANGE.cyrillic, wght),
    face(base, family, `${slug}-latin.woff2`, RANGE.latin, wght),
    face(base, family, `${slug}-symbols.woff2`, RANGE.ruble, wght),
  ].join('');
}

/** Боевая гарнитура страницы. В критический путь уходит только она. */
export function siteFontFaces(base: string): string {
  return trio(base, 'Spotik Text', site.slug, site.wght);
}

/** Витрина кандидатов: живёт только на /fonts и в боевую страницу не попадает. */
export function specimenFontFaces(base: string): string {
  return CANDIDATES.map((c) => trio(base, `Spec ${c.name}`, c.slug, c.wght)).join('');
}

/** Диапазон веса боевой гарнитуры — им пользуется вёрстка. */
export const SITE_WGHT = site.wght;

/**
 * Один и тот же префикс для разметки и для объявлений шрифтов.
 * Значение приходит из next.config.mjs через переменную сборки: два
 * независимых литерала рано или поздно разъедутся, и разъедутся тихо —
 * страница откроется, а шрифты нет.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

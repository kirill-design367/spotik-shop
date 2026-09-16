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
 * Наборный шрифт в проекте один — Golos Text. Он рисовался от кириллицы:
 * шире строчная, спокойнее Ж Ф Щ, ровнее ритм в абзаце. Им набран весь
 * русский текст и весь интерфейс.
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

type Face = {
  family: string;
  file: string;
  range: string;
  weight?: string;
  stretch?: string;
  display?: 'block' | 'swap';
};

function face(base: string, f: Face): string {
  return (
    `@font-face{font-family:'${f.family}';` +
    `src:url('${base}/fonts/${f.file}') format('woff2-variations');` +
    `font-weight:${f.weight ?? '400 900'};` +
    (f.stretch ? `font-stretch:${f.stretch};` : '') +
    `font-display:${f.display ?? 'swap'};` +
    `unicode-range:${f.range}}`
  );
}

/** Боевые гарнитуры страницы. */
export function siteFontFaces(base: string): string {
  return [
    face(base, { family: 'Spotik Text', file: 'golos-cyrillic.woff2', range: RANGE.cyrillic }),
    face(base, { family: 'Spotik Text', file: 'golos-latin.woff2', range: RANGE.latin }),
    face(base, { family: 'Spotik Text', file: 'golos-symbols.woff2', range: RANGE.ruble }),
  ].join('');
}

/**
 * Один и тот же префикс для разметки и для объявлений шрифтов.
 * Значение приходит из next.config.mjs через переменную сборки: два
 * независимых литерала рано или поздно разъедутся, и разъедутся тихо —
 * страница откроется, а шрифты нет.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

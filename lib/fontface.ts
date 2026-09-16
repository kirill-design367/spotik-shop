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
 * Две гарнитуры с разными ролями, и они намеренно разные.
 *   ПРИЁМ — Roboto Flex. Сабсет ровно из шести литер S P O T I K, но со
 *   ВСЕМИ 13 осями: на них живёт главный механизм страницы. 13 КБ.
 *   ГОЛОС — Golos Text. У Roboto Flex кириллица адаптированная, а Golos
 *   рисовался от кириллицы: шире строчная, спокойнее Ж Ф Щ, ровнее ритм
 *   в абзаце. Весь русский текст набран им.
 * Каждая разложена по unicode-range: браузер тянет только то, что встретил.
 */

export const RANGE = {
  spotik: 'U+49, U+4B, U+4F, U+50, U+53, U+54',
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
    // вордмарк не имеет права мигнуть подменой, поэтому display: block
    face(base, {
      family: 'Spotik Wordmark',
      file: 'spotik-wordmark.woff2',
      range: RANGE.spotik,
      weight: '100 1000',
      stretch: '25% 151%',
      display: 'block',
    }),
    face(base, { family: 'Spotik Text', file: 'golos-cyrillic.woff2', range: RANGE.cyrillic }),
    face(base, { family: 'Spotik Text', file: 'golos-latin.woff2', range: RANGE.latin }),
    face(base, { family: 'Spotik Text', file: 'golos-symbols.woff2', range: RANGE.ruble }),
  ].join('');
}

/** Кандидаты для служебной страницы /fonts. На боевые страницы не попадают. */
export function candidateFontFaces(base: string): string {
  return [
    face(base, {
      family: 'Cand Roboto Flex',
      file: 'spotik-wordmark.woff2',
      range: RANGE.spotik,
      weight: '100 1000',
      stretch: '25% 151%',
    }),
    face(base, { family: 'Cand Roboto Flex', file: 'spotik-text-cyrillic.woff2', range: RANGE.cyrillic, weight: '100 1000' }),
    face(base, { family: 'Cand Roboto Flex', file: 'spotik-text-latin.woff2', range: RANGE.latin, weight: '100 1000' }),
    face(base, { family: 'Cand Roboto Flex', file: 'spotik-text-symbols.woff2', range: RANGE.ruble, weight: '100 1000' }),

    face(base, { family: 'Cand Wix', file: 'cand-wix-cyr.woff2', range: RANGE.cyrillic, weight: '400 800' }),
    face(base, { family: 'Cand Wix', file: 'cand-wix-lat.woff2', range: `${RANGE.latin}, ${RANGE.ruble}`, weight: '400 800' }),

    face(base, { family: 'Cand Golos', file: 'cand-golos-cyr.woff2', range: RANGE.cyrillic }),
    face(base, { family: 'Cand Golos', file: 'cand-golos-lat.woff2', range: `${RANGE.latin}, ${RANGE.ruble}` }),

    face(base, { family: 'Cand Unbounded', file: 'cand-unbounded-cyr.woff2', range: RANGE.cyrillic, weight: '200 900' }),
    face(base, { family: 'Cand Unbounded', file: 'cand-unbounded-lat.woff2', range: `${RANGE.latin}, ${RANGE.ruble}`, weight: '200 900' }),
  ].join('');
}

/** Один и тот же префикс для разметки и для объявлений шрифтов. */
export const BASE_PATH = process.env.NODE_ENV === 'production' ? '/spotik-shop' : '';

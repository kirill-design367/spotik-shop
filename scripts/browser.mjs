/** Общий запуск браузера: в этой среде Chromium предустановлен по фиксированному пути. */
import { chromium } from 'playwright';
// В этой среде Chromium предустановлен по фиксированному пути; в CI его
// ставит playwright install, и тогда путь подбирает сама библиотека.
import { existsSync } from 'node:fs';
const PINNED = '/opt/pw-browsers/chromium';
export const LAUNCH = {
  ...(existsSync(PINNED) ? { executablePath: PINNED } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
};
export const launch = (extra = {}) => chromium.launch({ ...LAUNCH, ...extra });

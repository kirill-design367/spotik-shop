/** Общий запуск браузера: в этой среде Chromium предустановлен по фиксированному пути. */
import { chromium } from 'playwright';
export const LAUNCH = {
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
};
export const launch = (extra = {}) => chromium.launch({ ...LAUNCH, ...extra });

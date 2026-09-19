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

/**
 * ПРОКРУЧИВАЕТСЯ КОНТЕЙНЕР, А НЕ ДОКУМЕНТ (Р-37), и замеры обязаны мерить
 * то, что действительно едет.
 *
 * Скрипты проверок писались под документ и оперируют `window.scrollY`,
 * `window.scrollTo` и `documentElement.scrollHeight`. Переписывать
 * полтора десятка файлов построчно — это полтора десятка мест, где можно
 * ошибиться по-разному. Вместо этого одна подмена на весь стенд: три
 * величины начинают отвечать про `#scroller`.
 *
 * Подмена живёт ТОЛЬКО в стенде и ставится до скриптов страницы. Сайт
 * ею не пользуется: там своя функция scrollPos() из lib/scroll. Если
 * контейнера на странице нет (404, голая разметка), всё честно падает
 * обратно на документ.
 *
 * Горизонтальный вылет после подмены считается по ОБОИМ: документ
 * по-прежнему может разъехаться сам, а контейнер — своим содержимым.
 */
const SCROLL_SHIM = () => {
  const box = () =>
    document.getElementById('scroller') || document.scrollingElement || document.documentElement;
  const realW = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollWidth').get;
  const def = (obj, key, get) => {
    try {
      Object.defineProperty(obj, key, { configurable: true, get });
    } catch (e) {
      /* пусто: если не вышло, замер просто останется про документ */
    }
  };
  def(window, 'scrollY', () => box().scrollTop);
  def(window, 'pageYOffset', () => box().scrollTop);
  const native = window.scrollTo.bind(window);
  window.scrollTo = (a, b) => {
    const el = document.getElementById('scroller');
    if (!el) return native(a, b);
    if (a && typeof a === 'object') el.scrollTo(a);
    else el.scrollTop = b;
  };
  /* Подмена ставится ДО скриптов страницы, а в этот момент ни <html>,
     ни <body> ещё может не быть. Поэтому узлы правим и сразу, и по
     готовности разметки — что успеет, то и сработает. */
  const patchNodes = () => {
    for (const node of [document.documentElement, document.body]) {
      if (!node) continue;
      def(node, 'scrollHeight', () => box().scrollHeight);
      def(node, 'scrollWidth', () => Math.max(realW.call(node), box().scrollWidth));
    }
  };
  patchNodes();
  document.addEventListener('DOMContentLoaded', patchNodes);
};

/**
 * Браузер с уже вшитой подменой: любой контекст и любая страница получают
 * её автоматически, поэтому ни один скрипт про неё помнить не обязан.
 */
export const launch = async (extra = {}) => {
  const browser = await chromium.launch({ ...LAUNCH, ...extra });
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...args) => {
    const ctx = await newContext(...args);
    await ctx.addInitScript(SCROLL_SHIM);
    return ctx;
  };
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...args) => {
    const page = await newPage(...args);
    await page.addInitScript(SCROLL_SHIM);
    return page;
  };
  return browser;
};

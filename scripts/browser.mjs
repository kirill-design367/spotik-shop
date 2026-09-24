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
 * ⚠️ СЧЁТЧИК МЕТРИКИ ОТВЕЧАЕТСЯ ПУСТЫМ СКРИПТОМ, И ЭТО НЕ ПОБЛАЖКА.
 *
 * Наружу из среды разработки хода нет вовсе — прокси пускает только
 * на github.com, — и на раннере GitHub `mc.yandex.ru` тоже недостижим.
 * Настоящий запрос там ВИСИТ, а `waitUntil: 'networkidle'` ждёт тишины
 * в сети: тишина не наступает, и `page.goto` падает по тайм-ауту
 * на исправной странице. Ровно на этом легла выкладка № 100 —
 * `verify-pay` не смог открыть `/pay/ok/`.
 *
 * Вопрос у сторожей один: падает ли НАША страница. «Доступен ли Яндекс
 * с этой машины» — вопрос о среде, и смешивать их значило бы получать
 * провалы на исправном сайте. Заодно это и есть проверка НА ЧЕЛОВЕКА
 * С БЛОКИРОВЩИКОМ: библиотека не поднялась, `ym` остался заглушкой —
 * и ни одна страница не обязана от этого сломаться.
 *
 * ⚠️ И ЗАГЛУШКА ЖИВЁТ ЗДЕСЬ, А НЕ В КАЖДОМ СТОРОЖЕ ПООТДЕЛЬНОСТИ.
 * Первая редакция поставила её только в `verify-export`, и через
 * полчаса ровно та же беда уронила `verify-pay`. Способ должен быть
 * один на всех — то же правило, что вывело нас на подмену прокрутки
 * выше и на общий `serveOut` в Р-101.
 *
 * ⚠️ ИСКЛЮЧЕНИЕ РОВНО ОДНО: `verify-metrika`. Он и существует затем,
 * чтобы доказать, что счётчик ЗАПРАШИВАЕТСЯ и запрашивается ПОСЛЕ
 * `load`; заглуши мы его там — доказывать стало бы нечего. Поэтому
 * он поднимает браузер с `metrikaZhivaya: true`.
 */
const GLUSHITEL = '**/mc.yandex.ru/**';
const zaglushit = (cel) =>
  cel.route(GLUSHITEL, (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }),
  );

/**
 * Браузер с уже вшитыми подменами: любой контекст и любая страница
 * получают и подмену прокрутки, и заглушку счётчика автоматически,
 * поэтому ни один скрипт про них помнить не обязан.
 */
export const launch = async (extra = {}) => {
  const { metrikaZhivaya = false, ...opts } = extra;
  const browser = await chromium.launch({ ...LAUNCH, ...opts });
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...args) => {
    const ctx = await newContext(...args);
    await ctx.addInitScript(SCROLL_SHIM);
    if (!metrikaZhivaya) await zaglushit(ctx);
    return ctx;
  };
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...args) => {
    const page = await newPage(...args);
    await page.addInitScript(SCROLL_SHIM);
    if (!metrikaZhivaya) await zaglushit(page);
    return page;
  };
  return browser;
};

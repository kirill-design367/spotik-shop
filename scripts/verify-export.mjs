/**
 * ПРОВЕРКА СОБРАННОГО САЙТА В НАСТОЯЩЕМ БРАУЗЕРЕ.
 *
 * Сборка ломается тихо: страница открывается, но часть ресурсов
 * уходит мимо и отдаёт 404. Ловится это только тем, что сайт реально
 * поднимают и открывают браузером.
 *
 * ⚠️ ПОДНИМАЕТСЯ БОЕВОЙ СЕРВЕР, А НЕ ПАПКА. До двадцать седьмой
 * итерации сайт был статическим экспортом, и здесь стоял свой
 * файловый сервер поверх `out/`. Теперь это приложение, и проверять
 * надо ровно то, что отдаёт человеку тот же код (scripts/serve-out.mjs).
 *
 * ⚠️ БОЕВОЙ ПУТЬ — КОРЕНЬ: сайт переехал со страниц GitHub, где жил
 * подпапкой `/spotik-shop/`, на свой домен. Класс поломки от этого
 * не исчез, а поменял знак: раньше ассет мог уйти МИМО префикса,
 * теперь — получить лишний. Сверх того боевой адрес проверяется
 * ЖИВЫМ запросом с раннера после выкладки (deploy.yml).
 *
 * Требуется:
 *   • ноль ответов со статусом 400 и выше;
 *   • ноль ошибок JavaScript;
 *   • ни одного шрифта в состоянии error (состояние unloaded — норма:
 *     так браузер сообщает, что сабсет не понадобился, и это ровно то,
 *     ради чего объявления разложены по unicode-range);
 *   • ни одного горизонтального скролла на трёх эталонных размерах;
 *   • вордмарк занимает заданную долю ширины и НЕ упирается в края,
 *     а его контур непустой (пустой путь тоже «не ломает страницу»,
 *     но это не работа);
 *   • служебные страницы кабинета и оформления ОТКРЫВАЮТСЯ БЕЗ БАЗЫ
 *     и не роняют ни одной ошибки: сервер поднят без DATABASE_URL.
 */
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';

const PORT = 4178;
const server = await serveOut(PORT);

const SIZES = [['мобильный', 390, 844, true], ['десктоп', 1920, 1080, false], ['широкий', 2560, 1440, false]];
/**
 * Лендинг и служебные страницы раздела.
 *
 * ⚠️ КАБИНЕТ И ОФОРМЛЕНИЕ ПРОВЕРЯЮТСЯ БЕЗ БАЗЫ НАМЕРЕННО. Сервер
 * поднят без `DATABASE_URL`, и обе обязаны показать человеческую
 * строку, а не пятисотый ответ: на живом сайте так выглядит любая
 * недоступность базы.
 */
const PAGES = [
  ['главная', `${PREFIX}/`, true],
  ['оформление', `${PREFIX}/checkout/`, false],
  ['кабинет', `${PREFIX}/cabinet/`, false],
  ['сертификат', `${PREFIX}/certificate/`, false],
  ['оферта', `${PREFIX}/oferta/`, false],
  ['соглашение', `${PREFIX}/soglashenie/`, false],
  ['политика', `${PREFIX}/politika/`, false],
  ['согласие', `${PREFIX}/soglasie/`, false],
  ['админка', `${PREFIX}/admin/login/`, false],
];

const browser = await launch();
let failed = 0;

for (const [pname, path, wm] of PAGES) {
  for (const [sname, w, h, mob] of wm ? SIZES : [SIZES[0], SIZES[1]]) {
    const page = await browser.newPage({
      viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob, deviceScaleFactor: mob ? 2 : 1,
    });
    const bad = [];
    /* Счётчик Метрики глушит общий `launch` — см. browser.mjs. */
    page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
    page.on('pageerror', (e) => bad.push(`JS: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') bad.push(`консоль: ${m.text()}`); });

    await page.goto(`http://localhost:${PORT}${path}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(900);

    const d = await page.evaluate(() => {
      const t = document.querySelector('.wm--hero .wm__svg');
      const ps = t ? [...t.querySelectorAll('.wm__letter path')] : [];
      return {
        dw: document.documentElement.scrollWidth,
        ww: window.innerWidth,
        dh: document.documentElement.scrollHeight,
        fonts: [...document.fonts].map((f) => `${f.family}:${f.status}`),
        wmWidth: t ? +t.getBoundingClientRect().width.toFixed(1) : null,
        wmSize: t ? `слой ${t.getBoundingClientRect().height.toFixed(0)}px` : null,
        dLen: ps.reduce((n, e) => n + (e.getAttribute('d') || '').length, 0),
      };
    });

    const xscroll = d.dw > d.ww + 1;
    const fontErr = d.fonts.filter((f) => f.endsWith(':error'));
    const fontsUsed = d.fonts.filter((f) => f.endsWith(':loaded')).length;
    // Третья итерация отменила вылет за края: слово вписано в экран
    // с отступом около 0.65 % ширины с каждой стороны.
    const fill = wm && d.wmWidth ? d.wmWidth / d.ww : null;
    const fillBad = fill !== null && (fill < 0.96 || fill > 0.995);

    const pathBad = wm && d.dLen < 500;
    const ok = !bad.length && !xscroll && !fontErr.length && !fillBad && !pathBad;
    if (!ok) failed += 1;
    console.log(
      `${ok ? 'OK  ' : 'СБОЙ'} ${pname.padEnd(9)} ${sname.padEnd(10)} ${w}×${h}  ` +
        `высота ${String(d.dh).padStart(6)}  ` +
        (fill ? `ширина вордмарка ${(fill * 100).toFixed(1)} % окна  ${d.wmSize}  длина d ${d.dLen}  ` : '') +
        `шрифтов загружено ${fontsUsed} из ${d.fonts.length} объявленных`,
    );
    if (xscroll) console.log(`      ГОРИЗОНТАЛЬНЫЙ СКРОЛЛ: документ ${d.dw} при окне ${d.ww}`);
    if (fontErr.length) console.log(`      ШРИФТЫ НЕ ЗАГРУЗИЛИСЬ: ${fontErr.join(', ')}`);
    if (fillBad) console.log(`      ШИРИНА ВОРДМАРКА ВНЕ ДОПУСКА: ${fill}`);
    if (pathBad) console.log(`      КОНТУР ВОРДМАРКА ПУСТ ИЛИ ОБРЕЗАН: длина d ${d.dLen}`);
    for (const b of [...new Set(bad)].slice(0, 6)) console.log(`      ${b}`);
    await page.close();
  }
}

await browser.close();
server.close();
console.log(failed ? `\nПРОВАЛ: ${failed} проверок не прошло` : '\nВсё прошло: сайт с корня рабочий');
process.exit(failed ? 1 : 0);

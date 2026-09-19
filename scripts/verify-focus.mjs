/**
 * ПОДСВЕТКА КАСАНИЯ И КОЛЬЦО ФОКУСА.
 *
 * Мобильные браузеры рисуют под палец полупрозрачный прямоугольник
 * по габариту кликабельного элемента. У бургера габарит — тач-цель 44×44
 * при знаке 24×12, поэтому квадрат выходил втрое больше самого знака.
 *
 * Проверяется ТРИ вещи, и все три на живой странице:
 *   • у каждого кликабельного элемента подсветка касания прозрачна;
 *   • после указателя кольца фокуса нет — фокус ставится, но не рисуется;
 *   • после Tab кольцо есть. Это и есть доступность: убрать кольцо
 *     совсем было бы хуже квадрата;
 *   • ПОСЛЕ ЗАКРЫТИЯ МЕНЮ ПАЛЬЦЕМ кольца вокруг бургера нет, а после
 *     закрытия с клавиатуры — есть. Фокус возвращается в обоих случаях:
 *     без возврата человек с клавиатуры оказался бы в начале документа.
 *     Это ровно та прямоугольная рамка, на которую указал арт-директор
 *     в восемнадцатой итерации, и проверять её надо отдельно: браузер
 *     рисует кольцо на программный focus() и после касания, а эвристика
 *     :focus-visible у Chrome и Safari разная (Р-53).
 */
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';

const PORT = 4239;
const CLICKABLE = 'button, a[href], summary, [role="button"], input, select, textarea';

let failed = 0;
const server = await serveOut(PORT);
const browser = await launch();

for (const [w, h, mob] of [[390, 844, true], [1920, 1080, false]]) {
  const page = await browser.newPage({
    viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob, deviceScaleFactor: 1,
  });
  await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('.hero__stage[data-entered]');

  const tap = await page.evaluate((sel) => {
    const bad = [];
    let seen = 0;
    for (const el of document.querySelectorAll(sel)) {
      seen += 1;
      const v = getComputedStyle(el).webkitTapHighlightColor;
      if (v && v !== 'rgba(0, 0, 0, 0)' && v !== 'transparent') {
        bad.push(`${el.className || el.tagName}: ${v}`);
      }
    }
    return { seen, bad };
  }, CLICKABLE);
  const okTap = tap.bad.length === 0 && tap.seen > 5;
  if (!okTap) failed += 1;
  console.log('%s %s подсветка касания прозрачна у %d кликабельных элементов%s',
    okTap ? 'OK  ' : 'ПЛОХО', `${w}×${h}`.padEnd(9), tap.seen,
    tap.bad.length ? `  ← ${tap.bad.slice(0, 3).join('; ')}` : '');

  /* Указателем: фокус ставится, кольцо не рисуется. Бургер есть только
     на мобильной, на десктопе берём первый пункт меню. */
  const target = mob ? '.nav .nav__burger' : '.nav .nav__link';
  await page.click(target, { force: true });
  const byPointer = await page.evaluate(() => {
    const el = document.activeElement;
    const cs = getComputedStyle(el);
    return {
      tag: el.className || el.tagName,
      visible: el.matches(':focus-visible'),
      outline: cs.outlineStyle === 'none' || parseFloat(cs.outlineWidth) === 0,
    };
  });
  const okPointer = !byPointer.visible && byPointer.outline;
  if (!okPointer) failed += 1;
  console.log('%s %s указателем: :focus-visible=%s, кольца нет=%s  (%s)',
    okPointer ? 'OK  ' : 'ПЛОХО', `${w}×${h}`.padEnd(9),
    byPointer.visible, byPointer.outline, byPointer.tag);

  /* Клавиатурой: кольцо обязано быть. */
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const byKey = await page.evaluate(() => {
    const el = document.activeElement;
    const cs = getComputedStyle(el);
    return {
      tag: el.className || el.tagName,
      visible: el.matches(':focus-visible'),
      width: parseFloat(cs.outlineWidth) || 0,
      color: cs.outlineColor,
    };
  });
  const okKey = byKey.visible && byKey.width >= 1;
  if (!okKey) failed += 1;
  console.log('%s %s клавиатурой: кольцо %s px, %s  (%s)',
    okKey ? 'OK  ' : 'ПЛОХО', `${w}×${h}`.padEnd(9),
    byKey.width, byKey.color, byKey.tag);

  /* ВОЗВРАТ ФОКУСА ПОСЛЕ ЗАКРЫТИЯ МЕНЮ. Открываем и закрываем ДВАЖДЫ:
     сперва указателем, потом с клавиатуры. Фокус обязан вернуться
     на бургер оба раза, а кольцо — только во втором. */
  if (mob) {
    const ring = async () => page.evaluate(() => {
      const el = document.activeElement;
      const cs = getComputedStyle(el);
      return {
        onBurger: el.classList.contains('nav__burger'),
        visible: el.matches(':focus-visible'),
        width: cs.outlineStyle === 'none' ? 0 : parseFloat(cs.outlineWidth) || 0,
      };
    });

    /* Проверка «указателем» выше уже открыла накладку — закрываем,
       иначе она перехватывает клик по бургеру. */
    await page.keyboard.press('Escape');
    await page.waitForTimeout(320);

    await page.click('.nav__burger');
    await page.waitForTimeout(320);
    await page.click('.menu__close', { force: true });
    await page.waitForTimeout(320);
    const afterTap = await ring();
    const okTapClose = afterTap.onBurger && afterTap.width === 0;
    if (!okTapClose) failed += 1;
    console.log('%s %s закрыли ПАЛЬЦЕМ: фокус на бургере=%s, кольцо %s px',
      okTapClose ? 'OK  ' : 'ПЛОХО', `${w}×${h}`.padEnd(9), afterTap.onBurger, afterTap.width);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(320);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(320);
    const afterKey = await ring();
    const okKeyClose = afterKey.onBurger && afterKey.width >= 1 && afterKey.visible;
    if (!okKeyClose) failed += 1;
    console.log('%s %s закрыли С КЛАВИАТУРЫ: фокус на бургере=%s, кольцо %s px',
      okKeyClose ? 'OK  ' : 'ПЛОХО', `${w}×${h}`.padEnd(9), afterKey.onBurger, afterKey.width);
  }

  await page.close();
}

await browser.close();
server.close();
console.log(failed
  ? `\nПРОВАЛОВ: ${failed}`
  : '\nПодсветки касания нет, кольцо фокуса только с клавиатуры');
process.exit(failed ? 1 : 0);

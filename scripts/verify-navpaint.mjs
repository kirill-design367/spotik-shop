/**
 * ШАПКА ЕДЕТ ПО ВСЕЙ СТРАНИЦЕ И ЧИТАЕТСЯ НА ЛЮБОМ ФОНЕ.
 *
 * Проверяется ПО РАСТРУ живой страницы, а не по классам и не по стилям:
 * важно, каким цветом шапка в итоге НАРИСОВАНА.
 *
 *   • над тёмным фоном (первый экран, блоки 2–6) — светлая;
 *   • над зелёным (слово хиро, поле футера, акценты середины) — тёмная;
 *   • над чёрным словом внутри зелёного поля футера — снова светлая:
 *     там обрезка обязана вернуть светлую копию;
 *   • на кромке зелёного видны ОБЕ, и граница стоит там же, где кромка
 *     зелёного под ней.
 *
 * Отдельно ловится розовый #E246AB — цвет, которым расплачивалось
 * смешивание (Р-39). Любой розовый в шапке — провал.
 *
 * Механика двух копий описана в Р-43.
 */
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';
import { PNG } from 'pngjs';

const PORT = 4235;
const SIZES = [[390, 844], [1920, 1080], [2560, 1440]];

const palette = (png, x0, y0, w, h) => {
  const counts = new Map();
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      if (x < 0 || y < 0 || x >= png.width || y >= png.height) continue;
      const i = (png.width * y + x) << 2;
      const k = (png.data[i] << 16) | (png.data[i + 1] << 8) | png.data[i + 2];
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1]);
};
const hex = (k) => '#' + k.toString(16).padStart(6, '0');
const rgb = (k) => [(k >> 16) & 255, (k >> 8) & 255, k & 255];
const lum = (k) => {
  const c = rgb(k).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};
/* Розовый: красного и синего заметно больше зелёного — так выглядит
   difference белого по зелёному. */
const pink = (k) => { const [r, g, b] = rgb(k); return r > g + 40 && b > g + 40; };

let failed = 0;
const server = await serveOut(PORT);
const browser = await launch();

for (const [w, h] of SIZES) {
  const page = await browser.newPage({
    viewport: { width: w, height: h }, isMobile: w < 700, hasTouch: w < 700, deviceScaleFactor: 1,
  });
  await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('.hero__stage[data-entered]');
  await page.waitForTimeout(150);

  const m = await page.evaluate(() => {
    const sc = document.getElementById('scroller');
    const hero = document.getElementById('hero');
    const stage = document.querySelector('.hero__stage');
    const base = sc.getBoundingClientRect().top - sc.scrollTop;
    const heroTop = hero.getBoundingClientRect().top - base;
    const nav = document.querySelector('.nav--light');
    const row = nav.querySelector('.nav__row');
    const seg = [...document.querySelectorAll('.seg__btn')]
      .find((el) => getComputedStyle(el).backgroundColor === 'rgb(29, 185, 84)');
    return {
      stickEnd: heroTop + hero.offsetHeight - stage.offsetHeight,
      footTop: document.getElementById('footer').getBoundingClientRect().top - base,
      navH: row.offsetHeight,
      max: sc.scrollHeight - sc.clientHeight,
      logo: nav.querySelector('.logo-slot__text').getBoundingClientRect().toJSON(),
      segTop: seg ? seg.getBoundingClientRect().top - base : null,
      segBox: seg ? seg.getBoundingClientRect().toJSON() : null,
    };
  });

  /* Четыре положения. Пятое — зелёный акцент середины — считается
     от его собственного места на странице. */
  const stops = [
    ['первый экран', 0, 'светлая'],
    ['слово хиро', Math.round(m.stickEnd + m.navH + 260), 'обе'],
    ['блоки 2-6', Math.round((m.stickEnd + m.footTop) / 2), 'светлая'],
    ['поле футера', Math.round(m.max), 'обе'],
  ];
  if (m.segTop != null) stops.push(['зелёный акцент', Math.round(m.segTop - m.navH * 0.45), 'акцент']);

  for (const [name, y, want] of stops) {
    await page.evaluate((v) => { document.getElementById('scroller').scrollTop = v; }, y);
    await page.waitForTimeout(140);
    const png = PNG.sync.read(await page.screenshot({ clip: { x: 0, y: 0, width: w, height: m.navH } }));
    const L = m.logo;
    const area = want === 'акцент' && m.segBox
      ? { x: Math.round(Math.max(0, m.segBox.left)), y: Math.round(m.navH * 0.4), w: Math.round(m.segBox.width), h: Math.round(m.navH * 0.3) }
      : { x: Math.round(L.x), y: Math.round(L.y + L.height * 0.38), w: Math.round(L.width), h: Math.max(8, Math.round(L.height * 0.24)) };
    const P = palette(png, area.x, area.y, area.w, area.h);
    const top = P.slice(0, 8);
    const anyPink = top.some(([k, c]) => pink(k) && c > 4);

    let ok;
    let note;
    if (want === 'светлая') {
      const light = top.reduce((a, b) => (lum(b[0]) > lum(a[0]) ? b : a));
      ok = lum(light[0]) > 0.35;
      note = `самый светлый ${hex(light[0])}`;
    } else {
      /* Над зелёным обязана быть ТЁМНАЯ краска, и она обязана читаться
         на зелёном: контраст не ниже 4.5. */
      const dark = top.reduce((a, b) => (lum(b[0]) < lum(a[0]) ? b : a));
      const green = 0x1db954;
      ok = lum(dark[0]) < 0.06 && dark[1] > 10 && ratio(dark[0], green) > 4.5;
      note = `самый тёмный ${hex(dark[0])}×${dark[1]}, на зелёном ${ratio(dark[0], green).toFixed(1)}:1`;
    }
    if (!ok || anyPink) failed += 1;
    console.log('%s %s %s  %s%s',
      (ok && !anyPink ? 'OK  ' : 'ПЛОХО'),
      `${w}×${h}`.padEnd(9), name.padEnd(15), note,
      anyPink ? '  ← РОЗОВЫЙ В ШАПКЕ' : '');
  }

  /* КРОМКА. Зелёное поле футера входит в полосу шапки: выше кромки шапка
     обязана быть светлой, ниже — тёмной, и перелом ровно на кромке. */
  const edgeY = Math.round(m.footTop - m.navH / 2);
  await page.evaluate((v) => { document.getElementById('scroller').scrollTop = v; }, edgeY);
  await page.waitForTimeout(140);
  {
    const png = PNG.sync.read(await page.screenshot({ clip: { x: 0, y: 0, width: w, height: m.navH } }));
    const real = await page.evaluate(() => document.getElementById('footer').getBoundingClientRect().top);
    const L = m.logo;
    const band = (y0, hh) => palette(png, Math.round(L.x), Math.round(y0), Math.round(L.width), Math.round(hh));
    const above = band(Math.max(0, real - 8), 6);
    const below = band(real + 2, 6);
    const lightAbove = above.slice(0, 6).reduce((a, b) => (lum(b[0]) > lum(a[0]) ? b : a));
    const darkBelow = below.slice(0, 6).reduce((a, b) => (lum(b[0]) < lum(a[0]) ? b : a));
    const ok = lum(lightAbove[0]) > 0.35 && lum(darkBelow[0]) < 0.06;
    if (!ok) failed += 1;
    console.log('%s %s кромка           над кромкой %s, под кромкой %s (кромка зелёного на %s px)',
      ok ? 'OK  ' : 'ПЛОХО', `${w}×${h}`.padEnd(9),
      hex(lightAbove[0]), hex(darkBelow[0]), real.toFixed(2));
  }

  await page.close();
}

await browser.close();
server.close();
console.log(failed
  ? `\nПРОВАЛОВ: ${failed}`
  : '\nВсё прошло: шапка светлая над тёмным, тёмная над зелёным, розового нет');
process.exit(failed ? 1 : 0);

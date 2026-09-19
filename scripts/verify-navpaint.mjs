/**
 * ШАПКА ЧИТАЕТСЯ НА ЛЮБОМ ФОНЕ, И ИНВЕРСИЯ РАБОТАЕТ ПО ВСЕЙ СТРАНИЦЕ.
 *
 * Проверяется ПО РАСТРУ живой страницы, а не по классам и не по стилям:
 * важно, каким цветом шапка в итоге НАРИСОВАНА.
 *
 *   • сплошной тёмный фон — шапка ровно #FFFFFF;
 *   • зелёное (слово хиро, поле футера, акцент середины) — ровно #121212,
 *     и это 7.2:1 на зелёном;
 *   • чёрное слово внутри зелёного поля футера — снова светлая;
 *   • КРУПНЫЙ СВЕТЛЫЙ НАБОР блоков — над ним шапка обязана быть
 *     и светлой, и тёмной ОДНОВРЕМЕННО: над глифом строки тёмная,
 *     над просветом светлая. Именно это и значит «инверсия работает
 *     везде», и по габариту строки этого не получить.
 *
 * Отдельно ловится розовый #E246AB — цвет, которым расплачивалось
 * смешивание в Р-39. Любой розовый в шапке — провал.
 *
 * Механика трёх копий описана в Р-46.
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
    const nav = document.querySelector('.nav--plain');
    const row = nav.querySelector('.nav__row');
    const seg = [...document.querySelectorAll('.seg__btn')]
      .find((el) => getComputedStyle(el).backgroundColor === 'rgb(29, 185, 84)');
    /* Замер идёт по СТРОЧНОМУ боксу логотипа, а не по боксу элемента:
       слот под логотип выше самой строки, и окно, посчитанное от бокса,
       уезжает выше глифов — в пустоту или в чужой текст. */
    const logoEl = nav.querySelector('.logo-slot__text');
    const range = document.createRange();
    range.selectNodeContents(logoEl);
    const logo = [...range.getClientRects()].find((r) => r.width > 1 && r.height > 1)
      || logoEl.getBoundingClientRect();
    /* Крупная светлая строка: берём ту, что реально проходит под логотипом
       по горизонтали — иначе замер попадёт мимо. */
    const big = [...document.querySelectorAll('.row__t')]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .find((o) => o.r.left < logo.right && o.r.right > logo.left && o.r.height > 40);
    return {
      stickEnd: heroTop + hero.offsetHeight - stage.offsetHeight,
      footTop: document.getElementById('footer').getBoundingClientRect().top - base,
      navH: row.offsetHeight,
      max: sc.scrollHeight - sc.clientHeight,
      logo: logo.toJSON(),
      segTop: seg ? seg.getBoundingClientRect().top - base : null,
      segBox: seg ? seg.getBoundingClientRect().toJSON() : null,
      bigTop: big ? big.r.top - base + big.r.height * 0.55 : null,
    };
  });

  /* «Сплошной тёмный фон» — это положение, где под полосой НЕТ ни зелёного,
     ни светлого набора. На узком экране середина страницы забита текстом,
     и точка, взятая арифметически, попадает на строку — то есть проверяет
     совсем другой случай. Поэтому ищем её перебором, а не считаем. */
  let plainY = Math.round((m.stickEnd + m.footTop) / 2);
  for (let y = Math.round(m.stickEnd + m.navH * 2); y < m.footTop - m.navH; y += 60) {
    await page.evaluate((v) => { document.getElementById('scroller').scrollTop = v; }, y);
    await page.waitForTimeout(40);
    const clean = await page.evaluate(() => !document.querySelector('.nav--invert').hasAttribute('data-on')
      && !document.querySelector('.nav--dark').hasAttribute('data-on'));
    if (clean) { plainY = y; break; }
  }

  const stops = [
    ['первый экран', 0, 'светлая'],
    ['слово хиро', Math.round(m.stickEnd + m.navH + 260), 'тёмная'],
    ['блоки 2-6', plainY, 'светлая'],
    ['поле футера', Math.round(m.max), 'тёмная'],
  ];
  if (m.segTop != null) stops.push(['зелёный акцент', Math.round(m.segTop - m.navH * 0.45), 'тёмная']);
  if (m.bigTop != null) stops.push(['крупный светлый набор', Math.round(m.bigTop - m.navH * 0.5), 'обе']);

  for (const [name, y, want] of stops) {
    await page.evaluate((v) => { document.getElementById('scroller').scrollTop = v; }, y);
    await page.waitForTimeout(160);
    const png = PNG.sync.read(await page.screenshot({ clip: { x: 0, y: 0, width: w, height: m.navH } }));
    const L = m.logo;
    const area = want === 'тёмная' && m.segBox && name === 'зелёный акцент'
      ? { x: Math.round(Math.max(0, m.segBox.left)), y: Math.round(m.navH * 0.4), w: Math.round(m.segBox.width), h: Math.round(m.navH * 0.3) }
      : { x: Math.round(L.x), y: Math.round(L.y + L.height * 0.25), w: Math.round(L.width), h: Math.max(6, Math.round(L.height * 0.5)) };
    const P = palette(png, area.x, area.y, area.w, area.h);
    const top = P.slice(0, 8);
    const anyPink = top.some(([k, c]) => pink(k) && c > 4);
    const light = top.reduce((a, b) => (lum(b[0]) > lum(a[0]) ? b : a));
    const dark = top.reduce((a, b) => (lum(b[0]) < lum(a[0]) ? b : a));

    let ok;
    let note;
    if (want === 'светлая') {
      /* Светлых состояния ДВА, и оба законны: на сплошном фоне копия
         светлая и даёт ровно #FFFFFF, внутри габарита светлой строки
         работает копия со смешиванием и даёт #EDEDED — разность белого
         и `--ink`, чистого белого из неё не получить ничем. */
      ok = lum(light[0]) > 0.8 && light[1] > 10;
      note = `самый светлый ${hex(light[0])}×${light[1]}`;
    } else if (want === 'тёмная') {
      ok = lum(dark[0]) < 0.06 && dark[1] > 10 && ratio(dark[0], 0x1db954) > 4.5;
      note = `самый тёмный ${hex(dark[0])}×${dark[1]}, на зелёном ${ratio(dark[0], 0x1db954).toFixed(1)}:1`;
    } else {
      /* Над крупным набором обязаны быть ОБА состояния сразу. */
      const hasDark = top.some(([k, c]) => lum(k) < 0.06 && c > 6);
      const hasLight = top.some(([k, c]) => lum(k) > 0.5 && c > 6);
      ok = hasDark && hasLight;
      note = `светлое ${hex(light[0])}×${light[1]}, тёмное ${hex(dark[0])}×${dark[1]}`;
    }
    if (!ok || anyPink) failed += 1;
    console.log('%s %s %s  %s%s',
      (ok && !anyPink ? 'OK  ' : 'ПЛОХО'),
      `${w}×${h}`.padEnd(9), name.padEnd(22), note,
      anyPink ? '  ← РОЗОВЫЙ В ШАПКЕ' : '');
  }

  /* КРОМКА зелёного поля футера: выше неё светлая, ниже тёмная. */
  const edgeY = Math.round(m.footTop - m.navH / 2);
  await page.evaluate((v) => { document.getElementById('scroller').scrollTop = v; }, edgeY);
  await page.waitForTimeout(160);
  {
    const png = PNG.sync.read(await page.screenshot({ clip: { x: 0, y: 0, width: w, height: m.navH } }));
    const real = await page.evaluate(() => document.getElementById('footer').getBoundingClientRect().top);
    const L = m.logo;
    const band = (y0, hh) => palette(png, Math.round(L.x), Math.round(y0), Math.round(L.width), Math.round(hh));
    const above = band(Math.max(0, real - 8), 6);
    const below = band(real + 2, 6);
    const la = above.slice(0, 6).reduce((a, b) => (lum(b[0]) > lum(a[0]) ? b : a));
    const db = below.slice(0, 6).reduce((a, b) => (lum(b[0]) < lum(a[0]) ? b : a));
    const anyPink = [...above.slice(0, 6), ...below.slice(0, 6)].some(([k, c]) => pink(k) && c > 4);
    const ok = lum(la[0]) > 0.35 && lum(db[0]) < 0.06 && !anyPink;
    if (!ok) failed += 1;
    console.log('%s %s кромка                  над %s, под %s (кромка на %s px)%s',
      ok ? 'OK  ' : 'ПЛОХО', `${w}×${h}`.padEnd(9),
      hex(la[0]), hex(db[0]), real.toFixed(2), anyPink ? '  ← РОЗОВЫЙ' : '');
  }

  await page.close();
}

await browser.close();
server.close();
console.log(failed
  ? `\nПРОВАЛОВ: ${failed}`
  : '\nИнверсия работает на всех фонах, розового нет');
process.exit(failed ? 1 : 0);

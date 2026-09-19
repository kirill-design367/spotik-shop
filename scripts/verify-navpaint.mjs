/**
 * ШАПКА ЕДЕТ ПО ВСЕЙ СТРАНИЦЕ И ИНВЕРТИРУЕТСЯ ТОЛЬКО НАД ЗЕЛЁНЫМ.
 *
 * Проверяется ПО РАСТРУ живой страницы, а не по классам и не по стилям:
 * важно, каким цветом шапка в итоге НАРИСОВАНА.
 *
 *   • над тёмным фоном (первый экран, блоки 2–6) — светлая;
 *   • над зелёным (слово хиро, поле футера) — тёмная;
 *   • на кромке зелёного — обе части сразу, и кромка стоит там же, где
 *     кромка зелёного под ней: смена цвета это движение линии, а не щелчок.
 *
 * Отдельно ловится дефект, на который уже наступали: если глиф красится
 * сплошным цветом поверх градиента, difference над зелёным даёт розовый
 * #E246AB — цвет вне палитры (Р-39). Любой розовый в шапке — провал.
 */
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';
import { PNG } from 'pngjs';

const PORT = 4235;
const SIZES = [[390, 844], [1920, 1080], [2560, 1440]];

/* Самые частые цвета в прямоугольнике, кроме фоновых: это и есть покраска. */
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
const lum = (k) => { const [r, g, b] = rgb(k).map((v) => v / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
/* Розовый: красного и синего заметно больше зелёного. Именно так выглядит
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
    const nav = document.querySelector('.nav');
    return {
      stickEnd: heroTop + hero.offsetHeight - stage.offsetHeight,
      footTop: document.getElementById('footer').getBoundingClientRect().top - base,
      navH: nav.querySelector('.nav__inner').offsetHeight,
      max: sc.scrollHeight - sc.clientHeight,
      logo: nav.querySelector('.logo-slot__text').getBoundingClientRect().toJSON(),
      bars: nav.querySelector('.nav__burger-bars').getBoundingClientRect().toJSON(),
      /* Покраска у КАЖДОГО крашеного элемента своя: сокращение background
         у одного из них однажды стёрло градиент, и пункты меню пропали
         с десктопа целиком. Поэтому проверяется не «шапка», а все они. */
      paint: [...nav.querySelectorAll('.nav-paint')].map((el) => ({
        cls: el.className.replace(/nav-paint\S*\s*/g, '').trim() || el.tagName,
        img: getComputedStyle(el).backgroundImage.slice(0, 14),
      })),
    };
  });

  /* Четыре положения: над тёмным, над зелёным словом, над блоками, над футером. */
  const stops = [
    ['первый экран', 0, 'светлая'],
    ['слово хиро', Math.round(m.stickEnd + m.navH + 260), 'тёмная'],
    ['блоки 2-6', Math.round((m.stickEnd + m.footTop) / 2), 'светлая'],
    ['поле футера', Math.round(m.max), 'тёмная'],
  ];

  for (const [name, y, want] of stops) {
    await page.evaluate((v) => { document.getElementById('scroller').scrollTop = v; }, y);
    await page.waitForTimeout(120);
    const png = PNG.sync.read(await page.screenshot({ clip: { x: 0, y: 0, width: w, height: m.navH } }));
    /* Логотип меряем по средней трети глифов, бургер — по его габариту:
       так в выборку не попадают ни поля, ни сглаживание по краю. */
    const L = palette(png, Math.round(m.logo.x), Math.round(m.logo.y + m.logo.height * 0.38),
      Math.round(m.logo.width), Math.max(8, Math.round(m.logo.height * 0.24)));
    const B = w < 900
      ? palette(png, Math.round(m.bars.x), Math.round(m.bars.y), Math.round(m.bars.width), Math.round(m.bars.height))
      : [];
    /* Покраска — это самый ЯРКИЙ либо самый ТЁМНЫЙ из заметных цветов,
       смотря чего ждём; фон в выборке всегда есть, и он же самый частый. */
    const top = L.slice(0, 6).map(([k]) => k);
    const anyPink = [...L.slice(0, 6), ...B.slice(0, 4)].some(([k, c]) => pink(k) && c > 4);
    const ink = want === 'светлая'
      ? top.reduce((a, b) => (lum(b) > lum(a) ? b : a))
      : top.reduce((a, b) => (lum(b) < lum(a) ? b : a));
    const ok = want === 'светлая' ? lum(ink) > 0.35 : lum(ink) < 0.12;
    if (!ok || anyPink) failed += 1;
    console.log('%s %s %s  логотип %s  ждём %s%s',
      (ok && !anyPink ? 'OK  ' : 'ПЛОХО'),
      `${w}×${h}`.padEnd(9), name.padEnd(14),
      L.slice(0, 3).map(([k, c]) => `${hex(k)}×${c}`).join(' ').padEnd(34),
      want, anyPink ? '  ← РОЗОВЫЙ В ШАПКЕ' : '');
  }

  /* ГРАДИЕНТ ДОЕХАЛ ДО КАЖДОГО КРАШЕНОГО ЭЛЕМЕНТА. */
  const dead = m.paint.filter((p) => p.img === 'none');
  if (dead.length) failed += 1;
  console.log('%s %s покраска      элементов %d, без градиента %d%s',
    dead.length ? 'ПЛОХО' : 'OK  ', `${w}×${h}`.padEnd(9), m.paint.length, dead.length,
    dead.length ? `  ← ${dead.map((p) => p.cls).join(', ')}` : '');

  /* КРОМКА. Зелёное поле футера входит в полосу шапки — линия раздела
     обязана стоять там же, где верхний край футера. */
  const edgeY = Math.round(m.footTop - m.navH / 2);
  await page.evaluate((v) => { document.getElementById('scroller').scrollTop = v; }, edgeY);
  await page.waitForTimeout(120);
  const edge = await page.evaluate(() => {
    const nav = document.querySelector('.nav');
    const sc = document.getElementById('scroller');
    const foot = document.getElementById('footer');
    return {
      g1: parseFloat(nav.style.getPropertyValue('--g1')),
      /* фактическая кромка зелёного во вьюпорте */
      real: foot.getBoundingClientRect().top,
      blend: nav.hasAttribute('data-blend'),
    };
  });
  const drift = Math.abs(edge.g1 - edge.real);
  if (!(drift < 0.5) || !edge.blend) failed += 1;
  console.log('%s %s кромка         покраска %s px, зелёное %s px, расхождение %s px',
    drift < 0.5 && edge.blend ? 'OK  ' : 'ПЛОХО', `${w}×${h}`.padEnd(9),
    edge.g1.toFixed(2), edge.real.toFixed(2), drift.toFixed(2));

  await page.close();
}

await browser.close();
server.close();
console.log(failed ? `\nПРОВАЛОВ: ${failed}` : '\nВсё прошло: шапка светлая над тёмным, тёмная над зелёным, кромка совпадает');
process.exit(failed ? 1 : 0);

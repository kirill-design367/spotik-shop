/** Скриншоты каждой секции на мобильном и десктопе. */
import { launch } from './browser.mjs';
const URL = process.env.SHOT_URL || 'http://localhost:3000/';
const IDS = ['pricing', 'how', 'faq', 'footer'];
const browser = await launch();
for (const [name, w, h] of [['mobile', 390, 844], ['desktop', 1920, 1080]]) {
  const page = await browser.newPage({
    viewport: { width: w, height: h },
    isMobile: w < 500, hasTouch: w < 500, deviceScaleFactor: w < 500 ? 2 : 1,
  });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);
  for (const id of IDS) {
    await page.evaluate((i) => {
      const el = document.getElementById(i);
      window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - 8);
    }, id);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `.shots/sec-${name}-${id}.png` });
  }
  const diag = await page.evaluate(() => ({
    docW: document.documentElement.scrollWidth, winW: window.innerWidth,
    docH: document.documentElement.scrollHeight,
    slots: [...document.querySelectorAll('.scene-slot')].map((s) => s.dataset.state),
  }));
  console.log(`${name} ${w}x${h}: документ ${diag.docW} / окно ${diag.winW} ${diag.docW > diag.winW + 1 ? '!!! ГОРИЗОНТАЛЬНЫЙ СКРОЛЛ' : 'скролла по X нет'}, высота ${diag.docH}, 3D-слоты: ${diag.slots.join(' ')}`);
  if (errs.length) console.log('  ОШИБКИ:', [...new Set(errs)].slice(0, 5).join(' | '));
  await page.close();
}
await browser.close();

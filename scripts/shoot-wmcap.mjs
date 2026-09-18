/**
 * Подбор ПОТОЛКА ВЫСОТЫ ЗНАКА НА УЗКОМ ЭКРАНЕ.
 *
 * Правило «70 % высоты хиро» на телефоне не работает: там связывает второй
 * аргумент — потолок «высота чернил не больше ширины», и слово получается
 * квадратным (1:1 на 390). Сжатие в такой пропорции не читается.
 * Скрипт снимает кадры на нескольких значениях потолка и печатает
 * фактические пропорции раскрытого и сжатого состояний.
 */
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';

const PORT = 4188;
const CAPS = Number(process.env.WM_CAPS)
  ? [Number(process.env.WM_CAPS)]
  : [98.7, 74.0, 65.8, 61.7, 54.8, 49.4];
const SIZES = [
  { w: 390, h: 844, name: '390' },
  { w: 414, h: 896, name: '414' },
  { w: 360, h: 640, name: '360' },
  { w: 768, h: 1024, name: '768' },
  { w: 1920, h: 1080, name: '1920' },
];

const server = await serveOut(PORT);
const browser = await launch();

console.log('потолок  размер      ширина   чернила  раскрытое  сжатое');
for (const cap of CAPS) {
  for (const s of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.addStyleTag({ content: '' }).catch(() => {});
    await page.goto(`http://127.0.0.1:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });
    await page.addStyleTag({
      content: `.hero__stage{--wm-h:min(70svh,${cap}cqw)!important}.footer{--wm-h:min(70svh,${cap}cqw)!important}`,
    });
    await page.waitForTimeout(1100);
    const m = await page.evaluate(() => {
      const svg = document.querySelector('.wm--hero .wm__svg');
      const box = svg.getBoundingClientRect();
      // --wm-h это min(), и как строка он не разрешается: меряем пробником
      const probe = document.createElement('div');
      probe.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:var(--wm-h);pointer-events:none';
      document.querySelector('.hero__stage').appendChild(probe);
      const ink = probe.getBoundingClientRect().height;
      probe.remove();
      const foot = document.querySelector('.hero__foot').getBoundingClientRect();
      return { w: box.width, ink, footTop: foot.top, footBottom: foot.bottom, vh: innerHeight };
    });
    // сжатое состояние: высота чернил падает ровно в 1.712 раза
    const tight = m.ink / 1.7121;
    console.log(
      `${String(cap).padStart(6)}  ${s.name.padEnd(6)}  ${m.w.toFixed(0).padStart(7)}  ${m.ink.toFixed(0).padStart(7)}  ` +
        `1:${(m.w / m.ink).toFixed(2).padStart(5)}  1:${(m.w / tight).toFixed(2).padStart(5)}  ` +
        `тексты ${m.footTop.toFixed(0)}…${m.footBottom.toFixed(0)} из ${m.vh}`,
    );
    if (s.name === '390' || s.name === '1920') {
      await page.screenshot({ path: `.shots/wmcap/${cap}-${s.name}.png` });
    }
    await ctx.close();
  }
}
await browser.close();
server.close();

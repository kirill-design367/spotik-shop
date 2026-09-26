/**
 * РАЗМЕР ТЕКСТА ШАГА: проверка по живой странице, руками.
 *
 * Сорок первая итерация сняла постоянный кегль у текста шагов: он
 * мелкий у всех пяти, а тот шаг, чья коробка сейчас у середины
 * экрана, вырастает до крупного. Приём не растровый — он весь
 * в вычисленных стилях и прямоугольниках, — поэтому сторож дешёвый
 * и судит по ним.
 *
 * ⚠️ ЧТО ИМЕННО ЗДЕСЬ СТЕРЕЖЁТСЯ, И ПОЧЕМУ ИМЕННО ЭТО:
 *
 *   РАСКЛАДКА НЕ ЕДЕТ. Размер меняет ТРАНСФОРМ, а не кегль. Стоит
 *   кому-нибудь вернуть `font-size`, и коробка шага начнёт ходить
 *   за прокруткой — вместе с ней поедут соседи и лента, которая
 *   по этим коробкам нарисована. Глазом такое ловится не сразу,
 *   числом — мгновенно: дрейф коробки обязан быть нулевым.
 *
 *   ТЕКСТ НЕ ВЫХОДИТ ЗА СВОЮ КОРОБКУ. Место под крупное состояние
 *   резервирует раскладка, и если однажды порядок перевернут
 *   (набрать мелким и растягивать), наезд на соседа появится ровно
 *   в тот момент, когда шаг читают.
 *
 *   КАЖДЫЙ ШАГ ДОХОДИТ ДО ОБОИХ КОНЦОВ, И В ОБЕ СТОРОНЫ. Без этого
 *   «динамика есть» ничего не значит: окно, ставшее узким, или
 *   середина, посчитанная не от того числа, дают шаг, который
 *   не вырастает никогда.
 *
 *   ПРИ «УМЕНЬШИТЬ ДВИЖЕНИЕ» РАЗМЕР ОДИН НА ВСЕХ. Отдельной веткой:
 *   там `put` зовут один раз, и забыть её легче всего.
 *
 * См. Р-141.
 */
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';

const SIZES = [
  { w: 390, h: 844 },
  { w: 1920, h: 1080 },
];
/** Шаг прохода и границы множителя, выведенные из таблицы рельефа. */
const STEP_PX = 24;
const K_MIN = 0.74 / 1.32;

const snap = () => {
  const sc = document.getElementById('scroller');
  const root = document.querySelector('.route');
  if (!root || !sc) return null;
  const rb = root.getBoundingClientRect();
  const steps = [...document.querySelectorAll('.rstep')].map((el) => {
    const b = el.querySelector('.rstep__body').getBoundingClientRect();
    const g = el.querySelector('.rstep__grow').getBoundingClientRect();
    const n = el.querySelector('.rstep__num').getBoundingClientRect();
    return {
      sk: parseFloat(getComputedStyle(el).getPropertyValue('--sk')),
      tFs: parseFloat(getComputedStyle(el.querySelector('.rstep__t')).fontSize),
      nFs: parseFloat(getComputedStyle(el.querySelector('.rstep__num')).fontSize),
      body: { t: b.top - rb.top, b: b.bottom - rb.top, l: b.left - rb.left, r: b.right - rb.left },
      grow: { t: g.top - rb.top, b: g.bottom - rb.top, l: g.left - rb.left, r: g.right - rb.left },
      num: { t: n.top - rb.top, b: n.bottom - rb.top, l: n.left - rb.left, r: n.right - rb.left },
    };
  });
  return { y: sc.scrollTop, blockTop: rb.top + sc.scrollTop, blockH: rb.height, vh: sc.clientHeight, steps };
};

const park = async (page, y) => {
  await page.evaluate((v) => {
    document.getElementById('scroller').scrollTop = v;
  }, y);
  await page.waitForTimeout(16);
};

let failed = false;
const sud = (ok, txt) => {
  if (!ok) failed = true;
  console.log(`  ${ok ? 'OK  ' : 'СБОЙ'} ${txt}`);
};

const run = async () => {
  const srv = await serveOut(4237);
  const browser = await launch();
  try {
    for (const s of SIZES) {
      const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto(`${srv.url}${PREFIX}/`, { waitUntil: 'load' });
      await page.waitForTimeout(900);
      const head = await page.evaluate(snap);
      if (!head) throw new Error('блока маршрута на странице нет');

      const from = Math.max(0, head.blockTop - head.vh);
      const to = head.blockTop + head.blockH;
      const frames = [];
      for (const dir of ['вниз', 'вверх']) {
        const seq = [];
        for (let y = from; y <= to; y += STEP_PX) seq.push(y);
        if (dir === 'вверх') seq.reverse();
        for (const y of seq) {
          await park(page, y);
          frames.push({ dir, ...(await page.evaluate(snap)) });
        }
      }
      const n = head.steps.length;

      console.log(`\n${s.w}×${s.h}  блок ${head.blockH.toFixed(0)} px, положений ${frames.length}`);

      /* 1. раскладка стоит: коробка шага в системе блока не двигается */
      let drift = 0;
      for (let i = 0; i < n; i += 1) {
        for (const key of ['t', 'b']) {
          const v = frames.map((f) => f.steps[i].body[key]);
          drift = Math.max(drift, Math.max(...v) - Math.min(...v));
        }
      }
      sud(drift < 0.5, `раскладка не едет: наибольший дрейф коробки ${drift.toFixed(2)} px`);

      /* 2. каждый шаг доходит до крупного и до мелкого, в обе стороны */
      let allEnds = true;
      const say = [];
      for (let i = 0; i < n; i += 1) {
        const up = frames.filter((f) => f.dir === 'вверх').map((f) => f.steps[i].sk);
        const dn = frames.filter((f) => f.dir === 'вниз').map((f) => f.steps[i].sk);
        const big = Math.min(Math.max(...up), Math.max(...dn));
        const sml = Math.max(Math.min(...up), Math.min(...dn));
        if (big < 0.99 || sml > K_MIN + 0.005) allEnds = false;
        say.push(`${sml.toFixed(3)}…${big.toFixed(3)}`);
      }
      sud(allEnds, `множитель по шагам (в обе стороны): ${say.join(' / ')} при пределах ${K_MIN.toFixed(3)}…1.000`);

      /* 3. цифра от роста не зависит вовсе: её кегль постоянен */
      let numDrift = 0;
      for (let i = 0; i < n; i += 1) {
        const v = frames.map((f) => f.steps[i].nFs);
        numDrift = Math.max(numDrift, Math.max(...v) - Math.min(...v));
      }
      sud(numDrift < 0.01, `кегль цифры не трогается: разброс ${numDrift.toFixed(3)} px`);

      /* 4. текст не выходит за зарезервированную коробку */
      let over = 0;
      for (const f of frames) {
        for (const st of f.steps) {
          over = Math.max(over, st.grow.b - st.body.b, st.body.l - st.grow.l, st.grow.r - st.body.r);
        }
      }
      sud(over < 0.5, `вылет текста за свою коробку: ${over.toFixed(2)} px`);

      /* 5. соседи не пересекаются и текст не наезжает на цифру */
      let gap = Infinity;
      let numOver = 0;
      for (const f of frames) {
        for (let i = 1; i < n; i += 1) gap = Math.min(gap, f.steps[i].body.t - f.steps[i - 1].body.b);
        for (const st of f.steps) {
          const ox = Math.min(st.grow.r, st.num.r) - Math.max(st.grow.l, st.num.l);
          const oy = Math.min(st.grow.b, st.num.b) - Math.max(st.grow.t, st.num.t);
          if (ox > 0 && oy > 0) numOver = Math.max(numOver, Math.min(ox, oy));
        }
      }
      sud(gap > 0, `просвет между коробками соседей: ${gap.toFixed(1)} px`);
      sud(numOver < 0.5, `наезд текста на цифру: ${numOver.toFixed(2)} px`);

      /* 6. непрерывность: ни одного скачка размера в долю хода */
      let jump = 0;
      for (let i = 0; i < n; i += 1) {
        for (let k = 1; k < frames.length; k += 1) {
          if (frames[k].dir !== frames[k - 1].dir) continue;
          jump = Math.max(jump, Math.abs(frames[k].steps[i].sk - frames[k - 1].steps[i].sk));
        }
      }
      sud(jump < (1 - K_MIN) * 0.5, `наибольший шаг размера за ${STEP_PX} px прокрутки: ${jump.toFixed(4)}`);

      await ctx.close();
    }

    /* 7. «уменьшить движение»: динамики нет, размер один на всех */
    for (const s of SIZES) {
      const ctx = await browser.newContext({
        viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1, reducedMotion: 'reduce',
      });
      const page = await ctx.newPage();
      await page.goto(`${srv.url}${PREFIX}/`, { waitUntil: 'load' });
      await page.waitForTimeout(700);
      const seen = new Set();
      for (const y of [0, 1200, 2400, 3600, 4800]) {
        await park(page, y);
        await page.waitForTimeout(40);
        for (const v of await page.evaluate(() =>
          [...document.querySelectorAll('.rstep')].map((el) =>
            getComputedStyle(el).getPropertyValue('--sk').trim()),
        )) seen.add(v);
      }
      sud(seen.size === 1, `«уменьшить движение» ${s.w}: разных множителей за проход ${seen.size} (${[...seen].join(', ')})`);
      await ctx.close();
    }
  } finally {
    await browser.close();
    await srv.close();
  }
  console.log(failed ? '\nПРОВАЛ: размер текста шагов ведёт себя не так, как задумано' : '\nВСЁ ХОРОШО');
  if (failed) process.exitCode = 1;
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

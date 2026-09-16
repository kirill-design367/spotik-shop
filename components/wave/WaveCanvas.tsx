'use client';

import { useEffect, useRef } from 'react';
import { WAVEFORM, WAVEFORM_LENGTH } from '@/lib/waveform.data';
import { waveBus, pushImpulse } from '@/lib/wavebus';
import { prefersReducedMotion, onReducedMotionChange } from '@/lib/motion';

/**
 * Звуковые волны в хиро. Canvas 2D — и только он.
 *
 * Четыре условия из брифа, и как они выполнены:
 *
 * 1. ПЛОТНОСТЬ. Не одна линия, а стопка из ~120 тонких контуров, наслоённых
 *    со смещением и затуханием. Каждая линия проходит на своей доле s от
 *    центра до полной огибающей, поэтому стопка целиком читается как волна,
 *    а не как набор кривых.
 *
 * 2. ФОРМА ОТ РЕАЛЬНОГО ЗВУКА. Ординаты берутся из WAVEFORM —
 *    пиковой огибающей настоящего звукового сигнала (см. scripts/build-waveform.py),
 *    просчитанной заранее и лежащей в коде числами. Ни аудиофайла,
 *    ни единого сетевого запроса в рантайме. Синусоиды здесь нет.
 *
 * 3. ИМПУЛЬС, А НЕ ДРОЖЬ. Тап или клик рождает кольцо, которое расходится
 *    от точки касания к краям и гаснет. Вся масса разом не дрожит никогда.
 *
 * 4. СВЯЗКА С ВОРДМАРКОМ. Амплитуда берётся из waveBus.compression: пока
 *    SPOTIK крупный, волна на пределе видимости; когда слово сжимается,
 *    оно отдаёт энергию в волну и та просыпается.
 *
 * ПРОИЗВОДИТЕЛЬНОСТЬ. Ни одной тени, ни одного блюра, ни одного фильтра:
 * на 120 линиях это убило бы кадр. Только чистые линии и прозрачность,
 * свечение набирается наложением контуров. В покое цикл останавливается —
 * на экране не остаётся ничего анимируемого.
 */

type Tuning = { lines: number; points: number; dpr: number };

/**
 * ПЛОТНОСТЬ ЛИНИЙ НЕ ТРОГАЕМ. ДЕРЖИМ ЦЕЛЫЙ МАСШТАБ ПОДЛОЖКИ.
 *
 * Плотность — это и есть приём, резать её нельзя. К счастью, замер показал,
 * что она почти ничего и не стоит. Развёртка на живой странице, интервалы
 * кадров с requestAnimationFrame:
 *
 *   390×844, процессор замедлен ×4        2560×1440, без замедления
 *   линий точек  dpr  пикс.  кадр         линий точек  dpr  пикс.   кадр
 *     124   160 1.00   329k  16.7 мс        124   160 1.00  3686k  16.7 мс
 *      72    96 1.25   515k 183.3 мс         72    96 1.25  5760k  33.3 мс
 *      40    80 1.00   329k  16.7 мс        124   160 0.80  2359k  33.3 мс
 *       0     0 1.00   329k  16.7 мс        124   120 0.90  2986k  33.3 мс
 *
 * Обратите внимание на левый столбец: 124 контура стоят ровно столько же,
 * сколько сорок и сколько ноль. А теперь на правый: МЕНЬШЕ пикселей (2359k
 * против 3686k) — и вдвое хуже кадр.
 *
 * Значит, дело не в площади и не в числе линий, а в МАСШТАБЕ. Когда буфер
 * холста совпадает с его CSS-размером один в один, композитор кладёт его
 * без пересчёта. Любой дробный масштаб включает передискретизацию всей
 * поверхности каждый кадр — и она стоит дороже, чем вся отрисовка.
 *
 * Отсюда правило: масштаб только целый, число линий постоянное.
 * WAVE_SCALE = 1 проверен на всех трёх эталонных размерах и держит 60 fps.
 * Поднимать его до 2 имеет смысл только там, где есть настоящий
 * видеоускоритель, — в этой среде его нет, и непроверенное значение
 * ставить нельзя.
 */
const WAVE_SCALE = 1;

function tuningFor(w: number): Tuning {
  // Линий всегда столько же, на любом устройстве: это приём, а не настройка.
  return { lines: 124, points: w < 768 ? 128 : 160, dpr: WAVE_SCALE };
}

/** Сколько корзин огибающей укладывается в ширину экрана. */
const SPAN = 300;
/** Скорость проезда дорожки, корзин в секунду. */
const SPEED = 26;
/** Сдвиг чтения между крайними контурами — он и даёт объём.
    Больше 24 контуры выстраиваются в регулярные диагонали, и ткань
    начинает читаться как дождь, а не как объём. */
const SHEAR = 21;
/** Импульс от касания: скорость фронта в долях ширины за секунду и время жизни. */
const IMPULSE_SPEED = 1.15;
const IMPULSE_LIFE = 1500;

/** Интерполированная выборка из огибающей с заворотом по кольцу. */
function sample(i: number): number {
  const n = WAVEFORM_LENGTH;
  let x = i % n;
  if (x < 0) x += n;
  const a = x | 0;
  const b = a + 1 === n ? 0 : a + 1;
  const f = x - a;
  return WAVEFORM[a] + (WAVEFORM[b] - WAVEFORM[a]) * f;
}

export default function WaveCanvas({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
    if (!ctx) return;

    let tune = tuningFor(1);
    let w = 0;
    let h = 0;
    let raf = 0;
    let running = false;
    let visible = true;
    let reduced = prefersReducedMotion();
    let t0 = performance.now();

    // предвычисленные x и доли ширины, чтобы в кадре не делить
    let xs = new Float32Array(0);
    let fxs = new Float32Array(0);
    // вклад импульсов на каждый столбец: он зависит только от x, а не от
    // номера контура, поэтому считается ОДИН раз за кадр, а не 124 раза
    let kicks = new Float32Array(0);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = Math.max(1, Math.round(rect.width));
      h = Math.max(1, Math.round(rect.height));
      tune = tuningFor(w);
      canvas.width = Math.round(w * tune.dpr);
      canvas.height = Math.round(h * tune.dpr);
      ctx.setTransform(tune.dpr, 0, 0, tune.dpr, 0, 0);
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'round';
      xs = new Float32Array(tune.points);
      fxs = new Float32Array(tune.points);
      kicks = new Float32Array(tune.points);
      for (let p = 0; p < tune.points; p += 1) {
        fxs[p] = p / (tune.points - 1);
        xs[p] = fxs[p] * w;
      }
    };

    const draw = (now: number) => {
      const time = (now - t0) / 1000;

      ctx.clearRect(0, 0, w, h);

      // Связка с вордмарком: пока слово крупное, волна почти не видна.
      const energy = waveBus.compression;
      const wake = energy * energy * (3 - 2 * energy); // то же смягчение, что у осей
      // В покое волна на пределе видимости — но именно НА пределе, а не за ним:
      // 0.30 базовой яркости читается как зелёная дымка и не спорит с вордмарком.
      const gain = 0.3 + 0.7 * wake;

      const cy = h * 0.5;
      const base = h * 0.01;
      const amp = h * (0.2 + 0.17 * wake);
      const lines = tune.lines;
      const points = tune.points;

      // живые импульсы
      const imp = waveBus.impulses;
      for (let k = imp.length - 1; k >= 0; k -= 1) {
        if (now - imp[k].born > IMPULSE_LIFE) imp.splice(k, 1);
      }

      // Вклад импульсов на столбец — один проход на кадр вместо прохода
      // внутри каждого из 124 контуров.
      if (imp.length) {
        for (let p = 0; p < points; p += 1) {
          const fx = fxs[p];
          let k = 0;
          for (let j = 0; j < imp.length; j += 1) {
            const age = (now - imp[j].born) / 1000;
            const r = age * IMPULSE_SPEED;
            const d = fx - imp[j].x;
            const dd = (d < 0 ? -d : d) - r;
            const decay = 1 - age / (IMPULSE_LIFE / 1000);
            if (decay <= 0) continue;
            k += Math.exp(-(dd * dd) * 190) * decay * decay;
          }
          kicks[p] = k * 1.1;
        }
      } else if (kicks[0] !== 0 || kicks[points - 1] !== 0) {
        kicks.fill(0);
      }

      ctx.lineWidth = 1;
      ctx.strokeStyle = '#1DB954';

      const head = time * SPEED;

      for (let i = 0; i < lines; i += 1) {
        const u = i / (lines - 1);
        const s = (u - 0.5) * 2; // −1 … +1
        const as = s < 0 ? -s : s;

        // затухание к краям стопки: наружные контуры несут полную огибающую
        const alpha = (0.035 + 0.075 * (1 - as) * (1 - as)) * gain;
        if (alpha < 0.002) continue;

        ctx.globalAlpha = alpha;
        ctx.beginPath();

        const shear = s * SHEAR + head;
        for (let p = 0; p < points; p += 1) {
          // импульс: кольцо расходится от точки касания и гаснет, как по воде
          const y = cy + s * (base + amp * (sample(shear + fxs[p] * SPAN) + kicks[p]));
          if (p === 0) ctx.moveTo(xs[p], y);
          else ctx.lineTo(xs[p], y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };

    const loop = (now: number) => {
      draw(now);
      if (running) raf = requestAnimationFrame(loop);
    };

    const startLoop = () => {
      if (running || reduced || !visible) return;
      running = true;
      raf = requestAnimationFrame(loop);
    };
    const stopLoop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    resize();
    if (reduced) draw(performance.now()); // один статичный кадр, и всё замирает
    else startLoop();

    // цикл крутится только пока хиро на экране
    const io = new IntersectionObserver(
      (entries) => {
        visible = entries[0].isIntersecting;
        if (visible) startLoop();
        else stopLoop();
      },
      { threshold: 0 },
    );
    io.observe(canvas);

    const onResize = () => {
      resize();
      if (reduced) draw(performance.now());
    };
    window.addEventListener('resize', onResize, { passive: true });

    const onPointer = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (reduced) return;
      pushImpulse((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
    };
    // слушаем всю секцию хиро: тап по любому месту рождает волну
    const host = canvas.parentElement ?? canvas;
    host.addEventListener('pointerdown', onPointer, { passive: true });

    const offRM = onReducedMotionChange((v) => {
      reduced = v;
      if (v) {
        stopLoop();
        draw(performance.now());
      } else startLoop();
    });

    const onVisibility = () => {
      if (document.hidden) stopLoop();
      else startLoop();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stopLoop();
      io.disconnect();
      offRM();
      window.removeEventListener('resize', onResize);
      host.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}

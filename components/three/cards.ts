/**
 * ОБЪЁМ КАРТОЧЕК ТАРИФА — ОДНА СЦЕНА THREE.JS НА ВЕСЬ БЛОК.
 *
 * ⚠️ ДВАДЦАТЬ ТРЕТЬЯ ИТЕРАЦИЯ ВЕРНУЛА THREE.JS. Прошлая карточка была
 * плоской плитой с рамкой: «тела как плотного объекта просто нет».
 * Теперь карточка — настоящий предмет в сцене: плита с толщиной,
 * фаской, материалом и светом.
 *
 * ── ОДИН КОНТЕКСТ, ОДИН ХОЛСТ, ЧЕТЫРЕ ПЛИТЫ ───────────────────────────────
 * Живой WebGL-контекст на странице ровно один, и он не раздаётся слотам
 * копиями кадра, как в Р-8: холст ОДИН на всю сетку, а плиты стоят
 * в нём там же, где лежат ячейки. Так дешевле всего — ни передачи
 * битмапов, ни четырёх наборов состояния.
 *
 * ── ПЕРЕДНЯЯ ГРАНЬ ПРОЕЦИРУЕТСЯ ОДИН К ОДНОМУ С ЯЧЕЙКОЙ ───────────────────
 * Это главное условие, потому что название и цена остаются HTML: без
 * скрипта и без WebGL карточка обязана читаться. Камера стоит на оси
 * холста, передние грани всех плит лежат в плоскости z = 0, а поле
 * зрения подобрано так, что z = 0 отображается в CSS-пиксели ровно
 * один к одному:
 *
 *     fov = 2 · atan((H / 2) / D)
 *
 * Значит прямоугольник передней грани попадает в свою ячейку точно,
 * а толщина уходит ОТ зрителя. Отсюда даром получается и сам объём:
 * камера на конечном расстоянии, поэтому у крайних плит видно боковую
 * грань — тем больше, чем дальше плита от оси.
 *
 * Та же величина D уходит в CSS (`perspective` на сетке), поэтому
 * наклон текста и наклон плиты идут по ОДНОЙ матрице.
 *
 * ── МАТЕРИАЛ ПРОСТОЙ, СВЕТА В СЦЕНЕ НЕТ ───────────────────────────────────
 * Источников света нет ни одного, PBR нет, окружения нет: цена объёма
 * в девятнадцатой итерации сидела не в пикселях и не в освещении,
 * а в сборке большой шейдерной программы в машинный код — 3.6 с
 * главного потока (Р-34, Р-54). Здесь два крошечных шейдера:
 *
 *   ПЛИТА — направленный «ключ» и подсвет считаются прямо во фрагменте,
 *           плюс лампа-точка, которая ездит за курсором (это и есть
 *           глянец: на плоской грани направленный свет дал бы ровную
 *           заливку, а точка — пятно);
 *   ОРЕОЛ — знаковое расстояние до скруглённого прямоугольника.
 *           Ровный ореол ПО ВСЕМУ ПЕРИМЕТРУ получается по построению:
 *           яркость зависит только от расстояния до контура.
 *
 * ⚠️ ОРЕОЛ — НЕ ФИЛЬТР. Ни `blur`, ни `filter`: мягкость даёт сама
 * функция спада. Закон 29 цел.
 */
import {
  BufferGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Shape,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';

/** Прямоугольник ячейки в пикселях холста. */
export type Cell = { x: number; y: number; w: number; h: number; r: number };

export type Stage = {
  /** Расстояние камеры: та же величина уходит в CSS `perspective`. */
  dist: number;
  resize(w: number, h: number): void;
  layout(cells: Cell[], thick: number): void;
  pose(i: number, rx: number, ry: number, tz: number): void;
  light(i: number, x: number, y: number, k: number): void;
  glow(i: number, v: number, sel: number): void;
  render(): void;
  warm(): Promise<void>;
  dispose(): void;
};

/**
 * Толщина плиты и фаска считаются от ширины карточки.
 *
 * ⚠️ ТОЛЩИНА И РАССТОЯНИЕ ДО КАМЕРЫ — ОДНА ВЕЛИЧИНА НА ДВОИХ. Боковая
 * грань видна ровно на `толщина × смещение от оси / расстояние`:
 * при первом заходе (7.5 % ширины и камера в 1.1 высоты холста) это
 * давало 5 px, и плита читалась плоской. Взято 11.5 % и 0.74 — тогда
 * у крайней плиты боковина 15…18 px, то есть объём виден сразу.
 */
export const THICK = (w: number) => Math.max(18, Math.min(64, w * 0.115));
const BEVEL = 2.6;
/**
 * Вынос ореола за кромку плиты.
 *
 * ⚠️ ЭТО ЖЕ ЧИСЛО ЗАДАЁТ ГАБАРИТ ХОЛСТА. Холст шире сетки ровно
 * на него, и если развести две величины, ореол окажется обрезан
 * краем холста прямой линией. Поэтому наружу уходит константа,
 * а CSS берёт её переменной `--glow-pad`, а не своим числом.
 */
export const HALO = 72;

/** Насколько далеко стоит камера: от высоты холста, с полом и потолком. */
function camDist(h: number, narrow: boolean) {
  return Math.max(520, Math.min(1700, h * (narrow ? 0.62 : 0.74)));
}

function plate(w: number, h: number, r: number): Shape {
  const s = new Shape();
  const x = -w / 2;
  const y = -h / 2;
  const rr = Math.max(1, Math.min(r, w / 2 - 1, h / 2 - 1));
  s.moveTo(x + rr, y);
  s.lineTo(x + w - rr, y);
  s.absarc(x + w - rr, y + rr, rr, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - rr);
  s.absarc(x + w - rr, y + h - rr, rr, 0, Math.PI / 2, false);
  s.lineTo(x + rr, y + h);
  s.absarc(x + rr, y + h - rr, rr, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + rr);
  s.absarc(x + rr, y + rr, rr, Math.PI, Math.PI * 1.5, false);
  return s;
}

/**
 * ⚠️ ВЕСЬ СВЕТ СЧИТАЕТСЯ В ВЕРШИНЕ, А НЕ ВО ФРАГМЕНТЕ, И ЭТО ЗАМЕР.
 * Первый заход считал во фрагменте всё: два нормирования, три `pow`
 * и `length` на каждый пиксель. На 2560 холст сцены занимает два
 * мегапикселя, и в программном растеризаторе один кадр обходился
 * в 50…100 мс — блоки середины шли 30 fps при 73 % кадров дороже
 * бюджета.
 *
 * Считать это в вершине МОЖНО ПО ПОСТРОЕНИЮ: направленный свет,
 * отблеск фаски и кромочный свет зависят только от НОРМАЛИ, а она
 * у грани постоянна; вертикальный градиент линеен по локальной y,
 * и интерполяция его не искажает. Во фрагменте остаётся сложение —
 * и лампа глянца, которая одна и вправду позиционная.
 */
/**
 * РАМКА ПОД ОРЕОЛ — ЧЕТЫРЕ ПРЯМОУГОЛЬНИКА, А НЕ ОДИН.
 *
 * ⚠️ ЭТО ЗАМЕР, А НЕ АККУРАТНОСТЬ. Ореол рисуется со смешиванием,
 * и сплошной прямоугольник заставлял затенять ещё и середину —
 * ту, что всё равно закрыта плитой. Замер холостого хода сцены:
 * с ореолом 39 % кадров дороже 16.9 мс на 1920 и 46 % на 2560,
 * без ореола 0.4 % и 14 %. Рамка убирает середину по построению,
 * не полагаясь на ранний тест глубины.
 */
function ringGeom(w: number, h: number, pad: number): BufferGeometry {
  const a = w / 2;
  const b = h / 2;
  const p = pad;
  const quads = [
    [-a - p, b, a + p, b + p],
    [-a - p, -b - p, a + p, -b],
    [-a - p, -b, -a, b],
    [a, -b, a + p, b],
  ];
  const pos: number[] = [];
  for (const [x0, y0, x1, y1] of quads) {
    pos.push(x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y0, 0, x1, y1, 0, x0, y1, 0);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  return g;
}

const SLAB_VERT = `
uniform vec3 uTop;
uniform vec3 uBot;
uniform vec3 uRim;
uniform float uSel;
uniform float uHalfY;
varying vec3 vCol;
varying vec3 vBase;
varying vec3 vN;
varying vec3 vP;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 N = normalize(normalMatrix * normal);
  vec3 V = normalize(-mv.xyz);
  float g = clamp(position.y / uHalfY * 0.5 + 0.5, 0.0, 1.0);
  vec3 base = mix(uBot, uTop, g);
  vec3 key = normalize(vec3(-0.30, 0.86, 0.40));
  vec3 fil = normalize(vec3(0.74, -0.34, 0.40));
  float lit = 0.34 + 0.62 * max(dot(N, key), 0.0) + 0.18 * max(dot(N, fil), 0.0);
  float bev = pow(max(dot(N, normalize(key + V)), 0.0), 34.0) * 0.34;
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vBase = base;
  vCol = base * lit + vec3(bev) + uRim * rim * (0.30 + 0.95 * uSel);
  vN = N;
  vP = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

/**
 * Во фрагменте — сложение и ОДНА ветка по однородной величине: пока
 * указатель не на карточке, лампы нет вовсе и шейдер вырождается
 * в присваивание.
 *
 * Ключ бьёт сверху и почти вдоль плоскости (см. вершинный шейдер):
 * иначе верхняя грань светлее передней лишь на проценты, и толщина
 * не читается. Лампа-точка обязательна отдельно: на плоской грани
 * направленный свет дал бы ровную заливку, и пятна глянца
 * не получилось бы вовсе.
 */
const SLAB_FRAG = `
precision mediump float;
uniform vec3 uLamp;
uniform float uGloss;
varying vec3 vCol;
varying vec3 vBase;
varying vec3 vN;
varying vec3 vP;
void main() {
  vec3 col = vCol;
  if (uGloss > 0.002) {
    vec3 N = normalize(vN);
    vec3 V = normalize(-vP);
    vec3 ld = uLamp - vP;
    float dd = length(ld);
    vec3 L = ld / max(dd, 1.0);
    float fall = uGloss / (1.0 + dd * dd * 3.2e-6);
    vec3 H = normalize(L + V);
    col += vec3(pow(max(dot(N, H), 0.0), 26.0) * fall * 0.85);
    col += vBase * (max(dot(N, L), 0.0) * fall * 0.26);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const GLOW_VERT = `
varying vec2 vXY;
void main() {
  vXY = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/**
 * ⚠️ ОРЕОЛ ОБНИМАЕТ КОНТУР, А НЕ ЛЕЖИТ ПЯТНОМ. Прошлая подсветка была
 * радиальным градиентом за плитой — то есть кругом, и у портретной
 * карточки он вылезал слева и справа лужей. Здесь яркость зависит
 * ТОЛЬКО от расстояния до скруглённого прямоугольника, поэтому ореол
 * одинаков по всему периметру и повторяет углы.
 *
 * Два спада: узкий даёт светящуюся кромку, широкий — рассеянный свет
 * на фоне. Оба гаснут внутри своего бокса, поэтому прямой видимой
 * линии по краю слоя взяться неоткуда.
 */
const GLOW_FRAG = `
precision mediump float;
uniform vec2 uHalf;
uniform float uR;
uniform float uI;
uniform float uPad;
uniform vec3 uCol;
uniform vec3 uHot;
varying vec2 vXY;
float sdRR(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - r;
}
void main() {
  float d = max(sdRR(vXY, uHalf, uR), 0.0);
  /* СПАД — МНОГОЧЛЕН ОТ ОДНОЙ ВЕЛИЧИНЫ, и это замер, а не вкус.
     Сначала здесь стояли две экспоненты, потом два деления; обе
     формы дороги, а ореол занимает почти мегапиксель со смешиванием
     на каждый кадр. Многочлен от t = 1 - d / pad даёт ту же на глаз
     мягкость одними умножениями И ГАСНЕТ В НОЛЬ на кромке слоя сам:
     отдельная обойма от прямой видимой линии больше не нужна.
     Двенадцатая степень набирается четырьмя умножениями — это узкая
     яркая кромка; квадрат — широкий рассеянный свет. */
  float t = clamp(1.0 - d / uPad, 0.0, 1.0);
  float t2 = t * t;
  float t4 = t2 * t2;
  float edge = t4 * t4 * t4;
  float a = clamp((t2 * 0.30 + edge * 0.85) * uI, 0.0, 1.0);
  vec3 col = mix(uCol, uHot, edge * 0.7);
  gl_FragColor = vec4(col * a, a);
}`;

type Slot = { slab: Mesh; halo: Mesh };

export function createStage(canvas: HTMLCanvasElement, count: number): Stage | null {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      powerPreference: 'low-power',
    });
  } catch {
    return null;
  }
  if (!renderer.getContext()) return null;

  renderer.setClearAlpha(0);
  const scene = new Scene();
  const camera = new PerspectiveCamera(40, 1, 10, 9000);

  const slots: Slot[] = [];
  for (let i = 0; i < count; i += 1) {
    const slab = new Mesh(
      new PlaneGeometry(1, 1),
      new ShaderMaterial({
        vertexShader: SLAB_VERT,
        fragmentShader: SLAB_FRAG,
        uniforms: {
          /* Зеленовато-серый выведен из палитры подмешиванием акцента
             к `--surface`: седьмого цвета в палитре не появилось. */
          uTop: { value: new Vector3(0.212, 0.258, 0.228) },
          uBot: { value: new Vector3(0.105, 0.128, 0.115) },
          uRim: { value: new Vector3(0.114, 0.725, 0.329) },
          uLamp: { value: new Vector3(0, 0, 0) },
          uGloss: { value: 0 },
          uSel: { value: 0 },
          uHalfY: { value: 1 },
        },
      }),
    );
    slab.frustumCulled = false;
    const halo = new Mesh(
      new PlaneGeometry(1, 1),
      new ShaderMaterial({
        vertexShader: GLOW_VERT,
        fragmentShader: GLOW_FRAG,
        transparent: true,
        depthWrite: false,
        uniforms: {
          uHalf: { value: new Vector2(1, 1) },
          uR: { value: 20 },
          uI: { value: 0.2 },
          uPad: { value: 1 },
          uCol: { value: new Vector3(0.114, 0.725, 0.329) },
          uHot: { value: new Vector3(0.55, 0.95, 0.68) },
        },
      }),
    );
    halo.frustumCulled = false;
    halo.renderOrder = 1;
    scene.add(halo);
    scene.add(slab);
    slots.push({ slab, halo });
  }

  let W = 1;
  let H = 1;
  let dist = 1200;

  const stage: Stage = {
    get dist() {
      return dist;
    },
    set dist(v: number) {
      dist = v;
    },

    resize(w, h) {
      W = Math.max(1, w);
      H = Math.max(1, h);
      /* ⚠️ МАСШТАБ ХОЛСТА — ЦЕЛОЕ ЧИСЛО. Дробный включает
         передискретизацию всей поверхности на каждом кадре и стоит
         дороже самой отрисовки (Р-4).

         ⚠️ И НА УЗКОМ ЭКРАНЕ ОН РАВЕН ЕДИНИЦЕ. У телефона dpr 2.75,
         и при потолке 2 буфер сцены выходил в 1.7 мегапикселя — как
         у десктопа 2560, только процессор вчетверо медленнее. Замер:
         210 потерянных кадров в блоке тарифов за прогретый проход
         и по 150…180 мс на кадр сцены. Кромка плиты от этого мягче
         ровно на один экранный пиксель, а текст на ней остаётся
         в родной плотности — он HTML. */
      const dpr = W < 620 ? 1 : Math.min(2, Math.max(1, Math.round(window.devicePixelRatio || 1)));
      dist = camDist(H, W < 620);
      camera.fov = (2 * Math.atan(H / 2 / dist) * 180) / Math.PI;
      camera.aspect = W / H;
      camera.position.set(0, 0, dist);
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(dpr);
      renderer.setSize(W, H, false);
    },

    layout(cells, thick) {
      for (let i = 0; i < slots.length; i += 1) {
        const c = cells[i];
        if (!c) continue;
        const s = slots[i];
        const cx = c.x + c.w / 2 - W / 2;
        const cy = H / 2 - (c.y + c.h / 2);

        s.slab.geometry.dispose();
        const geo = new ExtrudeGeometry(plate(c.w, c.h, c.r), {
          depth: thick,
          bevelEnabled: true,
          bevelThickness: BEVEL,
          bevelSize: BEVEL,
          bevelOffset: 0,
          bevelSegments: 2,
          curveSegments: 10,
          steps: 1,
        });
        geo.computeBoundingBox();
        /* Передняя точка плиты садится ровно в плоскость z = 0 — там,
           где проекция один к одному совпадает с ячейкой. */
        geo.translate(0, 0, -(geo.boundingBox?.max.z ?? 0));
        s.slab.geometry = geo;
        s.slab.position.set(cx, cy, 0);
        (s.slab.material as ShaderMaterial).uniforms.uHalfY.value = c.h / 2;

        /* ⚠️ ОРЕОЛ ЛЕЖИТ ЗА ПЛИТОЙ, И ЕГО ПРОЕКЦИЮ НАДО КОМПЕНСИРОВАТЬ.
           Всё, что глубже z = 0, проецируется мельче и СМЕЩАЕТСЯ
           к точке схода: у крайней плиты ореол уезжал внутрь кадра
           и горел только с двух сторон — снизу и справа. Множитель
           k = (D + глубина) / D возвращает проекцию слоя ровно
           на контур передней грани, и ореол снова ровный по всему
           периметру. Середину закрывает сама плита (тест глубины). */
        const zh = -thick * 0.9;
        const k = (dist - zh) / dist;
        s.halo.geometry.dispose();
        s.halo.geometry = ringGeom(c.w * k, c.h * k, HALO * k);
        s.halo.position.set(cx * k, cy * k, zh);
        const u = (s.halo.material as ShaderMaterial).uniforms;
        (u.uHalf.value as Vector2).set((c.w / 2) * k, (c.h / 2) * k);
        u.uR.value = c.r * k;
        u.uPad.value = HALO * k;
      }
    },

    pose(i, rx, ry, tz) {
      const s = slots[i];
      if (!s) return;
      s.slab.rotation.set(rx, ry, 0);
      s.slab.position.z = tz;
      /* Ореол НЕ поворачивается: он лежит глубже, и поворот менял бы
         его проекцию сильнее, чем силуэт самой плиты, — контур поехал
         бы на восемь пикселей. Свет за предметом наклоняться не обязан. */
    },

    light(i, x, y, k) {
      const s = slots[i];
      if (!s) return;
      const u = (s.slab.material as ShaderMaterial).uniforms;
      /* Лампа задаётся в пространстве камеры: камера стоит на оси
         и смотрит вдоль −z, поэтому мир переводится в неё вычитанием
         расстояния. Ни одной матрицы в кадре. */
      (u.uLamp.value as Vector3).set(x - W / 2, H / 2 - y, 300 - dist);
      u.uGloss.value = k;
    },

    glow(i, v, sel) {
      const s = slots[i];
      if (!s) return;
      (s.halo.material as ShaderMaterial).uniforms.uI.value = v;
      (s.slab.material as ShaderMaterial).uniforms.uSel.value = sel;
    },

    render() {
      renderer.render(scene, camera);
    },

    async warm() {
      /* Сборка программы в машинный код — единственное, что здесь
         вообще дорого (Р-54). Делаем её ДО входа блока в кадр. */
      const c = renderer.compileAsync?.(scene, camera);
      if (c) await c;
    },

    dispose() {
      for (const s of slots) {
        s.slab.geometry.dispose();
        (s.slab.material as ShaderMaterial).dispose();
        s.halo.geometry.dispose();
        (s.halo.material as ShaderMaterial).dispose();
      }
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };

  return stage;
}

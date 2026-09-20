/**
 * ОБЩАЯ СЦЕНА: один WebGL-контекст на всю страницу, много слотов.
 *
 * Слотов теперь четыре — по одному на карточку тарифа, — и они делят
 * ОДИН рендерер. Четыре независимых контекста браузер держать не обязан:
 * при переполнении он убивает САМЫЙ СТАРЫЙ, то есть ломает не ту карточку,
 * на которую смотрят, а соседнюю. Поэтому контекст здесь ровно один,
 * а слоты получают готовый кадр: рендерер рисует во внеэкранный канвас,
 * слот принимает изображение через `bitmaprenderer` и `transferToImageBitmap` —
 * пиксели при этом не читаются.
 *
 * ── МАТЕРИАЛ ПРОСТОЙ, И ЭТО ГЛАВНОЕ РЕШЕНИЕ ЗДЕСЬ ──────────────────────────
 * До девятнадцатой итерации сцена шла на `MeshStandardMaterial`
 * с процедурным окружением через PMREM. Замер (Р-34) показал, где сидит
 * цена: 3.6 с уходило не на пиксели и не на свет, а на ПЕРВУЮ МАТЕРИАЛИЗАЦИЮ
 * кадра — компиляцию большой PBR-программы в машинный код. В контейнере
 * нет видеоускорителя, и этим занимается программный растеризатор.
 *
 * Поэтому здесь НЕТ НИ ОДНОГО ИСТОЧНИКА СВЕТА и нет PBR. Материал —
 * `MeshBasicMaterial` с вершинными цветами, а псевдоосвещение ЗАПЕЧЕНО
 * в геометрию: у каждой грани коробки свой множитель яркости. Верх
 * светлее, фронт средний, бок тёмный — глаз читает это как объём,
 * а шейдер при этом не считает ничего, кроме умножения двух цветов.
 * Побочно ушли и PMREM (257…298 мс), и весь `RoomEnvironment`.
 *
 * ── ПОЧЕМУ ЦВЕТ ПЕРЕМНОЖАЕТСЯ ─────────────────────────────────────────────
 * У `InstancedMesh` с `vertexColors: true` three.js умножает цвет вершины
 * на `instanceColor`. Значит в вершины кладётся ЯРКОСТЬ ГРАНИ (серая),
 * а в экземпляр — ТОН столбика. Одно и то же тело служит и зелёным,
 * и тёмным столбиком без второго материала.
 *
 * ── ЦИКЛ ОДИН НА ВСЕ СЛОТЫ, И ОН ГАСНЕТ В ПОКОЕ ───────────────────────────
 * Рисуется только то, что (а) на экране и (б) чем-то занято: наклоном
 * под указателем или собственным вращением. Как только всё сошлось
 * и ничего не вращается, цикл останавливается и кадров не заказывает.
 * Вращение вдобавок идёт с ПОНИЖЕННОЙ частотой (SPIN_MS): на касаниях
 * крутятся все видимые карточки разом, и 20 кадров в секунду там
 * неотличимы от 60, а стоят втрое дешевле. И оно ОСТАНАВЛИВАЕТСЯ,
 * пока страница едет: перерисовывать четыре предмета одновременно
 * с ходом страницы — это 31 потерянный кадр из 346 по замеру,
 * а смотрят вращение в покое. См. SCROLL_IDLE.
 */
import * as THREE from 'three';
import { onScrollY } from '@/lib/scroll';
import { WAVEFORM, WAVEFORM_LENGTH } from '@/lib/waveform.data';
import type { SceneKind } from './types';

type Stage = { renderer: THREE.WebGLRenderer };

let stage: Stage | null = null;
let users = 0;

/**
 * Умеет ли браузер отдавать кадр БЕЗ КОПИИ.
 *
 * OffscreenCanvas + transferToImageBitmap → canvas.getContext('bitmaprenderer')
 * передаёт кадр как объект, а не копирует пиксели. Это ровно тот путь,
 * ради которого bitmaprenderer и существует.
 */
const canTransfer =
  typeof OffscreenCanvas !== 'undefined' &&
  typeof HTMLCanvasElement !== 'undefined' &&
  typeof ImageBitmapRenderingContext !== 'undefined' &&
  'transferFromImageBitmap' in ImageBitmapRenderingContext.prototype;

function getStage(): Stage {
  if (stage) return stage;
  coarse = window.matchMedia('(pointer: coarse)').matches;
  const canvas: HTMLCanvasElement | OffscreenCanvas = canTransfer
    ? new OffscreenCanvas(1, 1)
    : document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({
    canvas: canvas as HTMLCanvasElement,
    antialias: true,
    alpha: true,
    // Дискретная видеокарта ради этого кадра — это мигание окна
    // на ноутбуках с двумя GPU и расход батареи.
    powerPreference: 'low-power',
    // нужен ТОЛЬКО запасному пути через drawImage: transferToImageBitmap
    // забирает кадр сам и в сохранённом буфере не нуждается
    preserveDrawingBuffer: !canTransfer,
  });
  renderer.setPixelRatio(1); // масштаб задаём размером буфера, а не dpr
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Тональная компрессия увела бы #1DB954, а рядом в том же вьюпорте
  // лежат CSS-поверхности ровно того же зелёного.
  renderer.toneMapping = THREE.NoToneMapping;
  stage = { renderer };
  return stage;
}

const GREEN = new THREE.Color('#1DB954');
const BAR = new THREE.Color('#585858');
const PLATE = new THREE.Color('#4A4A4A');

/**
 * ПСЕВДООСВЕЩЕНИЕ ЗАПЕЧЕНО В ВЕРШИНЫ. Порядок граней у BoxGeometry
 * жёсткий: +X, −X, +Y, −Y, +Z, −Z по четыре вершины на грань. Свет
 * условно идёт сверху-спереди-справа.
 */
const SHADE = [0.60, 0.34, 1.0, 0.24, 0.80, 0.34];

/** Красит коробку по граням: множитель яркости × тон грани. */
function paintBox(geo: THREE.BoxGeometry, tint: (face: number) => THREE.Color) {
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let v = 0; v < n; v += 1) {
    const face = Math.min(5, Math.floor(v / 4));
    const c = tint(face);
    const k = SHADE[face];
    col[v * 3] = c.r * k;
    col[v * 3 + 1] = c.g * k;
    col[v * 3 + 2] = c.b * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

type Built = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Что кадрируем: по этому объёму камера отходит под размер слота. */
  focus: THREE.Object3D;
  /** Группа, которую крутит наклон и собственное вращение. */
  pivot: THREE.Object3D;
  /** Поворот покоя: от него считаются и наклон, и вращение. */
  rest: THREE.Euler;
  margin: number;
  dispose: () => void;
};

/**
 * Кадрирование под известный бокс.
 *
 * Считаем НЕ по описанной сфере, а по восьми углам бокса, спроецированным
 * в систему координат камеры. Сфера вокруг повёрнутой плоской пластины
 * почти вдвое больше самой пластины, и подгонка по ней оставляет половину
 * слота пустой — при первом заходе так и вышло.
 */
const CORNERS = Array.from({ length: 8 }, () => new THREE.Vector3());

function fitCamera(camera: THREE.PerspectiveCamera, focus: THREE.Object3D, margin: number) {
  const box = new THREE.Box3().setFromObject(focus);
  const center = box.getCenter(new THREE.Vector3());
  const dir = camera.position.clone().sub(center).normalize();
  if (!Number.isFinite(dir.x) || dir.lengthSq() < 1e-6) dir.set(0, 0, 1);

  const forward = dir.clone().negate();
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(forward, up).normalize();
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  up.crossVectors(right, forward).normalize();

  let i = 0;
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) CORNERS[i++].set(x, y, z).sub(center);

  const vFov = (camera.fov * Math.PI) / 180;
  const tanV = Math.tan(vFov / 2);
  const tanH = tanV * camera.aspect;

  let dist = 0.001;
  let depth = 0;
  for (const c of CORNERS) {
    const cx = Math.abs(c.dot(right)) * margin;
    const cy = Math.abs(c.dot(up)) * margin;
    const cz = c.dot(forward);
    dist = Math.max(dist, cx / tanH + cz, cy / tanV + cz);
    depth = Math.max(depth, Math.abs(cz));
  }

  camera.position.copy(center).addScaledVector(dir, dist);
  camera.near = Math.max(0.01, dist - depth * 2);
  camera.far = dist + depth * 3;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

/**
 * Карточка тарифа — отрезок той же звуковой дорожки, поднятый в объём.
 * Рядов столько, на скольких человек тариф: это не украшение, а тот же
 * материал страницы, что нумерация и огибающая в хиро.
 */
function buildCard(seed: number): Built {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  const pivot = new THREE.Group();
  scene.add(pivot);

  /* Столбиков немного и они толстые: тонкий частокол на карточке
     в 300 px читается как диаграмма, а нужен ПРЕДМЕТ. */
  const COLS = 20;
  const ROWS = Math.max(1, Math.min(3, seed));
  const geo = new THREE.BoxGeometry(1, 1, 1);
  paintBox(geo, () => new THREE.Color(1, 1, 1));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const mesh = new THREE.InstancedMesh(geo, mat, COLS * ROWS);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const offset = (seed * 137) % WAVEFORM_LENGTH;

  let i = 0;
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const v = WAVEFORM[(offset + c * 17 + r * 53) % WAVEFORM_LENGTH];
      const h = 0.18 + v * 1.45;
      pos.set((c - (COLS - 1) / 2) * 0.27, h / 2 - 0.5, (r - (ROWS - 1) / 2) * 0.8);
      scl.set(0.19, h, 0.19);
      m.compose(pos, q, scl);
      mesh.setMatrixAt(i, m);
      // зелёным помечены пики: ряд читается как дорожка, а не как забор
      mesh.setColorAt(i, v > 0.58 ? GREEN : BAR);
      i += 1;
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  // без этого при подгонке кадра фрустум может отсечь объект целиком
  mesh.computeBoundingSphere();
  pivot.add(mesh);

  const rest = new THREE.Euler(-0.5, -0.66, 0);
  pivot.rotation.copy(rest);
  camera.position.set(0, 1.6, 7);

  return {
    scene,
    camera,
    focus: pivot,
    pivot,
    rest,
    margin: 1.14,
    dispose: () => {
      mesh.dispose();
      geo.dispose();
      mat.dispose();
    },
  };
}

/**
 * Сертификат — плита с зелёным торцом. Подарок как физический предмет:
 * ни фотографии, ни чужих знаков.
 */
function buildGift(): Built {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  const pivot = new THREE.Group();
  scene.add(pivot);

  /* Торцы (±X, ±Y) зелёные, лицо и оборот (±Z) тёмные — тот же приём,
     что и у столбиков, только тон запечён прямо в вершины. */
  /* Плита толстая намеренно: весь смысл предмета в зелёном ТОРЦЕ,
     а у тонкой пластины торца не видно. */
  const plate = new THREE.BoxGeometry(3.2, 2.05, 0.4);
  paintBox(plate, (f) => (f === 4 || f === 5 ? PLATE : GREEN));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const card = new THREE.Mesh(plate, mat);
  pivot.add(card);

  /* Тиснение на лице: короткий отрезок той же дорожки, чтобы сертификат
     читался как часть той же вещи, а не как отдельная иконка. */
  const COLS = 18;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  paintBox(geo, () => GREEN);
  const bars = new THREE.InstancedMesh(geo, mat, COLS);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  for (let c = 0; c < COLS; c += 1) {
    const v = WAVEFORM[(c * 41 + 220) % WAVEFORM_LENGTH];
    const h = 0.12 + v * 0.6;
    pos.set((c - (COLS - 1) / 2) * 0.16, -0.52 + h / 2, 0.23);
    scl.set(0.09, h, 0.09);
    m.compose(pos, q, scl);
    bars.setMatrixAt(c, m);
  }
  bars.instanceMatrix.needsUpdate = true;
  bars.computeBoundingSphere();
  pivot.add(bars);

  const rest = new THREE.Euler(-0.3, -0.64, 0.03);
  pivot.rotation.copy(rest);
  camera.position.set(0, 0.8, 7);

  return {
    scene,
    camera,
    focus: pivot,
    pivot,
    rest,
    margin: 1.14,
    dispose: () => {
      bars.dispose();
      plate.dispose();
      geo.dispose();
      mat.dispose();
    },
  };
}

export type SlotHandle = {
  /** Перерисовать под текущий размер слота. */
  draw: () => void;
  /** Указатель внутри карточки: −1…1 по обеим осям, либо null — ушёл. */
  setPointer: (x: number | null, y: number | null) => void;
  /** Слот на экране: вне экрана цикл его не трогает вовсе. */
  setVisible: (on: boolean) => void;
  /** Собственное медленное вращение (касания). */
  setSpin: (on: boolean) => void;
  dispose: () => void;
};

type State = {
  built: Built;
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  bmp: ImageBitmapRenderingContext | null;
  ctx2d: CanvasRenderingContext2D | null;
  /* цель и текущее значение наклона; демпфер ведёт второе к первому */
  tx: number;
  ty: number;
  cx: number;
  cy: number;
  spin: boolean;
  phase: number;
  visible: boolean;
  live: boolean;
  last: number;
};

const slots = new Set<State>();
let raf = 0;
let prev = 0;

/** Амплитуда наклона под указателем. Лёгкий, не аттракцион. */
const TILT = 0.17;
/** Постоянная времени демпфера наклона. */
const TAU = 110;
/** Оборот собственного вращения и его шаг кадра. */
const SPIN_RATE = 0.16;
/**
 * ЦЕНА ВРАЩЕНИЯ СНИЖЕНА ДВУМЯ РЫЧАГАМИ, И ОБА ЗАМЕРЕНЫ.
 *
 * На мобильном профиле (390, процессор ×4, программный растеризатор)
 * вращение в покое давало 11.1 % кадров дороже 16.9 мс. Выключать приём
 * нельзя — мобильная композиция по ТЗ главная, — поэтому он упрощён:
 *
 *   ЧАСТОТА. 20 кадров в секунду вместо 30. Оборот медленный, и на нём
 *   разница между 20 и 60 не читается вовсе, а работы втрое меньше.
 *
 *   ПИКСЕЛИ. Масштаб буфера на касаниях ограничен 1.4 вместо 2. Площадь
 *   падает вдвое, а сглаживание остаётся включённым и съедает разницу
 *   в чёткости.
 */
const SPIN_MS = 50;
const DPR_FINE = 2;
const DPR_COARSE = 1.4;
let coarse = false;

/**
 * ВРАЩЕНИЕ СТОИТ, ПОКА СТРАНИЦА ЕДЕТ.
 *
 * Замер (`measure-mobile.mjs`, прогретый проход) показал это прямо:
 * 31 потерянный кадр из 346 в блоке тарифов — и все на прокрутке мимо
 * карточек, где четыре предмета перерисовывались одновременно с ходом
 * страницы. Приём при этом не пострадал: вращение на то и медленное,
 * что смотрят его в покое, а во время жеста смотрят на движение
 * страницы. Возобновляется оно через `SCROLL_IDLE` после последнего
 * события прокрутки — с запасом на родную инерцию, которая шлёт
 * события и после отрыва пальца.
 */
const SCROLL_IDLE = 220;
let scrolling = false;
let idleTimer = 0;
let offScroll: (() => void) | null = null;

function watchScroll() {
  if (offScroll) return;
  offScroll = onScrollY(() => {
    scrolling = true;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      idleTimer = 0;
      scrolling = false;
      pump();
    }, SCROLL_IDLE);
  });
}

function unwatchScroll() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = 0;
  scrolling = false;
  offScroll?.();
  offScroll = null;
}

function drawState(s: State) {
  const st = stage;
  if (!st || (!s.bmp && !s.ctx2d)) return;
  const dpr = Math.min(window.devicePixelRatio || 1, coarse ? DPR_COARSE : DPR_FINE);
  const w = Math.max(1, Math.round(s.host.clientWidth * dpr));
  const h = Math.max(1, Math.round(s.host.clientHeight * dpr));
  if (w < 2 || h < 2) return;
  if (s.canvas.width !== w || s.canvas.height !== h) {
    s.canvas.width = w;
    s.canvas.height = h;
  }
  s.built.camera.aspect = w / h;
  fitCamera(s.built.camera, s.built.focus, s.built.margin);
  // третий аргумент false: иначе three пишет inline-размеры в свой канвас
  st.renderer.setSize(w, h, false);
  s.built.pivot.rotation.set(
    s.built.rest.x + s.cy,
    s.built.rest.y + s.cx + s.phase,
    s.built.rest.z,
  );
  st.renderer.render(s.built.scene, s.built.camera);
  if (s.bmp) {
    // передача кадра: пиксели не копируются
    s.bmp.transferFromImageBitmap(
      (st.renderer.domElement as unknown as OffscreenCanvas).transferToImageBitmap(),
    );
  } else if (s.ctx2d) {
    s.ctx2d.clearRect(0, 0, w, h);
    s.ctx2d.drawImage(st.renderer.domElement, 0, 0, w, h);
  }
}

function tick(now: number) {
  raf = 0;
  const dt = Math.min(64, prev ? now - prev : 16);
  prev = now;
  let busy = false;
  for (const s of slots) {
    if (!s.live || !s.visible) continue;
    let move = false;
    if (s.spin && !scrolling) {
      s.phase += (SPIN_RATE * dt) / 1000;
      move = true;
    }
    /* Доля пути считается от ФАКТИЧЕСКОГО Δt: иначе на 30 fps наклон
       смягчается вдвое сильнее, чем на 60. Тот же демпфер, что у формы
       вордмарка (Р-44). */
    const k = 1 - Math.exp(-dt / TAU);
    if (Math.abs(s.tx - s.cx) > 1e-4 || Math.abs(s.ty - s.cy) > 1e-4) {
      s.cx += (s.tx - s.cx) * k;
      s.cy += (s.ty - s.cy) * k;
      move = true;
    } else if (s.cx !== s.tx || s.cy !== s.ty) {
      s.cx = s.tx;
      s.cy = s.ty;
      move = true;
    }
    if (!move) continue;
    busy = true;
    /* Вращение идёт с пониженной частотой: на касаниях крутятся все
       видимые карточки сразу, и лишние кадры там стоят дороже, чем
       видны. Наклон под указателем — всегда полная частота: он идёт
       за рукой. */
    const gap = s.tx === 0 && s.ty === 0 && s.spin ? SPIN_MS : 0;
    if (now - s.last < gap) continue;
    s.last = now;
    drawState(s);
  }
  if (busy) raf = requestAnimationFrame(tick);
  else prev = 0;
}

function pump() {
  if (raf) return;
  prev = 0;
  raf = requestAnimationFrame(tick);
}

/** Подключает слот к общей сцене и рисует один кадр. */
export async function attachSlot(
  host: HTMLElement,
  { kind, seed }: { kind: SceneKind; seed: number },
): Promise<SlotHandle> {
  coarse = window.matchMedia('(pointer: coarse)').matches;
  watchScroll();
  const st = getStage();
  const built = kind === 'gift' ? buildGift() : buildCard(seed);

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;display:block;width:100%;height:100%';
  host.appendChild(canvas);
  const bmp = canTransfer
    ? (canvas.getContext('bitmaprenderer') as ImageBitmapRenderingContext | null)
    : null;
  const ctx2d = bmp ? null : canvas.getContext('2d');

  /* Компиляция программы синхронна и в программном растеризаторе стоит
     заметно. Прогреваем ЗАРАНЕЕ — слот поднимается, пока блок ещё
     за кадром, — иначе рывок придётся ровно на подход скролла. */
  try {
    await st.renderer.compileAsync(built.scene, built.camera);
  } catch (e) {
    // Считаем пользователей ПОСЛЕ последнего await: иначе сорвавшийся
    // на компиляции слот навсегда удержал бы общий контекст.
    built.dispose();
    canvas.remove();
    throw e;
  }
  users += 1;

  const s: State = {
    built, host, canvas, bmp, ctx2d,
    tx: 0, ty: 0, cx: 0, cy: 0,
    spin: false, phase: 0, visible: true, live: true, last: 0,
  };
  slots.add(s);
  drawState(s);

  return {
    draw: () => drawState(s),
    setPointer(x, y) {
      s.tx = x === null ? 0 : x * TILT;
      s.ty = y === null ? 0 : y * TILT;
      pump();
    },
    setVisible(on) {
      s.visible = on;
      if (on) pump();
    },
    setSpin(on) {
      s.spin = on;
      if (on) pump();
    },
    dispose() {
      if (!s.live) return;
      s.live = false;
      slots.delete(s);
      built.dispose();
      canvas.remove();
      users -= 1;
      if (users <= 0 && stage) {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        unwatchScroll();
        stage.renderer.dispose();
        stage.renderer.forceContextLoss();
        stage = null;
        users = 0;
      }
    },
  };
}

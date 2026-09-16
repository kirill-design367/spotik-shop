/**
 * ОБЩАЯ СЦЕНА: один WebGL-контекст на всю страницу.
 *
 * Слотов под 3D четыре — три карточки тарифа и сертификат. Если каждому дать
 * свой WebGLRenderer, это четыре живых контекста. Браузер держит их
 * ограниченное число и при переполнении убивает САМЫЙ СТАРЫЙ, то есть ломает
 * не тот блок, по которому скроллят, а соседний. Поэтому контекст здесь
 * ровно один, общий.
 *
 * Как это работает в текущей итерации: рендерер рисует кадр во внеэкранный
 * канвас, а слот получает готовое изображение через drawImage на свой
 * обычный 2D-канвас. Кадр статичный, поэтому копия ничем не хуже живого
 * контекста, а стоит один контекст вместо четырёх.
 *
 * Как это масштабируется во второй итерации: тот же общий рендерер
 * переключается на штатную технику нескольких видов (setScissor + setViewport
 * по прямоугольникам слотов) и начинает крутить цикл. Слоты, их геометрия
 * и жизненный цикл не меняются — меняется только способ доставки кадра.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { WAVEFORM, WAVEFORM_LENGTH } from '@/lib/waveform.data';
import type { SceneKind } from './types';

type Stage = {
  renderer: THREE.WebGLRenderer;
  envTexture: THREE.Texture;
  pmrem: THREE.PMREMGenerator;
};

let stage: Stage | null = null;
let users = 0;

function getStage(): Stage {
  if (stage) return stage;
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    // Кадр рисуется один раз. Просить ради него дискретную видеокарту —
    // это мигание окна на ноутбуках с двумя GPU и расход батареи.
    powerPreference: 'low-power',
    preserveDrawingBuffer: true, // иначе drawImage заберёт пустой буфер
  });
  renderer.setPixelRatio(1); // масштаб задаём размером буфера, а не dpr
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Тональная компрессия увела бы #1DB954 в сторону, а рядом в том же
  // вьюпорте лежат CSS-поверхности ровно того же зелёного.
  renderer.toneMapping = THREE.NoToneMapping;

  const pmrem = new THREE.PMREMGenerator(renderer);
  // Окружение процедурное: ни одной картинки, ни одного сетевого запроса.
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);

  stage = { renderer, envTexture: envRT.texture, pmrem };
  return stage;
}

const GREEN = new THREE.Color('#1DB954');
const DARK = new THREE.Color('#2A2A2A');

type Built = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Что именно кадрируем: по этому объёму камера отходит под размер слота. */
  focus: THREE.Object3D;
  /** Запас вокруг объекта в долях его радиуса. */
  margin: number;
  dispose: () => void;
};

/**
 * Кадрирование под известный бокс.
 *
 * Слот на мобильном 16:9, на десктопе бывает 1:1 — если ставить камеру
 * на фиксированное расстояние, на узком слоте объект вылезет за края,
 * а на широком повиснет в пустоте. Поэтому расстояние считается от радиуса
 * сцены и от МЕНЬШЕГО из двух углов обзора: вертикального и горизонтального.
 */
function fitCamera(camera: THREE.PerspectiveCamera, focus: THREE.Object3D, margin: number) {
  const box = new THREE.Box3().setFromObject(focus);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const r = sphere.radius * margin;
  const vFov = (camera.fov * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const dist = r / Math.sin(Math.min(vFov, hFov) / 2);
  const dir = camera.position.clone().sub(sphere.center).normalize();
  camera.position.copy(sphere.center).addScaledVector(dir, dist);
  camera.near = Math.max(0.01, dist - r * 2);
  camera.far = dist + r * 3;
  camera.lookAt(sphere.center);
  camera.updateProjectionMatrix();
}

/**
 * Карточка тарифа — отрезок той же звуковой дорожки, поднятый в объём.
 * Рядов столько, на скольких человек тариф. Высоты столбиков берутся из
 * WAVEFORM, то есть из той же огибающей, что рисует волну в хиро:
 * это один материал страницы, а не отдельная декорация.
 */
function buildCard(seed: number): Built {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const group = new THREE.Group();
  scene.add(group);

  const COLS = 48;
  const ROWS = Math.max(1, Math.min(3, seed));
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ metalness: 0.18, roughness: 0.36 });
  const mesh = new THREE.InstancedMesh(geo, mat, COLS * ROWS);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const offset = (seed * 137) % WAVEFORM_LENGTH;

  let i = 0;
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const v = WAVEFORM[(offset + c * 7 + r * 23) % WAVEFORM_LENGTH];
      const h = 0.1 + v * 1.5;
      pos.set((c - (COLS - 1) / 2) * 0.13, h / 2 - 0.5, (r - (ROWS - 1) / 2) * 0.36);
      scl.set(0.08, h, 0.08);
      m.compose(pos, q, scl);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, v > 0.6 ? GREEN : DARK);
      i += 1;
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  // без этого при подгонке кадра фрустум может отсечь карточку целиком
  mesh.computeBoundingSphere();
  group.add(mesh);
  group.rotation.set(-0.46, -0.66, 0);
  camera.position.set(0, 1.6, 6.6);

  return {
    scene,
    camera,
    focus: group,
    margin: 1.12,
    dispose: () => {
      mesh.dispose();
      geo.dispose();
      mat.dispose();
    },
  };
}

/**
 * Сертификат — плита с зелёным торцом и рядом столбиков той же дорожки.
 * Подарок как физический предмет: ни фотографии, ни чужих знаков.
 */
function buildGift(): Built {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const group = new THREE.Group();
  scene.add(group);

  const plate = new THREE.BoxGeometry(3.2, 2.05, 0.16);
  const face = new THREE.MeshStandardMaterial({ color: '#242424', metalness: 0.3, roughness: 0.36 });
  const edge = new THREE.MeshStandardMaterial({ color: GREEN, metalness: 0.1, roughness: 0.3 });
  const card = new THREE.Mesh(plate, [edge, edge, edge, edge, face, face]);
  group.add(card);

  const COLS = 26;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ color: GREEN, metalness: 0.12, roughness: 0.32 });
  const bars = new THREE.InstancedMesh(geo, mat, COLS);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  for (let c = 0; c < COLS; c += 1) {
    const v = WAVEFORM[(c * 31 + 220) % WAVEFORM_LENGTH];
    const h = 0.06 + v * 0.5;
    pos.set((c - (COLS - 1) / 2) * 0.108, -0.62 + h / 2, 0.1);
    scl.set(0.046, h, 0.046);
    m.compose(pos, q, scl);
    bars.setMatrixAt(c, m);
  }
  bars.instanceMatrix.needsUpdate = true;
  bars.computeBoundingSphere();
  group.add(bars);

  group.rotation.set(-0.26, -0.58, 0.04);
  camera.position.set(0, 0.9, 6.8);

  return {
    scene,
    camera,
    focus: group,
    margin: 1.18,
    dispose: () => {
      bars.dispose();
      plate.dispose();
      geo.dispose();
      face.dispose();
      edge.dispose();
      mat.dispose();
    },
  };
}

export type SlotHandle = {
  /** Перерисовать под текущий размер слота. */
  draw: () => void;
  /**
   * Рубильник цикла. В этой итерации выключен: кадр рисуется один раз.
   * Во второй итерации анимация включается отсюда, и общий рендерер
   * переходит на режим нескольких видов — слоты не переписываются.
   */
  setLoop: (on: boolean) => void;
  dispose: () => void;
};

/** Подключает слот к общей сцене и рисует один кадр. */
export async function attachSlot(
  host: HTMLElement,
  { kind, seed }: { kind: SceneKind; seed: number },
): Promise<SlotHandle> {
  const st = getStage();
  users += 1;

  const built = kind === 'card' ? buildCard(seed) : buildGift();
  built.scene.environment = st.envTexture;

  // собственный 2D-канвас слота: он показывает копию кадра,
  // а живой WebGL-контекст на странице остаётся один
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;display:block;width:100%;height:100%';
  host.appendChild(canvas);
  const ctx2d = canvas.getContext('2d');

  // Компиляция программ занимает десятки миллисекунд синхронно. Прогреваем
  // заранее, иначе рывок придётся ровно на подход скролла к блоку.
  await st.renderer.compileAsync(built.scene, built.camera);

  let disposed = false;

  const draw = () => {
    if (disposed || !ctx2d) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(host.clientWidth * dpr));
    const h = Math.max(1, Math.round(host.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    built.camera.aspect = w / h;
    fitCamera(built.camera, built.focus, built.margin);
    // третий аргумент false: иначе three пишет inline-размеры в свой канвас
    st.renderer.setSize(w, h, false);
    st.renderer.render(built.scene, built.camera);
    ctx2d.clearRect(0, 0, w, h);
    ctx2d.drawImage(st.renderer.domElement, 0, 0, w, h);
  };

  draw();

  return {
    draw,
    setLoop() {
      /* анимация — вторая итерация */
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      built.dispose();
      built.scene.environment = null;
      canvas.remove();
      users -= 1;
      if (users <= 0 && stage) {
        stage.pmrem.dispose();
        stage.envTexture.dispose();
        stage.renderer.dispose();
        stage.renderer.forceContextLoss();
        stage = null;
        users = 0;
      }
    },
  };
}

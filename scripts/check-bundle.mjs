/**
 * СТОРОЖ КРИТИЧЕСКОГО ПУТИ.
 *
 * ⚠️ THREE.JS ВЕРНУЛСЯ В ДВАДЦАТЬ ТРЕТЬЕЙ ИТЕРАЦИИ — по прямой
 * постановке, ради настоящего объёма карточек. Значит запрет
 * «его нет ни в одном чанке» снят, а вместо него стоит условие
 * посильнее и проверяемое:
 *
 *   1. three.js НЕ ПОПАДАЕТ В ПЕРВЫЙ ЭКРАН. Он живёт только
 *      в асинхронных чанках, которые тянет `lib/cards.ts`
 *      наблюдателем за 700 px до блока тарифов. Попал в чанк,
 *      на который ссылается сама страница, — провал;
 *   2. асинхронный вес three.js ПЕЧАТАЕТСЯ ЧИСЛОМ и ограничен
 *      сверху: втихую он вырасти не должен;
 *   3. огибающая звука не вернулась НИ В ОДИН чанк. Волну сняли
 *      в двадцать второй итерации; данные лежат в репозитории
 *      (`lib/waveform.data.ts`) и ждут, когда приём понадобится
 *      снова, — но в сборке их быть не должно.
 *
 * Ловится это только так: глазами такое не видно, а цена ошибки —
 * лишние сотни килобайт в критическом пути главной страницы.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = 'out/_next/static/chunks';
const all = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js')) all.push(p);
  }
};
walk(root);

const html = readFileSync('out/index.html', 'utf8');
// чанки, на которые ссылается сама страница (то есть критический путь)
const referenced = all.filter((p) => html.includes(p.replace('out', '')));

/** Опознавательные знаки three.js: они переживают минификацию. */
const THREE = ['WebGLRenderer', 'WebGLProgram', 'ShaderMaterial'];
/** Потолок асинхронного веса three.js, килобайты. */
const THREE_MAX_KB = 640;
/**
 * Первые числа огибающей. Имя переменной минификатор съест, числа — нет,
 * но ведущий ноль он срезает: в чанке лежит `.5902,.5782`, а не
 * `0.5902,0.5782`. Поэтому маркер берётся БЕЗ ведущего нуля.
 */
const WAVE = '.5902,.5782';

let bad = 0;
console.log('чанки первого экрана:');
for (const p of referenced) {
  const src = readFileSync(p, 'utf8');
  const hit = THREE.filter((m) => src.includes(m));
  if (src.includes(WAVE)) hit.push('огибающая звука');
  const kb = (statSync(p).size / 1024).toFixed(1);
  console.log(
    `  ${kb.padStart(7)} KB  ${p.replace(root + '/', '')}${hit.length ? '   !!! ' + hit.join(',') : ''}`,
  );
  if (hit.length) bad += 1;
}
const total = referenced.reduce((s, p) => s + statSync(p).size, 0);
console.log(`\nвсего в критическом пути: ${(total / 1024).toFixed(1)} KB`);

const withThree = all.filter((p) => THREE.some((m) => readFileSync(p, 'utf8').includes(m)));
const threeKb = withThree.reduce((s2, p) => s2 + statSync(p).size, 0) / 1024;
console.log(
  `three.js в асинхронных чанках: ${
    withThree.map((p) => `${p.split('/').pop()} (${(statSync(p).size / 1024).toFixed(0)} KB)`).join(', ') ||
    'нет ни в одном'
  }`,
);
console.log(`асинхронный вес three.js: ${threeKb.toFixed(1)} KB при потолке ${THREE_MAX_KB}`);
const withWave = all.filter((p) => readFileSync(p, 'utf8').includes(WAVE));
console.log(
  `огибающая звука в чанках: ${
    withWave.map((p) => `${p.split('/').pop()} (${(statSync(p).size / 1024).toFixed(0)} KB)`).join(', ') ||
    'нет ни в одном'
  }`,
);

if (withWave.length) {
  console.error(`\nПРОВАЛ: огибающая вернулась в сборку (${withWave.length} чанк(ов))`);
  process.exit(1);
}
if (!withThree.length) {
  console.error('\nПРОВАЛ: three.js не найден ни в одном чанке — объём карточек не соберётся');
  process.exit(1);
}
if (threeKb > THREE_MAX_KB) {
  console.error(`\nПРОВАЛ: three.js вырос до ${threeKb.toFixed(1)} KB при потолке ${THREE_MAX_KB}`);
  process.exit(1);
}
if (bad) {
  console.error('\nПРОВАЛ: тяжёлый модуль попал в первый экран');
  process.exit(1);
}
console.log('ОК: three.js только в асинхронных чанках, огибающей звука в сборке нет');

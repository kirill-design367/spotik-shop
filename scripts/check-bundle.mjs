/**
 * СТОРОЖ КРИТИЧЕСКОГО ПУТИ.
 *
 * ⚠️ THREE.JS СНОВА УБРАН ИЗ ПРОЕКТА — двадцать четвёртая итерация,
 * прямая постановка: карточки собраны на CSS, и библиотека не нужна
 * ни в первом экране, ни в асинхронном чанке. Значит и условие
 * возвращается прежнее, самое простое из возможных:
 *
 *   1. three.js не найден НИ В ОДНОМ чанке. Не «не в первом экране»,
 *      а нигде: зависимости в `package.json` больше нет, и вернуться
 *      она может только незаметно — через чужой пакет;
 *   2. огибающая звука не вернулась НИ В ОДИН чанк. Волну сняли
 *      в двадцать второй итерации; данные лежат в репозитории
 *      (`lib/waveform.data.ts`) и ждут, когда приём понадобится
 *      снова, — но в сборке их быть не должно;
 *   3. вес критического пути ПЕЧАТАЕТСЯ ЧИСЛОМ: втихую он расти
 *      не должен.
 *
 * Ловится это только так: глазами такое не видно, а цена ошибки —
 * лишние сотни килобайт в критическом пути главной страницы.
 *
 * ⚠️ ИСТОРИЯ ЭТОЙ ОСИ. Запрет уже был (двадцатая итерация), потом
 * снимался ради объёма (двадцать третья, потолок 640 КБ на
 * асинхронный вес), и вот снят возврат. Прежде чем разворачивать
 * в пятый раз — прочитать Р-59, Р-71 и Р-74 целиком.
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
console.log(
  `three.js в чанках: ${
    withThree.map((p) => `${p.split('/').pop()} (${(statSync(p).size / 1024).toFixed(0)} KB)`).join(', ') ||
    'нет ни в одном'
  }`,
);
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
if (withThree.length) {
  console.error(`\nПРОВАЛ: three.js вернулся в сборку (${withThree.length} чанк(ов))`);
  process.exit(1);
}
if (bad) {
  console.error('\nПРОВАЛ: тяжёлый модуль попал в первый экран');
  process.exit(1);
}
console.log('ОК: ни three.js, ни огибающей звука в сборке нет');

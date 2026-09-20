/**
 * СТОРОЖ КРИТИЧЕСКОГО ПУТИ.
 *
 * ⚠️ THREE.JS В ПРОЕКТЕ БОЛЬШЕ НЕТ ВОВСЕ (двадцатая итерация): объёмные
 * предметы в карточках заменены звуковой волной на Canvas 2D, и вместе
 * с объёмом ушли 538 КБ асинхронных чанков и вся цена их разбора.
 * Поэтому сторож теперь проверяет ДВЕ вещи:
 *
 *   1. три.js не вернулся НИ В ОДИН чанк — ни в первый экран, ни
 *      в асинхронные. Вернётся — это сознательное решение, и оно должно
 *      проходить через правку сторожа, а не втихую;
 *   2. огибающая звука (7 КБ чисел) НЕ ЛЕЖИТ В ПЕРВОМ ЭКРАНЕ: волна
 *      тянется динамическим импортом, и в критическом пути ей делать
 *      нечего.
 *
 * Ловится это только так: глазами такое не видно, а цена ошибки — лишние
 * сотни килобайт в критическом пути главной страницы.
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
const THREE = ['WebGLRenderer', 'PMREMGenerator', 'InstancedMesh'];
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
const withWave = all.filter((p) => readFileSync(p, 'utf8').includes(WAVE));
console.log(
  `огибающая в асинхронных чанках: ${
    withWave.map((p) => `${p.split('/').pop()} (${(statSync(p).size / 1024).toFixed(0)} KB)`).join(', ') ||
    'НЕ НАЙДЕНА'
  }`,
);

if (!withWave.length) {
  console.error('\nПРОВАЛ: огибающей нет ни в одном чанке — волна не соберётся');
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
console.log('ОК: three.js в сборке нет, огибающая только в асинхронном чанке');

/**
 * Проверка, что three.js не попал в бандл первого экрана.
 * Ловится только так: глазами такое не видно, а цена ошибки — весь WebGL
 * в критическом пути главной страницы.
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

const MARKERS = ['WebGLRenderer', 'PMREMGenerator', 'InstancedMesh'];
let bad = 0;
console.log('чанки первого экрана:');
for (const p of referenced) {
  const src = readFileSync(p, 'utf8');
  const hit = MARKERS.filter((m) => src.includes(m));
  const kb = (statSync(p).size / 1024).toFixed(1);
  console.log(`  ${kb.padStart(7)} KB  ${p.replace(root + '/', '')}${hit.length ? '   !!! ' + hit.join(',') : ''}`);
  if (hit.length) bad += 1;
}
const total = referenced.reduce((s, p) => s + statSync(p).size, 0);
console.log(`\nвсего в критическом пути: ${(total / 1024).toFixed(1)} KB`);

const async3d = all.filter((p) => !referenced.includes(p) && readFileSync(p, 'utf8').includes('WebGLRenderer'));
console.log(`three.js лежит в асинхронных чанках: ${async3d.map((p) => `${p.split('/').pop()} (${(statSync(p).size / 1024).toFixed(0)} KB)`).join(', ') || 'НЕ НАЙДЕН'}`);

if (bad) {
  console.error('\nПРОВАЛ: three.js попал в первый экран');
  process.exit(1);
}
console.log('ОК: в первом экране WebGL нет');

/**
 * Текст оферты: читается ИЗ `content/oferta.md`, а не лежит в разметке.
 *
 * ⚠️ ИСТОЧНИК ОДИН — САМ ФАЙЛ. Соблазн один раз перевести markdown
 * в JSX и забыть про него велик, но тогда у юридического текста
 * заводится вторая копия: правка в `content/oferta.md` не доедет
 * до страницы, и никто этого не заметит, пока не спросят в суде.
 *
 * ⚠️ ЧИТАЕТСЯ НА СБОРКЕ, А НЕ НА ЗАПРОС. Страница оферты статическая,
 * значит файл открывается один раз, когда Next её пререндерит.
 * На сервере он всё равно лежит рядом — выкладка кладёт `content/`
 * в релиз, — но на каждый заход туда никто не ходит.
 *
 * Разбор нарочно крошечный и знает ровно ту разметку, которая в файле
 * есть: заголовки, абзацы и списки. Тянуть в проект разборщик markdown
 * ради пяти правил — это чужая зависимость в критическом пути ради
 * одной страницы.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Kusok =
  | { vid: 'abzac'; tekst: string }
  | { vid: 'spisok'; punkty: string[] }
  | { vid: 'rekvizit'; pary: [string, string][] };

export type Razdel = { zagolovok: string; kuski: Kusok[] };

export type Oferta = { zagolovok: string; podzagolovok: string; razdely: Razdel[] };

/** `Ключ: значение` в блоке реквизитов. Ключ короткий и без точки. */
const REKVIZIT = /^([^:]{3,40}):\s+(.+)$/;

export function oferta(): Oferta {
  const syroy = readFileSync(join(process.cwd(), 'content', 'oferta.md'), 'utf8');
  const stroki = syroy.split('\n');

  let zagolovok = 'Публичная оферта';
  let podzagolovok = '';
  const razdely: Razdel[] = [];
  let tekushchiy: Razdel | null = null;
  let punkty: string[] = [];

  const zakrytSpisok = () => {
    if (punkty.length && tekushchiy) tekushchiy.kuski.push({ vid: 'spisok', punkty });
    punkty = [];
  };

  for (const syraya of stroki) {
    const s = syraya.trim();
    if (!s) {
      zakrytSpisok();
      continue;
    }
    if (s.startsWith('# ')) {
      zakrytSpisok();
      zagolovok = s.slice(2).trim();
      continue;
    }
    if (s.startsWith('## ')) {
      zakrytSpisok();
      tekushchiy = { zagolovok: s.slice(3).trim().replace(/:$/, ''), kuski: [] };
      razdely.push(tekushchiy);
      continue;
    }
    if (s.startsWith('- ')) {
      punkty.push(s.slice(2).trim());
      continue;
    }
    zakrytSpisok();
    if (!tekushchiy) {
      // Строка между заголовком документа и первым разделом.
      podzagolovok = podzagolovok ? `${podzagolovok} ${s}` : s;
      continue;
    }
    /* ⚠️ РЕКВИЗИТЫ ОПОЗНАЮТСЯ ТОЛЬКО В СВОЁМ РАЗДЕЛЕ. Правило
       «строка вида ключ-двоеточие-значение» само по себе поймало бы
       и «Договор заключается … выраженных в:», и любую другую фразу
       с двоеточием посередине. */
    const par = tekushchiy.zagolovok.startsWith('Реквизиты') ? REKVIZIT.exec(s) : null;
    if (par) {
      const posledniy = tekushchiy.kuski[tekushchiy.kuski.length - 1];
      if (posledniy && posledniy.vid === 'rekvizit') posledniy.pary.push([par[1].trim(), par[2].trim()]);
      else tekushchiy.kuski.push({ vid: 'rekvizit', pary: [[par[1].trim(), par[2].trim()]] });
      continue;
    }
    tekushchiy.kuski.push({ vid: 'abzac', tekst: s });
  }
  zakrytSpisok();

  return { zagolovok, podzagolovok, razdely };
}

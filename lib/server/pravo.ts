/**
 * ЮРИДИЧЕСКИЕ ТЕКСТЫ САЙТА: оферта, пользовательское соглашение,
 * политика конфиденциальности и согласие на обработку данных.
 *
 * ⚠️ ИСТОЧНИК ОДИН — САМ ФАЙЛ В `content/`. Соблазн один раз перевести
 * markdown в JSX и забыть про него велик, но тогда у юридического
 * текста заводится вторая копия: правка в `content/*.md` не доедет
 * до страницы, и никто этого не заметит, пока не спросят в суде.
 *
 * ⚠️ ЧИТАЕТСЯ НА СБОРКЕ, А НЕ НА ЗАПРОС. Страницы статические, значит
 * файл открывается один раз, когда Next их пререндерит. На сервере он
 * всё равно лежит рядом — выкладка кладёт `content/` в релиз, — но
 * на каждый заход туда никто не ходит.
 *
 * Разбор нарочно крошечный и знает ровно ту разметку, которая в файлах
 * есть: заголовок документа, разделы, абзацы и списки. Тянуть в проект
 * разборщик markdown ради четырёх страниц — это чужая зависимость
 * в критическом пути.
 *
 * ⚠️ ВСТУПЛЕНИЕ — ЭТО АБЗАЦЫ, А НЕ ОДНА СТРОКА. Прежний разбор
 * (он знал только оферту) склеивал всё, что стоит до первого раздела,
 * в один подзаголовок: у оферты там была одна строка. У политики их
 * шесть, а у согласия на обработку данных РАЗДЕЛОВ НЕТ ВОВСЕ —
 * весь документ живёт во вступлении. Поэтому вступление разбирается
 * теми же кусками, что и раздел.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Kusok =
  | { vid: 'abzac'; tekst: string }
  | { vid: 'spisok'; punkty: string[] }
  | { vid: 'rekvizit'; pary: [string, string][] };

export type Razdel = { zagolovok: string; kuski: Kusok[] };

export type Dokument = {
  zagolovok: string;
  /** Абзацы и списки до первого раздела. */
  vstuplenie: Kusok[];
  razdely: Razdel[];
};

/** `Ключ: значение` в блоке реквизитов. Ключ короткий и без точки. */
const REKVIZIT = /^([^:]{3,40}):\s+(.+)$/;

/** Что за документ, где лежит и как называется в шапке вкладки. */
export const PRAVO = {
  oferta: { fayl: 'oferta.md', vkladka: 'Публичная оферта' },
  soglashenie: { fayl: 'soglashenie.md', vkladka: 'Пользовательское соглашение' },
  politika: { fayl: 'politika.md', vkladka: 'Политика конфиденциальности' },
  soglasie: { fayl: 'soglasie.md', vkladka: 'Согласие на обработку персональных данных' },
} as const;

export type ImyaDokumenta = keyof typeof PRAVO;

export function dokument(imya: ImyaDokumenta): Dokument {
  const syroy = readFileSync(join(process.cwd(), 'content', PRAVO[imya].fayl), 'utf8');
  const stroki = syroy.split('\n');

  let zagolovok: string = PRAVO[imya].vkladka;
  const vstuplenie: Kusok[] = [];
  const razdely: Razdel[] = [];
  let tekushchiy: Razdel | null = null;
  let punkty: string[] = [];

  /** Куда складывать: в раздел, если он начался, иначе во вступление. */
  const kuda = () => (tekushchiy ? tekushchiy.kuski : vstuplenie);

  const zakrytSpisok = () => {
    if (punkty.length) kuda().push({ vid: 'spisok', punkty });
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
    /* ⚠️ РЕКВИЗИТЫ ОПОЗНАЮТСЯ ТОЛЬКО В СВОЁМ РАЗДЕЛЕ. Правило
       «строка вида ключ-двоеточие-значение» само по себе поймало бы
       и «Договор заключается … выраженных в:», и любую другую фразу
       с двоеточием посередине. */
    const par = tekushchiy?.zagolovok.startsWith('Реквизиты') ? REKVIZIT.exec(s) : null;
    if (par && tekushchiy) {
      const posledniy = tekushchiy.kuski[tekushchiy.kuski.length - 1];
      if (posledniy && posledniy.vid === 'rekvizit') posledniy.pary.push([par[1].trim(), par[2].trim()]);
      else tekushchiy.kuski.push({ vid: 'rekvizit', pary: [[par[1].trim(), par[2].trim()]] });
      continue;
    }
    kuda().push({ vid: 'abzac', tekst: s });
  }
  zakrytSpisok();

  return { zagolovok, vstuplenie, razdely };
}

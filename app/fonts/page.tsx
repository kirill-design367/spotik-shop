import type { Metadata } from 'next';
import Link from 'next/link';
import './fonts.css';
import FontAxisDemo from '@/components/fonts/FontAxisDemo';
import { candidateFontFaces, BASE_PATH } from '@/lib/fontface';

export const metadata: Metadata = {
  title: 'Шрифты — Spotik Shop',
  description: 'Кандидаты вариативных шрифтов для вордмарка SPOTIK и результат проверки cmap.',
  robots: { index: false, follow: false },
};

type Cand = {
  id: string;
  family: string;
  name: string;
  author: string;
  axes: string;
  cmap: string;
  cyr: string;
  why: string;
  verdict: 'рекомендую' | 'запасной' | 'не подходит';
};

const CANDIDATES: Cand[] = [
  {
    id: 'rf',
    family: 'Cand Roboto Flex',
    name: 'Roboto Flex',
    author: 'Google · Font Bureau · David Berlow',
    axes:
      'wght 100–1000 · wdth 25–151 · opsz 8–144 · GRAD −200…150 · slnt −10…0 · ' +
      'XOPQ 27–175 · YOPQ 25–135 · XTRA 323–603 · YTUC 528–760 · YTLC 416–570 · YTAS · YTDE · YTFI',
    cmap: '826 кодпоинтов в неурезанном бинарнике · А–я 64/64 · Ё ё есть · расширенная 15/16 · ₽ есть',
    cyr: 'полная',
    why:
      'Единственный кандидат, который вообще способен на описанный приём. Сжатие в референсе ' +
      'меняет высоту прописных в 1.7 раза, горизонтальные штрихи в 2.9, а вертикальные не трогает — ' +
      'значит, нужны РАЗДЕЛЬНЫЕ оси для горизонталей и вертикалей. У Roboto Flex это параметрические ' +
      'оси Font Bureau: YTUC отвечает за высоту прописных, YOPQ за толщину горизонтальных штрихов, ' +
      'XOPQ за вертикальные, wdth держит слово в ширину экрана. Ни один другой вариативный гротеск ' +
      'с живой кириллицей такого набора не даёт: у всех остальных одна ось wght, которая утолщает ' +
      'обе стороны разом, и отношение штрихов при сжатии сохранилось бы — то есть приём выродился ' +
      'бы в scaleY. Формы нейтральные, Ж Ф Щ без вычурности, на кегле 900 px держит плотность.',
    verdict: 'рекомендую',
  },
  {
    id: 'wix',
    family: 'Cand Wix',
    name: 'Wix Madefor Display',
    author: 'Wix · Kobi Franco, Yaron Mishayev',
    axes: 'wght 400–800',
    cmap: 'кириллический сабсет присутствует · А–я 64/64 · Ё ё есть · расширенная 16/16',
    cyr: 'полная',
    why:
      'Самый плотный и уверенный дисплейный гротеск из проверенных: узкие апертуры, короткие ' +
      'выносные, крупная строчная — ровно то, что нужно очень крупному кеглю. Кириллица спокойная, ' +
      'Ж симметричная и не разъезжается, Щ с коротким хвостом. Но ось ровно одна, wght, а диапазон ' +
      'у неё всего 400–800. Высоту прописных пришлось бы менять кеглем, а кегль тянет за собой ' +
      'ширину слова — обрезка краями поехала бы. Годится как голос текста, не как носитель приёма.',
    verdict: 'запасной',
  },
  {
    id: 'golos',
    family: 'Cand Golos',
    name: 'Golos Text',
    author: 'Paratype · Владимир Ефимов, Александра Королькова',
    axes: 'wght 400–900',
    cmap: 'кириллический сабсет присутствует · А–я 64/64 · Ё ё есть',
    cyr: 'полная, родная',
    why:
      'Единственный в подборке, кто рисовался ОТ кириллицы, а не адаптировал её после латиницы. ' +
      'Отсюда ровный ритм в русском абзаце, широкая строчная и предельно нейтральные Ж Ф Щ — без ' +
      'каллиграфических хвостов и без попытки сделать их «интереснее». Для вордмарка не подходит по ' +
      'той же причине, что и Wix: одна ось. Но именно поэтому он взят голосом сайта — весь русский ' +
      'текст набран им, и это заметно лучше, чем адаптированная кириллица Roboto Flex.',
    verdict: 'запасной',
  },
  {
    id: 'unb',
    family: 'Cand Unbounded',
    name: 'Unbounded',
    author: 'Google · Nadyr Rakhimov',
    axes: 'wght 200–900',
    cmap: 'кириллический сабсет присутствует · А–я 64/64 · Ё ё есть · расширенная 16/16',
    cyr: 'полная',
    why:
      'Широкий геометрический дисплей, на крупном кегле выглядит эффектно и сам просится в вордмарк. ' +
      'Отклонён сознательно: формы характерные — круглая О, высокая перекладина у Т, узнаваемый ' +
      'рисунок К. Такой знак начинает спорить с приёмом вместо того, чтобы его нести, а бриф просит ' +
      'нейтральный гротеск. Плюс та же единственная ось wght.',
    verdict: 'не подходит',
  },
];

const ARCHIVO_NOTE =
  'Archivo проверялся и отброшен на этапе аудита: у него есть и wght, и wdth — то есть теоретически ' +
  'он подходил бы, — но кириллического набора в поставке нет вовсе. Проверка по cmap показала только ' +
  'латинский и латинско-расширенный сабсеты. Инструмент без кириллицы для русского сайта не годится.';

export default function FontsPage() {
  return (
    <main className="fp" id="main" tabIndex={-1}>
      <style dangerouslySetInnerHTML={{ __html: candidateFontFaces(BASE_PATH) }} />
      <div className="shell">
        <header className="fp__head">
          <p className="eyebrow">Spotik Shop · служебная страница</p>
          <h1 className="fp__h1">Шрифты</h1>
          <p className="lead fp__lead">
            Четыре вариативных гротеска с живой кириллицей. Слово SPOTIK набрано каждым при финальном
            кегле, ниже показан ход осей от раскрытого состояния до сжатого. Рекомендация — Roboto Flex;
            до вашего решения на сайте стоит он.
          </p>
        </header>

        {CANDIDATES.map((c) => (
          <section key={c.id} className="fp__cand">
            <div className="fp__bar">
              <p className="section__num">
                <b>{c.name}</b>
                <span className="eyebrow">{c.author}</span>
              </p>
              <span className={`fp__verdict fp__verdict--${c.verdict === 'рекомендую' ? 'yes' : c.verdict === 'запасной' ? 'mid' : 'no'}`}>
                {c.verdict}
              </span>
            </div>

            {/* Слово при финальном кегле — обрезано краями, как на сайте */}
            <div className="fp__word" style={{ fontFamily: `'${c.family}', sans-serif` }}>
              SPOTIK
            </div>

            <div className="fp__specs">
              <dl>
                <dt>Оси</dt>
                <dd>{c.axes}</dd>
                <dt>Проверка cmap в бинарнике</dt>
                <dd>{c.cmap}</dd>
                <dt>Кириллица</dt>
                <dd>{c.cyr}</dd>
              </dl>
              <p className="fp__why">{c.why}</p>
            </div>

            {/* Контрольная строка кириллицей: Ж Ф Щ в деле */}
            <p className="fp__pangram" style={{ fontFamily: `'${c.family}', sans-serif` }}>
              Съешь же ещё этих мягких французских булок, да выпей чаю. ЖФЩЪЫЬЭЮЯ 1&nbsp;490&nbsp;₽
            </p>
          </section>
        ))}

        <section className="fp__cand">
          <div className="fp__bar">
            <p className="section__num">
              <b>Archivo</b>
              <span className="eyebrow">Omnibus-Type</span>
            </p>
            <span className="fp__verdict fp__verdict--no">отброшен</span>
          </div>
          <p className="fp__why" style={{ maxWidth: '68ch' }}>{ARCHIVO_NOTE}</p>
        </section>

        <FontAxisDemo />

        <footer className="fp__foot">
          <p className="body-text">
            Проверка cmap выполняется скриптом <code>scripts/font-audit.py</code>: он читает таблицы
            cmap и fvar напрямую из бинарника, без доверия к описанию на сайте шрифта. Сабсеты
            собираются скриптом <code>scripts/build-fonts.py</code>.
          </p>
          <Link className="btn btn--ghost" href="/">
            К сайту
          </Link>
        </footer>
      </div>
    </main>
  );
}

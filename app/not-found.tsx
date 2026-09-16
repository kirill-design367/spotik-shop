import Link from 'next/link';

/**
 * Боевая 404. Без этого файла Next отдаёт свою встроенную страницу —
 * на латинице и без выхода на сайт.
 */
export default function NotFound() {
  return (
    <main className="nf" id="main" tabIndex={-1}>
      <div className="shell">
        <p className="eyebrow">Ошибка 404</p>
        <h1 className="h-section" style={{ marginTop: 16 }}>
          Такой страницы нет
        </h1>
        <p className="lead" style={{ marginTop: 20, maxWidth: '38ch' }}>
          Адрес набран с ошибкой или страницу убрали. С главной можно дойти
          до тарифов, порядка оформления и ответов на вопросы.
        </p>
        <Link href="/" className="btn" style={{ marginTop: 32 }}>
          На главную
        </Link>
      </div>
    </main>
  );
}

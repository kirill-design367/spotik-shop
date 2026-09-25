import { dokument, type ImyaDokumenta, type Kusok } from '@/lib/server/pravo';

/**
 * Страница юридического документа. Одна на все четыре: оферту,
 * пользовательское соглашение, политику и согласие. Текст приходит
 * из `content/*.md` и в разметке не дублируется (см. `lib/server/pravo`).
 */
export function Pravo({ imya }: { imya: ImyaDokumenta }) {
  const d = dokument(imya);
  const kusok = (k: Kusok, i: number) => {
    if (k.vid === 'spisok') {
      return (
        <ul key={i}>
          {k.punkty.map((p, j) => (
            <li key={j}>{p}</li>
          ))}
        </ul>
      );
    }
    if (k.vid === 'rekvizit') {
      return (
        <dl className="legal__req" key={i}>
          {k.pary.map(([klyuch, znachenie]) => (
            <div key={klyuch}>
              <dt>{klyuch}</dt>
              <dd>{znachenie}</dd>
            </div>
          ))}
        </dl>
      );
    }
    return <p key={i}>{k.tekst}</p>;
  };

  return (
    <main id="main" className="page legal" tabIndex={-1}>
      <a className="page__back" href="/">← На главную</a>
      <h1 className="page__h">{d.zagolovok}</h1>
      {d.vstuplenie.length ? <section>{d.vstuplenie.map(kusok)}</section> : null}
      {d.razdely.map((r) => (
        <section key={r.zagolovok}>
          <h2>{r.zagolovok}</h2>
          {r.kuski.map(kusok)}
        </section>
      ))}
    </main>
  );
}

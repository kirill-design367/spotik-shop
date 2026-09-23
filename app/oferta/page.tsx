import '../shop.css';
import type { Metadata } from 'next';
import { oferta } from '@/lib/server/oferta';

export const metadata: Metadata = { title: 'Публичная оферта — Spotik Shop' };

/**
 * ⚠️ СТРАНИЦА СТАТИЧЕСКАЯ, И ЭТО НЕ УКРАШЕНИЕ. Файл оферты читается
 * с диска, и делать это на каждый заход незачем: текст меняется
 * выкладкой, а не в рантайме. Ни `cookies()`, ни `headers()` здесь
 * быть не должно — первое же из них перевело бы страницу
 * на посчитанный ответ вместе с чтением файла.
 */
export const dynamic = 'force-static';

export default function Oferta() {
  const d = oferta();
  return (
    <main id="main" className="page legal" tabIndex={-1}>
      <a className="page__back" href="/">← На главную</a>
      <h1 className="page__h">{d.zagolovok}</h1>
      {d.podzagolovok ? <p className="page__lead">{d.podzagolovok}</p> : null}

      {d.razdely.map((r) => (
        <section key={r.zagolovok}>
          <h2>{r.zagolovok}</h2>
          {r.kuski.map((k, i) => {
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
          })}
        </section>
      ))}
    </main>
  );
}

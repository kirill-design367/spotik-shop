/**
 * Галочка согласия. ОДНА на оформление заказа и на активацию
 * сертификата: текст юридический, и вторая его копия разошлась бы
 * с первой на ближайшей правке — ровно так же, как разошлись бы две
 * копии самих документов (см. `lib/server/pravo`).
 *
 * ⚠️ КАЖДОЕ НАЗВАНИЕ — ССЫЛКА НА СВОЙ ДОКУМЕНТ. Человек соглашается
 * с четырьмя разными текстами, и одна ссылка на оферту за все четыре
 * не годится: до остальных трёх он от неё не доберётся.
 */
export function Soglasie({ beda }: { beda?: string | null }) {
  return (
    <>
    <label className="check">
      <input type="checkbox" name="consent" />
      <span>
        Принимаю условия{' '}
        <a href="/oferta/" target="_blank" rel="noreferrer">публичной оферты</a>{' '}
        и{' '}
        <a href="/soglashenie/" target="_blank" rel="noreferrer">
          пользовательского соглашения
        </a>
        , даю{' '}
        <a href="/soglasie/" target="_blank" rel="noreferrer">
          согласие на обработку персональных данных
        </a>{' '}
        в соответствии с{' '}
        <a href="/politika/" target="_blank" rel="noreferrer">
          политикой конфиденциальности
        </a>
        .
      </span>
    </label>
    {/* ⚠️ ОТКАЗ ПОКАЗЫВАЕТ САЙТ, А НЕ БРАУЗЕР. У форм снят
        `required`-обход: подсказка браузера приходит системным
        шрифтом и на языке системы. */}
    {beda ? <p className="field__beda" style={{ marginTop: -8, marginBottom: 14 }}>{beda}</p> : null}
    </>
  );
}

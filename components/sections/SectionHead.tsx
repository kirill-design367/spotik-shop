/**
 * Шапка блока.
 *
 * Сознательно НЕ «крупный заголовок слева, поясняющий абзац справа» —
 * это самая узнаваемая шаблонная конструкция лендинга. Здесь другая схема:
 * тонкая линия с номером трека и короткой цифровой сводкой, под ней
 * заголовок во всю ширину, и только потом подводка в своей мере строки.
 * Страница читается как дорожка, поэтому блоки пронумерованы как треки.
 */
export default function SectionHead({
  num,
  kicker,
  title,
  lead,
  meta,
}: {
  num: string;
  kicker: string;
  title: string;
  lead?: string;
  /** Короткая цифровая сводка справа на линии. Не абзац. */
  meta?: string;
}) {
  return (
    <header className="shead">
      <div className="shead__bar">
        <p className="section__num">
          <b className="tnum">{num}</b>
          <span className="eyebrow">{kicker}</span>
        </p>
        {meta ? <p className="shead__meta tnum">{meta}</p> : null}
      </div>
      <h2 className="h-section">{title}</h2>
      {lead ? <p className="lead shead__lead">{lead}</p> : null}
    </header>
  );
}

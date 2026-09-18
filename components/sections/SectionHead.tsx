/**
 * Шапка блока.
 *
 * Сознательно НЕ «крупный заголовок слева, поясняющий абзац справа» —
 * это самая узнаваемая шаблонная конструкция лендинга. Здесь другая схема:
 * тонкая линия с номером трека и короткой цифровой сводкой, под ней
 * заголовок и подводка. Страница читается как дорожка, поэтому блоки
 * пронумерованы как треки.
 *
 * ТИХИЙ ВАРИАНТ (quiet) появился в двенадцатой итерации. В блоках 2–5
 * самый крупный набор — это тело блока: ряд тарифа, пункт, тезис. Второй
 * крупный набор в той же секции дерётся с первым, поэтому там заголовок
 * уходит в размер подзаголовка и весь вес остаётся у тела.
 */
export default function SectionHead({
  num,
  kicker,
  title,
  lead,
  meta,
  quiet = false,
  center = false,
}: {
  num: string;
  kicker: string;
  title: string;
  lead?: string;
  /** Короткая цифровая сводка справа на линии. Не абзац. */
  meta?: string;
  /** Заголовок в размер подзаголовка: вес блока держит его тело. */
  quiet?: boolean;
  /** Выключка по центру — для блоков, у которых тело центровано. */
  center?: boolean;
}) {
  return (
    <header className={`shead${quiet ? ' shead--quiet' : ''}${center ? ' shead--center' : ''}`}>
      <div className="shead__bar">
        <p className="section__num">
          <b className="tnum">{num}</b>
          <span className="eyebrow">{kicker}</span>
        </p>
        {meta ? <p className="shead__meta tnum">{meta}</p> : null}
      </div>
      <h2 className={quiet ? 'shead__title' : 'h-section shead__title'}>{title}</h2>
      {lead ? <p className="lead shead__lead">{lead}</p> : null}
    </header>
  );
}

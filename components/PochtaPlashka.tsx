import { POCHTA_TEKST } from '@/lib/plans';

/**
 * ТАБЛИЧКА ПРО ПОЧТУ (пятьдесят первая итерация, Р-165).
 *
 * Стоит на главной под кнопкой «Оформить» и в форме входа по коду —
 * то есть там, где человек собирается вводить почту и где он её вводит.
 * Вид — тот же, что у плашки про рабочее время и про египетский VPN:
 * зелёная кайма, подложка из зелёного подмешиванием, белый текст
 * и свой знак. Седьмого цвета нет.
 *
 * ⚠️ ОДИН КОМПОНЕНТ НА ВСЕ МЕСТА, И СНИМАЕТСЯ ОН ОДНОЙ СТРОКОЙ:
 * пустой `POCHTA_TEKST` — компонент не рисует ничего.
 *
 * ⚠️ ЭЛЕМЕНТ — `aside`, а не `div`: на оформлении очередь появления
 * панелей считает дивы (`.ozhivayet > .panel:nth-of-type(n)`), и лишний
 * див сдвинул бы её (то же, что у египетской плашки, Р-158).
 */
export default function PochtaPlashka() {
  if (!POCHTA_TEKST) return null;
  return (
    <aside className="plashka-pochta" role="note">
      {/* Знак рисуем сами: чужих иконочных шрифтов в проекте нет
          ни одного (закон 15). Конверт — прямоугольник и клапан. */}
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
        <rect x="3" y="5.5" width="18" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M4 7.5l8 6 8-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p>{POCHTA_TEKST}</p>
    </aside>
  );
}

import { POCHTA_SSYLKA, POCHTA_TEKST } from '@/lib/plans';
import { sAdresami } from '@/components/Bukvalno';

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
 * ⚠️ ССЫЛКА — НА ОДНОМ СЛОВЕ, И СЛОВО ИЩЕТСЯ В ТЕКСТЕ (`POCHTA_SSYLKA`):
 * текст заказчика лежит одной строкой, а не тремя обрывками. Ведёт она
 * на Telegram поддержки — чужой сайт, поэтому в новой вкладке и без
 * `opener`. Это аккаунт поддержки, а не бот для покупателя: бота
 * в схеме по-прежнему нет.
 *
 * ⚠️ ЭЛЕМЕНТ — `aside`, а не `div`: на оформлении очередь появления
 * панелей считает дивы (`.ozhivayet > .panel:nth-of-type(n)`), и лишний
 * див сдвинул бы её (то же, что у египетской плашки, Р-158).
 */
export default function PochtaPlashka() {
  if (!POCHTA_TEKST) return null;
  const i = POCHTA_TEKST.indexOf(POCHTA_SSYLKA.slovo);
  return (
    <aside className="plashka-pochta" role="note">
      {/* Знак рисуем сами: чужих иконочных шрифтов в проекте нет
          ни одного (закон 15). Конверт — прямоугольник и клапан. */}
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
        <rect x="3" y="5.5" width="18" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M4 7.5l8 6 8-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {i < 0 ? (
        <p>{sAdresami(POCHTA_TEKST)}</p>
      ) : (
        <p>
          {sAdresami(POCHTA_TEKST.slice(0, i))}
          <a href={POCHTA_SSYLKA.adres} target="_blank" rel="noopener noreferrer">
            {POCHTA_SSYLKA.slovo}
          </a>
          {sAdresami(POCHTA_TEKST.slice(i + POCHTA_SSYLKA.slovo.length))}
        </p>
      )}
    </aside>
  );
}

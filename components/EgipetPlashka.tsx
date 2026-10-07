import { EGIPET_TEKST } from '@/lib/plans';

/**
 * ПЛАШКА ПРО ЕГИПЕТСКИЙ VPN (сорок девятая итерация).
 *
 * Постановка: «Для пар „тариф × срок", где аккаунт с привязкой
 * к Египту, показывай плашку… Визуально — как плашка про рабочее
 * время… При смене тарифа или срока плашка плавно появляется
 * и исчезает».
 *
 * ⚠️ ПЛАШКА ВСЕГДА В РАЗМЕТКЕ, А ПОКАЗ РЕШАЕТ ПРИЗНАК. Снятый узел
 * не анимируется ничем — то же правило, что у скрытой карты тарифа
 * (закон 50). Высоту ведёт `grid-template-rows: 0fr → 1fr`: читать
 * её из JS не нужно вовсе (тот же приём, что у схлопывания карточки
 * заказа, Р-126).
 *
 * ⚠️ ОДИН КОМПОНЕНТ НА ГЛАВНУЮ И НА ОФОРМЛЕНИЕ. Две копии одной
 * плашки разошлись бы на первой же правке текста или вида.
 *
 * ⚠️ ЭЛЕМЕНТ — `aside`, А НЕ `div`, и это не семантика ради семантики.
 * На оформлении задержки появления панелей считает
 * `.ozhivayet > .panel:nth-of-type(n)`, а он считает ДИВЫ: лишний
 * див сдвинул бы очередь появления у всех панелей ниже.
 */
export default function EgipetPlashka({ pokaz }: { pokaz: boolean }) {
  return (
    <aside className="egipet" data-on={pokaz ? '' : undefined} aria-hidden={pokaz ? undefined : true}>
      <div className="egipet__nutro">
        <p className="plashka-egipet">
          {/* Знак рисуем сами: чужих иконочных шрифтов в проекте нет
              ни одного (закон 15). Глобус — меридиан, экватор и две
              параллели. */}
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <ellipse cx="12" cy="12" rx="4" ry="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path
              d="M3 12h18M4.6 7.5h14.8M4.6 16.5h14.8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
          <span>{EGIPET_TEKST}</span>
        </p>
      </div>
    </aside>
  );
}

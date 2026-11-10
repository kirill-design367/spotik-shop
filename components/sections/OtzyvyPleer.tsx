'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import Bukvalno from '@/components/Bukvalno';
import { onReducedMotionChange, prefersReducedMotion } from '@/lib/motion';
import { finePointer, scroller, scrollToId } from '@/lib/scroll';

/** Отзыв, готовый к показу: всё посчитано на сервере. */
export type TrekOtzyva = {
  id: number;
  imya: string;
  tekst: string;
  /** Первые слова — «название трека» (`nazvanieOtzyva`, одна функция). */
  nazvanie: string;
  /** `ДД.ММ.ГГГГ` и `ГГГГ-ММ-ДД`. */
  data: string;
  dataIso: string;
  /** Полное русское имя тарифа из каталога; нет в каталоге — `null`. */
  tarif: string | null;
  /** Буква для типографской «обложки». */
  inicial: string;
};

/**
 * Темп переключения. Постановка: «раз в 7–8 секунд». Число продублировано
 * в CSS (`@keyframes pl-hod`, `.pl__polosa`) — разойдутся, и полоска
 * дойдёт до конца не тогда, когда сменится отзыв.
 */
const TEMP_S = 7.5;
/** Имя кейфреймов полоски — по нему отличается её конец от чужих. */
const KADRY_HODA = 'pl-hod';
/** Сколько держится пауза после касания. */
const PAUZA_KASANIYA_MS = 10_000;
/** Порог свайпа и порог «это тап, а не жест». */
const SVAYP_PX = 40;
const TAP_PX = 10;
/** Длиннее этого — текст на ступень мельче (поправка после рецензии). */
const DLINNY = 220;

const dvaZnaka = (n: number) => String(n).padStart(2, '0');

/**
 * ПЛЕЕР ОТЗЫВОВ.
 *
 * ── ЧТО ИГРАЕТ И ЧТО СТАВИТ НА ПАУЗУ ────────────────────────────────────
 * Переключение само раз в 7.5 с, и ведёт его ПОЛОСКА ПРОГРЕССА: это
 * CSS-анимация `transform: scaleX` (композитная), и её `animationend`
 * переключает отзыв. Пауза — `animation-play-state: paused`: здесь
 * продолжение с того же места и нужно, это тот же отзыв. Смена отзыва
 * перезапускает полоску ключом.
 *
 * Играет, только когда ничто не держит паузу. Держат её:
 *   • ЯВНАЯ ПАУЗА кнопкой — до кнопки; уход указателя её не снимает;
 *   • НАВЕДЕНИЕ точного указателя на блок — пока он над блоком;
 *   • ФОКУС КЛАВИАТУРЫ внутри блока (WCAG 2.2.2 и шаблон карусели APG):
 *     человек с клавиатуры иначе не остановил бы переключение вовсе;
 *   • КАСАНИЕ — тап, свайп или выбор трека; держится десять секунд
 *     без касаний или до ухода блока с экрана;
 *   • блок вне экрана или вкладка скрыта (закон 11): полоска
 *     и эквалайзер стоят.
 * «Играть» на кнопке снимает ВСЕ временные паузы разом: человек явно
 * попросил играть, и наведение, под которым он нажал, этого не отменяет.
 *
 * ⚠️ ВЕРТИКАЛЬНАЯ ПРОКРУТКА ПАЛЬЦЕМ ПАУЗУ НЕ СТАВИТ (поправка после
 * рецензии). «Касание» — это тап: `pointerup` без `pointercancel`
 * и со сдвигом меньше десяти пикселей. Прокрутку браузер забирает себе
 * и шлёт `pointercancel` — иначе каждый проход мимо блока на телефоне
 * то ставил бы паузу, то снимал её.
 *
 * ── «УМЕНЬШИТЬ ДВИЖЕНИЕ» ────────────────────────────────────────────────
 * Автопереключения нет, эквалайзер стоит, у полоски НЕТ свойства
 * `animation` вовсе: общее правило `globals.css` под этой настройкой
 * ставит анимациям 0.01 мс, и полоска с анимацией закончилась бы
 * мгновенно — плейлист прогнал бы все отзывы за долю секунды. Поэтому
 * и обработчик реагирует только на СВОЮ полоску, своё имя кейфреймов
 * и при живой проверке настройки. Включили настройку при открытой
 * странице — подписка останавливает всё без перезагрузки. «Назад»,
 * «вперёд» и выбор трека работают.
 *
 * ── ДЛИННЫЙ ТЕКСТ ЦЕЛИКОМ ───────────────────────────────────────────────
 * Все карточки «Сейчас играет» лежат в ОДНОЙ ячейке сетки, видна одна,
 * и высота ячейки — по самой высокой: раскладка не прыгает
 * при переключении (тот же приём, что Р-58), а обрезки текста нет
 * никакой. Неактивные — `visibility: hidden` и `inert`: диктор и Tab
 * их не видят. Длинное за 7.5 с не прочесть, и ровно поэтому кнопка
 * паузы обязательна, а наведение и касание её ставят сами.
 *
 * ── ДИКТОР ──────────────────────────────────────────────────────────────
 * Пока переключение идёт само, `aria-live` выключен — диктор не начинает
 * читать отзыв каждые семь секунд; на паузе и при ручном переключении
 * — `polite`.
 *
 * ⚠️ ПЕРЕВОДЧИК: имя и дата — данные, под `Bukvalno` (закон 54); текст
 * отзыва и его «название» переводятся — это текст для чтения, а не
 * данные для копирования (поправка после рецензии).
 */
export default function OtzyvyPleer({ treki }: { treki: TrekOtzyva[] }) {
  const n = treki.length;
  const koren = useRef<HTMLDivElement>(null);
  const ekran = useRef<HTMLDivElement>(null);
  const [rezhim, setRezhim] = useState(false);
  const [tek, setTek] = useState(0);
  const [kuda, setKuda] = useState<'vpered' | 'nazad'>('vpered');
  const [yavnaya, setYavnaya] = useState(false);
  const [navedenie, setNavedenie] = useState(false);
  const [fokus, setFokus] = useState(false);
  const [kasanie, setKasanie] = useState(false);
  const [vidno, setVidno] = useState(false);
  const [vkladka, setVkladka] = useState(true);
  const [reduce, setReduce] = useState(false);
  const tajmer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const kasanieNachalo = useRef<{ x: number; y: number; id: number } | null>(null);

  const igraet = rezhim && !reduce && vidno && vkladka && !yavnaya && !navedenie && !fokus && !kasanie;

  useEffect(() => {
    setRezhim(true);
    setReduce(prefersReducedMotion());
    const offReduce = onReducedMotionChange(setReduce);
    const vkl = () => setVkladka(!document.hidden);
    vkl();
    document.addEventListener('visibilitychange', vkl);
    /* Закон 11: ушёл блок с экрана — всё стоит. Пауза касания при этом
       снимается: человек уже не смотрит на этот отзыв. */
    let io: IntersectionObserver | null = null;
    const el = koren.current;
    if (el && 'IntersectionObserver' in window) {
      io = new IntersectionObserver(
        (zapisi) => {
          for (const z of zapisi) {
            setVidno(z.isIntersecting);
            if (!z.isIntersecting) setKasanie(false);
          }
        },
        { threshold: 0.15 },
      );
      io.observe(el);
    } else {
      setVidno(true);
    }
    return () => {
      offReduce();
      document.removeEventListener('visibilitychange', vkl);
      io?.disconnect();
      if (tajmer.current) clearTimeout(tajmer.current);
    };
  }, []);

  const pauzaKasaniya = useCallback(() => {
    setKasanie(true);
    if (tajmer.current) clearTimeout(tajmer.current);
    tajmer.current = setTimeout(() => setKasanie(false), PAUZA_KASANIYA_MS);
  }, []);

  const pereyti = useCallback(
    (sdvig: number, napr: 'vpered' | 'nazad') => {
      setKuda(napr);
      setTek((t) => (((t + sdvig) % n) + n) % n);
    },
    [n],
  );

  const vybrat = (i: number) => {
    if (i === tek) return;
    setKuda(i > tek ? 'vpered' : 'nazad');
    setTek(i);
    /* На касаниях очередь стоит ПОД экраном «Сейчас играет», и трек
       внизу длинной очереди менял бы то, чего не видно (поправка после
       рецензии): экран уехал вверх — плавно возвращаемся к нему.
       Через `scrollToId`, а не `scrollIntoView` (Р-37). */
    if (!finePointer()) {
      const sc = scroller();
      const e = ekran.current;
      if (sc && e) {
        const verh = e.getBoundingClientRect().top - sc.getBoundingClientRect().top;
        if (verh < 0) scrollToId('pl-yakor');
      }
    }
  };

  const knopkaPauzy = () => {
    if (yavnaya) {
      setYavnaya(false);
      setNavedenie(false);
      setFokus(false);
      setKasanie(false);
      if (tajmer.current) clearTimeout(tajmer.current);
    } else {
      setYavnaya(true);
    }
  };

  const konecHoda = (e: React.AnimationEvent<HTMLSpanElement>) => {
    if (e.target !== e.currentTarget || e.animationName !== KADRY_HODA || prefersReducedMotion()) return;
    pereyti(1, 'vpered');
  };

  const kasanieVniz = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'touch') return;
    kasanieNachalo.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const kasanieVverh = (e: RPointerEvent<HTMLDivElement>) => {
    const s = kasanieNachalo.current;
    kasanieNachalo.current = null;
    if (e.pointerType !== 'touch' || !s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    const naEkrane = ekran.current?.contains(e.target as Node) ?? false;
    if (naEkrane && Math.abs(dx) >= SVAYP_PX && Math.abs(dx) > Math.abs(dy) * 1.2) {
      pereyti(dx < 0 ? 1 : -1, dx < 0 ? 'vpered' : 'nazad');
      pauzaKasaniya();
      return;
    }
    if (Math.hypot(dx, dy) < TAP_PX) {
      /* Тап по самой кнопке паузы решает кнопка: иначе «Играть» тут же
         ставило бы паузу касания на десять секунд. */
      if ((e.target as Element).closest?.('[data-pl-pauza]')) return;
      pauzaKasaniya();
    }
  };

  const pauzaVidna = rezhim && !reduce && !igraet;

  return (
    <div
      ref={koren}
      id="pl-koren"
      className="pl rv"
      role="region"
      aria-roledescription="плейлист отзывов"
      aria-label="Отзывы"
      data-pl={rezhim ? '' : undefined}
      data-igraet={igraet ? '' : undefined}
      data-kuda={kuda}
      /* ⚠️ `data-pl` ставит ещё и строчка в разборе HTML (см. `Otzyvy.tsx`),
         то есть до гидратации атрибут уже на месте, а в разметке сервера
         его нет. Это ожидаемое расхождение, а не ошибка. */
      suppressHydrationWarning
      onPointerEnter={(e) => {
        if (e.pointerType !== 'touch') setNavedenie(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== 'touch') setNavedenie(false);
      }}
      onPointerDown={kasanieVniz}
      onPointerUp={kasanieVverh}
      onPointerCancel={() => {
        kasanieNachalo.current = null;
      }}
      onFocus={(e) => {
        /* Пауза — от фокуса КЛАВИАТУРЫ: щелчок мышью по кнопке тоже
           ставит фокус, но паузу тут держит наведение. */
        let vidimy = true;
        try {
          vidimy = (e.target as Element).matches(':focus-visible');
        } catch {
          /* старый браузер: считаем, что фокус с клавиатуры */
        }
        if (vidimy) setFokus(true);
      }}
      onBlur={(e) => {
        if (!koren.current?.contains(e.relatedTarget as Node | null)) setFokus(false);
      }}
    >
      <div className="pl__ekran" ref={ekran}>
        <span id="pl-yakor" className="pl__yakor" aria-hidden="true" />
        <div className="pl__verh">
          <span className="pl__metka">
            <span className="pl__eq" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
            {pauzaVidna ? 'На паузе' : 'Сейчас играет'}
          </span>
          <span className="pl__schet tnum" aria-hidden="true">
            {dvaZnaka(tek + 1)} / {dvaZnaka(n)}
          </span>
        </div>

        <div className="pl__stopka" aria-live={igraet ? 'off' : 'polite'}>
          {treki.map((o, i) => {
            const on = i === tek;
            const skryt = rezhim && !on;
            return (
              <article
                key={o.id}
                className="pl__karta"
                data-on={on ? '' : undefined}
                data-dlinny={Array.from(o.tekst).length > DLINNY ? '' : undefined}
                role="group"
                aria-roledescription="отзыв"
                aria-label={`${i + 1} из ${n}`}
                inert={skryt || undefined}
                aria-hidden={skryt || undefined}
              >
                <blockquote className="pl__tekst">
                  <p>{o.tekst}</p>
                </blockquote>
                <footer className="pl__kto">
                  <span className="pl__oblozhka" aria-hidden="true" translate="no">
                    {o.inicial}
                  </span>
                  <span className="pl__kto-t">
                    <span className="pl__imya">
                      <Bukvalno>{o.imya}</Bukvalno>
                    </span>
                    <span className="pl__meta">
                      {o.tarif ? (
                        <>
                          <span>{o.tarif}</span>
                          <span aria-hidden="true"> · </span>
                        </>
                      ) : null}
                      <time dateTime={o.dataIso}>
                        <Bukvalno className="tnum">{o.data}</Bukvalno>
                      </time>
                    </span>
                  </span>
                </footer>
              </article>
            );
          })}
        </div>

        <div
          className="pl__progress"
          style={{ ['--pl-poz' as string]: String((tek + 1) / n), ['--pl-temp' as string]: `${TEMP_S}s` }}
          aria-hidden="true"
        >
          <span key={tek} className="pl__polosa" onAnimationEnd={konecHoda} />
        </div>

        <div className="pl__upr">
          {/* ⚠️ ПАУЗА — ПЕРВАЯ В ПОРЯДКЕ ОБХОДА и есть на всех ширинах
              (поправка после рецензии, WCAG 2.2.2). При «уменьшить
              движение» её нет: переключения само там нет вовсе. */}
          <button
            type="button"
            className="btn pl__kn pl__kn--pauza"
            data-pl-pauza=""
            aria-label={yavnaya ? 'Играть' : 'Пауза'}
            onClick={knopkaPauzy}
          >
            {yavnaya ? (
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
                <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
                <path d="M7 5h3.6v14H7zM13.4 5H17v14h-3.6z" fill="currentColor" />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="btn btn--ghost pl__kn"
            aria-label="Предыдущий отзыв"
            onClick={() => pereyti(-1, 'nazad')}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
              <path d="M6 5h2.4v14H6zM19 5.6v12.8L9.4 12z" fill="currentColor" />
            </svg>
          </button>
          <button
            type="button"
            className="btn btn--ghost pl__kn"
            aria-label="Следующий отзыв"
            onClick={() => pereyti(1, 'vpered')}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
              <path d="M15.6 5H18v14h-2.4zM5 5.6v12.8l9.6-6.4z" fill="currentColor" />
            </svg>
          </button>
        </div>
      </div>

      <div className="pl__ochered">
        <p className="pl__metka pl__metka--ochered">Очередь</p>
        <ol className="pl__spisok">
          {treki.map((o, i) => {
            const on = i === tek;
            return (
              <li key={o.id}>
                <button
                  type="button"
                  className="pl__trek"
                  aria-current={on ? 'true' : undefined}
                  onClick={() => vybrat(i)}
                >
                  <span className="pl__n tnum" aria-hidden="true">
                    {on ? (
                      <span className="pl__eq pl__eq--mini">
                        <i />
                        <i />
                        <i />
                      </span>
                    ) : (
                      i + 1
                    )}
                  </span>
                  <span className="pl__trek-t">
                    <span className="pl__nazv">{o.nazvanie}</span>
                    <span className="pl__isp">
                      <Bukvalno>{o.imya}</Bukvalno>
                    </span>
                  </span>
                  <span className="pl__dlit">
                    <Bukvalno className="tnum">{o.data}</Bukvalno>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

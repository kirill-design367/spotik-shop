'use client';

import { useEffect, useId, useRef } from 'react';
import SectionHead from './SectionHead';
import { onLayoutChange, onScrollY, scroller } from '@/lib/scroll';
import { prefersReducedMotion } from '@/lib/motion';

/**
 * БЛОК 4 — ВОПРОСЫ. АККОРДЕОНА БОЛЬШЕ НЕТ.
 *
 * Вопросы стоят колонкой по центру крупным кеглем — все сразу, ничего
 * не спрятано. Ответ появляется НЕ ПО КЛИКУ, А ПО ПРОКРУТКЕ: напротив
 * того вопроса, который сейчас подошёл к линии отсчёта в экране.
 * Активный вопрос светлый, остальные приглушены.
 *
 * ── ПОЧЕМУ ВЕС НЕПРЕРЫВНЫЙ, А НЕ КЛАСС «АКТИВНЫЙ» ──────────────────────────
 * Класс переключался бы в одном кадре — это щелчок, а арт-директор просил
 * без него. Поэтому каждый вопрос получает СВОЙ ВЕС 0…1, посчитанный
 * от расстояния до линии отсчёта, и вес идёт в CSS одним числом. У веса
 * есть ПОЛКА: пока вопрос близко к линии, он горит целиком, и только
 * в узкой зоне посередине между соседями идёт перекрёстное затухание.
 * Иначе половину времени горели бы два ответа вполсилы.
 *
 * ── ЧТО СЧИТАЕТСЯ В КАДРЕ ──────────────────────────────────────────────────
 * Ничего, кроме вычитания и деления: центры вопросов сняты один раз
 * при раскладке, в кадре только шесть записей переменной. Ни одного
 * чтения геометрии — иначе любое чтение после записи выталкивало бы
 * принудительный пересчёт раскладки.
 *
 * ── БЕЗ СКРИПТА И ПРИ «УМЕНЬШИТЬ ДВИЖЕНИЕ» ─────────────────────────────────
 * Вес по умолчанию равен единице, и задаёт это CSS. Значит без JavaScript
 * видны ВСЕ ответы сразу, и при «уменьшить движение» тоже: подписки
 * там просто не заводится. Прятать что-либо безусловно было бы нельзя.
 *
 * Тексты ответов — ЗАГЛУШКИ по две-три строки. Финальные формулировки даёт
 * арт-директор: они затрагивают обязательства перед клиентом.
 */
const QA = [
  {
    q: 'Нужен ли VPN?',
    a: 'Здесь будет ответ про то, что VPN не требуется ни для оплаты, ни для прослушивания, и что настройки сети менять не нужно.',
  },
  {
    q: 'Как оплатить из России?',
    a: 'Здесь будет ответ про оплату российской картой и через СБП, без зарубежных карт и посредников.',
  },
  {
    q: 'Что если аккаунт перестанет работать?',
    a: 'Здесь будет ответ про то, что делает сервис, если доступ прервался раньше срока, и в какой срок вопрос решается.',
  },
  {
    q: 'Можно ли слушать с нескольких устройств?',
    a: 'Здесь будет ответ про число одновременных устройств и про то, чем тарифы на двоих и на троих отличаются от индивидуального.',
  },
  {
    q: 'Сколько ждать после оплаты?',
    a: 'Здесь будет ответ про фактическое время от оплаты до выдачи доступа и про то, что происходит, если оно вышло за обычные рамки.',
  },
  {
    q: 'Что если я передумаю?',
    a: 'Здесь будет ответ про возврат: в какой срок, на каких условиях и каким способом приходят деньги.',
  },
];

/** Линия отсчёта в экране и ширина зоны перекрёстного затухания. */
const REF = 0.46;
const BAND = 0.62;
const PLATEAU = 0.45;

export default function Faq() {
  const listRef = useRef<HTMLDivElement>(null);
  const base = useId();

  useEffect(() => {
    const list = listRef.current;
    const sc = scroller();
    if (!list || !sc || prefersReducedMotion()) return;

    let items: HTMLElement[] = [];
    let mids: number[] = [];
    let band = 1;

    const measure = () => {
      const shift = sc.getBoundingClientRect().top - sc.scrollTop;
      items = Array.from(list.querySelectorAll<HTMLElement>('.qa__item'));
      mids = items.map((el) => {
        const r = el.getBoundingClientRect();
        return r.top - shift + r.height / 2;
      });
      const step =
        mids.length > 1 ? (mids[mids.length - 1] - mids[0]) / (mids.length - 1) : sc.clientHeight;
      band = Math.max(1, step * BAND);
    };

    const read = (y: number) => {
      const line = y + sc.clientHeight * REF;
      for (let i = 0; i < items.length; i += 1) {
        const raw = 1 - Math.abs(mids[i] - line) / band;
        const w = raw <= 0 ? 0 : raw >= PLATEAU ? 1 : raw / PLATEAU;
        items[i].style.setProperty('--w', w.toFixed(3));
      }
    };

    measure();
    const offLayout = onLayoutChange(measure);
    const offScroll = onScrollY(read);
    return () => {
      offLayout();
      offScroll();
      for (const el of items) el.style.removeProperty('--w');
    };
  }, []);

  return (
    <section id="faq" className="section">
      <div className="shell">
        <SectionHead
          num="04"
          kicker="Вопросы"
          title="Что обычно спрашивают"
          lead="Если ответа здесь нет, напишите — отвечаем тем же языком, каким написано тут."
          meta="6 вопросов"
          center
        />

        <div ref={listRef} className="qa">
          {QA.map((item, i) => {
            const aid = `${base}-a-${i}`;
            return (
              <div key={item.q} className="qa__item">
                <h3 className="qa__q">{item.q}</h3>
                {/* Ответ лежит в разметке ВСЕГДА — и для индексации,
                    и для скринридера: прокрутка меняет только его вид. */}
                <p id={aid} className="qa__a">
                  <span className="faq__draft-mark">черновик</span>
                  {item.a}
                </p>
              </div>
            );
          })}
        </div>

        <p className="faq__note">
          <span>Остался вопрос про деньги или сроки?</span>
          <a href="mailto:lev.menashe@yandex.ru" className="btn btn--ghost btn--sm">
            Написать на почту
          </a>
        </p>
      </div>
    </section>
  );
}

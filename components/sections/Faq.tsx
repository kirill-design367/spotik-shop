'use client';

import { useEffect, useId, useRef } from 'react';
import SectionHead from './SectionHead';
import { onLayoutChange, onScrollY, scroller } from '@/lib/scroll';
import { prefersReducedMotion } from '@/lib/motion';

/**
 * БЛОК ВОПРОСОВ — ОТВЕТ ВСТАЁТ НА МЕСТО ВОПРОСА.
 *
 * Вопросы стоят колонкой по центру крупным кеглем, все сразу. По мере
 * прокрутки вопрос РАСТВОРЯЕТСЯ, а на его месте проявляется ответ:
 * оба живут в одной ячейке сетки, друг поверх друга. Прокрутил назад —
 * ответ ушёл, вопрос вернулся. Ничего не по клику.
 *
 * ── ПОЧЕМУ ОДНА ЯЧЕЙКА СЕТКИ, А НЕ ДВА АБСОЛЮТА ───────────────────────────
 * Высота контейнера обязана быть по БОЛЬШЕМУ из двух, иначе раскладка
 * прыгает на смене активного. Абсолютом это пришлось бы мерить и
 * записывать; сетка делает то же даром: `grid-area: 1 / 1` у обоих,
 * и ячейка сама берёт максимум. Ни одного чтения геометрии ради высоты.
 *
 * ── ПЕРЕКРЁСТНЫЙ ПЕРЕХОД ──────────────────────────────────────────────────
 * Вес 0…1 идёт от расстояния до линии отсчёта (Р-52). Вопрос гаснет
 * как `(1 − w)`, ответ разгорается как `w`, поэтому кадра, где оба
 * видны в полную силу, не существует: в середине перехода каждый
 * примерно вполсилы. У веса есть ПОЛКА — пока вопрос близко к линии,
 * ответ горит целиком, и только в узкой зоне между соседями идёт
 * перекрёстное затухание.
 *
 * ── БЕЗ СКРИПТА И ПРИ «УМЕНЬШИТЬ ДВИЖЕНИЕ» ────────────────────────────────
 * Подмена включается атрибутом `data-swap`, и ставит его скрипт — только
 * когда подписался. Нет скрипта, «уменьшить движение» — ячейка
 * разворачивается в две строки, и видно И вопрос, И ответ. Прятать
 * что-либо безусловно было бы нельзя.
 *
 * Тексты ответов — ЗАГЛУШКИ. Финальные формулировки даёт арт-директор:
 * они затрагивают обязательства перед клиентом.
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

/** Линия отсчёта в экране, ширина зоны затухания и полка. */
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

    /* Атрибут ставится ПОСЛЕ измерения и подписки: до этого момента
       вопрос и ответ стоят друг под другом и оба видны. */
    measure();
    list.setAttribute('data-swap', '');
    const offLayout = onLayoutChange(measure);
    const offScroll = onScrollY(read);
    return () => {
      offLayout();
      offScroll();
      list.removeAttribute('data-swap');
      for (const el of items) el.style.removeProperty('--w');
    };
  }, []);

  return (
    <section id="faq" className="section">
      <div className="shell">
        <SectionHead title="Ваши вопросы" center />

        <div ref={listRef} className="qa">
          {QA.map((item, i) => {
            const aid = `${base}-a-${i}`;
            return (
              <div key={item.q} className="qa__item">
                {/* Вопрос и ответ — в ОДНОЙ ячейке: высота берётся
                    по большему из двух, и раскладка не прыгает. */}
                <div className="qa__swap">
                  <h3 className="qa__q">{item.q}</h3>
                  {/* Ответ лежит в разметке ВСЕГДА — и для индексации,
                      и для скринридера: прокрутка меняет только его вид. */}
                  <p id={aid} className="qa__a">
                    <span className="faq__draft-mark">черновик</span>
                    {item.a}
                  </p>
                </div>
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

'use client';

import Wordmark from '@/components/wordmark/Wordmark';
import Nav from '@/components/chrome/Nav';
import { scrollToId } from '@/lib/scroll';

/**
 * Хиро.
 *
 * Секция вдвое выше экрана, а её содержимое прилипает через position: sticky.
 * Это даёт ровно один экран прокрутки, на котором приём успевает прочитаться:
 * SPOTIK сплющивается от неподвижного верха вниз. Без этого слово уезжало бы
 * с экрана раньше, чем досжалось.
 *
 * Прилипание сделано нативным sticky, а не пином ScrollTrigger: нет
 * пин-спейсера, нет пересчёта при рефреше и нет рывков на тач-устройствах.
 *
 * Фон здесь пустой и таким задуман: волну третья итерация сняла, она спорила
 * со словом. Приём на экране один.
 */
export default function Hero() {
  return (
    <section id="hero" className="hero">
      <div className="hero__stage">
        <Nav />

        {/* Верхняя скобка: SPOTIK во всю ширину экрана, с малым отступом
            от краёв. Верх слова неподвижен, меняется только низ. */}
        <Wordmark mode="hero" sectionId="hero" reserveSelector=".hero__foot" reserveGap={28} />

        <div className="hero__foot shell">
          <h1 className="eyebrow">
            Сервис №1 по оформлению доступа к Spotify Premium из России
          </h1>

          <p className="hero__offer">
            С помощью Spotik Shop вы можете получить доступ к любимым хитам, недоступным
            на российских площадках. Без VPN и оплачивая русской картой или СБП.
          </p>

          <div className="hero__cta-row">
            <button type="button" className="btn btn--wide" onClick={() => scrollToId('pricing')}>
              Выбрать тариф
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

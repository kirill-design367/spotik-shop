'use client';

import Wordmark from '@/components/wordmark/Wordmark';
import WaveCanvas from '@/components/wave/WaveCanvas';
import Nav from '@/components/chrome/Nav';
import { scrollToId } from '@/lib/scroll';

/**
 * Хиро.
 *
 * Секция вдвое выше экрана, а её содержимое прилипает через position: sticky.
 * Это даёт ровно один экран прокрутки, на котором приём успевает прочитаться:
 * SPOTIK сжимается по осям и уезжает вверх, а освободившуюся энергию
 * подхватывает волна. Без этого слово уезжало бы с экрана раньше, чем
 * досжалось, и волна просыпалась бы уже за кадром.
 *
 * Прилипание сделано нативным sticky, а не пином ScrollTrigger: нет
 * пин-спейсера, нет пересчёта при рефреше и нет рывков на тач-устройствах.
 */
export default function Hero() {
  return (
    <section id="hero" className="hero">
      <div className="hero__stage">
        {/* Волна — фон хиро. Пока SPOTIK крупный, она на пределе видимости. */}
        <WaveCanvas className="hero__wave" />

        <Nav />

        {/* Верхняя скобка: SPOTIK во всю ширину, обрезан краями вьюпорта */}
        <Wordmark mode="hero" sectionId="hero" reserveSelector=".hero__foot" reserveGap={28} />

        <div className="hero__foot shell">
          <h1 className="eyebrow">
            Сервис №1 по оформлению доступа к Spotify Premium из России
          </h1>

          <p className="hero__offer">
            С помощью Spotik Shop вы можете получить доступ к любимым хитам, недоступным
            на российских площадках. Без VPN и оплачивая русской картой или СБП.
          </p>

          <div className="hero__cta-row">
            <button type="button" className="btn btn--wide" onClick={() => scrollToId('pricing')}>
              Выбрать тариф
            </button>
            <span className="hero__hint">Коснитесь фона — волна отзовётся</span>
          </div>
        </div>
      </div>
    </section>
  );
}

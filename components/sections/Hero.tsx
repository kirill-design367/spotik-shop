'use client';

import Wordmark from '@/components/wordmark/Wordmark';
import Nav from '@/components/chrome/Nav';
import { scrollToId } from '@/lib/scroll';
import { MORPH_TRAVEL } from '@/lib/wordmark';

/**
 * Хиро.
 *
 * Секция вдвое выше экрана, а её содержимое прилипает через position: sticky.
 * Это даёт ровно один экран прокрутки, на котором приём успевает прочитаться:
 * SPOTIK сплющивается от неподвижного верха вниз.
 *
 * Порядок в потоке важен. Навигация, под ней слово, под ним — тексты,
 * прижатые к низу. Слово стоит В ПОТОКЕ сразу после навигации, поэтому
 * его верхняя кромка это и есть низ навигации: без JS, без чтения
 * геометрии и без сдвига макета.
 *
 * Кнопок на десктопе здесь нет: путь к тарифам ведёт пункт меню «Тарифы».
 * На узком экране меню спрятано, поэтому кнопка остаётся — иначе тарифы
 * стали бы недостижимы.
 */
export default function Hero() {
  return (
    <section
      id="hero"
      className="hero"
      // Ход морфа и высота секции — одна и та же величина, поэтому она
      // приходит сюда из кода, а не дублируется числом в CSS.
      style={{ ['--wm-travel' as string]: `${MORPH_TRAVEL * 100}svh` }}
    >
      <div className="hero__stage">
        <Nav />

        {/* Верхняя скобка: SPOTIK во всю ширину экрана, с малым отступом
            от краёв. Верх слова неподвижен, меняется только низ. */}
        <Wordmark mode="hero" sectionId="hero" followSelector=".hero__foot" />

        <div className="hero__foot shell">
          <h1 className="hero__kicker">
            Сервис №1 по оформлению доступа к Spotify Premium из России
          </h1>

          <p className="hero__note">
            С помощью Spotik Shop вы можете получить доступ к любимым хитам, недоступным
            на российских площадках. Без VPN и оплачивая русской картой или СБП.
          </p>

          <button
            type="button"
            className="btn btn--wide hero__cta"
            onClick={() => scrollToId('pricing')}
          >
            Выбрать тариф
          </button>
        </div>
      </div>
    </section>
  );
}

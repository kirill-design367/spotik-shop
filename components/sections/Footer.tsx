'use client';

import Wordmark from '@/components/wordmark/Wordmark';
import { MORPH_TRAVEL, CUT_OVER_INK } from '@/lib/wordmark';

/**
 * Нижняя скобка.
 *
 * То же слово возвращается зеркально, с инверсией цвета: чёрный SPOTIK
 * на сплошном зелёном. Зелёный экран в конце страницы — намеренный
 * финальный удар, а не фон по недосмотру.
 *
 * Порядок: СНАЧАЛА слово, под ним реквизиты. Слово стоит в потоке первым
 * и растёт ВНИЗ от неподвижного верха — точное зеркало хиро. Реквизиты
 * держат низ экрана и не двигаются.
 *
 * ── ЗЕЛЁНОЕ ПОЛЕ НАЧИНАЕТСЯ У СЛОВА ────────────────────────────────────────
 * Зелёным заливает не вся секция, а .footer__field — отдельный слой, чей
 * верхний край опущен ниже верха чернил на CUT_OVER_INK. Этот же край режет
 * верхушки литер (overflow: hidden), поэтому заливка и срез — одна граница,
 * а не две сущности, которые однажды разъедутся. Геометрия контуров не
 * трогается: шесть условий держатся ровно так же, как в хиро.
 */
export default function Footer() {
  return (
    <footer
      id="footer"
      className="footer"
      style={{ ['--wm-travel' as string]: `${MORPH_TRAVEL * 100}svh` }}
    >
      <div
        className="footer__stage"
        // величина среза живёт в lib/wordmark и приходит сюда числом:
        // в CSS она домножается на высоту чернил, которую CSS и так знает
        style={{ ['--wm-cut' as string]: `calc(var(--wm-h) * ${CUT_OVER_INK.toFixed(5)})` }}
      >
        <div className="footer__field">
          <Wordmark mode="footer" sectionId="footer" />

          <div className="footer__body shell">
            <div className="footer__col">
              <p className="footer__head">Реквизиты</p>
              <dl className="footer__req">
                <dt>Исполнитель</dt>
                <dd>Менаше Лев Наумович</dd>
                <dt>ИНН</dt>
                <dd className="tnum">526324111452</dd>
                <dt>ОГРНИП</dt>
                <dd className="tnum">326527500140369</dd>
              </dl>
            </div>

            <div className="footer__col">
              <p className="footer__head">Связь</p>
              <dl className="footer__req">
                <dt>Телефон</dt>
                <dd>
                  <a href="tel:+79503738046" className="tnum">
                    +7 950 373-80-46
                  </a>
                </dd>
                <dt>Почта</dt>
                <dd>
                  <a href="mailto:lev.menashe@yandex.ru">lev.menashe@yandex.ru</a>
                </dd>
              </dl>
            </div>

            <div className="footer__col">
              <p className="footer__head">Документы</p>
              <dl className="footer__req">
                <dt>Оферта</dt>
                <dd>
                  {/*
                    Домена пока нет, боевого адреса оферты тоже. Ссылка
                    на несуществующий якорь хуже её отсутствия: выглядит
                    рабочей, кликается и не делает ничего. Поэтому текст,
                    а <a href> появится вместе с документом.
                    Без прозрачности: на зелёном она роняет контраст ниже
                    нормы. Второстепенность передаём словом, не яркостью.
                  */}
                  <span>Готовится</span>
                </dd>
              </dl>
            </div>

            <div className="footer__col">
              <p className="footer__head">Оговорка</p>
              <p className="footer__req footer__note">
                Spotik Shop — независимый сервис. Мы не связаны со Spotify AB
                и не используем её товарные знаки.
              </p>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

'use client';

import Wordmark from '@/components/wordmark/Wordmark';

/**
 * Нижняя скобка.
 *
 * То же слово возвращается зеркально, с инверсией цвета: чёрный SPOTIK
 * на сплошном зелёном. Полный зелёный экран в конце страницы — намеренный
 * финальный удар, а не фон по недосмотру.
 *
 * Порядок: СНАЧАЛА слово, под ним реквизиты. Слово стоит в потоке первым
 * и разрастается вверх от собственной нижней кромки, а реквизиты держат
 * низ экрана и не двигаются.
 */
export default function Footer() {
  return (
    <footer id="footer" className="footer">
      <div className="footer__stage">
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
    </footer>
  );
}

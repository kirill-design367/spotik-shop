'use client';

import Wordmark from '@/components/wordmark/Wordmark';

/**
 * Нижняя скобка.
 *
 * То же слово возвращается зеркально, с инверсией цвета: чёрный SPOTIK
 * на сплошном зелёном. Полный зелёный экран в конце страницы — намеренный
 * финальный удар, а не фон по недосмотру.
 */
export default function Footer() {
  return (
    <footer id="footer" className="footer">
      <div className="footer__stage">
      <div className="footer__body shell">
        <div style={{ gridColumn: 'span 5' }}>
          <p className="eyebrow" style={{ color: 'var(--on-green-dim)', opacity: 1 }}>
            Реквизиты
          </p>
          <dl className="footer__req">
            <dt>Исполнитель</dt>
            <dd>Менаше Лев Наумович</dd>
            <dt>ИНН</dt>
            <dd className="tnum">526324111452</dd>
            <dt>ОГРНИП</dt>
            <dd className="tnum">326527500140369</dd>
          </dl>
        </div>

        <div style={{ gridColumn: 'span 4' }}>
          <p className="eyebrow" style={{ color: 'var(--on-green-dim)', opacity: 1 }}>
            Связь
          </p>
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
            <dt>Документы</dt>
            <dd>
              {/*
                Домена пока нет, боевого адреса оферты тоже. Ссылка на
                несуществующий якорь хуже отсутствия ссылки: она выглядит
                рабочей, кликается и не делает ничего. Поэтому здесь текст,
                а <a href> появится вместе с документом.
              */}
              <span style={{ opacity: 0.72 }}>Публичная оферта — готовится</span>
            </dd>
          </dl>
        </div>

        <div style={{ gridColumn: 'span 3' }}>
          <p className="eyebrow" style={{ color: 'var(--on-green-dim)', opacity: 1 }}>
            Оговорка
          </p>
          <p className="footer__req" style={{ maxWidth: '28ch' }}>
            Spotik Shop — независимый сервис. Мы не связаны со Spotify AB
            и не используем её товарные знаки.
          </p>
        </div>
      </div>

      {/* Место, которое занимает разрастающееся слово */}
      <div className="footer__spacer" />

      <Wordmark mode="footer" sectionId="footer" reserveSelector=".footer__body" reserveGap={32} />
      </div>
    </footer>
  );
}

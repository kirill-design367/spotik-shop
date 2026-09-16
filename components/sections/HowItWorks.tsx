import SectionHead from './SectionHead';

/**
 * БЛОК 3 — КАК ЭТО РАБОТАЕТ.
 * Пять шагов и отдельная развилка: новый аккаунт или продление.
 * Собственной анимации нет — следующая итерация.
 */
const STEPS = [
  {
    t: 'Выбираете тариф и срок',
    d: 'Индивидуальный, на двоих или на троих. Срок — от месяца до года, цена фиксируется сразу.',
  },
  {
    t: 'Оплачиваете картой или через СБП',
    d: 'Обычная российская карта или перевод по СБП. Ни зарубежных карт, ни криптовалюты, ни посредников.',
  },
  {
    t: 'Переходите в Telegram-бот',
    d: 'После оплаты открывается ссылка на бота. Он же остаётся каналом связи на весь срок подписки.',
  },
  {
    t: 'Получаете логин и пароль от аккаунта',
    d: 'Данные приходят в бот. Если продлевали свой аккаунт — приходит подтверждение, что Premium уже активен.',
  },
  {
    t: 'Входите в Spotify и слушаете',
    d: 'Приложение, браузер, колонка, телевизор — куда угодно. Без VPN и без изменения настроек сети.',
  },
];

export default function HowItWorks() {
  return (
    <section id="how" className="section">
      <div className="shell">
        <SectionHead
          num="03"
          kicker="Порядок"
          title="Как это работает"
          lead="Пять шагов от выбора тарифа до первого трека. Ни одного, который делаете вслепую."
          meta="5 шагов · 2 развилки"
        />

        <ol className="steps" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {STEPS.map((s, i) => (
            <li key={s.t} className="step">
              <span className="step__n">{String(i + 1).padStart(2, '0')}</span>
              <h3 className="step__t">{s.t}</h3>
              <p className="step__d">{s.d}</p>
            </li>
          ))}
        </ol>

        <div className="fork">
          <div className="fork__col">
            <p className="fork__tag">Развилка А</p>
            <h3 className="h-card" style={{ marginTop: 12 }}>
              Создаём новый аккаунт
            </h3>
            <p className="body-text" style={{ marginTop: 12, paddingBottom: 24 }}>
              Подходит, если Spotify вы ещё не слушали или готовы начать с чистого листа.
              Заводим аккаунт, подключаем Premium и передаём вам логин с паролем. Фонотеку
              и плейлисты собираете сами — они останутся вашими.
            </p>
          </div>
          <div className="fork__col">
            <p className="fork__tag">Развилка Б</p>
            <h3 className="h-card" style={{ marginTop: 12 }}>
              Продлеваем существующий
            </h3>
            <p className="body-text" style={{ marginTop: 12, paddingBottom: 24 }}>
              Подходит, если у вас уже есть аккаунт с плейлистами, подписками и историей
              прослушиваний. Ничего не переносим и не пересоздаём — Premium подключается
              к тому аккаунту, которым вы пользуетесь.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

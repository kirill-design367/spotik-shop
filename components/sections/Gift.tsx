import SectionHead from './SectionHead';
import SceneSlot from '@/components/three/SceneSlot';
import ScrollButton from '@/components/chrome/ScrollButton';

/**
 * БЛОК 5 — СЕРТИФИКАТ В ПОДАРОК. Блок продающий, не технический.
 * Здесь разрешён Three.js: сцена подключена, анимации нет — вторая итерация.
 */
export default function Gift() {
  return (
    <section id="gift" className="section">
      <div className="shell">
        <SectionHead
          num="05"
          kicker="Подарок"
          title="Сертификат, который слушают"
          lead="Подписка вместо очередной коробки. Её открывают один раз и пользуются весь год."
          meta="от 1 до 12 месяцев"
        />

        <div className="gift">
          <div>
            <p className="lead" style={{ color: 'var(--white)', maxWidth: '26ch' }}>
              Вы оплачиваете срок, получаете сертификат и передаёте его тому, кому он
              предназначен.
            </p>
            <p className="body-text" style={{ marginTop: 20, maxWidth: '46ch' }}>
              Человек активирует его сам и сам решает, заводить новый аккаунт или
              продлить свой. Вам не нужно знать ни его пароль, ни что он слушает.
            </p>

            <ul className="gift__list">
              <li>Любой срок из тарифов — от месяца до года</li>
              <li>Активируется получателем, без вашего участия</li>
              <li>Не привязан к дате: можно подарить заранее</li>
              <li>Если у получателя уже есть аккаунт — Premium встанет на него</li>
            </ul>

            <div style={{ marginTop: 32, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <ScrollButton to="pricing">Выбрать срок</ScrollButton>
              <ScrollButton to="faq" variant="ghost">
                Как это работает
              </ScrollButton>
            </div>
          </div>

          {/* Слот под 3D-объект сертификата. Сцена подключена, анимация — потом. */}
          <SceneSlot
            kind="gift"
            seed={7}
            label="Сертификат Spotik Shop в объёме"
            className="scene-slot--tall"
          />
        </div>
      </div>
    </section>
  );
}

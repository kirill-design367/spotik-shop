import SectionHead from './SectionHead';
import SceneSlot from '@/components/three/SceneSlot';
import ScrollButton from '@/components/chrome/ScrollButton';

/**
 * БЛОК 5 — СЕРТИФИКАТ В ПОДАРОК. ПРИЁМ Б.
 *
 * Один крупный тезис по левому краю, справа воздух — и это единственное,
 * что есть в верхней половине блока. Подробности уходят вниз мелким
 * набором, объём — вниз и вправо.
 *
 * ЗДЕСЬ И ТОЛЬКО ЗДЕСЬ разрешён three.js: с двенадцатой итерации слот
 * в блоке тарифов снят, и объём на странице остался ровно один. На
 * касаниях он всё так же не поднимается вовсе — слот рисует ту же дорожку
 * плоско (CLAUDE.md, Р-34).
 */
export default function Gift() {
  return (
    <section id="gift" className="section">
      <div className="shell">
        <SectionHead num="05" kicker="Подарок" title="Сертификат, который слушают" meta="от 1 до 12 месяцев" quiet />

        <div className="gift">
          <p className="stmt stmt--gift gift__say rv">
            Подписка вместо очередной коробки. <em>Её открывают один раз и пользуются весь год.</em>
          </p>

          <div className="gift__side rv" style={{ ['--rv-d' as string]: '90ms' }}>
            <p className="col__d" style={{ maxWidth: '46ch' }}>
              Вы оплачиваете срок, получаете сертификат и передаёте его тому, кому он
              предназначен. Человек активирует его сам и сам решает, заводить новый аккаунт
              или продлить свой. Вам не нужно знать ни его пароль, ни что он слушает.
            </p>

            <ul className="gift__list">
              <li>Любой срок из тарифов — от месяца до года</li>
              <li>Активируется получателем, без вашего участия</li>
              <li>Не привязан к дате: можно подарить заранее</li>
              <li>Если у получателя уже есть аккаунт — Premium встанет на него</li>
            </ul>

            <div className="gift__act">
              <ScrollButton to="pricing">Выбрать срок</ScrollButton>
              <ScrollButton to="how" variant="ghost">
                Как это работает
              </ScrollButton>
            </div>
          </div>

          {/* Слот под 3D-объект сертификата — единственный на странице. */}
          <SceneSlot
            kind="gift"
            seed={7}
            label="Сертификат Spotik Shop в объёме"
            className="scene-slot--tall gift__slot"
          />
        </div>
      </div>
    </section>
  );
}

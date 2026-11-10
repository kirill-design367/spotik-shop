/**
 * АВТОПЛАТЁЖ В КАРТОЧКЕ ЗАКАЗА (пятьдесят четвёртая итерация).
 *
 * Постановка: «В кабинете у заказа видно, включён ли автоплатёж и когда
 * следующее списание. Отключается одним нажатием», и «если первый платёж
 * прошёл не картой, автоплатёж не включается, и клиент видит это
 * в кабинете».
 *
 * ⚠️ РИСУЕТСЯ ТОЛЬКО ПРИ ВКЛЮЧЁННОМ ВЫКЛЮЧАТЕЛЕ — решает вызывающий
 * (постановка: «пока выключен, клиент ничего про автоплатёж не видит»).
 * Само действие «Отключить» при этом работает всегда (поправка money-7):
 * форма, отправленная до выключения, своё дело сделает.
 *
 * ⚠️ НОМЕР ПОДПИСКИ ЕДЕТ СКРЫТЫМ ПОЛЕМ, А ВЛАДЕЛЕЦ ПРОВЕРЯЕТСЯ
 * НА СЕРВЕРЕ (`otklyuchitPodpisku`): поле правится в браузере.
 *
 * Серверный компонент: кнопка — обычная серверная форма, без единой
 * строки клиентского кода.
 */

import { deystvieOtklyuchitAvto } from '@/lib/server/actions-client';
import type { AvtoKlientu } from '@/lib/server/views';
import type { PrichinaAvto } from '@/lib/avtoplatezh';

/** Почему отключён — словами клиенту. `zakaz_otmenyon` не говорится:
    карточка отменённого заказа уже сказала всё сама. */
const POCHEMU: Partial<Record<PrichinaAvto, string>> = {
  klient: 'Автоплатёж отключён.',
  admin: 'Автоплатёж отключён администратором.',
  dve_neudachi: 'Автоплатёж отключён: два раза не удалось списать оплату.',
  ne_prodayotsya: 'Автоплатёж отключён: этот тариф на этот срок больше не продаётся.',
  prosrochen: 'Автоплатёж отключён: срок подписки кончился раньше, чем мы успели предупредить о списании.',
  testovaya: 'Автоплатёж отключён: первый платёж прошёл в тестовом режиме.',
  bez_recurring: 'Автоплатёж не включился: счёт был оплачен без него.',
};

const SNOVA = 'Включить снова можно при следующем продлении: отметьте галочку и оплатите картой.';

export default function AvtoBlok({
  avto,
  konchaetsya,
  zakazGotov,
}: {
  avto: AvtoKlientu;
  konchaetsya: Date | null;
  zakazGotov: boolean;
}) {
  if (avto.status === 'zhdyot_oplaty') {
    return (
      <div className="avto-sost">
        <p className="panel__note">Автоплатёж включится после оплаты картой.</p>
        <OtklyuchitForma id={avto.id} podpis="Не включать автоплатёж" />
      </div>
    );
  }
  if (avto.status === 'vklyuchen') {
    // Сумму и состояние «списание в пути» показывает часть списаний —
    // здесь только то, что известно без неё: включён и когда.
    const kogda =
      zakazGotov && konchaetsya
        ? `Следующее списание — в день окончания подписки, ${konchaetsya.toLocaleDateString('ru-RU')}.`
        : 'Следующее списание — в день окончания подписки.';
    return (
      <div className="avto-sost">
        <p className="panel__note">Автоплатёж включён. {kogda}</p>
        <OtklyuchitForma id={avto.id} podpis="Отключить автоплатёж" />
      </div>
    );
  }
  if (avto.status === 'ne_karta') {
    return (
      <div className="avto-sost">
        <p className="panel__note">
          Автоплатёж не включился: первый платёж прошёл не картой. {SNOVA}
        </p>
      </div>
    );
  }
  if (avto.prichina === 'zamenena') {
    return (
      <div className="avto-sost">
        <p className="panel__note">Автоплатёж перенесён на более новый заказ этих же аккаунтов.</p>
      </div>
    );
  }
  const slova = avto.prichina ? POCHEMU[avto.prichina] : 'Автоплатёж отключён.';
  if (!slova) return null;
  return (
    <div className="avto-sost">
      <p className="panel__note">
        {slova} {SNOVA}
      </p>
    </div>
  );
}

function OtklyuchitForma({ id, podpis }: { id: number; podpis: string }) {
  return (
    <form action={deystvieOtklyuchitAvto}>
      <input type="hidden" name="avto" value={id} />
      <button type="submit" className="btn btn--ghost btn--sm">
        {podpis}
      </button>
    </form>
  );
}

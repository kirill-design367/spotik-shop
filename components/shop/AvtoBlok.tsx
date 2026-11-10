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
import { ZONA_MSK } from '@/lib/chasy';
import { rubli } from '@/lib/server/money';

/** Почему отключён — словами клиенту. `zakaz_otmenyon` не говорится:
    карточка отменённого заказа уже сказала всё сама. */
const POCHEMU: Partial<Record<PrichinaAvto, string>> = {
  klient: 'Автоплатёж отключён по вашей просьбе.',
  admin: 'Автоплатёж отключён администратором.',
  dve_neudachi: 'Автоплатёж отключён: два раза не удалось списать оплату.',
  ne_prodayotsya: 'Автоплатёж отключён: этот тариф на этот срок больше не продаётся.',
  prosrochen: 'Автоплатёж отключён: срок подписки кончился раньше, чем мы успели предупредить о списании.',
  testovaya: 'Автоплатёж отключён: первый платёж прошёл в тестовом режиме.',
  bez_recurring: 'Автоплатёж не включился: счёт был оплачен без него.',
  prodlen: 'Автоплатёж отключён: аккаунт уже продлён другим заказом, и второе списание за тот же срок было бы лишним.',
};

const SNOVA = 'Включить снова можно при следующем продлении: отметьте галочку и оплатите картой.';

/**
 * ⚠️ ДАТЫ — ПО МОСКВЕ ЯВНОЙ ЗОНОЙ, как в письмах (`dataMsk`): сервер
 * стоит в UTC, и окончание в 01:00 по Москве иначе вышло бы вчерашним
 * днём — человек прочёл бы в кабинете одну дату, а в письме другую.
 */
function data(d: Date): string {
  return d.toLocaleDateString('ru-RU', { timeZone: ZONA_MSK });
}

export default function AvtoBlok({
  avto,
  zakazGotov,
  balansKop,
}: {
  avto: AvtoKlientu;
  zakazGotov: boolean;
  /** Баланс сейчас: «с баланса», если на нём уже хватает на списание. */
  balansKop: number;
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
    return (
      <div className="avto-sost">
        <p className="panel__note">
          Автоплатёж включён. <Vklyuchen avto={avto} zakazGotov={zakazGotov} balansKop={balansKop} />
        </p>
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

/**
 * Включённый автоплатёж — что с ним сейчас, одной фразой.
 *
 * Порядок проверок — порядок важности для человека:
 *   1. счёт «в пути»: деньги, возможно, уже ушли с карты, и дата
 *      «следующего списания» была бы прошедшей (поправка product-5);
 *   2. заказ ещё не выполнен: дня окончания нет, и дата была бы
 *      выдуманной;
 *   3. была неудача, ждём повтора;
 *   4. обычное: когда, сколько и откуда.
 *
 * ⚠️ СУММА И ДЕНЬ — ТЕ ЖЕ, ЧТО ВОЗЬМЁТ ЧАСОВОЙ ХОД (`avtoKlientu`
 * во `views.ts`), и «с баланса» говорится, только если на балансе
 * хватает уже сейчас: баланс списывается первым (постановка).
 */
function Vklyuchen({
  avto,
  zakazGotov,
  balansKop,
}: {
  avto: AvtoKlientu;
  zakazGotov: boolean;
  balansKop: number;
}) {
  if (avto.vPuti) {
    const skolko = avto.vPutiSummaKop !== null ? ` ${rubli(avto.vPutiSummaKop)}` : '';
    const kogda = avto.vPutiKogda ? ` ${data(avto.vPutiKogda)}` : '';
    return <>{`Списание${skolko} отправлено${kogda}, ждём подтверждения банка.`}</>;
  }
  if (!zakazGotov || !avto.sleduyushcheeSpisanie) return <>Следующее списание — в день окончания подписки.</>;
  const hvataet = avto.summaKop !== null && balansKop >= avto.summaKop;
  const skolko =
    avto.summaKop !== null ? `, ${rubli(avto.summaKop)} ${hvataet ? 'с баланса' : 'с карты'}` : '';
  if (avto.neudach > 0 && avto.sleduyushchayaPopytka) {
    const kogdaNe = avto.neudachaKogda ? ` ${data(avto.neudachaKogda)}` : '';
    return (
      <>
        {`Не удалось списать оплату${kogdaNe}, повторим ${data(avto.sleduyushcheeSpisanie)}${skolko}.`}
        {hvataet ? null : ' Пополните баланс — спишем с него.'}
      </>
    );
  }
  return <>{`Следующее списание — ${data(avto.sleduyushcheeSpisanie)}${skolko}.`}</>;
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

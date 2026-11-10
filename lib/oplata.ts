/**
 * СПОСОБ ОПЛАТЫ ЗАКАЗА СЛОВАМИ (решение заказчика по вопросу 126):
 * «Карта», «СБП», «Баланс», «Сертификат» — в карточке заказа
 * и в «Продажах».
 *
 * Робокасса присылает в уведомлении `PaymentMethod` и `IncCurrLabel`,
 * а мы храним их в `payment.sposob` строкой «<PaymentMethod>/<метка>»
 * (`sposobStrokoy` в `lib/avtoplatezh.ts`). Решает МЕТКА валюты:
 * `BankCardPSR` — карта, `SBPPSR` — СБП; `PaymentMethod` общий у СБП
 * и кошельков (`PayButton`) и учитывается лишь при пустой метке — то же
 * правило, что у `oplachenoKartoy`.
 *
 * Способов у заказа бывает два сразу: часть с баланса, остаток картой —
 * тогда оба, через «+».
 *
 * ⚠️ У СЧЕТОВ ДО ПЯТЬДЕСЯТ ЧЕТВЁРТОЙ ИТЕРАЦИИ СПОСОБА НЕТ ВОВСЕ:
 * колонку завели вместе с автоплатежом. Их деньги прошли через
 * Робокассу, а чем именно — неизвестно, и выдумывать «Карта» нельзя:
 * это «Карта или СБП».
 */

export type VidOplaty = 'karta' | 'sbp' | 'balans' | 'sert' | 'robokassa' | 'inoe' | 'nichego';

/** Чем прошли деньги через Робокассу — по строке `payment.sposob`. */
export function vidPoSposobu(sposob: string | null): VidOplaty {
  if (!sposob) return 'robokassa';
  const [metod = '', metka = ''] = sposob.split('/');
  const m = metka.trim();
  if (m) {
    if (/^BankCard/i.test(m)) return 'karta';
    if (/^SBP/i.test(m)) return 'sbp';
    return 'inoe';
  }
  const p = metod.trim().toLowerCase();
  if (p === 'bankcard') return 'karta';
  if (p === 'sbp') return 'sbp';
  return p ? 'inoe' : 'robokassa';
}

/**
 * Способы оплаты заказа по порядку: баланс, потом то, чем прошли деньги
 * через Робокассу. Пустой список — заказ НЕ ОПЛАЧЕН (на экране прочерк);
 * `nichego` — оплачен, а платить было нечего (скидка в 100 %).
 *
 * `source` — откуда заказ: `certificate` — оформлен активацией
 * сертификата, денег за ним нет; `avto` — создан автоплатежом, а он
 * списывает только с карты (Р-173) — дочерний счёт с заказом
 * продления не связан, и спрашивать его не о чем.
 */
export function vidyOplaty(z: {
  source: string;
  balanceKop: number;
  moneyKop: number;
  sposob: string | null;
  oplachen: boolean;
}): VidOplaty[] {
  if (z.source === 'certificate') return ['sert'];
  if (!z.oplachen) return [];
  const vse: VidOplaty[] = [];
  if (z.balanceKop > 0) vse.push('balans');
  if (z.moneyKop > 0) vse.push(z.source === 'avto' ? 'karta' : vidPoSposobu(z.sposob));
  return vse.length ? vse : ['nichego'];
}

/**
 * Строка для админки: «Баланс + Карта». Перевод берёт вызывающий —
 * словарь админки двуязычный, а этот файл о нём не знает.
 */
export function oplataSlovami(t: (k: `op.${VidOplaty}`) => string, vidy: VidOplaty[]): string {
  return vidy.length ? vidy.map((v) => t(`op.${v}`)).join(' + ') : '—';
}

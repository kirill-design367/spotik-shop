/**
 * Причины отмены заказа.
 *
 * Постановка сорок второй итерации: «Отменить заказ без причины
 * нельзя. Причина выбирается из списка», и тексты перенесены
 * СЛОВО В СЛОВО.
 *
 * ⚠️ ПАРА ЖИВЁТ ЗДЕСЬ, А НЕ В `lib/admin/slova.ts`, И ЭТО НЕ ОБХОД
 * ЗАКОНА 40. Русская половина — НЕ НАДПИСЬ: ровно этот текст видит
 * КЛИЕНТ в своём кабинете и в письме, и язык там русский всегда.
 * Английская половина — надпись для сотрудника. Разведи их
 * по двум файлам, и одна и та же фраза получит два источника:
 * поправят её в словаре, а клиенту уйдёт прежняя. Поэтому пара
 * стоит рядом, а клиенту всегда уходит `[0]`.
 *
 * Файл ОБЩИЙ для сервера и браузера: список выбирает оператор
 * в клиентском компоненте, а текст клиенту подставляет сервер.
 */

export type KodPrichiny = 'parol' | 'parol1' | 'parol2' | 'parol3' | 'zanyata' | 'est_premium' | 'drugoe';

/** [что увидит КЛИЕНТ (по-русски, дословно), надпись для сотрудника по-английски] */
const P: Record<KodPrichiny, readonly [string, string]> = {
  parol: ['Неправильный логин или пароль', 'Wrong login or password'],
  parol1: ['Неправильный логин или пароль 1-го аккаунта', 'Wrong login or password, account 1'],
  parol2: ['Неправильный логин или пароль 2-го аккаунта', 'Wrong login or password, account 2'],
  parol3: ['Неправильный логин или пароль 3-го аккаунта', 'Wrong login or password, account 3'],
  zanyata: ['Этот адрес электронной почты уже зарегистрирован', 'This email address is already registered'],
  est_premium: [
    'У Вас уже подключен Spotify Premium. Ждём Вас, когда Ваша подписка перестанет действовать! Деньги останутся лежать у Вас на балансе.',
    'The client already has Spotify Premium. The money stays on their balance.',
  ],
  drugoe: ['Другое: свяжитесь с поддержкой', 'Other: contact support'],
};

export const KODY_PRICHIN = Object.keys(P) as KodPrichiny[];

export function ponyatPrichinu(v: string): KodPrichiny | null {
  return (KODY_PRICHIN as string[]).includes(v) ? (v as KodPrichiny) : null;
}

/** Текст КЛИЕНТУ. Всегда русский, каким бы ни был язык админки. */
export function prichinaKlientu(k: KodPrichiny): string {
  return P[k][0];
}

/** Надпись в списке у оператора. */
export function prichinaSotrudniku(k: KodPrichiny, en: boolean): string {
  return en ? P[k][1] : P[k][0];
}

/**
 * Какие причины предложить при `mest` аккаунтах.
 *
 * ⚠️ У ОДНОГО АККАУНТА ПРИЧИНА БЕЗ НОМЕРА, у двух и трёх — с номером,
 * и это прямо из постановки: «Неправильный логин или пароль» для
 * тарифа на одного, «…1-го аккаунта» и «…2-го аккаунта» для «На
 * двоих». Номер там, где аккаунтов больше одного, и только там:
 * клиенту, у которого аккаунт один, «1-го аккаунта» сказало бы,
 * что где-то есть второй.
 */
export function prichinyDlya(mest: number): KodPrichiny[] {
  const parol: KodPrichiny[] =
    mest <= 1 ? ['parol'] : mest === 2 ? ['parol1', 'parol2'] : ['parol1', 'parol2', 'parol3'];
  return [...parol, 'zanyata', 'est_premium', 'drugoe'];
}

/**
 * Номер аккаунта (с нуля), у которого не подошёл пароль, — или `null`,
 * если причина не про пароль.
 *
 * ⚠️ ОТСЮДА И РЕШАЕТСЯ, УХОДИТ ЛИ ПИСЬМО «НЕ ПОДОШЁЛ ПАРОЛЬ»
 * (постановка: «при любой причине про неправильный логин или пароль
 * клиенту автоматически уходит письмо»). Отдельной галочки «это
 * случай пароля» больше нет: она была вторым источником одного
 * и того же признака.
 */
export function slotPrichiny(k: KodPrichiny): number | null {
  if (k === 'parol' || k === 'parol1') return 0;
  if (k === 'parol2') return 1;
  if (k === 'parol3') return 2;
  return null;
}

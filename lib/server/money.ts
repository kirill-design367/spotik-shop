/**
 * Деньги.
 *
 * Копейки целым числом везде, кроме показа человеку и строки
 * для Робокассы. Ни одного сложения в рублях с плавающей точкой.
 */

/** «1 490 ₽» — разряды неразрывным пробелом, как в вёрстке лендинга. */
export function rubli(kop: number): string {
  const r = Math.round(kop) / 100;
  const celye = Math.floor(Math.abs(r));
  const kopeyki = Math.round((Math.abs(r) - celye) * 100);
  const znak = r < 0 ? '−' : '';
  const s = celye.toLocaleString('ru-RU').replace(/ |\s/g, ' ');
  return kopeyki ? `${znak}${s},${String(kopeyki).padStart(2, '0')} ₽` : `${znak}${s} ₽`;
}

/**
 * Рубли строкой с двумя знаками — для подписи Робокассы.
 *
 * Строкой, а не числом, и это важно: подпись считается по ТОЙ ЖЕ
 * строке, которая уедет в параметре `OutSum`. Число 1259.1
 * и строка «1259.10» — это разные строки, и хеш у них разный.
 */
export function rubliStrokoy(kop: number): string {
  return (Math.round(kop) / 100).toFixed(2);
}

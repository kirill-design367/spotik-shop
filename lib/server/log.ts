/**
 * Журнал сервера.
 *
 * ⚠️ ПИШЕТСЯ ЧЕРЕЗ `process.stdout`, А НЕ ЧЕРЕЗ `console`, и это
 * не стилистика. В `next.config.mjs` стоит `compiler.removeConsole`,
 * и он вырезает вызовы `console.log` из ВСЕХ модулей, включая
 * серверные. До настройки SMTP журнал сервера — единственное место,
 * куда попадают коды входа и письма; вырезанный журнал означал бы,
 * что войти на сайт нельзя вовсе.
 *
 * ⚠️ ПАРОЛИ ОТ АККАУНТОВ SPOTIFY В ЖУРНАЛ НЕ ПОПАДАЮТ НИКОГДА
 * (постановка двадцать седьмой итерации). Поэтому здесь нет функции
 * «залогировать объект целиком»: всё, что пишется, перечисляется
 * руками в месте вызова. Одна общая «удобная» функция, печатающая
 * запись из базы, рано или поздно напечатает и зашифрованное поле,
 * и расшифрованное.
 */

const TS = () => new Date().toISOString();

function put(uroven: string, tekst: string, polya?: Record<string, string | number | boolean | null>) {
  const hvost = polya
    ? ' ' +
      Object.entries(polya)
        .map(([k, v]) => `${k}=${typeof v === 'string' ? JSON.stringify(v) : String(v)}`)
        .join(' ')
    : '';
  process.stdout.write(`${TS()} ${uroven} ${tekst}${hvost}\n`);
}

export const log = {
  info: (tekst: string, polya?: Record<string, string | number | boolean | null>) => put('INFO', tekst, polya),
  warn: (tekst: string, polya?: Record<string, string | number | boolean | null>) => put('WARN', tekst, polya),
  error: (tekst: string, polya?: Record<string, string | number | boolean | null>) => put('ERR ', tekst, polya),
};

/**
 * Почта в журнале — только хвост домена и длина имени.
 *
 * Адрес человека это персональные данные, а журнал systemd читают
 * все, у кого есть доступ к серверу. Для разбора беды довольно знать,
 * что адрес был и какой он формы.
 */
export function pochtaVZhurnal(email: string): string {
  const i = email.indexOf('@');
  if (i < 1) return '…';
  return `${email[0]}…${email.length - i - 1 > 0 ? email.slice(i) : ''}`;
}

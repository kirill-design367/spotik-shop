/**
 * Надписи админки на двух языках.
 *
 * ⚠️ ВСЕ НАДПИСИ ЖИВУТ ЗДЕСЬ, И ЭТО ПРЯМОЕ ТРЕБОВАНИЕ ПОСТАНОВКИ:
 * «новые надписи добавляются в одном месте, а не разбредаются
 * по коду». Поэтому ни одна строка интерфейса не пишется в разметке
 * и ни одна не возвращается из серверного действия готовым текстом —
 * действия отдают КЛЮЧ, а переводит его страница.
 *
 * ⚠️ ДАННЫЕ ЗАКАЗОВ НЕ ПЕРЕВОДЯТСЯ. Название тарифа, срок, почта
 * клиента, причина отмены — это то, что человек ввёл или выбрал,
 * и переводу оно не подлежит ни на каком языке интерфейса.
 *
 * Файл ОБЩИЙ для сервера и браузера: функцию через границу
 * серверного компонента не передать (она не сериализуется), поэтому
 * клиентским кускам отдаётся сам язык одной строкой, а словарь они
 * собирают у себя.
 */

export type Yazyk = 'ru' | 'en';

export const YAZYKI: { kod: Yazyk; imya: string }[] = [
  { kod: 'ru', imya: 'Рус' },
  { kod: 'en', imya: 'Eng' },
];

/** По умолчанию русский — постановка. */
export const PO_UMOLCHANIYU: Yazyk = 'ru';

export function ponyatYazyk(v: string | undefined | null): Yazyk {
  return v === 'en' ? 'en' : 'ru';
}

/* Порядок в паре один и тот же везде: [русский, английский]. */
const S = {
  /* ── Шапка ───────────────────────────────────────────────────── */
  'nav.title': ['Админка — Spotik Shop', 'Admin — Spotik Shop'],
  'nav.queue': ['Очередь', 'Queue'],
  'nav.prices': ['Цены', 'Prices'],
  'nav.certs': ['Сертификаты', 'Certificates'],
  'nav.staff': ['Сотрудники', 'Staff'],
  'nav.site': ['Сайт', 'Site'],
  'nav.logout': ['Выйти', 'Log out'],
  'nav.lang': ['Язык интерфейса', 'Interface language'],

  /* ── Общее ───────────────────────────────────────────────────── */
  'o.no_db': ['На этом сервере не настроена база.', 'No database configured on this server.'],
  'o.only_admin': ['Только для администраторов.', 'Administrators only.'],
  'o.no_order': ['Заказ не найден.', 'Order not found.'],
  'o.save': ['Сохранить', 'Save'],
  'o.saving': ['Сохраняем…', 'Saving…'],

  /* ── Вход ────────────────────────────────────────────────────── */
  'in.h': ['Вход', 'Sign in'],
  'in.hint': ['Войти могут только адреса из списка сотрудников.', 'Only addresses on the staff list can sign in.'],
  'in.email': ['Почта', 'Email'],
  'in.send': ['Выслать код', 'Send code'],
  'in.sending': ['Высылаем…', 'Sending…'],
  'in.code_to': ['Код отправлен на {email}', 'Code sent to {email}'],
  'in.enter': ['Войти', 'Sign in'],
  'in.checking': ['Проверяем…', 'Checking…'],

  /* ── Очередь ─────────────────────────────────────────────────── */
  'q.h': ['Очередь заказов', 'Order queue'],
  'q.hint': [
    'Возьмите заказ, чтобы увидеть данные клиента и начать работу.',
    'Take an order to see the client data and start working on it.',
  ],
  'q.setup': ['Что настроено на сервере', 'Server setup'],
  'q.mail': ['Почта', 'Email'],
  'q.mail_on': ['SMTP настроен', 'SMTP configured'],
  'q.mail_off': [
    'НЕ настроен — коды и письма идут в журнал сервера',
    'NOT configured — codes and letters go to the server log',
  ],
  'q.crypto': ['Шифрование доступов', 'Credential encryption'],
  'q.crypto_on': ['ключ на месте', 'key present'],
  'q.crypto_off': ['КЛЮЧА НЕТ — пароли сохранять нельзя', 'NO KEY — passwords cannot be stored'],
  'q.pay': ['Оплата', 'Payments'],
  'q.pay_test': ['Робокасса в ТЕСТОВОМ режиме', 'Robokassa in TEST mode'],
  'q.pay_live': ['Робокасса боевая', 'Robokassa live'],
  'q.pay_off': ['Робокасса не настроена', 'Robokassa not configured'],
  'q.tg': ['Уведомления', 'Notifications'],
  'q.tg_on': ['Telegram настроен', 'Telegram configured'],
  'q.tg_off': [
    'Telegram не настроен — уведомления идут в журнал сервера',
    'Telegram not configured — notifications go to the server log',
  ],
  'q.closed': ['Недавно закрытые', 'Recently closed'],
  'q.empty': [
    'Сейчас работы нет. Новые оплаченные заказы появляются здесь сами.',
    'Nothing to do right now. New paid orders appear here by themselves.',
  ],
  'q.live': ['На связи — обновляется каждые 15 с', 'Live — refreshes every 15 s'],
  'q.lost': ['Связь потеряна, пробуем ещё', 'Connection lost, retrying…'],
  'q.new': ['новый', 'new'],
  'q.yours': ['ваш', 'yours'],
  'q.taken': ['взял: {kto}', 'taken: {kto}'],
  'q.take': ['Взять', 'Take'],
  'q.open': ['Открыть', 'Open'],
  'q.gift': ['подарок', 'gift'],

  /* ── Столбцы таблиц ──────────────────────────────────────────── */
  't.num': ['№', '#'],
  't.plan': ['Тариф', 'Plan'],
  't.client': ['Клиент', 'Client'],
  't.state': ['Состояние', 'State'],
  't.closed': ['Закрыт', 'Closed'],
  't.accounts': ['Аккаунтов', 'Accounts'],
  't.term': ['Срок', 'Term'],
  't.paid': ['Оплачен', 'Paid'],
  't.email': ['Почта', 'Email'],
  't.role': ['Роль', 'Role'],
  't.price': ['Цена, ₽', 'Price, ₽'],
  't.source': ['Откуда', 'Source'],
  't.code': ['Код', 'Code'],
  't.gift': ['Подарок', 'Gift'],
  't.bought_by': ['Купил', 'Bought by'],
  't.bought': ['Куплен', 'Bought'],
  't.until': ['Годен до', 'Valid until'],
  't.activated_by': ['Активировал', 'Activated by'],
  't.order': ['Заказ', 'Order'],

  /* ── Состояния заказа ────────────────────────────────────────── */
  'st.new': ['новый', 'new'],
  'st.paid': ['оплачен', 'paid'],
  'st.in_work': ['в работе', 'in work'],
  'st.done': ['выполнен', 'done'],
  'st.cancelled': ['отменён', 'cancelled'],

  /* ── Карточка заказа ─────────────────────────────────────────── */
  'z.h': ['Заказ № {n}', 'Order #{n}'],
  'z.back': ['← назад в очередь', '← back to the queue'],
  'z.money': ['Деньги', 'Money'],
  'z.money_gift': [
    'денег нет — заказ по подарочному сертификату, их взяли при его покупке',
    'nothing is due — a gift certificate was redeemed, the money was taken when it was bought',
  ],
  'z.money_sum': [
    '{total} ₽ всего · {balance} с баланса · {card} картой',
    '{total} ₽ total · {balance} from balance · {card} by card',
  ],
  'z.taken_by': ['взял {kto}', 'taken by {kto}'],
  'z.cancel_reason': ['Отменён потому что', 'Cancelled because'],
  'z.take': ['Взять заказ', 'Take this order'],
  'z.release': ['Вернуть в очередь', 'Put back in the queue'],
  'z.done_note': [
    'Заказ закрыт. Клиенту отправлено письмо, доступы он видит в своём кабинете.',
    'Order is closed. The client has been emailed and sees the credentials in their cabinet.',
  ],
  'z.cancelled_note': [
    'Заказ отменён. Деньги вернулись на баланс клиента.',
    'Order is cancelled. The money is back on the client balance.',
  ],
  'z.wiped': [
    'Доступы стёрты через 7 дней после закрытия заказа.',
    'Credentials were wiped 7 days after this order closed.',
  ],
  'z.take_first': [
    'Возьмите заказ, чтобы увидеть доступы клиента. Они расшифровываются только тому, кто взял заказ.',
    'Take the order to see the client credentials. They are decrypted for the assigned operator only.',
  ],
  'z.finish': ['Завершить', 'Finish'],
  'z.finish_btn': ['Отметить весь заказ выполненным', 'Mark the whole order done'],
  'z.closing': ['Закрываем…', 'Closing…'],
  'z.need_all': ['Сначала должен быть готов каждый участник.', 'Every participant must be done first.'],
  'z.cancel': ['Отмена и возврат', 'Cancel and refund'],
  'z.reason': ['Причина (её увидит клиент)', 'Reason (the client sees this)'],
  'z.reason_ph': ['Не подошёл пароль от существующего аккаунта', 'Wrong password on the existing account'],
  'z.badpass': ['Это случай «пароль не подошёл»', 'This is the wrong-password case'],
  'z.cancel_btn': ['Отменить заказ, деньги на баланс клиента', 'Cancel order, money to client balance'],
  'z.cancelling': ['Отменяем…', 'Cancelling…'],
  'z.need_letter': [
    'В случае «пароль не подошёл» сначала отправьте письмо с инструкцией — до этого отмена не проходит.',
    'For the wrong-password case send the recovery email first — cancelling is blocked until then.',
  ],

  /* ── Участник ────────────────────────────────────────────────── */
  'u.account': ['Аккаунт {n} — ', 'Account {n} — '],
  'u.new': ['Новый аккаунт', 'New account'],
  'u.renew': ['Продлить собственный аккаунт клиента', 'Renew the client’s own account'],
  'u.done': [' · готово', ' · done'],
  'u.renew_steps': [
    '1. Откройте spotify.com и войдите под доступами ниже. 2. Включите Premium на выбранный срок. 3. Вернитесь и отметьте выполненным.',
    '1. Open spotify.com and sign in with the credentials below. 2. Turn Premium on for the chosen term. 3. Come back and mark it done.',
  ],
  'u.password': ['Пароль', 'Password'],
  'u.wiped': ['— стёрто —', '— wiped —'],
  'u.renew_done': ['Premium включён — отметить выполненным', 'Premium is on — mark done'],
  'u.recovery_sent': ['Письмо с восстановлением отправлено', 'Recovery email sent'],
  'u.recovery': ['Пароль не подошёл — написать клиенту', 'Password does not work — email the client'],
  'u.sending': ['Отправляем…', 'Sending…'],
  'u.new_steps': [
    '1. Заведите клиенту новый почтовый ящик. 2. Зарегистрируйте на него аккаунт Spotify и включите Premium на выбранный срок. 3. Впишите все три строки ниже — клиент увидит их в кабинете сразу.',
    '1. Create a fresh mailbox for the client. 2. Register a Spotify account on it and turn Premium on for the chosen term. 3. Paste all three below — the client sees them in their cabinet right away.',
  ],
  'u.login': ['Логин', 'Login'],
  'u.login_email': ['Логин (почта)', 'Login (email)'],
  'u.mailpass': ['Пароль от ящика', 'Mailbox password'],
  'u.spotpass': ['Пароль от Spotify', 'Spotify password'],
  'u.save_creds': ['Сохранить доступы', 'Save credentials'],
  'u.update_creds': ['Обновить доступы', 'Update credentials'],

  /* ── Цены ────────────────────────────────────────────────────── */
  'c.h': ['Цены', 'Prices'],
  'c.hint': [
    'Цена — в рублях за весь срок. Очистите поле и сохраните, чтобы перестать продавать этот срок: на лендинге он пропадёт. Подарочный сертификат стоит ровно столько, сколько тариф в нём, и своей цены не имеет.',
    'Prices are in roubles for the whole term. Leave a field empty and save to stop selling that term — the landing hides it. A gift certificate costs exactly the same as the plan it carries, so it has no price of its own.',
  ],
  'c.from_db': ['база', 'database'],
  'c.from_default': ['умолчание', 'default'],
  'c.cert_h': ['Срок действия сертификата', 'Certificate validity'],
  'c.cert_hint': [
    'Сколько подарочный код остаётся годным после покупки.',
    'How long a gift code stays usable after it was bought.',
  ],
  'c.days': ['Дней с покупки', 'Days from purchase'],

  /* ── Сотрудники ──────────────────────────────────────────────── */
  'f.h': ['Сотрудники', 'Staff'],
  'f.hint': [
    'Войти сюда могут только эти адреса. Администраторы видят всё и правят цены и состав; операторы берут заказы и выполняют их.',
    'Only these addresses can sign in here. Administrators see everything and manage prices and staff; operators take and fulfil orders.',
  ],
  'f.role_op': ['оператор', 'operator'],
  'f.role_admin': ['администратор', 'administrator'],
  'f.add': ['Добавить или обновить', 'Add or update'],
  'f.current': ['Сейчас', 'Current'],
  'f.you': [' · это вы', ' · you'],
  'f.disabled': ['отключён', 'disabled'],
  'f.active': ['активен', 'active'],
  'f.disable': ['Отключить', 'Disable'],

  /* ── Сертификаты ─────────────────────────────────────────────── */
  's.h': ['Подарочные сертификаты', 'Gift certificates'],
  's.hint': [
    'Сертификат несёт тариф и срок и стоит ровно столько, сколько этот тариф. Сам код лежит в базе зашифрованным и виден только тому, кто его купил, в его кабинете; здесь видны четыре последних знака.',
    'A certificate carries a plan and a term and costs exactly what that plan costs. The code itself is stored encrypted and is visible only to the buyer, in their own cabinet — here you see its last four characters.',
  ],
  's.empty': ['Сертификатов ещё не выпускали.', 'No certificates have been issued yet.'],
  's.valid': ['годен', 'valid'],
  's.used': ['использован', 'used'],
  's.expired': ['просрочен', 'expired'],

  /* ── Отказы ──────────────────────────────────────────────────── */
  'e.check_email': ['Проверьте адрес почты.', 'Check the email address.'],
  'e.not_staff': ['Этого адреса нет в списке сотрудников.', 'This address is not on the staff list.'],
  'e.often': ['Код только что отправлен. Попробуйте через минуту.', 'A code was just sent. Try again in a minute.'],
  'e.send_fail': ['Код отправить не вышло.', 'Could not send the code.'],
  'e.no_code': ['Для этого адреса кода нет. Запросите новый.', 'No code for this address. Request a new one.'],
  'e.wrong_code': ['Неверный код.', 'Wrong code.'],
  'e.attempts': ['Слишком много попыток. Запросите новый код.', 'Too many attempts. Request a new code.'],
  'e.expired': ['Код истёк. Запросите новый.', 'The code has expired. Request a new one.'],
  'e.session': ['Сессия истекла. Войдите заново.', 'Session expired. Log in again.'],
  'e.no_key': [
    'На сервере нет SPOTIK_CRYPTO_KEY — доступы сохранять нельзя.',
    'SPOTIK_CRYPTO_KEY is missing on the server — credentials cannot be stored.',
  ],
  'e.not_yours': ['Этот заказ взят не вами.', 'This order is not taken by you.'],
  'e.fill_three': ['Заполните все три поля.', 'Fill in all three fields.'],
  'e.save_creds': ['Доступы сохранить не вышло.', 'Could not save the credentials.'],
  'e.mark_done': ['Отметить участника выполненным не вышло.', 'Could not mark this participant as done.'],
  'e.not_all_done': ['Ещё не все участники готовы.', 'Not every participant is done yet.'],
  'e.recovery_first': [
    'Сначала отправьте письмо с восстановлением пароля — до этого отмена не проходит.',
    'Send the password-recovery email first — cancelling is blocked until then.',
  ],
  'e.cancel_fail': ['Отменить не вышло.', 'Could not cancel.'],
  'e.pick_plan': ['Выберите тариф и срок.', 'Pick a plan and a term.'],
  'e.price_number': ['Цена должна быть неотрицательным числом.', 'Price must be a non-negative number.'],
  'e.days_number': ['Срок должен быть целым числом дней больше нуля.', 'Validity must be a positive number of days.'],

  /* ── Подтверждения ───────────────────────────────────────────── */
  'k.creds_saved': [
    'Сохранено. Клиент видит эти доступы в своём кабинете.',
    'Saved. The client sees these credentials in their cabinet.',
  ],
  'k.marked': ['Отмечено выполненным.', 'Marked as done.'],
  'k.order_closed': ['Заказ закрыт. Клиенту отправлено письмо.', 'Order closed. The client has been emailed.'],
  'k.recovery_sent': [
    'Инструкция по восстановлению отправлена. Теперь заказ можно отменить.',
    'Recovery instructions sent. You can cancel the order now.',
  ],
  'k.order_cancelled': [
    'Заказ отменён, деньги вернулись на баланс клиента.',
    'Order cancelled, the money is back on the client balance.',
  ],
  'k.price_removed': ['Цена убрана: на этот срок больше не продаём.', 'Price removed: this term is no longer sold.'],
  'k.price_saved': ['Цена сохранена.', 'Price saved.'],
  'k.cert_days_saved': ['Срок действия сертификата сохранён.', 'Certificate validity saved.'],
  'k.staff_saved': ['{email} теперь {role}.', '{email} is now {role}.'],
} as const satisfies Record<string, readonly [string, string]>;

export type Klyuch = keyof typeof S;

/** Подстановки вида `{imya}`. Данные заказа приходят сюда как есть. */
export type Podstanovki = Record<string, string | number>;

export type Perevod = (k: Klyuch, p?: Podstanovki) => string;

export function slovar(y: Yazyk): Perevod {
  const i = y === 'en' ? 1 : 0;
  return (k, p) => {
    let s: string = S[k][i];
    if (p) for (const [imya, v] of Object.entries(p)) s = s.split(`{${imya}}`).join(String(v));
    return s;
  };
}

/** Состояние заказа словами. Ключи приходят из базы, а не от человека. */
export function sostoyanie(t: Perevod, status: string): string {
  const k: Record<string, Klyuch> = {
    new: 'st.new',
    paid: 'st.paid',
    in_work: 'st.in_work',
    done: 'st.done',
    cancelled: 'st.cancelled',
  };
  return k[status] ? t(k[status]!) : status;
}

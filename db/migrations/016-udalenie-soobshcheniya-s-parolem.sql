-- Пятидесятая итерация: СООБЩЕНИЕ БОТА С ПАРОЛЕМ УХОДИТ ИЗ ЧАТА
-- В ТОТ ЖЕ СРОК, ЧТО ПАРОЛЬ С САЙТА.
--
-- Постановка (решение по вопросу 103): «Пароль в рабочем чате: бот
-- удаляет своё сообщение об отмене подписки через 7 дней, в тот же
-- срок, когда стирается пароль на сайте».
--
-- ⚠️ ЧТОБЫ УДАЛИТЬ СООБЩЕНИЕ, НАДО ЗНАТЬ ЕГО НОМЕР В ЧАТЕ, а до этой
-- итерации ответ `sendMessage` не сохранялся нигде. Строка заводится
-- В МОМЕНТ ОТПРАВКИ — и прямой, и из очереди, — и живёт, пока
-- сообщение не убрано.
--
-- ⚠️ СВОЯ ТАБЛИЦА, А НЕ КОЛОНКИ В `notify_outbox`. Сообщение, ушедшее
-- с первой попытки, в очередь не попадает вовсе (`soobshchitKomande`),
-- а удалить надо и его. Очередь отвечает на вопрос «что ещё не ушло»,
-- эта таблица — «что ушло и ещё не убрано».
--
-- ⚠️ ПАРОЛЕЙ ЗДЕСЬ НЕТ. `tekst_bez` — то же сообщение, где почты
-- и пароли заменены словами «wiped 7 days after the order closed»:
-- им бот ПРАВИТ сообщение, если Telegram откажет в удалении
-- (Bot API не даёт удалять сообщения старше 48 часов, см. Р-161).
-- Номер заказа здесь — ключ к сроку: убирается сообщение, когда
-- у ЭТОГО заказа стёрты секреты (`shop_order.secrets_wiped_at`).
create table if not exists tg_s_parolem (
  id          bigserial   primary key,
  order_id    bigint      not null references shop_order (id) on delete cascade,
  -- Чат и номер сообщения — ровно то, что вернул `sendMessage`.
  -- Чат хранится, а не берётся из окружения в момент удаления:
  -- сменят чат в настройках — удалять старое надо всё равно там,
  -- где оно лежит.
  chat_id     text        not null,
  message_id  bigint      not null,
  tekst_bez   text        not null,
  created_at  timestamptz not null default now(),
  -- Когда убрано и как: `udaleno` — удалено; `ispravleno` — удалить
  -- Telegram не дал, и почты с паролями вычеркнуты правкой;
  -- `uzhe_net` — сообщения в чате уже нет (удалили руками).
  ubrano_at   timestamptz,
  kak         text        check (kak in ('udaleno', 'ispravleno', 'uzhe_net')),
  popytok     int         not null default 0,
  oshibka     text
);
create index if not exists tg_s_parolem_neubrannye on tg_s_parolem (order_id) where ubrano_at is null;

-- В очередь кладётся то, без чего строку выше не завести, когда
-- сообщение уйдёт со второй попытки: номер заказа и чистый текст.
alter table notify_outbox add column if not exists order_id bigint;
alter table notify_outbox add column if not exists tekst_bez text;

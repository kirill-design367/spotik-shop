-- Очередь уведомлений сотрудникам.
--
-- ⚠️ ОЧЕРЕДЬ НУЖНА РОВНО ЗАТЕМ, ЧТОБЫ СБОЙ СВЯЗИ НЕ РОНЯЛ ОПЛАТУ
-- (постановка): «если Telegram не ответил — заказ всё равно
-- создаётся, уведомление в журнал и повтор позже». Держать такой
-- повтор в памяти процесса нельзя: выкладка перезапускает службу,
-- и всё, что не ушло, пропало бы молча.
--
-- Персональных данных КЛИЕНТА в тексте нет: туда идут номер заказа,
-- тариф, срок и — у закрытия — адрес СОТРУДНИКА, потому что канал
-- служебный и постановка требует «кто выполнил».
create table if not exists notify_outbox (
  id          bigserial primary key,
  vid         text        not null,
  tekst       text        not null,
  popytok     integer     not null default 0,
  poslednyaya_oshibka text,
  sleduyushchaya_v timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);

-- Выборка всегда одна и та же: что ещё не ушло и чему подошёл срок.
create index if not exists notify_outbox_ochered
  on notify_outbox (sleduyushchaya_v)
  where sent_at is null;

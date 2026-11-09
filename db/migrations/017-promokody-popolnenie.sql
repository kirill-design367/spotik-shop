-- Пятьдесят третья итерация: ПРОМОКОДЫ (Р-167) и ПОПОЛНЕНИЕ БАЛАНСА
-- (Р-168).

-- ── промокоды ──────────────────────────────────────────────────────
--
-- Механизм перенесён из Нейролавки (`006-promokody`), с переводом
-- на PostgreSQL. Код, скидка в процентах, срок и число активаций.
-- Остальное — следствие одного требования: двое, вводящие ПОСЛЕДНЮЮ
-- активацию одновременно, не получают её оба, и разнимает их БАЗА,
-- а не проверка в коде.
create table if not exists promokod (
  kod         text        primary key,
  -- Проценты, а не копейки: скидка считается от цены, а цены меняются.
  skidka_proc int         not null check (skidka_proc between 1 and 100),
  -- ДЕНЬ, до которого код работает ВКЛЮЧИТЕЛЬНО, по Москве. «Действует
  -- до 30 сентября» человек читает как «тридцатое ещё работает».
  -- Бессрочного кода нет: бессрочная скидка — это новая цена.
  do_daty     date        not null,
  aktivaciy   int         not null check (aktivaciy between 1 and 10000),
  -- Досрочное отключение. Не удаление: на код ссылаются заказы.
  otklyuchen  boolean     not null default false,
  staff_id    bigint      references staff (id),
  created_at  timestamptz not null default now()
);

-- АКТИВАЦИИ — ЭТО СТРОКИ, А НЕ СЧЁТЧИК. Колонка «использовано» рядом
-- с историей применений — два источника правды об одном числе.
--
-- МЕСТО — номер активации от 1 до `aktivaciy`. Занятые места не могут
-- повторяться, и держит это частичный уникальный индекс: вторая
-- вставка на то же место не проходит НА УРОВНЕ БАЗЫ.
create table if not exists promo_aktivaciya (
  id          bigserial   primary key,
  kod         text        not null references promokod (kod),
  mesto       int         not null,
  order_id    bigint      not null references shop_order (id) on delete cascade,
  user_id     bigint      not null references app_user (id),
  -- Сколько скидки дала эта активация. Снимок: цена поменяется,
  -- а в истории должно остаться то, что человек получил.
  skidka_kop  bigint      not null check (skidka_kop >= 0),
  created_at  timestamptz not null default now(),
  -- Когда активация ВЕРНУЛАСЬ коду: отмена заказа до выполнения, той же
  -- транзакцией, что и возврат денег. Строка остаётся — это история.
  snyata_v    timestamptz
);
create unique index if not exists promo_mesto_zanyato
  on promo_aktivaciya (kod, mesto) where snyata_v is null;
create index if not exists promo_po_kodu on promo_aktivaciya (kod, id);
create index if not exists promo_po_zakazu on promo_aktivaciya (order_id);

-- Заказ помнит свой промокод снимком. ⚠️ `total_kop` — это ЦЕНА
-- ПОСЛЕ ПРОМОКОДА, то есть то, по чему платят: от неё считаются
-- платёж, чек и возврат на баланс, и ни одно из этих мест не обязано
-- помнить о вычитании. Цена до промокода — `total_kop + promo_skidka_kop`.
alter table shop_order add column if not exists promo_kod text;
alter table shop_order add column if not exists promo_skidka_kop bigint not null default 0;

-- Неудачные проверки кода — для предела частоты, как у сертификата
-- (Р-107): без него код из восьми знаков вылавливается перебором.
create table if not exists promo_try (
  id         bigserial   primary key,
  adres      text        not null,
  user_id    bigint,
  created_at timestamptz not null default now()
);
create index if not exists promo_try_adres on promo_try (adres, created_at);
create index if not exists promo_try_user on promo_try (user_id, created_at);

-- ── пополнение баланса ─────────────────────────────────────────────
--
-- Платёж без заказа. Счёт в Робокассе — это `payment.id` (Р-88),
-- поэтому пополнение живёт в ТОЙ ЖЕ таблице: два источника номеров
-- счёта дали бы повторный `InvId`, а его Робокасса не принимает
-- никогда. Дверь «оплачено» тоже одна — `otmetitOplachennym`.
alter table payment add column if not exists kind text not null default 'order';
alter table payment add column if not exists user_id bigint references app_user (id);
alter table payment alter column order_id drop not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payment_kind_check') then
    alter table payment add constraint payment_kind_check check (
      (kind = 'order' and order_id is not null)
      or (kind = 'topup' and order_id is null and user_id is not null)
    );
  end if;
end $$;
create index if not exists payment_popolnenie on payment (paid_at) where kind = 'topup';

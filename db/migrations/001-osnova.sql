-- Основа: люди, вход, заказы, платежи, сертификаты, сотрудники.
--
-- ⚠️ ДЕНЬГИ ВЕЗДЕ В КОПЕЙКАХ И ЦЕЛЫМ ЧИСЛОМ. Ни одна сумма
-- на сайте не считается в рублях с плавающей точкой: 0.1 + 0.2
-- в двоичной дроби не равно 0.3, и на балансе это рано или поздно
-- станет копейкой из ниоткуда.
--
-- ⚠️ ПАРОЛИ ОТ АККАУНТОВ SPOTIFY ЛЕЖАТ ТОЛЬКО В ПОЛЯХ `*_enc`,
-- и в них — шифротекст AES-256-GCM (lib/server/crypto.ts). Ключ
-- в базе не лежит: он приходит из окружения сервера. Унесённая
-- резервная копия доступов не открывает.

create table if not exists app_user (
  id          bigserial primary key,
  email       text        not null unique,
  balance_kop bigint      not null default 0 check (balance_kop >= 0),
  created_at  timestamptz not null default now()
);

create table if not exists staff (
  id         bigserial primary key,
  email      text        not null unique,
  role       text        not null default 'operator' check (role in ('admin', 'operator')),
  disabled   boolean     not null default false,
  created_at timestamptz not null default now()
);

-- Коды входа. Живут десять минут, пять попыток, потом мертвы.
create table if not exists login_code (
  id         bigserial primary key,
  email      text        not null,
  scope      text        not null check (scope in ('client', 'staff')),
  code_hash  text        not null,
  attempts   int         not null default 0,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists login_code_poisk on login_code (email, scope, created_at desc);

-- Сессия лежит в базе ОТПЕЧАТКОМ токена, а не самим токеном:
-- унесённая база не даёт войти ни в один кабинет.
create table if not exists session (
  id         bigserial primary key,
  token_hash text        not null unique,
  scope      text        not null check (scope in ('client', 'staff')),
  user_id    bigint      references app_user (id) on delete cascade,
  staff_id   bigint      references staff (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists session_srok on session (expires_at);

-- Настройки: срок жизни сертификата и прочее, что меняет админ.
create table if not exists setting (
  key        text primary key,
  value      text        not null,
  updated_at timestamptz not null default now()
);

-- Цены тарифов. Пусто — берутся значения по умолчанию из lib/plans.ts.
create table if not exists plan_price (
  plan_id   text   not null,
  period    int    not null,
  price_kop bigint not null check (price_kop >= 0),
  primary key (plan_id, period)
);

create table if not exists shop_order (
  id               bigserial primary key,
  user_id          bigint      not null references app_user (id),
  kind             text        not null check (kind in ('plan', 'certificate')),
  plan_id          text        not null,
  period           int         not null,
  status           text        not null check (status in ('new', 'paid', 'in_work', 'done', 'cancelled')),
  total_kop        bigint      not null check (total_kop >= 0),
  balance_kop      bigint      not null default 0,
  money_kop        bigint      not null default 0,
  source           text        not null default 'payment' check (source in ('payment', 'certificate')),
  certificate_id   bigint,
  operator_id      bigint      references staff (id),
  consent_at       timestamptz,
  paid_at          timestamptz,
  taken_at         timestamptz,
  closed_at        timestamptz,
  secrets_wiped_at timestamptz,
  cancel_reason    text,
  created_at       timestamptz not null default now()
);
create index if not exists shop_order_ochered on shop_order (status, paid_at);
create index if not exists shop_order_chey on shop_order (user_id, created_at desc);
-- Уборка доступов идёт ПО ЭТОМУ индексу: закрытые заказы, у которых
-- секреты ещё не стёрты.
create index if not exists shop_order_uborka on shop_order (closed_at) where secrets_wiped_at is null;

create table if not exists order_slot (
  id                bigserial primary key,
  order_id          bigint not null references shop_order (id) on delete cascade,
  idx               int    not null,
  mode              text   not null check (mode in ('new', 'renew')),
  -- Что дал клиент: свой аккаунт Spotify (только при mode='renew').
  in_login_enc      text,
  in_password_enc   text,
  -- Что выдал оператор: новый аккаунт (только при mode='new').
  out_login_enc     text,
  out_mail_pass_enc text,
  out_password_enc  text,
  recovery_sent_at  timestamptz,
  done_at           timestamptz,
  unique (order_id, idx)
);

create table if not exists payment (
  id          bigserial primary key,
  order_id    bigint      not null references shop_order (id) on delete cascade,
  provider    text        not null,
  amount_kop  bigint      not null check (amount_kop > 0),
  status      text        not null check (status in ('new', 'paid', 'failed')),
  external_id text,
  created_at  timestamptz not null default now(),
  paid_at     timestamptz
);
create index if not exists payment_zakaz on payment (order_id);

create table if not exists certificate (
  id              bigserial primary key,
  -- Отпечаток для поиска, шифротекст для показа владельцу, хвост
  -- для списка. Открытого кода в базе нет.
  code_hash       text        not null unique,
  code_enc        text        not null,
  tail            text        not null,
  plan_id         text        not null default 'gift',
  period          int         not null,
  buyer_id        bigint      references app_user (id),
  bought_order_id bigint      references shop_order (id),
  expires_at      timestamptz not null,
  used_at         timestamptz,
  used_order_id   bigint      references shop_order (id),
  created_at      timestamptz not null default now()
);
create index if not exists certificate_chey on certificate (buyer_id, created_at desc);

-- Движение баланса: откуда деньги пришли и куда ушли. Нужна не для
-- красоты — без неё «на балансе 2690, а почему» не разобрать.
create table if not exists balance_move (
  id         bigserial primary key,
  user_id    bigint      not null references app_user (id),
  delta_kop  bigint      not null,
  reason     text        not null,
  order_id   bigint,
  created_at timestamptz not null default now()
);
create index if not exists balance_move_chey on balance_move (user_id, created_at desc);

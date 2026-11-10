-- Пятьдесят четвёртая итерация: РАЗДАЧА ЗАКАЗОВ ОПЕРАТОРАМ В TELEGRAM.
--
-- Постановка: «Каждый новый оплаченный заказ автоматически назначается
-- оператору по очереди среди тех, кому в „Сотрудниках" разрешена эта
-- пара „тариф × срок"… бот пишет ему в личку на английском… кнопка
-- „Take". Заказ сразу виден только ему».
--
-- Здесь вся схема раздачи разом: привязка чата оператора, состояние
-- раздачи у заказа, история предложений, три новых глагола журнала
-- и защита бота от повторной доставки обновлений.

-- ── ПРИВЯЗКА TELEGRAM ───────────────────────────────────────────────
--
-- ⚠️ ЧАТ ОДИН НА СОТРУДНИКА, И СОТРУДНИК ОДИН НА ЧАТ. Личный чат
-- с ботом — это номер пользователя Telegram (`chat.id === from.id`),
-- и два сотрудника на одном чате значили бы, что предложения одного
-- приходят другому. Уникальность держит база; привязка нового
-- сотрудника к уже занятому чату сперва снимает его у прежнего.
--
-- ⚠️ НОМЕР ПОЛЬЗОВАТЕЛЯ TELEGRAM БЫВАЕТ ДЛИННЕЕ 32 БИТ (до 52 значащих),
-- поэтому `bigint`, а не `int`.
alter table staff add column if not exists tg_chat_id bigint;
create unique index if not exists staff_tg_chat on staff (tg_chat_id) where tg_chat_id is not null;
alter table staff add column if not exists tg_privyazan_at timestamptz;
-- Кто ИМЕННО открыл ссылку: ссылку передают из рук в руки, и открыть её
-- может кто угодно. Ник и имя — данные Telegram, а не наши надписи:
-- на экране они стоят под `translate="no"` (закон 54).
alter table staff add column if not exists tg_username text;
alter table staff add column if not exists tg_imya text;

-- Одноразовая ссылка привязки: живёт сутки.
--
-- ⚠️ В БАЗЕ ЛЕЖИТ ОТПЕЧАТОК, А НЕ САМ ТОКЕН — как у сессии и у ссылки
-- восстановления (Р-87, Р-144): унесённая база не привязывает ничей
-- чат. Сам токен знает только экран администратора и ссылка.
create table if not exists tg_privyazka (
  token_hash text        primary key,
  staff_id   bigint      not null references staff (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz
);
create index if not exists tg_privyazka_staff on tg_privyazka (staff_id) where used_at is null;

-- ── СОСТОЯНИЕ РАЗДАЧИ У ЗАКАЗА ──────────────────────────────────────
--
-- `null` — как до раздачи: заказ в общей очереди, его видят все, кому
-- разрешена пара. `zhdyot` — копится и операторам не виден (ночь или
-- ещё не раздан); `predlozhen` — предложен одному (`offer_staff_id`)
-- до `offer_until`; `obshchaya` — круг пройден или раздавать некому,
-- и заказ в общей очереди.
--
-- ⚠️ ВИДИМОСТЬ И ИСТЕЧЕНИЕ ЧИТАЮТ ТОЛЬКО ЭТИ КОЛОНКИ, а `order_offer`
-- ниже — история и номера сообщений (поправка concurrency-9). Пишутся
-- они в одной транзакции под блокировкой строки заказа.
alter table shop_order add column if not exists razdacha text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'shop_order_razdacha_check') then
    alter table shop_order add constraint shop_order_razdacha_check
      check (razdacha in ('zhdyot', 'predlozhen', 'obshchaya'));
  end if;
end $$;
alter table shop_order add column if not exists offer_staff_id bigint references staff (id) on delete set null;
alter table shop_order add column if not exists offer_until timestamptz;
-- Когда состояние раздачи менялось в последний раз: по нему сторож
-- тика находит заказ, застрявший в `zhdyot` (поправка concurrency-7).
alter table shop_order add column if not exists razdacha_at timestamptz;
-- Тику нужны только живые состояния — их единицы, а заказов тысячи.
create index if not exists shop_order_razdacha on shop_order (razdacha, offer_until)
  where razdacha in ('zhdyot', 'predlozhen');

-- ── ИСТОРИЯ ПРЕДЛОЖЕНИЙ ─────────────────────────────────────────────
--
-- Строка на каждое предложение: кому, в каком круге, до какого времени
-- и чем кончилось. Номер личного сообщения хранится здесь, чтобы
-- по закрытии предложения его поправить («is yours» / «no longer
-- offered to you»).
--
-- ⚠️ ИСХОД `ne_dostavleno` — личное сообщение не ушло (Telegram
-- недоступен, бот заблокирован): предложение закрывается сразу,
-- а не прячет заказ ещё пятнадцать минут (поправка concurrency-8).
create table if not exists order_offer (
  id            bigserial   primary key,
  order_id      bigint      not null references shop_order (id) on delete cascade,
  staff_id      bigint      not null references staff (id) on delete cascade,
  -- Номер круга раздачи ЭТОГО заказа: в одном круге одному оператору
  -- заказ предлагается не больше раза.
  krug          int         not null,
  created_at    timestamptz not null default now(),
  until         timestamptz not null,
  ishod         text        check (ishod in ('vzyal', 'istyok', 'snyat', 'perenaznachen', 'ne_dostavleno')),
  closed_at     timestamptz,
  tg_message_id bigint,
  tg_chat_id    bigint
);
-- ⚠️ ОТКРЫТОЕ ПРЕДЛОЖЕНИЕ У ЗАКАЗА ОДНО — И ДЕРЖИТ ЭТО БАЗА. Гонка
-- оплаты и тика иначе завела бы два предложения и два личных сообщения
-- на один заказ; здесь вторая вставка просто не пройдёт.
create unique index if not exists order_offer_otkrytoe on order_offer (order_id) where closed_at is null;
create index if not exists order_offer_zakaz on order_offer (order_id, id);
-- «Кому дольше всех не предлагали ничего» (поправка concurrency-3).
create index if not exists order_offer_komu on order_offer (staff_id, created_at);

-- ── ЖУРНАЛ ──────────────────────────────────────────────────────────
--
-- Три новых глагола: заказ предложен оператору, оператор его не взял
-- (истекло, не доставлено, оператор перестал быть пригодным),
-- администратор назначил заказ вручную. Кому назначил — своя колонка:
-- `staff_id` у события — тот, КТО сделал (администратор), а не тот,
-- КОМУ (Р-153).
alter table order_event drop constraint if exists order_event_vid_check;
alter table order_event add constraint order_event_vid_check
  check (vid in ('vzyal', 'vernul', 'vypolnil', 'otmenil', 'otmena_zaproshena', 'podpiska_otmenena',
                 'predlozhen', 'ne_vzyal', 'naznachil'));
alter table order_event add column if not exists komu_staff_id bigint references staff (id) on delete set null;

-- ── ОБНОВЛЕНИЯ БОТА ─────────────────────────────────────────────────
--
-- ⚠️ ПОВТОРЫ ОТСЕКАЮТСЯ МНОЖЕСТВОМ НОМЕРОВ, А НЕ СРАВНЕНИЕМ С ПОСЛЕДНИМ.
-- Обновление подтверждается только следующим `getUpdates`, и два
-- экземпляра приложения (выкладка, второй сервер сторожа) или падение
-- между обработкой и записью offset доставят его ещё раз. А после
-- недели тишины Telegram начинает номера со СЛУЧАЙНОГО числа: правило
-- «номер не больше сохранённого — пропустить» отрезало бы с этого
-- момента всё навсегда (поправка concurrency-5). Строка живёт двое
-- суток — дольше Telegram обновления не держит.
create table if not exists tg_obnovlenie (
  update_id  bigint      primary key,
  created_at timestamptz not null default now()
);
create index if not exists tg_obnovlenie_vozrast on tg_obnovlenie (created_at);

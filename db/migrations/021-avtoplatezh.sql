-- Пятьдесят четвёртая итерация: АВТОПЛАТЁЖ.
--
-- Постановка: «Робокасса подключает периодические платежи только
-- по согласованию… Код делаем сейчас, с выключателем в админке
-- „Автоплатёж" — по умолчанию выключен. Пока выключен, клиент ничего
-- про автоплатёж не видит».
--
-- Здесь вся схема разом: подписка, ссылка «Отключить» из письма,
-- дочерние списания в той же таблице `payment` и пометка заказов,
-- которые создал автоплатёж. Выключатель — строка `setting
-- 'avtoplatezh'`; её нет — выключен (`setting` усекается в проверках,
-- поэтому умолчание живёт в коде, а не здесь).

-- ── ПОДПИСКА ────────────────────────────────────────────────────────
--
-- Одна строка — одна цепочка продлений одного набора аккаунтов.
-- `order_id` — ТЕКУЩИЙ заказ цепочки: на его карточке подписка видна
-- в кабинете, от его `expires_at` считается день списания. После
-- удачного продления строка переезжает на новый заказ.
--
-- ⚠️ `mat_payment_id` — МАТЕРИНСКИЙ СЧЁТ (PreviousInvoiceID): первый
-- платёж серии, оплаченный картой со `Recurring=true`. Ставится ровно
-- тогда, когда его оплата подтверждена ПРОВЕРЕННЫМ уведомлением
-- (закон 34), и больше не меняется: Робокасса требует номер ПЕРВОГО
-- платежа серии, а не прошлого дочернего.
--
-- ⚠️ СОГЛАСИЕ ХРАНИТСЯ ТЕКСТОМ, КОТОРЫЙ ВИДЕЛ ЧЕЛОВЕК, и временем.
-- Робокасса перед включением рекуррентов просит историю согласий,
-- а 69-ФЗ и 376-ФЗ — информированное согласие с ценой и сроком.
-- Текст собирает на сервере та же функция, что и на форме
-- (`lib/avtoplatezh.ts`), а не берёт его из формы: поле формы
-- правится в браузере. При отключении эти две колонки не трогаются.
create table if not exists avtoplatezh (
  id                     bigserial   primary key,
  user_id                bigint      not null references app_user (id) on delete cascade,
  order_id               bigint      not null references shop_order (id) on delete cascade,
  plan_id                text        not null,
  period                 int         not null,
  mat_payment_id         bigint      references payment (id) on delete set null,
  status                 text        not null check (status in ('zhdyot_oplaty', 'vklyuchen', 'ne_karta', 'otklyuchen')),
  -- Почему отключён. Словами её говорит кабинет; здесь — ключ.
  --   klient         — отключил сам человек («Отключить» или «Не включать»);
  --   admin          — отключил администратор (просьба через поддержку);
  --   dve_neudachi   — два раза не удалось списать оплату;
  --   zakaz_otmenyon — заказ подписки отменён;
  --   ne_prodayotsya — пара «тариф × срок» больше не продаётся;
  --   prosrochen     — срок кончился раньше, чем ушло письмо о списании;
  --   testovaya      — материнский платёж прошёл в тестовом режиме;
  --   zamenena       — на те же аккаунты заведена новая подписка;
  --   bez_recurring  — заказ оплачен счётом без `Recurring=true`
  --                    (выключатель выключили между оформлением
  --                    и оплатой, или «Не включать» до оплаты).
  prichina               text        check (prichina in ('klient', 'dve_neudachi', 'zakaz_otmenyon', 'ne_prodayotsya',
                                                          'admin', 'prosrochen', 'testovaya', 'zamenena', 'bez_recurring')),
  -- Способ первой оплаты как пришёл из уведомления:
  -- «<PaymentMethod>/<IncCurrLabel>».
  sposob                 text,
  -- Неудач в ТЕКУЩЕМ цикле — только «неудача клиента» (отказ банка).
  neudach                int         not null default 0,
  -- Когда пробовать снова (после первой неудачи — завтра в 10:00 МСК).
  sleduyushchaya_popytka timestamptz,
  -- Дочерний счёт, ждущий ResultURL. Ставится ДО запроса Recurring
  -- и в отдельной транзакции: второй экземпляр приложения (выкладка)
  -- видит его и не шлёт второй запрос — двойного списания нет.
  platezh_v_puti         bigint      references payment (id) on delete set null,
  -- Когда запрос Recurring ушёл (ответ OK или обрыв после отправки).
  -- Пусто при заданном `platezh_v_puti` — процесс упал до отправки.
  otpravlen_at           timestamptz,
  -- ⚠️ ПИСЬМО О СПИСАНИИ — ВОРОТА СПИСАНИЯ. Дата окончания цикла,
  -- о которой уже напомнили, когда и какую сумму назвали: списать
  -- можно не раньше суток после письма и не больше названной суммы.
  napomnil_za_cikl       date,
  napomnil_at            timestamptz,
  napomnil_summa_kop     bigint,
  soglasie_at            timestamptz not null default now(),
  soglasie_tekst         text        not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  otklyuchen_at          timestamptz,
  unique (order_id)
);
create index if not exists avtoplatezh_vladelec on avtoplatezh (user_id);
-- Часовой тик смотрит только живые подписки, а их единицы.
create index if not exists avtoplatezh_zhivye on avtoplatezh (status) where status in ('vklyuchen', 'zhdyot_oplaty');

-- ── ССЫЛКА «ОТКЛЮЧИТЬ» ИЗ ПИСЬМА ────────────────────────────────────
--
-- ⚠️ В БАЗЕ ЛЕЖИТ ОТПЕЧАТОК, А НЕ САМ ТОКЕН — как у сессии и у ссылки
-- восстановления (Р-87, Р-144): унесённая база не отключает ничью
-- подписку. Живёт тридцать дней.
create table if not exists avto_token (
  token_hash     text        primary key,
  avtoplatezh_id bigint      not null references avtoplatezh (id) on delete cascade,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null
);
create index if not exists avto_token_podpiska on avto_token (avtoplatezh_id);

-- ── ПЛАТЕЖИ ─────────────────────────────────────────────────────────
--
-- Дочернее списание живёт в ТОЙ ЖЕ таблице `payment`, и по той же
-- причине, что пополнение (Р-168): номер счёта Робокассы — это
-- `payment.id`, и второй источник номеров дал бы повторный
-- `InvoiceID`, а его Робокасса не принимает никогда. Заказа у него нет
-- (его создаст удачное уведомление), владелец и подписка — есть.
--
-- ⚠️ `on delete set null` ПРИ ОГРАНИЧЕНИИ «у avto подписка обязана
-- быть» РАБОТАЕТ КАК ЗАПРЕТ, и так задумано: удалить подписку,
-- по которой уже списывали деньги, нельзя — запись о деньгах важнее.
-- У материнских и прочих счетов колонка пуста, и им это не мешает.
alter table payment add column if not exists avtoplatezh_id bigint references avtoplatezh (id) on delete set null;
-- ⚠️ МАРКЕР ЦИКЛА: заказ подписки, который ЭТО списание продлевает.
-- Уведомление сопоставляется с ним, а не с `platezh_v_puti`: ResultURL
-- может прийти раньше, чем запишется `otpravlen_at`, а подписка
-- к тому времени — переехать на другой заказ.
alter table payment add column if not exists avto_cikl_order_id bigint references shop_order (id) on delete set null;
-- Материнский счёт выставлен со `Recurring=true`.
alter table payment add column if not exists recurring boolean not null default false;
-- Способ оплаты из уведомления: «<PaymentMethod>/<IncCurrLabel>».
-- В подпись уведомления эти поля не входят; хранятся для разбора
-- и для решения «карта или нет».
alter table payment add column if not exists sposob text;
-- Режим Робокассы на момент счёта. Пусто — счёт выставлен до этой
-- миграции. Тестовая мать в боевом режиме цепочку не начнёт:
-- тестовые операции Робокасса не помнит по номеру.
alter table payment add column if not exists test boolean;

alter table payment drop constraint if exists payment_kind_check;
alter table payment add constraint payment_kind_check check (
  (kind = 'order' and order_id is not null)
  or (kind = 'topup' and order_id is null and user_id is not null)
  or (kind = 'avto' and order_id is null and user_id is not null and avtoplatezh_id is not null)
);
create index if not exists payment_avto on payment (avtoplatezh_id) where avtoplatezh_id is not null;

-- ── ЗАКАЗЫ ──────────────────────────────────────────────────────────
--
-- Заказ продления, созданный автоплатежом: `source = 'avto'`
-- и подписка, из которой он вырос. Оператору это видно словами
-- «Автопродление»: работа та же, что у продления, но клиент её
-- в этот раз не заказывал руками.
alter table shop_order drop constraint if exists shop_order_source_check;
alter table shop_order add constraint shop_order_source_check check (source in ('payment', 'certificate', 'avto'));
alter table shop_order add column if not exists avtoplatezh_id bigint references avtoplatezh (id) on delete set null;
create index if not exists shop_order_avto on shop_order (avtoplatezh_id) where avtoplatezh_id is not null;

-- Пятьдесят четвёртая итерация: ОТЗЫВЫ.
--
-- Постановка: «Только настоящие отзывы — ничего не выдумывай и не ставь
-- заглушек на боевом сайте». Отзыв заводит администратор руками или
-- оставляет клиент у выполненного заказа; клиентский уходит
-- на модерацию и до неё на сайте не виден.
--
-- ⚠️ ОДИН ОТЗЫВ НА ЗАКАЗ — УНИКАЛЬНЫЙ ИНДЕКС, И ЭТО ПОСЛЕДНЯЯ ЗАЩИТА,
-- А НЕ ПЕРВАЯ. Действие кабинета проверяет «отзыва ещё нет» само,
-- а двойное нажатие разнимает база: вторая вставка с тем же заказом
-- не проходит. У заведённых руками заказа нет, и `null` уникальности
-- не мешает.
--
-- ⚠️ ДЛИНА ТЕКСТА — 600 ЗНАКОВ, А НЕ 1500 (поправка после рецензии):
-- текущий отзыв набран крупно, все карточки «Сейчас играет» лежат
-- в одной ячейке, и самый длинный задаёт высоту всем. Отзыв в полторы
-- тысячи знаков за 7.5 с не прочесть, а экран «Сейчас играет» вышел бы
-- выше телефона. Предел стоит и здесь, и в обеих формах.
--
-- ⚠️ СОГЛАСИЕ НА ПУБЛИКАЦИЮ ХРАНИТСЯ ВРЕМЕНЕМ. Имя (или ник) и текст
-- клиента публикуются на открытой странице, то есть персональные данные
-- распространяются (152-ФЗ, ст. 10.1): нужна отдельная галочка, и момент
-- согласия обязан остаться в базе. У клиентского отзыва он обязателен,
-- у заведённого администратором его нет — там согласие брал сам Лев.
create table if not exists otzyv (
  id          bigserial   primary key,
  istochnik   text        not null check (istochnik in ('admin', 'klient')),
  order_id    bigint      unique references shop_order (id) on delete set null,
  user_id     bigint      references app_user (id) on delete set null,
  imya        text        not null check (char_length(imya) between 1 and 60),
  tekst       text        not null check (char_length(tekst) between 1 and 600),
  -- Дата отзыва. У клиентского — день создания по Москве; у заведённого
  -- руками — та, что указал Лев (не позже сегодняшней, проверка в коде).
  data        date        not null,
  -- Тариф по желанию; у клиентского — тариф его заказа. Название берётся
  -- из каталога при показе: имена — данные (Р-142).
  plan_id     text,
  status      text        not null check (status in ('moderaciya', 'opublikovan', 'skryt')),
  -- Меньше — выше. Новый опубликованный встаёт наверх: ему ставится
  -- наименьшее значение минус единица.
  poryadok    int         not null default 0,
  -- Кто завёл или промодерировал.
  staff_id    bigint      references staff (id) on delete set null,
  soglasie_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint otzyv_soglasie_klienta check (istochnik = 'admin' or soglasie_at is not null)
);
create index if not exists otzyv_pokaz on otzyv (status, poryadok, id);
-- Под предел частоты в кабинете: не больше пяти отзывов в сутки.
create index if not exists otzyv_avtor on otzyv (user_id, created_at);

-- Сорок четвёртая итерация: КТО И ЧТО СДЕЛАЛ С ЗАКАЗОМ.
--
-- Постановка: «Сотрудников будет несколько, и администратору нужно
-- видеть, кто какой заказ взял, выполнил или отменил, и сколько
-- сделал каждый… Если заказ передавали из рук в руки, видны все
-- записи по порядку».
--
-- ⚠️ ЖУРНАЛ ЗАВОДИТСЯ ПОТОМУ, ЧТО `shop_order.operator_id` НА ЭТОТ
-- ВОПРОС НЕ ОТВЕЧАЕТ И ОТВЕТИТЬ НЕ МОЖЕТ. Колонка одна и хранит
-- ТЕКУЩЕГО держателя: «Вернуть в очередь» ставит ей `null`
-- (`vernutVOchered`), и всё, что было до передачи, пропадает
-- бесследно. Ровно это постановка и просит показать.
--
-- ⚠️ В СТРОКЕ ЛЕЖИТ НОМЕР СОТРУДНИКА, А НЕ ЕГО ПОЧТА. Почта — это
-- `staff.email`, у неё один источник, и копия в журнале разошлась бы
-- с ним на первой же правке (то же правило, что у номера аккаунта
-- в причине отмены, Р-151). Адрес подставляется при чтении, join'ом.
--
-- ⚠️ ПЕРСОНАЛЬНЫХ ДАННЫХ КЛИЕНТА ТУТ НЕТ ВОВСЕ: номер заказа, номер
-- сотрудника, глагол и время. Поэтому строки живут вечно и под
-- семидневное стирание шифротекстов (закон 35) не попадают — стирать
-- в них нечего.
--
-- ⚠️ `staff_id` МОЖЕТ БЫТЬ ПУСТЫМ, И ЭТО НЕ «ДАННЫХ НЕТ». Пустой он
-- ровно у одного события — отмены САМИМ ПОКУПАТЕЛЕМ: сотрудника там
-- не было, и написать в историю «покупатель» честнее, чем не писать
-- ничего. Различает их та же колонка `cancelled_by_client`, что
-- и в кабинете (Р-126), а не догадка по пустому полю.
create table if not exists order_event (
  id         bigserial   primary key,
  order_id   bigint      not null references shop_order (id) on delete cascade,
  staff_id   bigint      references staff (id),
  vid        text        not null check (vid in ('vzyal', 'vernul', 'vypolnil', 'otmenil')),
  created_at timestamptz not null default now()
);
-- История читается по одному заказу и по порядку; статистика —
-- по виду события и времени.
create index if not exists order_event_zakaz on order_event (order_id, created_at, id);
create index if not exists order_event_kogda on order_event (vid, created_at);

-- ── ЧТО ЕСТЬ В БАЗЕ ПРО СТАРЫЕ ЗАКАЗЫ ──────────────────────────────────
--
-- Постановка, пункт 6: «Для уже существующих заказов покажи то, что
-- есть в базе. Если данных нет, поле пустое, без ошибок».
--
-- ⚠️ ЗАСЫПАЕМ ОДИН РАЗ, ЗДЕСЬ, А НЕ ВЫВОДИМ ПРИ КАЖДОМ ЧТЕНИИ. Иначе
-- у истории два источника — журнал и арифметика по `taken_at`
-- с `operator_id`, — и каждый будущий читатель обязан помнить второй.
-- Один раз выведенное и записанное оставляет ОДИН источник (то же
-- рассуждение, что в Р-142 про имена тарифов).
--
-- ⚠️ ВРЕМЯ БЕРЁТСЯ НАСТОЯЩЕЕ, А НЕ `now()`. `taken_at` и `closed_at`
-- лежат в заказе и верны; выдумывать вместо них момент миграции
-- значило бы написать в историю неправду.
--
-- ⚠️ ЧЕГО ЭТОТ ЗАСЫП НЕ ВЕРНЁТ — ПЕРЕДАЧ ИЗ РУК В РУКИ. «Вернуть
-- в очередь» обнуляло и `operator_id`, и `taken_at`: у заказа,
-- который побывал у двоих, в базе не осталось ни следа первого.
-- Это не недоделка засыпа, а то, чего в базе нет; с этой итерации
-- такие передачи пишутся сами.
insert into order_event (order_id, staff_id, vid, created_at)
select id, operator_id, 'vzyal', taken_at
  from shop_order
 where taken_at is not null and operator_id is not null;

insert into order_event (order_id, staff_id, vid, created_at)
select id, operator_id, 'vypolnil', closed_at
  from shop_order
 where status = 'done' and closed_at is not null and operator_id is not null;

-- У отмены покупателем сотрудника нет вовсе — кладём пустой номер,
-- и история честно скажет «покупатель».
insert into order_event (order_id, staff_id, vid, created_at)
select id, case when cancelled_by_client then null else operator_id end, 'otmenil', closed_at
  from shop_order
 where status = 'cancelled' and closed_at is not null
   and (cancelled_by_client or operator_id is not null);

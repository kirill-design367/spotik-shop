-- ОТКУДА ПРИШЁЛ ЗАКАЗ: метки кампании, снятые с адреса первого захода.
--
-- Пять колонок, а не один jsonb, и это не вкус: по источнику
-- группирует статистика админки, а `group by` по колонке читается
-- и планируется, тогда как по выражению из jsonb — нет.
--
-- ⚠️ ДЛИНА ОГРАНИЧЕНА В КОДЕ, А НЕ ТИПОМ. Метку пишет кто угодно
-- в адресной строке, и `varchar(n)` уронил бы СОЗДАНИЕ ЗАКАЗА
-- на чужой рекламной ссылке с длинным хвостом. Значение режется
-- при записи (lib/server/utm.ts), а тип остаётся text.
alter table shop_order add column if not exists utm_source   text;
alter table shop_order add column if not exists utm_medium   text;
alter table shop_order add column if not exists utm_campaign text;
alter table shop_order add column if not exists utm_term     text;
alter table shop_order add column if not exists utm_content  text;

-- Индекс ровно один и ровно под тот запрос, который будет: источники
-- заказов за период. Остальные четыре метки показываются в карточке
-- заказа поштучно, и группировки по ним нет.
create index if not exists shop_order_istochnik on shop_order (utm_source, created_at desc);

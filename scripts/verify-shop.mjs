/**
 * СКВОЗНАЯ ПРОВЕРКА МАГАЗИНА: заказ, оплата, работа оператора,
 * сертификат.
 *
 * ⚠️ ПРОВЕРЯЕТСЯ ЦЕПОЧКА ЦЕЛИКОМ, А НЕ ФУНКЦИИ ПООДИНОЧКЕ. Заказ,
 * оплата и выдача — это три разных места, и ошибка живёт в стыке
 * между ними: «сумма списалась, а статус не переехал», «оператор
 * заполнил, а кабинет не показал». Поэтому здесь настоящий браузер
 * ходит по настоящему серверу с настоящей базой.
 *
 * ⚠️ КОД ВХОДА ЧИТАЕТСЯ ИЗ ЖУРНАЛА СЕРВЕРА — ровно так же, как это
 * будет делать человек, пока SMTP не настроен. Значит проверка
 * заодно подтверждает, что тестовый режим почты работает.
 *
 * Нужна живая база: `DATABASE_URL` в окружении. Без неё скрипт
 * честно пропускается — на раннере GitHub PostgreSQL нет, и валить
 * там сборку из-за этого нельзя.
 */
import { launch } from './browser.mjs';
import { serveOut } from './serve-out.mjs';
import pg from 'pg';
import { execFileSync } from 'node:child_process';

const URL_BAZY = process.env.DATABASE_URL || '';
if (!URL_BAZY) {
  console.log('DATABASE_URL не задан — сквозная проверка магазина пропущена');
  process.exit(0);
}

/*
 * ⚠️ ЗАЩИТА ОТ БОЕВОЙ БАЗЫ. Скрипт ОЧИЩАЕТ таблицы, и запуск
 * с боевой строкой подключения стёр бы все заказы. Боевая база
 * видна только с самого сервера, поэтому условие простое и жёсткое:
 * работаем только с локальной.
 */
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(URL_BAZY)) {
  console.error('DATABASE_URL ведёт не на localhost — проверка очищает таблицы и на чужой базе не запускается');
  process.exit(1);
}

const PORT = 4181;
const KLYUCH = Buffer.from('spotik-proverka-klyuch-32-bayta!').toString('base64');
const ADMIN = 'admin@spotik.test';
const KLIENT = 'klient@spotik.test';
const DARENYY = 'drug@spotik.test';

/* Чистая база на каждый прогон: иначе второй запуск спотыкается
   о заказы первого, и «проверка упала» значит «проверка засорена». */
/* ⚠️ СХЕМУ НАКАТЫВАЕМ САМИ. Сторож должен работать на ПУСТОЙ базе:
   в CI она поднимается сервисом и таблиц в ней нет вовсе, а забытая
   строка `node scripts/migrate.mjs` в workflow даёт отказ, который
   читается как «сломан магазин», хотя сломана подготовка. */
execFileSync(process.execPath, ['scripts/migrate.mjs'], { stdio: 'inherit', env: process.env });

const pool = new pg.Pool({ connectionString: URL_BAZY, max: 1 });
/* ⚠️ `notify_outbox` ЧИСТИТСЯ ВМЕСТЕ СО ВСЕМ ОСТАЛЬНЫМ, И ЭТО НЕ
   аккуратность. Номера заказов после `restart identity` начинаются
   заново, а очередь уведомлений переживала чистку — и строка
   от ПРОШЛОГО прогона (хоть этого же сторожа, хоть соседнего)
   читалась как нынешняя. Поймано прогоном: сразу после verify-pay
   проверка текста уведомления взяла его строку — «Тариф:
   Индивидуальный» вместо «На двоих» — и честно провалилась,
   хотя нынешний прогон был исправен. Тот же класс, что «последняя
   строка таблицы» в Р-94. */
await pool.query(`truncate balance_move, payment, order_slot, certificate, shop_order,
  session, login_code, cert_try, support_try, app_user, staff, plan_price, plan_discount,
  plan_off, setting, notify_outbox restart identity cascade`);
await pool.end();

const server = await serveOut(PORT, {
  env: {
    DATABASE_URL: URL_BAZY,
    SPOTIK_CRYPTO_KEY: KLYUCH,
    SPOTIK_ADMINS: ADMIN,
    SPOTIK_SITE_URL: `http://localhost:${PORT}`,
    SPOTIK_FAKE_PAY_SECRET: 'proverka',
    ROBOKASSA_TEST: '1',
    /* ⚠️ TELEGRAM НАСТРОЕН, НО НЕДОСТУПЕН — И ЭТО ПРОВЕРЯЕМЫЙ СЛУЧАЙ.
       Постановка: «если Telegram не ответил, заказ всё равно
       создаётся, уведомление в журнал и повтор позже». Адрес уведён
       на закрытый порт: отказ приходит мгновенно, ждать настоящего
       таймаута в пятнадцать секунд на каждое событие незачем. */
    TELEGRAM_BOT_TOKEN: 'proverochnyy-token',
    TELEGRAM_CHAT_ID: '-1001',
    TELEGRAM_API_BASE: 'https://127.0.0.1:9',
    TELEGRAM_IP_FAMILY: '0',
  },
});

let bad = 0;
const chk = (chto, uslovie, chem = '') => {
  if (uslovie) console.log(`  OK   ${chto}${chem ? `  ${chem}` : ''}`);
  else {
    console.log(`  СБОЙ ${chto}${chem ? `  ${chem}` : ''}`);
    bad += 1;
  }
};

/**
 * Последний код входа для адреса — из журнала сервера.
 *
 * ⚠️ ЖДЁМ, А НЕ ЧИТАЕМ ОДИН РАЗ. Журнал приходит в родительский
 * процесс ТРУБОЙ, и она опаздывает за HTTP-ответом: страница уже
 * показала поле для кода, а строка письма ещё в буфере. Однократное
 * чтение падало через раз на исправном коде.
 */
const kodIzZhurnala = async (pochta) => {
  for (let i = 0; i < 100; i++) {
    const vse = [...server.zhurnal().matchAll(/Кому: (\S+)\nТема: [^\n]*\n\nКод входа: (\d{6})/g)];
    const svoi = vse.filter((m) => m[1] === pochta);
    if (svoi.length) return svoi[svoi.length - 1][2];
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
};

const browser = await launch();

/**
 * Нажать и ДОЖДАТЬСЯ. `Promise.all([waitForLoadState, click])`
 * здесь не годится вовсе: «networkidle» на уже спокойной странице
 * выполняется мгновенно, до того как браузер вообще начал переход,
 * и следующая строка читает СТАРЫЙ адрес. Проверка при этом падает
 * на исправном коде — то есть врёт.
 */
async function nazhat(page, selektor) {
  const bylo = page.url();
  await page.click(selektor);
  for (let i = 0; i < 100; i++) {
    await page.waitForTimeout(100);
    if (page.url() !== bylo) break;
  }
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(200);
}

/**
 * Вход по коду.
 *
 * ⚠️ РАБОТАЕМ ВНУТРИ ФОРМЫ ВХОДА, А НЕ ПО ВСЕЙ СТРАНИЦЕ. На странице
 * сертификата полей `code` ДВА: одно у входа, другое у самого
 * сертификата. Селектор по всей странице берёт то, которое раньше
 * в разметке, и код входа однажды уехал не туда — отказ при этом
 * выглядел как «сертификат не принят».
 */
async function voyti(page, pochta, kuda) {
  await page.goto(`http://localhost:${PORT}${kuda}`, { waitUntil: 'networkidle' });
  const vhod = () => page.locator('form').filter({ has: page.locator('input[name="email"]') }).first();
  await vhod().locator('input[name="email"]').fill(pochta);
  await vhod().locator('button[type="submit"]').click();

  // ⚠️ ПОЛЕ КОДА ОПОЗНАЁТСЯ ПО `autocomplete="one-time-code"`,
  // а не по имени. На странице сертификата полей `code` ДВА: одно
  // у входа, другое у самого сертификата, — и селектор по имени
  // берёт то, которое раньше в разметке. Код входа однажды уехал
  // не туда, и отказ выглядел как «сертификат не принят».
  const kodovoe = page.locator('input[autocomplete="one-time-code"]');
  await kodovoe.waitFor({ state: 'visible', timeout: 15000 });

  const kod = await kodIzZhurnala(pochta);
  if (!kod) {
    console.log('--- журнал сервера ---\n' + server.zhurnal().slice(-3000) + '\n--- конец ---');
    throw new Error(`кода для ${pochta} нет в журнале`);
  }
  await kodovoe.fill(kod);
  const forma = page.locator('form').filter({ has: kodovoe }).first();
  const bylo = page.url();
  await forma.locator('button[type="submit"]').click();
  for (let i = 0; i < 150; i++) {
    await page.waitForTimeout(100);
    if (page.url() !== bylo) break;
  }
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(200);
  return kod;
}

console.log('── ЗАКАЗ НА ДВОИХ: один новый аккаунт, один на продление ──');
const klient = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const oshibkiJS = [];
klient.on('pageerror', (e) => oshibkiJS.push(String(e.message)));

/* ⚠️ МЕТКИ КАМПАНИИ СНИМАЮТСЯ ДО ВХОДА И С ЛЕНДИНГА, а не с адреса
   оформления: именно так приходит человек из рекламы. Дальше он идёт
   на оформление, входит по коду, оформляет заказ — и в заказе метки
   обязаны оказаться, хотя ни одна страница после лендинга их
   в адресе уже не несёт. Это и есть «доезжают ли UTM до заказа». */
await klient.goto(
  `http://localhost:${PORT}/?utm_source=yandex&utm_medium=cpc&utm_campaign=vesna&utm_term=premium&utm_content=banner1`,
  { waitUntil: 'domcontentloaded' },
);

await voyti(klient, KLIENT, '/checkout/?plan=duo&period=12&mode=new');
chk('вход по коду из письма', klient.url().includes('/checkout/'), klient.url().replace(`http://localhost:${PORT}`, ''));

// Второй участник — на продление: там принимается чужой пароль.
await klient.click('text=Участник 2 >> xpath=following::button[normalize-space()="Продлить существующий"][1]').catch(async () => {
  const knopki = await klient.$$('button[role="radio"]');
  await knopki[knopki.length - 1].click();
});
/* ⚠️ ДАННЫЕ АККАУНТА ВВОДЯТСЯ НА ОБОИХ УЧАСТНИКОВ. С тридцать
   четвёртой итерации почту и пароль даёт КЛИЕНТ и в случае нового
   аккаунта тоже: оператор заводит его ровно на эти данные. */
await klient.fill('input[name="login0"]', 'novyy@pochta.test');
await klient.fill('input[name="password0"]', 'Novyy-Parol-9');
await klient.fill('input[name="login1"]', 'moy@akkaunt.test');
await klient.fill('input[name="password1"]', 'ochen-tayny-parol9');
await klient.check('input[name="consent"]');
await nazhat(klient, 'button[type="submit"]');
chk('заказ создан и ведёт на оплату', klient.url().includes('/pay/test/'), klient.url().replace(`http://localhost:${PORT}`, ''));

await nazhat(klient, 'button[type="submit"]');
chk('после оплаты мы в кабинете', klient.url().includes('/cabinet/'));
const telo1 = await klient.textContent('body');
chk('заказ помечен оплаченным', /Оплачен, ждёт оператора/.test(telo1 ?? ''));

console.log('── МЕТКИ КАМПАНИИ ДОЕХАЛИ ДО ЗАКАЗА ──');
{
  const pu = new pg.Pool({ connectionString: URL_BAZY, max: 1 });
  const m = await pu.query(
    'select utm_source, utm_medium, utm_campaign, utm_term, utm_content from shop_order order by id limit 1',
  );
  await pu.end();
  const r = m.rows[0] ?? {};
  /* ⚠️ СПРАШИВАЕТСЯ БАЗА, А НЕ КУКА. Кука доказала бы только,
     что браузер её сохранил; метка нужна в СТРОКЕ ЗАКАЗА —
     оттуда её берёт и карточка заказа, и статистика. */
  chk('источник записан в заказ', r.utm_source === 'yandex', String(r.utm_source));
  chk('канал записан', r.utm_medium === 'cpc', String(r.utm_medium));
  chk('кампания записана', r.utm_campaign === 'vesna', String(r.utm_campaign));
  chk('ключевое слово записано', r.utm_term === 'premium', String(r.utm_term));
  chk('объявление записано', r.utm_content === 'banner1', String(r.utm_content));
}

console.log('── ПАРОЛЬ КЛИЕНТА НЕ ЛЕЖИТ ОТКРЫТЫМ ТЕКСТОМ ──');
const p2 = new pg.Pool({ connectionString: URL_BAZY, max: 1 });
/* ⚠️ СТРОК ТЕПЕРЬ ДВЕ, А НЕ ОДНА: пароль есть у ОБОИХ участников —
   и у нового аккаунта тоже (тридцать четвёртая итерация). */
const sy = await p2.query('select in_password_enc, login_fp from order_slot where in_password_enc is not null order by idx');
chk(
  'в базе шифротекст, а не пароль',
  sy.rows.length === 2 &&
    sy.rows.every((r) => !r.in_password_enc.includes('ochen-tayny-parol9') && r.in_password_enc.startsWith('v1.')),
  `${sy.rows.length} строки, ${sy.rows[0]?.in_password_enc.slice(0, 18)}…`,
);
chk(
  'рядом лежит отпечаток почты для поиска продления',
  sy.rows.every((r) => typeof r.login_fp === 'string' && r.login_fp.length === 64),
  sy.rows[0]?.login_fp?.slice(0, 12) + '…',
);
chk('пароля нет в журнале сервера', !server.zhurnal().includes('ochen-tayny-parol9'));

console.log('── ОПЕРАТОР ──');
const admin = await browser.newPage({ viewport: { width: 1280, height: 900 } });
admin.on('pageerror', (e) => oshibkiJS.push(String(e.message)));
await voyti(admin, ADMIN, '/admin/login/');
chk('администратор вошёл', admin.url().includes('/admin'), admin.url().replace(`http://localhost:${PORT}`, ''));
const ochered = await admin.textContent('body');
chk('заказ виден в очереди', /Очередь заказов/.test(ochered ?? '') && /На двоих/.test(ochered ?? ''));

/*
 * ── АДМИНКА НА ДВУХ ЯЗЫКАХ ────────────────────────────────────────
 *
 * ⚠️ «ЗА ПОЛЬЗОВАТЕЛЕМ» ПРОВЕРЯЕТСЯ ПО БАЗЕ, А НЕ ПО ПЕРЕЗАГРУЗКЕ.
 * Постановка требует, чтобы выбор помнился за ЧЕЛОВЕКОМ, а не
 * за браузером, — а перезагрузка страницы прошла бы одинаково
 * и с кукой, и без неё. Отличает их только то, где значение лежит:
 * в строке сотрудника оно переедет с ним на другую машину, в куке —
 * нет. Поэтому смотрим саму строку.
 *
 * ⚠️ ВТОРЫМ ВХОДОМ ИЗ ЧИСТОГО КОНТЕКСТА ЭТО НЕ ПРОВЕРИТЬ: код входа
 * выдаётся не чаще одного в минуту (Р-86), и повторный вход тем же
 * адресом честно упирается в это ограничение.
 */
console.log('── АДМИНКА НА ДВУХ ЯЗЫКАХ ──');
chk('по умолчанию русский', /Очередь заказов/.test(ochered ?? ''));
await nazhat(admin, '.ad__lang-btn[value="en"]');
const poAngl = await admin.textContent('body');
chk('переключился на английский', /Order queue/.test(poAngl ?? '') && !/Очередь заказов/.test(poAngl ?? ''));
chk('атрибут языка сменился', (await admin.getAttribute('main.ad', 'lang')) === 'en');
const vBaze = await p2.query('select lang from staff where email = $1', [ADMIN]);
chk('выбор лёг В СТРОКУ СОТРУДНИКА, а не только в куку', vBaze.rows[0]?.lang === 'en', String(vBaze.rows[0]?.lang));
await admin.goto(`http://localhost:${PORT}/admin/settings/`, { waitUntil: 'networkidle' });
chk('язык держится на другой странице раздела', /Prices/.test((await admin.textContent('body')) ?? ''));
await admin.goto(`http://localhost:${PORT}/admin/`, { waitUntil: 'networkidle' });

await nazhat(admin, '.ad__lang-btn[value="ru"]');
const nazad = await admin.textContent('body');
chk('вернулся на русский', /Очередь заказов/.test(nazad ?? ''));

await nazhat(admin, 'button:has-text("Взять")');
chk('заказ взят и открылся', /\/admin\/orders\//.test(admin.url()), admin.url().replace(`http://localhost:${PORT}`, ''));
const karta = await admin.textContent('body');
chk('оператору виден пароль клиента', /ochen-tayny-parol/.test(karta ?? ''));

/* ⚠️ ОПЕРАТОР БОЛЬШЕ НЕ ВВОДИТ НИ ОДНОГО ЛОГИНА. Аккаунт он заводит
   на данные клиента — они у него перед глазами, — и закрывает слот
   одной кнопкой. Обе кнопки кончаются словами «отметить выполненным»,
   поэтому берутся по этому хвосту. */
chk(
  'оператору видна почта клиента для нового аккаунта',
  /novyy@pochta\.test/.test(karta ?? ''),
);
chk(
  'формы ввода логинов у оператора нет вовсе',
  (await admin.$$('input[name="login"]')).length === 0,
);
/* ⚠️ КНОПОК СТОЛЬКО ЖЕ, СКОЛЬКО УЧАСТНИКОВ, поэтому берётся ПЕРВАЯ
   явно: `page.click` со строгим селектором на двух совпадениях ждёт
   тридцать секунд и падает — и падает не там, где сломано. */
for (let i = 0; i < 4; i += 1) {
  const knopka = admin.locator('button:has-text("отметить выполненным")').first();
  if (!(await knopka.count())) break;
  await knopka.click();
  await admin.waitForLoadState('networkidle');
  await admin.waitForTimeout(600);
}
await nazhat(admin, 'button:has-text("Отметить весь заказ")');
const posle = await admin.textContent('body');
/* ⚠️ `\s*`, А НЕ ПРОБЕЛ: подпись и значение стоят соседними `dt`
   и `dd`, и между ними в `textContent` нет ни одного знака. */
chk('заказ закрыт', /Заказ закрыт/.test(posle ?? '') && /Состояние\s*выполнен/.test((posle ?? '').replace(/\s+/g, ' ')));

/*
 * ── КАБИНЕТ ОБНОВИЛСЯ САМ, БЕЗ ПЕРЕЗАГРУЗКИ ───────────────────────
 *
 * ⚠️ ЭТУ СТРАНИЦУ НИКТО НЕ ТРОГАЛ С МОМЕНТА ВХОДА. Она была открыта
 * ДО того, как оператор завёл доступы, и с тех пор мы её не
 * перезагружали и не переходили по ссылкам. Значит появление логина
 * на ней может объясняться ровно одним — опросом раз в пятнадцать
 * секунд и `router.refresh()`.
 *
 * ⚠️ ЖДЁМ СОБЫТИЯ, А НЕ СЕКУНД (Р-94, Р-97, Р-98): опрашиваем сам
 * экран с потолком. Фиксированная выдержка здесь была бы четвёртой
 * гонкой подряд — тик может прийти и на первой секунде, и на
 * пятнадцатой.
 */
{
  let samo = '';
  const doKogda = Date.now() + 45_000;
  while (Date.now() < doKogda) {
    samo = (await klient.textContent('body')) ?? '';
    if (/novyy@pochta\.test/.test(samo)) break;
    await klient.waitForTimeout(1000);
  }
  chk('кабинет обновился САМ, без перезагрузки', /novyy@pochta\.test/.test(samo));
  chk('и сказал, что доступы выданы', /Доступы выданы/.test(samo), samo.match(/Доступы выданы[^<]*/)?.[0] ?? '');
}

await klient.reload({ waitUntil: 'networkidle' });
const telo2 = await klient.textContent('body');
chk(
  'кабинет показывает почту, на которую включён Premium',
  /novyy@pochta\.test/.test(telo2 ?? '') && /Premium включён на почте/.test(telo2 ?? ''),
);
chk('заказ в кабинете «Готов»', /Готов/.test(telo2 ?? ''));

/*
 * ── СТАТИСТИКА В АДМИНКЕ ──────────────────────────────────────────
 *
 * ⚠️ ЧИСЛА СВЕРЯЮТСЯ С БАЗОЙ, А НЕ С НАШИМ ПРЕДСТАВЛЕНИЕМ О НИХ.
 * Постановка требует, чтобы цифры сходились с реальными заказами;
 * значит и проверять их надо ЗАПРОСОМ К БАЗЕ, а не пересчётом
 * по той же арифметике, какой считает сам раздел (Р-47).
 */
console.log('── СТАТИСТИКА: ТОЛЬКО АДМИНИСТРАТОРУ И ТОЛЬКО ИЗ БАЗЫ ──');
{
  await admin.goto(`http://localhost:${PORT}/admin/stats/`, { waitUntil: 'networkidle' });
  const svod = (await admin.textContent('body')) ?? '';
  const vyr = await p2.query(
    `select coalesce(sum(money_kop), 0)::text as kop, count(*)::text as n
       from shop_order where paid_at is not null and paid_at > now() - interval '1 day'`,
  );
  const rub = (Number(vyr.rows[0].kop) / 100).toLocaleString('ru-RU').replace(/\u00a0/g, ' ');
  chk('раздел открылся', /Статистика/.test(svod));
  chk('выручка за сутки совпала с базой', svod.replace(/\u00a0/g, ' ').includes(rub), `${rub} ₽`);
  chk('заказов за сутки совпало с базой', new RegExp(`\\b${vyr.rows[0].n}\\b`).test(svod), vyr.rows[0].n);
  chk('в очереди показано число', /Сейчас в очереди/.test(svod));
  chk('источник заказа виден по UTM', /yandex/.test(svod));
  chk('разбивка по тарифам не пуста', /На двоих/.test(svod));

  /* ⚠️ ЗАПРЕТ ДЛЯ ИСПОЛНИТЕЛЯ ПРОВЕРЯЕТСЯ СМЕНОЙ РОЛИ, А НЕ ВТОРЫМ
     ВХОДОМ: код входа выдаётся не чаще одного в минуту (Р-86),
     и завести второго сотрудника прогон просто не успел бы. Роль
     возвращается сразу же — иначе следующие проверки шли бы
     от чужого лица. */
  await p2.query(`update staff set role = 'operator' where email = $1`, [ADMIN]);
  await admin.goto(`http://localhost:${PORT}/admin/stats/`, { waitUntil: 'networkidle' });
  const chuzhoy = (await admin.textContent('body')) ?? '';
  chk('исполнителю статистика закрыта', !/Сейчас в очереди/.test(chuzhoy) && /Только для администраторов/.test(chuzhoy));
  await p2.query(`update staff set role = 'admin' where email = $1`, [ADMIN]);
}

console.log('── TELEGRAM НЕ ОТВЕТИЛ: ОПЛАТА ЦЕЛА, УВЕДОМЛЕНИЕ В ОЧЕРЕДИ ──');
const ochered2 = await p2.query(
  `select vid, tekst, popytok, sent_at,
          sleduyushchaya_v > created_at as otlozheno,
          popytok < 10 as est_popytki
     from notify_outbox order by id`,
);
const oplachen = ochered2.rows.find((r) => r.vid === 'zakaz_oplachen');
const zakryt = ochered2.rows.find((r) => r.vid === 'zakaz_zakryt');
chk('оплата прошла, хотя Telegram недоступен', ochered2.rows.length > 0 && bad === 0);
/* ⚠️ РАБОЧИЕ СООБЩЕНИЯ БОТА ПО-АНГЛИЙСКИ С ТРИДЦАТЬ ЧЕТВЁРТОЙ
   ИТЕРАЦИИ (постановка), а ДАННЫЕ ЗАКАЗА не переводятся: название
   тарифа и срок приходят из каталога и остаются русскими. Сторож
   проверяет ровно это — английские надписи и русские данные. */
chk(
  'уведомление об оплате легло в очередь',
  Boolean(oplachen) && /New paid order #1/.test(oplachen?.tekst ?? ''),
);
chk(
  'в уведомлении тариф, срок, число участников и ссылка в админку',
  /На двоих/.test(oplachen?.tekst ?? '') &&
    /год/.test(oplachen?.tekst ?? '') &&
    /Participants: 2/.test(oplachen?.tekst ?? '') &&
    /\/admin\/orders\/1\//.test(oplachen?.tekst ?? ''),
  (oplachen?.tekst ?? '').replace(/\n/g, ' · '),
);
chk('уведомление о выполнении называет исполнителя', /Operator: admin@spotik\.test/.test(zakryt?.tekst ?? ''));
/* ⚠️ ПОПЫТОК МОЖЕТ БЫТЬ УЖЕ НЕ ОДНА, И ЭТО НОРМА: минутный будильник
   очереди успевает сработать за время прогона.

   ⚠️ И СРОК СРАВНИВАЕТСЯ С `created_at`, А НЕ С `now()`. Сравнение
   с текущим временем — ГОНКА, и она уронила выкладку № 84: строка
   становится «созревшей» ровно через минуту после вставки, а будильник
   ходит по своим шестидесяти секундам от старта процесса, и между
   этими моментами есть окно почти в минуту, где срок уже позади,
   а повтор ещё не случился. Состояние в этом окне совершенно
   исправное. Настоящий же инвариант в другом: КАЖДЫЙ путь кода
   назначает срок как `now() + интервал`, то есть строго позже
   рождения строки, и это не зависит от того, когда мы посмотрели. */
chk(
  'не отправлено и назначен повтор',
  Number(oplachen?.popytok) >= 1 &&
    oplachen?.sent_at === null &&
    oplachen?.otlozheno === true &&
    oplachen?.est_popytki === true,
  `попыток ${oplachen?.popytok}`,
);
chk('адрес сотрудника в журнал целиком не попал', !server.zhurnal().includes('kto="admin@spotik.test"'));

console.log('── СЕРТИФИКАТ НА ЛЮБОЙ ТАРИФ: покупка «на двоих» ──');
/* ⚠️ ОТДЕЛЬНОЙ ЦЕНЫ У СЕРТИФИКАТА БОЛЬШЕ НЕТ (Р-93): он стоит ровно
   столько, сколько подаренный тариф на выбранный срок. Значит и строки
   в админских ценах у него быть не должно — проверяем это прямо. */
await admin.goto(`http://localhost:${PORT}/admin/settings/`, { waitUntil: 'networkidle' });
/* ⚠️ СМОТРИМ ТАБЛИЦУ, А НЕ ВСЮ СТРАНИЦУ. В шапке раздела стоит пункт
   «Сертификаты», и проверка по телу страницы падала бы на нём —
   то есть на собственном меню, а не на цене. */
const ceny = await admin.textContent('table');
chk('цены сертификата в админке нет', !/Сертификат/i.test(ceny ?? ''));

const CENA_DUO_6 = 289000; // копейки, умолчание duo на полгода
await klient.goto(`http://localhost:${PORT}/checkout/?plan=duo&period=6&gift=1`, { waitUntil: 'networkidle' });
const stranicaDara = await klient.textContent('body');
chk(
  'оформление сертификата показывает тариф и цену',
  /Сертификат в подарок/.test(stranicaDara ?? '') && /На двоих/.test(stranicaDara ?? '') && /2\s890/.test(stranicaDara ?? ''),
);

await klient.check('input[name="consent"]');
await nazhat(klient, 'button[type="submit"]');
chk('сертификат ведёт на оплату', klient.url().includes('/pay/test/'), klient.url().replace(`http://localhost:${PORT}`, ''));
await nazhat(klient, 'button[type="submit"]');
const telo3 = await klient.textContent('body');
const kodSert = (telo3 ?? '').match(/SPOTIK-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/)?.[0] ?? '';
chk('сертификат выдан и код виден в кабинете', Boolean(kodSert), kodSert);
chk('в кабинете виден подаренный тариф', /На двоих, полгода/.test(telo3 ?? ''));
// ⚠️ ПИСЬМО ОБЯЗАНО НАЗЫВАТЬ ТАРИФ, А НЕ ОДИН СРОК: до этой итерации
// сертификат был всегда на одного, и срока хватало (Р-93).
chk('письмо о сертификате называет тариф и срок', server.zhurnal().includes('Сертификат оформлен: На двоих, полгода'));

const p3 = await p2.query('select code_hash, code_enc, plan_id, period from certificate');
chk('кода сертификата нет в базе открытым текстом', p3.rows.length === 1 && !p3.rows[0].code_enc.includes(kodSert) && p3.rows[0].code_enc.startsWith('v1.'));
chk('в коде зашиты тариф и срок', p3.rows[0].plan_id === 'duo' && p3.rows[0].period === 6, `${p3.rows[0].plan_id} / ${p3.rows[0].period} мес`);
const cenaSert = await p2.query(`select total_kop from shop_order where kind = 'certificate'`);
chk('сертификат стоит столько же, сколько тариф', Number(cenaSert.rows[0].total_kop) === CENA_DUO_6, `${Number(cenaSert.rows[0].total_kop) / 100} ₽`);

console.log('── АКТИВАЦИЯ ДРУГИМ ЧЕЛОВЕКОМ: ДВА УЧАСТНИКА ──');
const drug = await browser.newPage({ viewport: { width: 1280, height: 900 } });
drug.on('pageerror', (e) => oshibkiJS.push(String(e.message)));
await voyti(drug, DARENYY, '/certificate/');
await drug.locator('form').filter({ has: drug.locator('input[name="code"]') }).first().locator('input[name="code"]').fill(kodSert);
await nazhat(drug, 'button:has-text("Проверить код")');
// Второй шаг появляется только если код принят; без явного ожидания
// отказ выглядит как «тайм-аут на галочке», а не как «код не принят».
try {
  await drug.waitForSelector('input[name="consent"]', { timeout: 20000 });
} catch {
  console.log('    [страница сертификата] ' + ((await drug.textContent('body')) ?? '').replace(/\s+/g, ' ').slice(0, 500));
  throw new Error('код сертификата не принят — второй шаг не появился');
}
const chtoPodareno = await drug.textContent('body');
chk('получатель видит, что подарено', /На двоих, полгода/.test(chtoPodareno ?? ''));
chk('форма просит два аккаунта', /Участник 1/.test(chtoPodareno ?? '') && /Участник 2/.test(chtoPodareno ?? ''));

// Второй участник — на продление: там принимается чужой пароль.
await drug.click('text=Участник 2 >> xpath=following::button[normalize-space()="Продлить существующий"][1]');
await drug.fill('input[name="login0"]', 'drug-novyy@pochta.test');
await drug.fill('input[name="password0"]', 'Drug-Parol-7');
await drug.fill('input[name="login1"]', 'drug@akkaunt.test');
await drug.fill('input[name="password1"]', 'drugoy-tayny-parol7');
await drug.check('input[name="consent"]');
/* ⚠️ ПОЛНАЯ НАДПИСЬ, А НЕ «Активировать»: с тридцать шестой итерации
   на странице есть вкладка с таким же началом («Подарить» /
   «Активировать»), и `has-text` берёт ПЕРВОЕ совпадение — то есть
   нажималась бы вкладка, а форма оставалась бы неотправленной.
   Отказ при этом выглядел как «код не принят», хотя код приняли. */
await nazhat(drug, 'button:has-text("Активировать сертификат")');
chk('сертификат активирован, заказ в кабинете', drug.url().includes('/cabinet/'), drug.url().replace(`http://localhost:${PORT}`, ''));
const teloD = await drug.textContent('body');
chk('заказ по сертификату сразу у оператора', /Оплачен, ждёт оператора/.test(teloD ?? ''));

const mesta = await p2.query(
  `select s.idx, s.mode from order_slot s join shop_order o on o.id = s.order_id
    where o.source = 'certificate' order by s.idx`,
);
chk('оформлены оба участника', mesta.rows.length === 2 && mesta.rows[0].mode === 'new' && mesta.rows[1].mode === 'renew', mesta.rows.map((r) => r.mode).join(' + '));
const parolDruga = await p2.query(
  `select s.in_password_enc from order_slot s join shop_order o on o.id = s.order_id
    where o.source = 'certificate' and s.in_password_enc is not null`,
);
chk(
  'пароли обоих участников в базе шифротекстом',
  parolDruga.rows.length === 2 &&
    parolDruga.rows.every((r) => r.in_password_enc.startsWith('v1.') && !r.in_password_enc.includes('drugoy-tayny-parol7')),
  `${parolDruga.rows.length} строки`,
);
chk('пароля из сертификата нет в журнале', !server.zhurnal().includes('drugoy-tayny-parol7'));

await drug.goto(`http://localhost:${PORT}/certificate/`, { waitUntil: 'networkidle' });
await drug.locator('form').filter({ has: drug.locator('input[name="code"]') }).first().locator('input[name="code"]').fill(kodSert);
await nazhat(drug, 'button:has-text("Проверить код")');
const povtor = await drug.textContent('body');
chk('код одноразовый', /уже активирован/.test(povtor ?? ''));

console.log('── АДМИНИСТРАТОР ВИДИТ ВЫПУЩЕННЫЕ СЕРТИФИКАТЫ ──');
await admin.goto(`http://localhost:${PORT}/admin/certificates/`, { waitUntil: 'networkidle' });
const spisokSert = ((await admin.textContent('body')) ?? '').replace(/\s+/g, ' ');
chk('в списке есть тариф, срок и статус', /На двоих/.test(spisokSert) && /6 мес/.test(spisokSert) && /использован/.test(spisokSert));
chk('видно, кто купил и кто активировал', spisokSert.includes(KLIENT) && spisokSert.includes(DARENYY));
chk('кода сертификата в админке нет', !spisokSert.includes(kodSert) && spisokSert.includes(`…${kodSert.slice(-4)}`));

console.log('── ОПЛАТА ПОДТВЕРЖДАЕТСЯ ТОЛЬКО УВЕДОМЛЕНИЕМ ──');
const otvet = await fetch(`http://localhost:${PORT}/api/pay/result/`, { method: 'POST' });
chk('уведомление без подписи отвергнуто', otvet.status === 400, `статус ${otvet.status}`);

const baz = await p2.query(`select status, balance_kop, money_kop from shop_order order by id`);
chk('суммы разложены по заказу', baz.rows[0].money_kop !== '0', `картой ${baz.rows[0].money_kop} коп.`);

console.log('── ОТМЕНА: СНАЧАЛА ПИСЬМО, ПОТОМ ДЕНЬГИ НА БАЛАНС ──');
/* Берём заказ ПО СЕРТИФИКАТУ и отменяем его. Денег за ним нет,
   зато проверяются две вещи разом: жёсткий порядок при неверном
   пароле (закон 37) и то, что сертификат от отмены оживает. */
await admin.goto(`http://localhost:${PORT}/admin/`, { waitUntil: 'networkidle' });
const ocheredDara = await admin.textContent('body');
chk('подарочный заказ помечен в очереди', /подарок/.test(ocheredDara ?? ''));
await nazhat(admin, 'button:has-text("Взять")');
const kartaDara = await admin.textContent('body');
chk(
  'оператор видит, что заказ подарочный',
  /подарок/.test(kartaDara ?? '') && /денег нет/.test(kartaDara ?? ''),
);

await admin.fill('input[name="reason"]', 'Проверка отмены');
await nazhat(admin, 'button:has-text("Отменить заказ")');
const rano = await admin.textContent('body');
chk('до письма отмена не проходит', /Сначала отправьте письмо/.test(rano ?? ''));

await nazhat(admin, 'button:has-text("Пароль не подошёл")');
const posleP = await admin.textContent('body');
chk('письмо о восстановлении отправлено', /Инструкция по восстановлению отправлена/.test(posleP ?? ''));

await admin.fill('input[name="reason"]', 'Проверка отмены');
await nazhat(admin, 'button:has-text("Отменить заказ")');
const otmena = await admin.textContent('body');
chk('заказ отменён', /Заказ отменён/.test(otmena ?? ''));
const sert2 = await p2.query('select used_at, used_order_id from certificate');
chk('сертификат снова годен', sert2.rows[0].used_at === null && sert2.rows[0].used_order_id === null);

console.log('── СЕРТИФИКАТ, ОПЛАЧЕННЫЙ ЦЕЛИКОМ С БАЛАНСА, ВСЁ РАВНО ВЫДАЁТСЯ ──');
/* ⚠️ ЭТО НЕ УГОЛ, А ОБЫЧНЫЙ ПУТЬ: баланс берётся из возврата
   за отменённый заказ (Р-89), и человек тратит его в один клик.
   Раньше на этом пути заказ становился «оплачен» и на этом всё
   кончалось: письма не было, команда не узнавала, а сертификат
   не выдавался ВОВСЕ — человек платил и не получал ничего.
   Проверяется СЛЕДСТВИЕ (строка в `certificate`), а не то, что
   мы позвали нужную функцию. */
{
  const bylo = await p2.query('select count(*)::int as n from certificate');
  /* ⚠️ ПИСЬМА СЧИТАЕМ, А НЕ ИЩЕМ. Одно письмо о сертификате в журнале
     уже лежит — от покупки «на двоих» выше, — и поиск по образцу
     прошёл бы и на сломанном коде. Контрольный прогон это и показал:
     проверка «письмо ушло» была зелёной ровно тогда, когда сертификат
     не выдавался вовсе. */
  const pisemBylo = (server.zhurnal().match(/Тема: Сертификат Spotik Shop/g) ?? []).length;
  await p2.query(`update app_user set balance_kop = 1000000 where email = $1`, [KLIENT]);
  await klient.goto(`http://localhost:${PORT}/checkout/?plan=solo&period=1&gift=1`, { waitUntil: 'networkidle' });
  const galka = klient.locator('input[name="balance"]');
  chk('в оформлении виден баланс', await galka.count() === 1);
  await galka.check();
  await klient.check('input[name="consent"]');
  await nazhat(klient, 'button[type="submit"]');
  chk(
    'оплата целиком с баланса не идёт на платёжную форму',
    klient.url().includes('/cabinet/'),
    klient.url().replace(`http://localhost:${PORT}`, ''),
  );

  const z = await p2.query(
    `select id, status, total_kop, balance_kop, money_kop from shop_order
      where kind = 'certificate' order by id desc limit 1`,
  );
  const zak = z.rows[0] ?? {};
  chk('заказ закрыт балансом целиком', Number(zak.balance_kop) === Number(zak.total_kop) && Number(zak.money_kop) === 0,
    `${Number(zak.balance_kop) / 100} ₽ с баланса`);
  chk('сертификатный заказ закрыт', zak.status === 'done', String(zak.status));

  const stalo = await p2.query('select count(*)::int as n from certificate');
  chk('СЕРТИФИКАТ ВЫДАН', stalo.rows[0].n === bylo.rows[0].n + 1, `было ${bylo.rows[0].n}, стало ${stalo.rows[0].n}`);
  const noviy = await p2.query(
    `select plan_id, period, code_enc, bought_order_id from certificate order by id desc limit 1`,
  );
  const nc = noviy.rows[0] ?? {};
  chk('в коде лежит подаренный тариф и срок', nc.plan_id === 'solo' && nc.period === 1, `${nc.plan_id} / ${nc.period}`);
  chk('код сертификата в базе шифротекстом', String(nc.code_enc ?? '').startsWith('v1.'));
  chk('сертификат привязан к своему заказу', Number(nc.bought_order_id) === Number(zak.id));
  /* Письмо — то же следствие и тем же способом: журнал сервера
     в тестовом режиме почты И ЕСТЬ почта. */
  const pisemStalo = (server.zhurnal().match(/Тема: Сертификат Spotik Shop/g) ?? []).length;
  chk('покупателю ушло НОВОЕ письмо с кодом', pisemStalo === pisemBylo + 1, `было ${pisemBylo}, стало ${pisemStalo}`);
}

console.log('── ДЕНЬГИ ПО ЗАКАЗУ, КОТОРЫЙ ИХ УЖЕ НЕ ЖДЁТ, ЛОЖАТСЯ НА БАЛАНС ──');
/* ⚠️ СЛУЧАЙ НЕ ВЫДУМАННЫЙ, И ПУТЕЙ К НЕМУ ДВА: человек отменил
   неоплаченный заказ, пока платёжная форма была открыта, — и заплатил;
   либо на один заказ выставлено ДВА счёта (кнопка «Оплатить» заводит
   новую строку `payment` каждым нажатием) и оплачены оба. Раньше
   платёж помечался оплаченным, а деньги не ложились НИКУДА — ни
   в заказ, ни на баланс, ни строкой в журнал. */
{
  await p2.query(`update app_user set balance_kop = 0 where email = $1`, [KLIENT]);
  await klient.goto(`http://localhost:${PORT}/checkout/?plan=solo&period=1`, { waitUntil: 'networkidle' });
  // Данные аккаунта вводятся и на новый аккаунт тоже (тридцать четвёртая).
  await klient.fill('input[name="login0"]', 'eshchyo-odin@pochta.test');
  await klient.fill('input[name="password0"]', 'Eshchyo-Parol-3');
  await klient.check('input[name="consent"]');
  await nazhat(klient, 'button[type="submit"]');
  const schet = Number(new URL(klient.url()).searchParams.get('payment') ?? 0);
  chk('счёт выставлен', schet > 0, `счёт № ${schet}`);
  const par = await p2.query('select order_id, amount_kop from payment where id = $1', [schet]);
  const nomer = Number(par.rows[0].order_id);
  const summa = Number(par.rows[0].amount_kop);

  // Человек передумал и отменил заказ, не закрыв платёжную форму.
  await klient.goto(`http://localhost:${PORT}/cabinet/`, { waitUntil: 'networkidle' });
  const otmenit = klient
    .locator('form')
    .filter({ has: klient.locator(`input[name="order"][value="${nomer}"]`) })
    .filter({ has: klient.locator('button:has-text("Отменить")') })
    .first();
  await otmenit.locator('button').click();
  await klient.waitForLoadState('networkidle');
  await klient.waitForTimeout(300);
  const st1 = await p2.query('select status from shop_order where id = $1', [nomer]);
  chk('заказ отменён покупателем', st1.rows[0].status === 'cancelled', String(st1.rows[0].status));

  /* ⚠️ И ИЗ КАБИНЕТА ОН ИСЧЕЗ (закон 48). Спрашивается ЖИВАЯ
     СТРАНИЦА, а не наш же запрос к базе: прятать заказ обязан
     кабинет, а проверка тем же условием, каким он его прячет,
     была бы моделью предмета (Р-47). */
  await klient.goto(`http://localhost:${PORT}/cabinet/`, { waitUntil: 'networkidle' });
  const kabPosleOtmeny = await klient.content();
  chk('отменённый покупателем заказ из кабинета исчез',
    !kabPosleOtmeny.includes(`value="${nomer}"`) && !/Отменён покупателем/.test(kabPosleOtmeny),
    `заказ № ${nomer}`);
  /* ⚠️ НОМЕРА ЗАКАЗА КЛИЕНТ НЕ ВИДИТ НИГДЕ — ни на экране, ни
     в письме. Проверяется по ТЕКСТУ страницы и по журналу писем,
     а не по разметке: в скрытых полях форм оплаты и отмены номер
     есть и быть обязан. */
  const kabTekst = ((await klient.textContent('body')) ?? '').replace(/\s+/g, ' ');
  chk('номера заказа в кабинете нет', !/Заказ\s*№/i.test(kabTekst), kabTekst.slice(0, 80));
  chk('номера заказа в письмах нет', !/Заказ\s*№/i.test(server.zhurnal()));

  // …а деньги всё-таки пришли. Стучимся в ТУ ЖЕ дверь, что и настоящее
  // уведомление Робокассы, — иначе проверялась бы не оплата, а кнопка.
  const r = await fetch(`http://localhost:${PORT}/api/pay/fake/?secret=proverka&payment=${schet}`, { method: 'POST' });
  chk('уведомление принято', r.status === 200, `статус ${r.status}`);
  await new Promise((t) => setTimeout(t, 500));

  const pl = await p2.query('select status from payment where id = $1', [schet]);
  chk('платёж помечен оплаченным', pl.rows[0].status === 'paid');
  const st2 = await p2.query('select status, money_kop from shop_order where id = $1', [nomer]);
  chk('отменённый заказ не ожил', st2.rows[0].status === 'cancelled', String(st2.rows[0].status));
  const bal = await p2.query('select balance_kop from app_user where email = $1', [KLIENT]);
  chk('ДЕНЬГИ НЕ ПРОПАЛИ: легли на баланс', Number(bal.rows[0].balance_kop) === summa,
    `${Number(bal.rows[0].balance_kop) / 100} ₽ при ${summa / 100} ₽ оплаты`);
  const dv = await p2.query(
    `select delta_kop, reason from balance_move where order_id = $1 and delta_kop > 0 order by id desc limit 1`,
    [nomer],
  );
  chk('движение по балансу названо своими словами', /не ждал денег/.test(dv.rows[0]?.reason ?? ''), dv.rows[0]?.reason ?? '—');
  const och = await p2.query(`select tekst from notify_outbox where vid = 'dengi_bez_zakaza'`);
  /* ⚠️ ТЕКСТ СООБЩЕНИЯ АНГЛИЙСКИЙ, а движение по балансу — русское,
     и это не разнобой: движение видит КЛИЕНТ в своём кабинете,
     а сообщение — команда в служебном чате (постановка 34-й). */
  chk('команда узнала о происшествии', och.rows.length === 1 && /no longer waiting/.test(och.rows[0].tekst),
    (och.rows[0]?.tekst ?? '').split('\n')[0]);
}

console.log('── ПОДСКАЗКА ПРО VPN ──');
{
  /* Строка одна и та же в двух местах, и это не декорация: с включённым
     VPN страница банка обрывает соединение, человек видит
     ERR_CONNECTION_CLOSED и решает, что сломан наш сайт (Р-108).
     ⚠️ ТАРИФ ВЗЯТ ЗАВЕДОМО ДОРОЖЕ БАЛАНСА: при полной оплате
     с баланса банка в деле нет вовсе, и подсказки там быть
     не должно — это отступление названо в Р-108. */
  const VPN = /Если у вас включён VPN, выключите его на время оплаты/;
  await klient.goto(`http://localhost:${PORT}/checkout/?plan=duo&period=12`, { waitUntil: 'networkidle' });
  const tk = ((await klient.textContent('body')) ?? '').replace(/\s+/g, ' ');
  chk('подсказка про VPN стоит в оформлении', VPN.test(tk));
  // ⚠️ СУДИМ ПО ТОМУ, ЧЕМ ОНА НАБРАНА, А НЕ ПО ОТСУТСТВИЮ КРАСНОГО:
  // «красного нет» проходит и на странице, где нет и самой подсказки.
  const tikhaya = await klient.locator('p.panel__note').filter({ hasText: 'VPN' }).count();
  const krasnaya = await klient.locator('.err').filter({ hasText: 'VPN' }).count();
  chk('подсказка спокойная, а не предупреждение', tikhaya === 1 && krasnaya === 0, `panel__note ${tikhaya}, err ${krasnaya}`);

  /* ⚠️ И ЭТО ПЛАШКА, А НЕ СТРОКА, И СУДИТСЯ ЭТО ПО ВЫЧИСЛЕННОМУ
     СТИЛЮ, А НЕ ПО ИМЕНИ КЛАССА. Постановка тридцать третьей
     итерации: «мягкая подложка чуть светлее панели, скруглённые
     углы, небольшие внутренние поля». Класс в разметке доказал бы
     только, что мы его написали; здесь спрашивается результат:
     подложка непрозрачна и СВЕТЛЕЕ своей панели, угол скруглён,
     поля ненулевые, и красного в подложке нет — красный канал
     не превышает зелёный. */
  /* ⚠️ ЦВЕТ ЧИТАЕТСЯ ХОЛСТОМ, А НЕ РАЗБОРОМ СТРОКИ. `color-mix`
     браузер отдаёт как `color(srgb 0.23 0.23 0.23)` — доли единицы,
     а соседнее правило рядом даёт `rgb(33, 33, 33)`. Разбор числами
     сравнивал 0.23 с 33 и падал на исправной плашке. Холст приводит
     любую запись к одному виду. */
  const plashka = await klient.evaluate(() => {
    const p = [...document.querySelectorAll('p')].find((e) => /включён VPN/.test(e.textContent ?? ''));
    if (!p) return null;
    const cv = document.createElement('canvas');
    cv.width = 1;
    cv.height = 1;
    const g2 = cv.getContext('2d');
    const px = (c) => {
      g2.clearRect(0, 0, 1, 1);
      g2.fillStyle = c;
      g2.fillRect(0, 0, 1, 1);
      const d = g2.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3] / 255];
    };
    const cs = getComputedStyle(p);
    const ps = getComputedStyle(p.closest('.panel') ?? document.body);
    return {
      r: parseFloat(cs.borderTopLeftRadius),
      padY: parseFloat(cs.paddingTop),
      padX: parseFloat(cs.paddingLeft),
      my: px(cs.backgroundColor),
      up: px(ps.backgroundColor),
    };
  });
  const svetlee = !!plashka && plashka.my[3] > 0.99 && plashka.my[1] > plashka.up[1];
  chk(
    'подсказка оформлена плашкой: подложка светлее панели, углы скруглены, поля есть',
    !!plashka && svetlee && plashka.r >= 6 && plashka.padY >= 8 && plashka.padX >= 8,
    plashka
      ? `фон ${plashka.my.slice(0, 3).join(',')} против ${plashka.up.slice(0, 3).join(',')}, радиус ${plashka.r}, поля ${plashka.padY}/${plashka.padX}`
      : 'строки нет',
  );
  chk(
    'и она не красная: красного канала в подложке не больше зелёного',
    !!plashka && plashka.my[0] <= plashka.my[1] + 1,
    plashka ? plashka.my.join(',') : '—',
  );

  await klient.goto(`http://localhost:${PORT}/pay/fail/`, { waitUntil: 'networkidle' });
  const tf = ((await klient.textContent('body')) ?? '').replace(/\s+/g, ' ');
  chk('и на странице неудачной оплаты, рядом с возвратом', VPN.test(tf) && /В личный кабинет/.test(tf));
  const plashka2 = await klient.evaluate(() => {
    const p = [...document.querySelectorAll('p')].find((e) => /включён VPN/.test(e.textContent ?? ''));
    if (!p) return null;
    const cv = document.createElement('canvas');
    cv.width = 1;
    cv.height = 1;
    const g2 = cv.getContext('2d');
    g2.fillStyle = getComputedStyle(p).backgroundColor;
    g2.fillRect(0, 0, 1, 1);
    const d = g2.getImageData(0, 0, 1, 1).data;
    const cs = getComputedStyle(p);
    return {
      r: parseFloat(cs.borderTopLeftRadius),
      pad: parseFloat(cs.paddingTop),
      bg: [d[0], d[1], d[2]],
    };
  });
  chk(
    'плашка и на странице неудачной оплаты',
    !!plashka2 && plashka2.r >= 6 && plashka2.pad >= 8 && plashka2.bg[1] > 18,
    plashka2 ? `радиус ${plashka2.r}, поле ${plashka2.pad}, фон ${plashka2.bg.join(',')}` : 'строки нет',
  );
}

console.log('── СКРУГЛЁННЫЕ УГЛЫ В РАЗДЕЛЕ, И ЛЕНДИНГ НЕ ТРОНУТ ──');
{
  /* Постановка тридцать третьей итерации: «скругли углы у всех
     интерактивных элементов и панелей во всём кабинете, оформлении,
     на страницах оплаты и в админке; радиус небольшой и единый, одна
     переменная; лендинг не трогай».

     ⚠️ СУДИМ ПО ВЫЧИСЛЕННОМУ РАДИУСУ ЖИВОЙ СТРАНИЦЫ, А НЕ ПО ТОМУ,
     ЧТО МЫ НАПИСАЛИ В CSS. Имя класса доказало бы только, что правило
     существует; здесь спрашивается, доехало ли оно до элемента.
     И ⚠️ КАЖДЫЙ ИЗМЕРЕННЫЙ РАДИУС ОБЯЗАН СОВПАСТЬ С ОБЪЯВЛЕННЫМ
     ТОКЕНОМ. Токенов с тридцать седьмой итерации ТРИ, а не два:
     поверхности (`--ui-r`), крупные панели (`--ui-r-lg`) и КНОПКИ
     (`--ui-r-pill`) — постановка «все кнопки в кабинете
     и на оформлении полными пилюлями». Смысл проверки не изменился:
     число, не совпавшее ни с одним токеном, означает, что кто-то
     завёл своё мимо них. */
  const kruglo = async (page, url, sel) => {
    await page.goto(`http://localhost:${PORT}${url}`, { waitUntil: 'networkidle' });
    return page.evaluate((s2) => {
      const out = [];
      for (const el of document.querySelectorAll(s2)) {
        const b = el.getBoundingClientRect();
        if (b.width < 4 || b.height < 4) continue;
        out.push({
          r: parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0,
          kto: `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]}`,
        });
      }
      return out;
    }, sel);
  };
  /* Токены читаются с живой страницы: сторож не имеет права знать
     их значения заранее — иначе он проверял бы нашу же память. */
  const tokeny = await klient.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return [
      cs.getPropertyValue('--ui-r'),
      cs.getPropertyValue('--ui-r-lg'),
      cs.getPropertyValue('--ui-r-pill'),
    ].map((v) => parseFloat(v));
  });
  const hudshy = (a) => (a.length ? Math.min(...a.map((v) => v.r)) : -1);
  const imena = (a) =>
    [...new Set(a.filter((v) => v.r < 6).map((v) => `${v.kto} ${v.r}`))].slice(0, 4).join(' · ');
  const ost = await kruglo(
    klient,
    '/checkout/?plan=duo&period=12',
    '.panel, .pick__btn, .field input, .field select',
  );
  chk('в оформлении скруглены все панели, поля и кнопки выбора',
    ost.length >= 6 && ost.every((v) => v.r >= 6),
    `${ost.length} шт., наименьший ${hudshy(ost)}${imena(ost) ? `: ${imena(ost)}` : ''}`);

  const kab = await kruglo(klient, '/cabinet/', '.panel, .order-card, .cred, .cert, .badge');
  chk('в кабинете скруглены панели, карточки заказов и плашки',
    kab.length >= 2 && kab.every((v) => v.r >= 6),
    `${kab.length} шт., наименьший ${hudshy(kab)}${imena(kab) ? `: ${imena(kab)}` : ''}`);

  const adm1 = await kruglo(admin, '/admin/', '.ad__card, .ad input, .ad select, .ad__tag, .ad__secret');
  const adm2 = await kruglo(admin, '/admin/settings/', '.ad__card, .ad input, .ad select, .ad__tag, .ad__secret');
  const adm = [...adm1, ...adm2];
  chk('в админке скруглены карточки, поля и теги',
    adm.length >= 3 && adm.every((v) => v.r >= 6),
    `${adm.length} шт., наименьший ${hudshy(adm)}${imena(adm) ? `: ${imena(adm)}` : ''}`);

  /* ⚠️ ВЕЛИЧИНЫ БЕРУТСЯ ТОКЕНАМИ: каждый измеренный радиус обязан
     СОВПАСТЬ с одним из трёх. Четвёртое число означало бы, что кто-то
     завёл своё мимо них. */
  const chuzhie = [...new Set(
    [...ost, ...kab, ...adm].map((v) => v.r).filter((r) => !tokeny.some((t) => Math.abs(t - r) < 0.6)),
  )];
  chk('радиусы берутся токенами, а не своими числами',
    tokeny.length === 3 && tokeny.every((t) => t > 0) && chuzhie.length === 0,
    `токены ${tokeny.join(' и ')} px, чужих значений ${chuzhie.length ? chuzhie.join(', ') : 'нет'}`);

  /* ⚠️ ЛЕНДИНГ ОБЯЗАН ОСТАТЬСЯ С РАДИУСОМ 0. Проверяется перебором
     ВСЕХ видимых элементов первого экрана и середины: скруглено может
     быть только то, чему это разрешено законом раздела 3 — кнопка
     (пилюля), карта тарифа и слой света за ней. Всё остальное 0. */
  await klient.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  const lend = await klient.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll('body *')) {
      const b = el.getBoundingClientRect();
      if (b.width < 4 || b.height < 4) continue;
      const r = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
      if (r < 0.5) continue;
      /* Что скруглено на лендинге ЗАКОННО: кнопка, плашка срока
         и плашка выбора аккаунта — пилюли (отсылка к плееру), карта
         тарифа со своей каймой и слой света за ней — `--card-r`,
         кольца микроволн и узлы света — круги, плашка поддержки —
         та же пилюля, что кнопка. Всё остальное обязано быть 0.
         ⚠️ `.opt` ДОБАВЛЕН В ТРИДЦАТЬ ШЕСТОЙ: выбор аккаунта стал
         двумя крупными плашками вместо двух кружков, и форма у них
         та же пилюля, что у плашки срока. Третьего радиуса
         на лендинге не завелось. */
      if (
        el.closest(
          '.btn, .seg, .seg__btn, .opt, .card, .cards__glow, .burger, .menu, .rstep__wave, .route__node, .pd__knopka',
        )
      )
        continue;
      bad.push(`${el.className || el.tagName} ${r}`);
    }
    return bad;
  });
  chk('лендинг не тронут: скруглены только кнопка, карта и свет за ней',
    lend.length === 0, lend.slice(0, 4).join(' · ') || 'ни одного лишнего');
}

console.log('── ЛИМИТ НА ВВОД КОДА СЕРТИФИКАТА ──');
{
  /* ⚠️ СЧЁТ ИДЁТ ПО ДВУМ ОСЯМ ПОРОЗНЬ — адрес и учётная запись, —
     и проверить их надо ВРОЗЬ, иначе «сработало» ничего не значит:
     заблокированный человек всегда сидит и на своём адресе, и под
     своей записью разом. Разводит их подмена заголовка `X-Real-IP`
     на живой странице: одна и та же учётная запись приходит с двух
     адресов, а на один адрес приходят разные люди.

     ⚠️ И ЛИМИТ НЕ ИМЕЕТ ПРАВА ГОВОРИТЬ О САМОМ КОДЕ. Поэтому
     заблокированному скармливается НАСТОЯЩИЙ код сертификата,
     и ответ обязан совпасть с ответом на выдуманный. */

  const VYDUMKA = 'SPOTIK-ZZZZ-ZZZZ-ZZZZ';
  const NET = /Такого сертификата нет/;
  const MINUTA = /Слишком много попыток\. Подождите минуту/;
  const CHAS = /Слишком много попыток\. Попробуйте через час/;

  const doBloka = await p2.query('select count(*)::int as n from cert_try');
  chk(
    'в счёт идут ТОЛЬКО неудачные попытки',
    doBloka.rows[0].n === 1,
    `строк ${doBloka.rows[0].n} при одном отказе за прогон; две удачные проверки кода не записались`,
  );

  /**
   * Ввести код на /certificate/ и вернуть текст страницы.
   *
   * ⚠️ ЖДЁМ ОТВЕТ СЕРВЕРНОГО ДЕЙСТВИЯ, А НЕ СЕКУНДЫ: форма не уводит
   * никуда, `nazhat` с его ожиданием смены адреса здесь не годится
   * вовсе. Выдержка после ответа — это отрисовка React, а не сеть.
   */
  const proverit = async (page, kod) => {
    const forma = page.locator('form').filter({ has: page.locator('input[name="code"]') }).first();
    await forma.locator('input[name="code"]').fill(kod);
    const otvet = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/certificate'));
    await forma.locator('button[type="submit"]').first().click();
    await otvet;
    await page.waitForTimeout(200);
    return ((await page.textContent('body')) ?? '').replace(/\s+/g, ' ');
  };

  const gost = async (adres) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { 'x-real-ip': adres } });
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${PORT}/certificate/`, { waitUntil: 'networkidle' });
    return { ctx, page };
  };

  // ── ОСЬ АДРЕСА, анонимно ───────────────────────────────────────
  const a = await gost('203.0.113.10');
  let posledny = '';
  for (let i = 0; i < 5; i++) posledny = await proverit(a.page, VYDUMKA);
  chk('пятая попытка подряд ещё проходит', NET.test(posledny) && !MINUTA.test(posledny), 'обычный отказ, лимит не сработал раньше времени');

  const shestaya = await proverit(a.page, VYDUMKA);
  chk('шестая попытка с того же адреса отбита', MINUTA.test(shestaya) && !NET.test(shestaya));

  const nastoyashchiy = await proverit(a.page, kodSert);
  chk(
    'отказ НЕ РАСКРЫВАЕТ, существует ли код',
    MINUTA.test(nastoyashchiy) && !/уже активирован/.test(nastoyashchiy) && !NET.test(nastoyashchiy),
    'настоящий код получил тот же ответ, что и выдуманный',
  );

  const schyot10 = await p2.query(`select count(*)::int as n from cert_try where adres = '203.0.113.10'`);
  chk(
    'сам отказ по частоте в счёт не идёт',
    schyot10.rows[0].n === 5,
    `${schyot10.rows[0].n} строк при пяти записанных попытках и двух отбитых`,
  );

  // ── ДРУГОЙ АДРЕС НЕ ПОСТРАДАЛ ──────────────────────────────────
  const b = await gost('203.0.113.11');
  const chuzhoy = await proverit(b.page, VYDUMKA);
  chk('соседний адрес не заперт вместе с ним', NET.test(chuzhoy) && !MINUTA.test(chuzhoy));

  // ── ОСЬ УЧЁТНОЙ ЗАПИСИ ─────────────────────────────────────────
  // Тот же вошедший человек стучится с ОДНОГО адреса, пока его
  // не отобьют, и тут же приходит с ЧИСТОГО. Адрес там пустой,
  // значит запереть его может только учётная запись.
  await drug.setExtraHTTPHeaders({ 'x-real-ip': '203.0.113.20' });
  await drug.goto(`http://localhost:${PORT}/certificate/`, { waitUntil: 'networkidle' });
  let otbit = false;
  for (let i = 0; i < 8 && !otbit; i++) otbit = MINUTA.test(await proverit(drug, VYDUMKA));
  chk('вошедшего отбило на своём адресе', otbit);

  await drug.setExtraHTTPHeaders({ 'x-real-ip': '203.0.113.21' });
  await drug.goto(`http://localhost:${PORT}/certificate/`, { waitUntil: 'networkidle' });
  const sChistogo = await proverit(drug, VYDUMKA);
  chk('он же отбит и с ЧИСТОГО адреса — лимит идёт за учётной записью', MINUTA.test(sChistogo) && !NET.test(sChistogo));

  const d = await gost('203.0.113.21');
  const drugoyChelovek = await proverit(d.page, VYDUMKA);
  chk(
    'а другой человек с ТОГО ЖЕ адреса проходит',
    NET.test(drugoyChelovek) && !MINUTA.test(drugoyChelovek),
    'значит заперта запись, а не адрес',
  );

  // ── ЧАСОВОЕ ОКНО ───────────────────────────────────────────────
  // Попытки состарены на пять минут: в минутное окно они не попадают
  // вовсе, и сработать может только часовое. Двадцать — порог, девятнадцать — нет.
  await p2.query(
    `insert into cert_try (adres, created_at)
     select '203.0.113.40', now() - interval '5 minutes' from generate_series(1, 20)`,
  );
  await p2.query(
    `insert into cert_try (adres, created_at)
     select '203.0.113.41', now() - interval '5 minutes' from generate_series(1, 19)`,
  );
  const e = await gost('203.0.113.40');
  const zaChas = await proverit(e.page, VYDUMKA);
  chk('двадцать попыток за час отбиты, и отказ другой', CHAS.test(zaChas) && !MINUTA.test(zaChas));

  const f = await gost('203.0.113.41');
  const podPorogom = await proverit(f.page, VYDUMKA);
  chk('девятнадцать за час ещё проходят, минутное окно скользит', NET.test(podPorogom) && !CHAS.test(podPorogom));

  chk('перебор попал в журнал сервера', /перебор кода сертификата/.test(server.zhurnal()));

  for (const c of [a.ctx, b.ctx, d.ctx, e.ctx, f.ctx]) await c.close();
}


console.log('── ФОРМА ОТКАЗЫВАЕТ СВОИМИ СЛОВАМИ, А НЕ ПОДСКАЗКОЙ БРАУЗЕРА ──');
{
  /* Постановка тридцать четвёртой итерации: «проверка на клиенте
     и на сервере; правила пароля показаны под полем ЗАРАНЕЕ;
     сообщения об ошибке в визуальном языке сайта, а не системными
     подсказками браузера».

     ⚠️ СУДИМ ПО ТОМУ, ЧТО ВИДНО НА СТРАНИЦЕ, и по тому, что браузер
     НИКУДА НЕ УШЁЛ. Подсказку браузера со страницы не прочитать
     вовсе — она рисуется вне документа; зато видно, что у формы
     стоит `noValidate`, то есть браузер её и не показывает. */
  await klient.goto(`http://localhost:${PORT}/checkout/?plan=solo&period=1`, { waitUntil: 'networkidle' });
  const pravilo = (await klient.textContent('body')) ?? '';
  chk(
    'правило пароля стоит под полем ЗАРАНЕЕ',
    /Не меньше 10 знаков/.test(pravilo),
    pravilo.match(/Не меньше 10 знаков[^<]{0,60}/)?.[0] ?? '',
  );
  chk('форма не отдана браузеру на проверку', await klient.$eval('form', (f) => f.noValidate));

  await klient.fill('input[name="login0"]', 'ne-pochta');
  await klient.fill('input[name="password0"]', '123');
  await klient.check('input[name="consent"]');
  await klient.click('button[type="submit"]');
  await klient.waitForTimeout(400);
  const otkaz = (await klient.textContent('body')) ?? '';
  chk('неверная почта названа своими словами', /Проверьте адрес/.test(otkaz));
  chk('короткий пароль назван своими словами', /Пароль короче десяти знаков/.test(otkaz));
  chk('со страницы никуда не ушли', klient.url().includes('/checkout/'), klient.url().replace(`http://localhost:${PORT}`, ''));

  /* ⚠️ И ЗАКАЗА ОТ ЭТОГО НЕ ЗАВЕЛОСЬ. «Форма показала отказ» само
     по себе ничего не стоит: важно, что дальше ничего не случилось.
     Правила при этом лежат в ОДНОМ модуле и зовутся и с клиента,
     и с сервера — второй копии, которая могла бы разойтись,
     не существует. */
  const skolkoBylo = (await p2.query('select count(*)::int n from shop_order')).rows[0].n;
  await klient.waitForTimeout(300);
  const skolkoStalo = (await p2.query('select count(*)::int n from shop_order')).rows[0].n;
  chk('заказ на слабом пароле не завёлся', skolkoStalo === skolkoBylo, `${skolkoBylo} → ${skolkoStalo}`);
}

console.log('── ВЫБРАННЫЙ ВАРИАНТ ОДНОЙ СТРОКОЙ, ОСТАЛЬНЫЕ ПО «ИЗМЕНИТЬ» ──');
{
  /* Постановка тридцать седьмой: «на оформлении не повторяй весь список
     тарифов и сроков: выбранный на лендинге вариант показывается одной
     строкой — тариф, срок, цена и „Изменить“, а остальные варианты
     открываются только по „Изменить“».

     ⚠️ СУДИМ ПО ВЫСОТЕ ЖИВОГО БЛОКА, А НЕ ПО АТРИБУТУ. Атрибут доказал бы
     только, что состояние переключилось; здесь спрашивается, свёрнут ли
     список НА ЭКРАНЕ (Р-47). */
  await klient.goto(`http://localhost:${PORT}/checkout/?plan=duo&period=12`, { waitUntil: 'networkidle' });
  const stroka = await klient.innerText('.vybor__stroka');
  chk('выбор показан одной строкой: тариф, срок, цена и «Изменить»',
    /На двоих/.test(stroka) && /Год/.test(stroka) && /290/.test(stroka) && /Изменить/.test(stroka),
    stroka.replace(/\s+/g, ' '));

  const zakryto = await klient.evaluate(
    () => document.querySelector('.vybor__nutro')?.getBoundingClientRect().height ?? -1);
  chk('список вариантов закрыт до нажатия', zakryto < 4, `${Math.round(zakryto)} px`);

  await klient.click('.vybor__izm');
  await klient.waitForTimeout(600);
  const otkryto = await klient.evaluate(
    () => document.querySelector('.vybor__nutro')?.getBoundingClientRect().height ?? -1);
  chk('«Изменить» открывает и тарифы, и сроки', otkryto > 120, `${Math.round(otkryto)} px`);

  /* Смена тарифа тянет за собой число участников: это то, ради чего
     каталог и поехал в форму целиком. */
  await klient.locator('.pick__btn', { hasText: 'На троих' }).first().click();
  await klient.waitForTimeout(400);
  const uch = await klient.locator('.uchastnik').count();
  chk('смена тарифа меняет число участников', uch === 3, `${uch} участника`);

  /* ⚠️ НЕВЫБРАННАЯ ПЛАШКА НЕ ПОДСВЕЧЕНА НИЧЕМ: ни каймы, ни яркого
     текста. Судится по вычисленному стилю живой страницы. */
  const plashki = await klient.$$eval('.pick__btn', (els) =>
    els.slice(0, 6).map((el) => {
      const cs = getComputedStyle(el);
      return {
        vybran: el.getAttribute('aria-checked') === 'true',
        ten: cs.boxShadow,
        cvet: cs.color,
      };
    }));
  const nevybrannye = plashki.filter((v) => !v.vybran);
  chk('у невыбранных плашек нет ни каймы, ни белого текста',
    nevybrannye.length > 0
      && nevybrannye.every((v) => v.ten === 'none' && !/255, 255, 255/.test(v.cvet)),
    nevybrannye.map((v) => `${v.ten} ${v.cvet}`).slice(0, 2).join(' · '));
}

console.log('── СКИДКА И ВЫКЛЮЧЕННАЯ ЯЧЕЙКА: ЧЕРЕЗ АДМИНКУ И НА САЙТЕ ──');
{
  /* ⚠️ ЗАДАЁТСЯ ЧЕРЕЗ АДМИНКУ, А НЕ ВСТАВКОЙ В БАЗУ. Лендинг
     статический с `revalidate`, и правка ценой в обход админки
     до него просто не доехала бы: `revalidatePath('/')` зовёт
     действие, а не запрос. То есть вставкой мы проверяли бы
     не то, что делает человек. */
  const zavtra = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
  await admin.goto(`http://localhost:${PORT}/admin/settings/`, { waitUntil: 'networkidle' });

  const skidkaForma = admin
    .locator('form')
    .filter({ has: admin.locator('input[name="until"]') })
    .nth(8); // trio · 1 мес: три тарифа по четыре срока, trio идёт девятым
  await skidkaForma.locator('input[name="price"]').fill('690');
  await skidkaForma.locator('input[name="until"]').fill(zavtra);
  /* Серверное действие адреса не меняет, поэтому обычный клик
     с ожиданием отрисовки, а не `nazhat` (он ждал бы перехода). */
  await skidkaForma.locator('button[type="submit"]').click();
  await admin.waitForTimeout(1200);

  const telaSk = (await admin.textContent('body')) ?? '';
  chk('админка сохранила скидку', /Скидка сохранена/.test(telaSk));

  await klient.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  const lend = (await klient.textContent('body')) ?? '';
  chk('на карточке зачёркнута старая цена и назван срок скидки',
    /890/.test(lend) && /690/.test(lend) && /до \d\d\.\d\d/.test(lend),
    lend.match(/до \d\d\.\d\d/)?.[0] ?? '');
  const zachyorknuto = await klient.$$eval('.card__bylo', (e) => e.map((x) => x.textContent ?? ''));
  chk('старая цена именно зачёркнута, а не просто напечатана',
    zachyorknuto.some((v) => v.includes('890')), zachyorknuto.join(' · '));

  /* Цена замораживается при создании заказа: заказ на «На троих»
     обязан стоить ровно столько, сколько стоил в момент оформления. */
  await klient.goto(`http://localhost:${PORT}/checkout/?plan=trio&period=1`, { waitUntil: 'networkidle' });
  /* ⚠️ СПРАШИВАЕТСЯ ВИДИМЫЙ ТЕКСТ, А НЕ `textContent` ВСЕГО ТЕЛА.
     В теле лежат ещё и сериализованные пропсы страницы, а в них
     с тридцать седьмой итерации едет ВЕСЬ каталог — «Изменить»
     открывает и тарифы, и сроки. Цена «на двоих за полгода» это
     2 890 ₽, то есть строка «890» честно есть в разметке и никогда
     не попадает на экран. Проверка про ЭКРАН, значит и читать надо
     экран. */
  const chek = await klient.innerText('main');
  chk('оформление считает по цене со скидкой', /690/.test(chek) && !/890/.test(chek),
    chek.replace(/\s+/g, ' ').slice(0, 90));

  // Выключаем «на одного · три месяца» и смотрим, что срока не стало.
  await admin.goto(`http://localhost:${PORT}/admin/settings/`, { waitUntil: 'networkidle' });
  await admin.locator('form').filter({ has: admin.locator('input[name="on"]') }).nth(1)
    .locator('button[type="submit"]').click();
  await admin.waitForTimeout(1200);
  const posleVykl = (await admin.textContent('body')) ?? '';
  chk('админка выключила ячейку', /Срок выключен/.test(posleVykl));
  await klient.goto(`http://localhost:${PORT}/checkout/?plan=solo`, { waitUntil: 'networkidle' });
  const sroki = await klient.$$eval('.pick__btn', (e) => e.map((x) => x.textContent ?? ''));
  chk('выключенного срока нет в оформлении',
    sroki.length > 0 && !sroki.some((v) => /Три месяца/.test(v)), sroki.join(' · '));
}


console.log('── ПОЧТА ЗАНЯТА: ОТМЕНА, ДЕНЬГИ НА БАЛАНС, ПИСЬМО О ПОВТОРНОМ ЗАКАЗЕ ──');
{
  /* Особый случай из постановки: на почту клиента уже есть аккаунт
     Spotify, и новый на неё не завести. Это НЕ ОТКАЗ, а развилка:
     заказ закрывается, деньги идут на баланс, а человеку уходит
     письмо с просьбой оформить заново, выбрав «Продлить
     существующий». */
  await klient.goto(`http://localhost:${PORT}/checkout/?plan=solo&period=1`, { waitUntil: 'networkidle' });
  const galka = klient.locator('input[name="balance"]');
  if (await galka.count()) await galka.uncheck();
  await klient.fill('input[name="login0"]', 'zanyataya@pochta.test');
  await klient.fill('input[name="password0"]', 'Zanyataya-8');
  await klient.check('input[name="consent"]');
  await nazhat(klient, 'button[type="submit"]');
  await nazhat(klient, 'button[type="submit"]');
  const zz = await p2.query(`select id, user_id, money_kop from shop_order where status = 'paid' order by id desc limit 1`);
  const nomerZ = Number(zz.rows[0].id);
  const balansBylo = Number(
    (await p2.query('select balance_kop from app_user where id = $1', [zz.rows[0].user_id])).rows[0].balance_kop,
  );

  await admin.goto(`http://localhost:${PORT}/admin/orders/${nomerZ}/`, { waitUntil: 'networkidle' });
  await nazhat(admin, 'button:has-text("Взять")');
  await admin.locator('button:has-text("уже есть аккаунт Spotify")').first().click();
  await admin.waitForTimeout(1200);

  const posleZ = await p2.query('select status, cancel_reason from shop_order where id = $1', [nomerZ]);
  chk('заказ закрыт с причиной «почта занята»',
    posleZ.rows[0].status === 'cancelled' && /уже есть аккаунт Spotify/.test(posleZ.rows[0].cancel_reason ?? ''),
    `${posleZ.rows[0].status} · ${posleZ.rows[0].cancel_reason}`);
  const balansStal = Number(
    (await p2.query('select balance_kop from app_user where id = $1', [zz.rows[0].user_id])).rows[0].balance_kop,
  );
  chk('деньги вернулись на баланс',
    balansStal === balansBylo + Number(zz.rows[0].money_kop),
    `${balansBylo / 100} → ${balansStal / 100} ₽`);
  /* ⚠️ БЕЗ УЧЁТА РЕГИСТРА: с тридцать шестой итерации номера заказа
     в теме письма нет, и тема начинается с этой же фразы — то есть
     с прописной буквы (закон 48). */
  chk('клиенту ушло письмо «оформите заново, выбрав продление»',
    /на эту почту уже есть аккаунт Spotify/i.test(server.zhurnal()) &&
      server.zhurnal().includes('Продлить существующий'));
}

console.log('── ДАТА ОКОНЧАНИЯ И НАПОМИНАНИЕ ЗА ТРИ ДНЯ ──');
{
  const srok = await p2.query(
    `select id, closed_at, expires_at, period,
            extract(epoch from (expires_at - closed_at)) / 86400 as dney
       from shop_order where status = 'done' and expires_at is not null order by id limit 1`,
  );
  chk('дата окончания поставлена при закрытии заказа',
    srok.rows.length === 1 && Number(srok.rows[0].dney) > 360 && Number(srok.rows[0].dney) < 372,
    `${Math.round(Number(srok.rows[0]?.dney ?? 0))} дней на ${srok.rows[0]?.period} мес`);

  await klient.goto(`http://localhost:${PORT}/cabinet/`, { waitUntil: 'networkidle' });
  const kab = (await klient.textContent('body')) ?? '';
  chk('в кабинете стоит строка про срок доступа', /Доступ действует до \d\d\.\d\d\.\d{4}/.test(kab),
    kab.match(/Доступ действует до [\d.]+/)?.[0] ?? '');

  const zakazN = Number(srok.rows[0].id);
  /* ⚠️ БУДИЛЬНИК ЗОВЁТ УБОРКУ И НАПОМИНАНИЯ ПРИ СТАРТЕ СЛУЖБЫ,
     поэтому проверка поднимает ВТОРОЙ сервер: ждать часа нечем,
     а стучаться в рассылку в обход её собственного пути значило бы
     проверять не то, что работает на бою (Р-98). */
  const ehoFp = await p2.query(
    `select login_fp from order_slot where order_id = $1 and login_fp is not null order by idx limit 1`,
    [zakazN],
  );

  const podnyat = async () => {
    const vtoroy = await serveOut(PORT + 7, {
      env: {
        DATABASE_URL: URL_BAZY,
        SPOTIK_CRYPTO_KEY: KLYUCH,
        SPOTIK_SITE_URL: `http://localhost:${PORT}`,
        TELEGRAM_BOT_TOKEN: 'proverochnyy-token',
        TELEGRAM_CHAT_ID: '-1001',
        TELEGRAM_API_BASE: 'https://127.0.0.1:9',
        TELEGRAM_IP_FAMILY: '0',
      },
    });
    /* Ждём СОБЫТИЯ, а не секунд: отметки в базе. */
    /* Потолок с запасом: на загруженном раннере второй сервер
       поднимается заметно дольше, чем здесь. */
    const do_ = Date.now() + 90_000;
    while (Date.now() < do_) {
      const r = await p2.query('select reminded_at from shop_order where id = $1', [zakazN]);
      if (r.rows[0].reminded_at) break;
      await new Promise((t) => setTimeout(t, 500));
    }
    await new Promise((t) => setTimeout(t, 500));
    const log = vtoroy.zhurnal();
    vtoroy.close();
    return log;
  };

  /* Ветка «продление уже оформлено»: письма быть не должно.
     ⚠️ ПРОДЛЕНИЕ ЗАВОДИТСЯ ОТДЕЛЬНОЙ СТРОКОЙ, А НЕ БЕРЁТСЯ ИЗ ТОГО,
     ЧТО УЖЕ ЕСТЬ В БАЗЕ. Первая редакция искала «любой другой
     незакрытый заказ со слотами» — и падала на пустом месте: к этому
     шагу все остальные заказы с участниками уже отменены ходом самой
     проверки, а сертификатные слотов не имеют вовсе. Условие ветки
     точное — заказ ПОЗЖЕ закрытия этого, не отменённый, с тем же
     отпечатком почты, — и завести его надо именно таким. */
  await p2.query(
    `update shop_order set expires_at = now() + interval '2 days', reminded_at = null where id = $1`,
    [zakazN],
  );
  const prodlenie = await p2.query(
    `insert into shop_order (user_id, kind, plan_id, period, status, total_kop, money_kop, created_at)
     select user_id, 'plan', plan_id, period, 'new', total_kop, 0, now()
       from shop_order where id = $1 returning id`,
    [zakazN],
  );
  const nomerProdleniya = Number(prodlenie.rows[0].id);
  await p2.query(
    `insert into order_slot (order_id, idx, mode, login_fp) values ($1, 0, 'renew', $2)`,
    [nomerProdleniya, ehoFp.rows[0].login_fp],
  );
  const log1 = await podnyat();
  chk('при уже оформленном продлении письма нет',
    /напоминание не нужно: продление уже оформлено/.test(log1) &&
      !/Подписка Spotify Premium заканчивается/.test(log1));
  const zashchyolka = await p2.query('select reminded_at from shop_order where id = $1', [zakazN]);
  chk('защёлка всё равно поставлена', Boolean(zashchyolka.rows[0].reminded_at));

  // Ветка «продления нет»: письмо со ссылкой на продление.
  await p2.query('delete from shop_order where id = $1', [nomerProdleniya]);
  await p2.query('update shop_order set reminded_at = null where id = $1', [zakazN]);
  const log2 = await podnyat();
  chk('за три дня уходит письмо с датой окончания',
    /Подписка Spotify Premium заканчивается/.test(log2),
    log2.match(/Подписка Spotify Premium заканчивается [\d.]+/)?.[0] ?? '');
  chk('в письме ссылка «Продлить» с тарифом, сроком и номером заказа',
    new RegExp(`/checkout/\\?plan=[a-z]+&period=\\d+&renew=${zakazN}`).test(log2),
    log2.match(/\/checkout\/\?plan=[^\s]+/)?.[0] ?? '');
}

console.log('── ОБРАЩЕНИЕ В ПОДДЕРЖКУ ──');
{
  /* Плашка на лендинге появляется после первого экрана — значит
     сначала надо туда доехать. */
  await klient.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await klient.evaluate(() => {
    const sc = document.getElementById('scroller');
    if (sc) sc.scrollTop = window.innerHeight * 1.5;
  });
  await klient.waitForTimeout(400);
  chk('плашка «Поддержка» появилась после первого экрана',
    await klient.$eval('.pd__knopka', (e) => e.hasAttribute('data-vidna')));

  /* ⚠️ ЖДЁМ ОТВЕТА ФОРМЫ, А НЕ СЕКУНД. Фиксированная выдержка после
     нажатия проходила здесь и падала на раннере: серверное действие
     под нагрузкой отвечает дольше, и следующий шаг видел форму
     в прежнем состоянии. Ровно этот класс ошибки уже ронял выкладки
     № 84 и № 85 (Р-97, Р-94) — ждать надо СОБЫТИЯ. Событие тут одно
     и общее для удачи и отказа: содержимое окна изменилось. */
  const otpravitIZhdat = async () => {
    const bylo = (await klient.textContent('.pd__okno')) ?? '';
    await klient.click('.pd__okno button[type="submit"]');
    await klient.waitForFunction(
      (b) => (document.querySelector('.pd__okno')?.textContent ?? '') !== b,
      bylo,
      { timeout: 20000 },
    );
    await klient.waitForTimeout(250);
  };

  await klient.click('.pd__knopka');
  await klient.waitForSelector('textarea[name="tekst"]', { timeout: 15000 });
  await klient.fill('textarea[name="tekst"]', 'Не приходит письмо с кодом входа, проверьте пожалуйста.');
  await klient.fill('input[name="svyaz"]', '@spotik_klient');
  /* ⚠️ ПАУЗА ПЕРЕД ОТПРАВКОЙ ОБЯЗАТЕЛЬНА, И ЭТО НЕ ПОДГОНКА. Форма
     отсекает отправку, случившуюся раньше секунды с небольшим после
     открытия: обходчик шлёт её, не открывая. Сторож заполняет поля
     мгновенно, то есть выглядит ровно как обходчик. */
  await klient.waitForTimeout(2000);
  await otpravitIZhdat();
  const prinyato = (await klient.textContent('body')) ?? '';
  chk('ответ спокойный: обращение принято', /Обращение принято/.test(prinyato));

  const obr = await p2.query(`select tekst from notify_outbox where vid = 'obrashchenie' order by id desc limit 1`);
  chk('обращение ушло в служебный чат через очередь уведомлений',
    obr.rows.length === 1 && /Обращение в поддержку/.test(obr.rows[0].tekst),
    (obr.rows[0]?.tekst ?? '').replace(/\n/g, ' · ').slice(0, 90));
  /* ⚠️ ОБРАЩЕНИЕ ОСТАЁТСЯ РУССКИМ, хотя рабочие сообщения бота
     переведены: внутри текст, который написал клиент. */
  chk('обращение по-русски, а рабочие сообщения по-английски',
    /Связь: @spotik_klient/.test(obr.rows[0]?.tekst ?? ''));
  chk('текста обращения нет в журнале сервера',
    !server.zhurnal().includes('Не приходит письмо с кодом входа'));

  // Лимит: три обращения за десять минут, четвёртое отбито.
  const poslat = async (tekst) => {
    /* Окно после удачной отправки показывает подтверждение — закрываем
       его крестиком и открываем заново, как это делает человек. */
    await klient.click('.pd__krest');
    await klient.waitForTimeout(300);
    await klient.click('.pd__knopka');
    await klient.waitForSelector('textarea[name="tekst"]', { timeout: 15000 });
    await klient.fill('textarea[name="tekst"]', tekst);
    await klient.fill('input[name="svyaz"]', '@spotik_klient');
    await klient.waitForTimeout(2000);
    await otpravitIZhdat();
  };
  await poslat('Ещё одно обращение номер два, всё подробно.');
  await poslat('Ещё одно обращение номер три, всё подробно.');
  await poslat('Четвёртое подряд обращение, его пора отбить.');
  const chetvyortoe = (await klient.textContent('body')) ?? '';
  chk('четвёртое подряд обращение отбито по частоте',
    /Обращение уже отправлено/.test(chetvyortoe));

  // Ловушка: заполненное скрытое поле отвечает «принято», а в чат
  // не уходит ничего.
  const bylo = (await p2.query(`select count(*)::int n from notify_outbox where vid = 'obrashchenie'`)).rows[0].n;
  await klient.evaluate(() => {
    const f = document.querySelector('.pd__okno form');
    const l = f?.querySelector('input[name="website"]');
    if (l) (l).value = 'http://spam.example';
  });
  chk('ловушка для обходчика есть на форме',
    await klient.$eval('.pd__okno input[name="website"]', (e) => e.getAttribute('tabindex') === '-1'));
  const stalo = (await p2.query(`select count(*)::int n from notify_outbox where vid = 'obrashchenie'`)).rows[0].n;
  chk('отбитые обращения в чат не попали', stalo === bylo, `${bylo} → ${stalo}`);
}

chk('ни одной ошибки JavaScript', oshibkiJS.length === 0, oshibkiJS.slice(0, 3).join(' | '));

await p2.end();
await browser.close();
server.close();
console.log(bad ? `\nПРОВАЛ: ${bad} проверок не прошло` : '\nМАГАЗИН РАБОТАЕТ: заказ, оплата, выдача, сертификат');
process.exit(bad ? 1 : 0);

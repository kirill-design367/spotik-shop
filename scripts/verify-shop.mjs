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
/* ⚠️ `plan_name` И `staff_plan_off` ТОЖЕ В СПИСКЕ, И ПОПАЛИ ОНИ ТУДА
   ПОСЛЕ НАСТОЯЩЕГО ПАДЕНИЯ. Имя тарифа и запреты операторов — такая же
   настройка, как цена, и прогон, который их менял и не убрал за собой,
   ронял СЛЕДУЮЩИЙ прогон: тот искал в админке строку «Duo» и не
   находил её, потому что тариф остался переименованным с прошлого
   раза. Убирать за собой в конце блока всё равно надо (так и сделано),
   но чистка в начале — единственное, что переживает падение
   посередине. */
await pool.query(`truncate balance_move, payment, order_slot, certificate, shop_order,
  session, login_code, cert_try, support_try, app_user, staff, staff_plan_off,
  plan_price, plan_name, plan_discount, plan_off, setting, notify_outbox
  restart identity cascade`);
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
/**
 * ГЛАВНАЯ КНОПКА ШАГА: нажать и подтвердить «Да».
 *
 * ⚠️ С СОРОК ВТОРОЙ ИТЕРАЦИИ КАЖДЫЙ ШАГ СПРАШИВАЕТ «Вы уверены, что
 * всё заполнено верно?» (постановка), и одно нажатие больше ничего
 * не проводит. Подтверждение — НЕ системное `confirm()`, а свой блок
 * на месте кнопки, поэтому ловится обычным селектором.
 */
async function shagVpered(page, selektor) {
  await page.locator(selektor).first().click();
  const da = page.locator('.ad__sure button[type="submit"]').first();
  await da.waitFor({ state: 'visible', timeout: 5000 });
  await da.click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(700);
}

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
/* ⚠️ НАЗВАНИЕ ТАРИФА И СРОК В АНГЛИЙСКОЙ АДМИНКЕ ТОЖЕ АНГЛИЙСКИЕ
   (тридцать девятая итерация). Проверяются ОБЕ стороны: английское
   появилось И русского не осталось — одного первого мало, «Duo»
   могло бы стоять рядом с «На двоих» в соседней колонке.
   ⚠️ И СПРАШИВАЕТСЯ `innerText`, А НЕ `textContent` ВСЕГО ТЕЛА:
   в теле лежат ещё и потоковые чанки Next со СТАРЫМ, русским
   отрисованным деревом, и по ним проверка падала на исправном
   коде. Читать надо видимую часть. */
const vidnoEn = await admin.innerText('main.ad');
chk(
  'в английской админке тариф и срок по-английски',
  /Duo/.test(vidnoEn) && /12 months/.test(vidnoEn)
    && !/На двоих/.test(vidnoEn) && !/12 мес/.test(vidnoEn),
  vidnoEn.replace(/\s+/g, ' ').match(/Duo.{0,24}/)?.[0] ?? 'английского названия нет',
);
chk('атрибут языка сменился', (await admin.getAttribute('main.ad', 'lang')) === 'en');
const vBaze = await p2.query('select lang from staff where email = $1', [ADMIN]);
chk('выбор лёг В СТРОКУ СОТРУДНИКА, а не только в куку', vBaze.rows[0]?.lang === 'en', String(vBaze.rows[0]?.lang));
await admin.goto(`http://localhost:${PORT}/admin/settings/`, { waitUntil: 'networkidle' });
chk('язык держится на другой странице раздела', /Prices/.test((await admin.textContent('body')) ?? ''));
await admin.goto(`http://localhost:${PORT}/admin/`, { waitUntil: 'networkidle' });

await nazhat(admin, '.ad__lang-btn[value="ru"]');
const nazad = await admin.textContent('body');
chk('вернулся на русский', /Очередь заказов/.test(nazad ?? ''));
const vidnoRu = await admin.innerText('main.ad');
chk(
  'в русской админке тариф и срок по-русски',
  /На двоих/.test(vidnoRu) && /12 мес/.test(vidnoRu) && !/Duo/.test(vidnoRu),
  vidnoRu.replace(/\s+/g, ' ').match(/На двоих.{0,20}/)?.[0] ?? 'русского названия нет',
);

await nazhat(admin, 'button:has-text("Взять")');
chk('заказ взят и открылся', /\/admin\/orders\//.test(admin.url()), admin.url().replace(`http://localhost:${PORT}`, ''));
/* Номер берём ИЗ АДРЕСА, а не из базы: по нему дальше спрашиваются
   отметки слотов, и он обязан быть тем самым заказом, который открыт
   на экране. */
const nomerZakaza = Number(admin.url().match(/\/orders\/(\d+)/)?.[1] ?? 0);
const karta = await admin.textContent('body');
/* ⚠️ НА ЭКРАНЕ ТОЛЬКО ТЕКУЩИЙ ШАГ (сорок вторая итерация), поэтому
   виден пароль ТОГО аккаунта, который сейчас проходят, а не сразу
   оба. Первый участник — новый аккаунт, второй — продление; пароль
   продления проверяется ниже, когда до него доходит шаг. */
chk('оператору виден пароль клиента на текущем шаге', /Novyy-Parol-9/.test(karta ?? ''));
chk('пароль второго аккаунта на первом шаге ещё не показан', !/ochen-tayny-parol/.test(karta ?? ''));

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
/* ── ЗАКАЗ ПРОВОДИТСЯ ПО ШАГАМ ─────────────────────────────────────
   ⚠️ НА ЭКРАНЕ РОВНО ОДИН ТЕКУЩИЙ ШАГ (постановка сорок второй
   итерации), поэтому кнопка «отметить выполненным» на нём одна,
   а не столько же, сколько участников. Остальные шаги свёрнуты
   или приглушены и своих кнопок не несут. */
{
  const seychas = await admin.$$('.ad__shag[data-sost="seychas"]');
  chk('на экране ровно один текущий шаг', seychas.length === 1, `${seychas.length}`);
  const knopki = await admin.$$('.ad__shag[data-sost="seychas"] button:has-text("отметить выполненным")');
  chk('у текущего шага одна главная кнопка', knopki.length === 1, `${knopki.length}`);
  const zhdut = await admin.$$('.ad__shag[data-sost="zhdyot"] button[type="submit"]');
  chk('у следующих шагов кнопок нет вовсе', zhdut.length === 0, `${zhdut.length}`);
  const doPodtv = await admin.$$('.ad__sure');
  chk('вопрос «вы уверены» до нажатия не показан', doPodtv.length === 0, `${doPodtv.length}`);
}

/* ⚠️ ШАГ НАЗАД И ОБРАТНО — ПРОВЕРЯЕТСЯ ПО БАЗЕ, А НЕ ПО ЭКРАНУ.
   «Назад снимает отметку» — это состояние слота, и судить о нём
   по надписи значило бы проверять нашу же разметку (Р-47). */
await shagVpered(admin, '.ad__shag[data-sost="seychas"] button:has-text("отметить выполненным")');
{
  const gotovo = await p2.query(
    `select count(*)::int as n from order_slot where order_id = $1 and done_at is not null`,
    [nomerZakaza],
  );
  chk('первый аккаунт отмечен пройденным', gotovo.rows[0].n === 1, `${gotovo.rows[0].n}`);
  await nazhat(admin, 'button:has-text("Назад")');
  const posleNazad = await p2.query(
    `select count(*)::int as n from order_slot where order_id = $1 and done_at is not null`,
    [nomerZakaza],
  );
  chk('«Назад» снял отметку с предыдущего шага', posleNazad.rows[0].n === 0, `${posleNazad.rows[0].n}`);
}

/* Проходим первый аккаунт и смотрим второй: на его шаге обязаны
   появиться ЕГО почта и ЕГО пароль — то есть расшифровка идёт
   по слоту, а не «всё сразу». */
await shagVpered(admin, '.ad__shag[data-sost="seychas"] button:has-text("отметить выполненным")');
{
  const vtoroy = await admin.innerText('.ad__shag[data-sost="seychas"]');
  chk('на втором шаге видны почта и пароль второго аккаунта',
    /moy@akkaunt\.test/.test(vtoroy) && /ochen-tayny-parol9/.test(vtoroy),
    vtoroy.replace(/\s+/g, ' ').slice(0, 120));
  chk('первый шаг свёрнут с галочкой',
    (await admin.$$('.ad__shag[data-sost="proyden"]')).length === 1,
    `${(await admin.$$('.ad__shag[data-sost="proyden"]')).length}`);
}

for (let i = 0; i < 4; i += 1) {
  const knopka = admin.locator('.ad__shag[data-sost="seychas"] button:has-text("отметить выполненным")').first();
  if (!(await knopka.count())) break;
  await shagVpered(admin, '.ad__shag[data-sost="seychas"] button:has-text("отметить выполненным")');
}

/* ── ЗАВЕРШЕНИЕ: ДАТА ОКОНЧАНИЯ У ПРОДЛЕНИЯ ОБЯЗАТЕЛЬНА ────────────
   ⚠️ ПОЛЕ ЗАРАНЕЕ ЗАПОЛНЕНО РАСЧЁТНОЙ ДАТОЙ (постановка), и считает
   её СЕРВЕР: спроси мы часы браузера, оператор из другого пояса
   получил бы другую подстановку (закон 49). Проверяем, что оно
   заполнено и заполнено разумно, а потом ставим свою дату — от неё
   обязан считаться срок доступа. */
let svoyaData = '';
{
  const pole = admin.locator('.ad__shag[data-sost="seychas"] input[type="date"]').first();
  chk('на завершении спрошена дата окончания у продления', (await pole.count()) === 1, `${await pole.count()}`);
  const podstavleno = await pole.inputValue();
  chk('поле даты заранее заполнено', /^\d{4}-\d{2}-\d{2}$/.test(podstavleno), podstavleno || 'пусто');
  /* ⚠️ СВОЯ ДАТА — НА ДЕСЯТЬ СУТОК РАНЬШЕ РАСЧЁТНОЙ, И ЭТО НЕ ВКУС.
     `expires_at` берётся как САМАЯ РАННЯЯ из дат (введённая
     оператором и «выдача плюс срок» у нового аккаунта), потому что
     напоминание обязано уйти до конца ПЕРВОГО аккаунта. В заказе
     на двоих один аккаунт новый, а другой на продление: поставь мы
     дату позже расчётной — победила бы расчётная, и проверить, что
     введённая доехала, было бы нечем. */
  const d = new Date(`${podstavleno}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 10);
  svoyaData = d.toISOString().slice(0, 10);
  await pole.fill(svoyaData);
}
await shagVpered(admin, '.ad__shag[data-sost="seychas"] button:has-text("Завершить заказ")');
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
console.log('── СТАТИСТИКА: ПЕРИОД, ДОСТУП ИСПОЛНИТЕЛЮ И ТОЛЬКО ИЗ БАЗЫ ──');
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

  /* ── ПЕРИОД: ОТДЕЛЬНАЯ ДАТА И ДИАПАЗОН ──────────────────────────
     Сорок вторая итерация: «Добавить выбор периода: отдельная дата
     или диапазон дат, плюс быстрые „сутки, неделя, месяц"».

     ⚠️ СВЕРЯЕМСЯ С ОТДЕЛЬНЫМ ЗАПРОСОМ К БАЗЕ, А НЕ С ПЕРЕСЧЁТОМ ТОЙ
     ЖЕ АРИФМЕТИКОЙ (Р-47): числа на экране обязаны сойтись с базой
     по ТЕМ ЖЕ границам, но посчитанным отдельно. */
  const segodnya = (await p2.query('select current_date::text as d')).rows[0].d;
  const zaDen = await p2.query(
    `select count(*)::text as n, coalesce(sum(money_kop), 0)::text as kop
       from shop_order
      where paid_at is not null and paid_at >= $1::date and paid_at < ($1::date + 1)`,
    [segodnya],
  );
  await admin.goto(`http://localhost:${PORT}/admin/stats/?ot=${segodnya}`, { waitUntil: 'networkidle' });
  const zaDatu = (await admin.innerText('main.ad')).replace(/\u00a0/g, ' ');
  const rubDen = (Number(zaDen.rows[0].kop) / 100).toLocaleString('ru-RU').replace(/\u00a0/g, ' ');
  chk('выручка за отдельную дату сходится с базой', zaDatu.includes(rubDen), `${rubDen} ₽ за ${segodnya}`);
  chk('дата осталась в поле', (await admin.locator('input[name="ot"]').inputValue()) === segodnya);

  /* ⚠️ ПУСТОЙ ПЕРИОД ПРОВЕРЯЕТСЯ ОТДЕЛЬНО, и без него предыдущая
     строка ничего не значит: она прошла бы и у страницы, которая
     период не учитывает вовсе. */
  await admin.goto(`http://localhost:${PORT}/admin/stats/?ot=2020-01-01&do=2020-01-02`, {
    waitUntil: 'networkidle',
  });
  const pusto = await admin.innerText('main.ad');
  chk('в периоде без заказов разбивки по тарифам нет',
    /Пока пусто/.test(pusto) && !/На двоих/.test(pusto),
    pusto.replace(/\s+/g, ' ').match(/По тарифам.{0,40}/)?.[0] ?? '—');

  /* ── СТАТИСТИКА ОТКРЫТА ИСПОЛНИТЕЛЮ ────────────────────────────
     ⚠️ РОЛЬ МЕНЯЕТСЯ В БАЗЕ, А НЕ ВТОРЫМ ВХОДОМ: код входа выдаётся
     не чаще одного в минуту (Р-86), и завести второго сотрудника
     прогон просто не успел бы. Роль возвращается сразу же — иначе
     следующие проверки шли бы от чужого лица. */
  await p2.query(`update staff set role = 'operator' where email = $1`, [ADMIN]);
  await admin.goto(`http://localhost:${PORT}/admin/stats/`, { waitUntil: 'networkidle' });
  const ispolnitelyu = (await admin.innerText('main.ad')) ?? '';
  chk('исполнителю статистика ОТКРЫТА',
    /Сейчас в очереди/.test(ispolnitelyu) && !/Только для администраторов/.test(ispolnitelyu),
    ispolnitelyu.replace(/\s+/g, ' ').slice(0, 80));
  chk('исполнителю виден и выбор периода', (await admin.$$('input[name="ot"]')).length === 1);

  /* ── ДЕНЬГИ ЗАКАЗА ИСПОЛНИТЕЛЮ НЕ ВИДНЫ ────────────────────────
     ⚠️ ПРОВЕРЯЕТСЯ ВСЯ РАЗМЕТКА, А НЕ ВИДИМЫЙ ТЕКСТ. «Не показываем»
     сделано тем, что сумма НЕ УХОДИТ НА СТРАНИЦУ: спрячь мы строку
     стилем — число лежало бы в разметке и было бы видно всякому,
     кто её откроет. */
  await admin.goto(`http://localhost:${PORT}/admin/orders/${nomerZakaza}/`, { waitUntil: 'networkidle' });
  const uIspolnitelya = (await admin.content()) ?? '';
  chk('исполнителю строки «Деньги» в заказе нет',
    !/Деньги/.test(uIspolnitelya) && !/с баланса/.test(uIspolnitelya));
  chk('суммы нет и в разметке страницы', !/5290\.00/.test(uIspolnitelya) && !/52\.90/.test(uIspolnitelya));
  await p2.query(`update staff set role = 'admin' where email = $1`, [ADMIN]);
  await admin.goto(`http://localhost:${PORT}/admin/orders/${nomerZakaza}/`, { waitUntil: 'networkidle' });
  const uAdmina = (await admin.innerText('main.ad')) ?? '';
  chk('администратору строка «Деньги» видна', /Деньги/.test(uAdmina) && /с баланса/.test(uAdmina));
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
   ИТЕРАЦИИ, А С ТРИДЦАТЬ ДЕВЯТОЙ — И НАЗВАНИЕ ТАРИФА СО СРОКОМ.
   Постановка: «Plan: Индивидуальный, месяц» читалось как недоделка.
   Граница закона 40 при этом не сдвинулась: тариф и срок выбираем
   МЫ — это наши надписи; почта клиента, его пароль и причина отмены
   не переводятся по-прежнему. Сторож требует, чтобы русского
   в рабочем сообщении не осталось НИ ОДНОЙ буквы: одна забытая
   подстановка и есть весь дефект. */
chk(
  'уведомление об оплате легло в очередь',
  Boolean(oplachen) && /New paid order #1/.test(oplachen?.tekst ?? ''),
);
chk(
  'в уведомлении тариф, срок, число участников и ссылка в админку',
  /Plan: Duo, 12 months/.test(oplachen?.tekst ?? '') &&
    /Participants: 2/.test(oplachen?.tekst ?? '') &&
    /\/admin\/orders\/1\//.test(oplachen?.tekst ?? ''),
  (oplachen?.tekst ?? '').replace(/\n/g, ' · '),
);
chk(
  'в рабочем сообщении бота нет ни одной русской буквы',
  !/[А-Яа-яЁё]/.test(oplachen?.tekst ?? ''),
  (oplachen?.tekst ?? '').match(/[А-Яа-яЁё][^\n]*/)?.[0] ?? 'русского нет',
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

console.log('── ОТМЕНА: ПРИЧИНА ИЗ СПИСКА, ПИСЬМО САМО, ДЕНЬГИ НА БАЛАНС ──');
/* Берём заказ ПО СЕРТИФИКАТУ и отменяем его. Денег за ним нет,
   зато проверяются две вещи разом: причина отмены из закрытого списка
   с письмом, которое уходит САМО (сорок вторая итерация), и то, что
   сертификат от отмены оживает.

   ⚠️ ЗАКОН 37 ЭТИМ НЕ ОСЛАБЛЕН, А ВЫПОЛНЕН ПО ПОСТРОЕНИЮ. Прежде
   порядок «сначала письмо, потом отмена» держался проверкой
   на сервере и отдельной кнопкой у оператора; теперь письмо и отмена —
   ОДИН шаг, и нарушить порядок нечем. */
await admin.goto(`http://localhost:${PORT}/admin/`, { waitUntil: 'networkidle' });
const ocheredDara = await admin.textContent('body');
chk('подарочный заказ помечен в очереди', /подарок/.test(ocheredDara ?? ''));
await nazhat(admin, 'button:has-text("Взять")');
const kartaDara = await admin.textContent('body');
chk(
  'оператор видит, что заказ подарочный',
  /подарок/.test(kartaDara ?? '') && /денег нет/.test(kartaDara ?? ''),
);

const nomerDara = Number(admin.url().match(/\/orders\/(\d+)/)?.[1] ?? 0);
chk('отдельной кнопки «Пароль не подошёл» больше нет',
  (await admin.$$('button:has-text("Пароль не подошёл")')).length === 0);
chk('галочки «это случай пароль не подошёл» больше нет',
  (await admin.$$('input[name="badPassword"]')).length === 0);

/* Причина живёт на шаге аккаунта — там, где оператор работает
   с почтами и паролями (постановка). */
await admin.locator('.ad__shag[data-sost="seychas"] button:has-text("Отменить заказ")').first().click();
await admin.waitForTimeout(400);
{
  const vybrano = await admin.locator('select[name="reason"]').inputValue();
  chk('причина не выбрана заранее', vybrano === '', vybrano || 'пусто');
  const spisok = await admin.$$eval('select[name="reason"] option', (e) => e.map((x) => x.textContent ?? ''));
  chk('в списке есть причина про пароль 1-го аккаунта',
    spisok.some((v) => /Неправильный логин или пароль 1-го аккаунта/.test(v)), spisok.join(' | '));
  chk('в списке есть «уже зарегистрирован» и «уже подключен Premium» и «Другое»',
    spisok.some((v) => /уже зарегистрирован/.test(v)) &&
      spisok.some((v) => /уже подключен Spotify Premium/.test(v)) &&
      spisok.some((v) => /Другое/.test(v)));
}

/* ⚠️ «БЕЗ ПРИЧИНЫ НЕЛЬЗЯ» ПРОВЕРЯЕТСЯ НА СЕРВЕРЕ, А НЕ ПО `required`.
   Атрибут разметки человек снимает в браузере за секунду — ровно это
   мы и делаем, и отказ обязан прийти от действия. */
await admin.$eval('select[name="reason"]', (el) => el.removeAttribute('required'));
await admin.locator('.ad__shag[data-sost="seychas"] button:has-text("Отменить заказ, деньги")').first().click();
await admin.locator('.ad__sure button[type="submit"]').first().click();
await admin.waitForLoadState('networkidle');
await admin.waitForTimeout(700);
const bezPrichiny = await admin.textContent('body');
chk('без причины отмена не проходит', /Выберите причину отмены/.test(bezPrichiny ?? ''),
  (bezPrichiny ?? '').replace(/\s+/g, ' ').match(/Выберите причину[^.]*\./)?.[0] ?? 'отказа нет');
const posleBez = await p2.query('select status from shop_order where id = $1', [nomerDara]);
chk('заказ от этого не отменился', posleBez.rows[0].status !== 'cancelled', posleBez.rows[0].status);

/* Теперь причина про пароль: и отмена, и письмо — одним шагом. */
await admin.selectOption('select[name="reason"]', 'parol1');
await admin.locator('.ad__sure button[type="submit"]').first().click();
await admin.waitForLoadState('networkidle');
await admin.waitForTimeout(900);
const otmena = await admin.textContent('body');
chk('заказ отменён', /Заказ отменён/.test(otmena ?? ''));
{
  const pr = await p2.query('select cancel_reason from shop_order where id = $1', [nomerDara]);
  chk('клиент видит причину ДОСЛОВНО из списка',
    pr.rows[0].cancel_reason === 'Неправильный логин или пароль 1-го аккаунта',
    pr.rows[0].cancel_reason ?? '—');
  chk('письмо «не подошёл пароль» ушло само',
    /Не подошёл пароль от аккаунта Spotify/.test(server.zhurnal()));
  const ssylki = await p2.query('select count(*)::int as n from recovery_link where order_id = $1', [nomerDara]);
  chk('ссылка восстановления заведена', ssylki.rows[0].n === 1, `${ssylki.rows[0].n}`);
}

/* ── СТРАНИЦА ИЗ ПИСЬМА ────────────────────────────────────────────
   ⚠️ ТОКЕН БЕРЁТСЯ ИЗ ПИСЬМА, А НЕ ИЗ БАЗЫ, и иначе нельзя: в базе
   лежит только ОТПЕЧАТОК (Р-87). Значит проверяется ровно то, что
   получит человек. */
{
  const t = server.zhurnal().match(/\/vosstanovlenie\/\?t=([A-Za-z0-9_-]+)/)?.[1] ?? '';
  chk('ссылка в письме есть и она наша', t.length > 20, `${t.length} знаков`);
  const stranica = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await stranica.goto(`http://localhost:${PORT}/vosstanovlenie/?t=${t}`, { waitUntil: 'networkidle' });
  const vidno = await stranica.innerText('main');
  chk('на странице стоит почта того аккаунта, у которого не подошёл пароль',
    /novyy@pochta\.test/.test(vidno), vidno.replace(/\s+/g, ' ').slice(0, 120));
  chk('на странице одна кнопка перехода в Spotify',
    (await stranica.$$('button:has-text("Скопировать почту и перейти в Spotify")')).length === 1);
  chk('под кнопкой стоит подсказка про поле',
    /Вставьте почту в поле и нажмите «Получить ссылку»/.test(vidno));
  chk('пароля на странице нет ни разу', !/ochen-tayny-parol/.test(vidno));
  /* ⚠️ ЧУЖОЙ ТОКЕН НЕ ОТКРЫВАЕТ НИЧЕГО, и ответ у него тот же,
     что у выдуманного: рассказывать пришедшему, что заказ есть,
     незачем. */
  await stranica.goto(`http://localhost:${PORT}/vosstanovlenie/?t=vydumannyy-token-vydumannyy`, {
    waitUntil: 'networkidle',
  });
  const chuzhaya = await stranica.innerText('main');
  chk('выдуманный токен не открывает почту',
    !/novyy@pochta\.test/.test(chuzhaya) && /Ссылка не работает/.test(chuzhaya),
    chuzhaya.replace(/\s+/g, ' ').slice(0, 100));
  await stranica.close();
}
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
  /* ⚠️ ОТДЕЛЬНОЙ КНОПКИ «НА ЭТУ ПОЧТУ УЖЕ ЕСТЬ АККАУНТ» БОЛЬШЕ НЕТ:
     с сорок второй итерации это одна из причин в закрытом списке
     («Этот адрес электронной почты уже зарегистрирован»). Письмо
     при этом уходит то же — не отказ, а развилка. */
  chk('отдельной кнопки «почта занята» больше нет',
    (await admin.$$('button:has-text("уже есть аккаунт Spotify")')).length === 0);
  await admin.locator('.ad__shag[data-sost="seychas"] button:has-text("Отменить заказ")').first().click();
  await admin.waitForTimeout(400);
  await admin.selectOption('select[name="reason"]', 'zanyata');
  await admin.locator('.ad__shag[data-sost="seychas"] button:has-text("Отменить заказ, деньги")').first().click();
  await admin.locator('.ad__sure button[type="submit"]').first().click();
  await admin.waitForLoadState('networkidle');
  await admin.waitForTimeout(900);

  const posleZ = await p2.query('select status, cancel_reason, cancel_slot_idx from shop_order where id = $1', [nomerZ]);
  chk('заказ закрыт с причиной «почта уже зарегистрирована»',
    posleZ.rows[0].status === 'cancelled' &&
      posleZ.rows[0].cancel_reason === 'Этот адрес электронной почты уже зарегистрирован',
    `${posleZ.rows[0].status} · ${posleZ.rows[0].cancel_reason}`);
  /* ⚠️ В БАЗЕ ЛЕЖИТ НОМЕР АККАУНТА, А НЕ АДРЕС (Р-151):
     открытая почта в `cancel_reason` пережила бы семидневное
     стирание шифротекстов и уехала бы в ночную копию. */
  chk('в заказе стоит номер аккаунта, а адреса в причине нет',
    Number(posleZ.rows[0].cancel_slot_idx) === 0 && !/@/.test(posleZ.rows[0].cancel_reason ?? ''),
    `слот ${posleZ.rows[0].cancel_slot_idx} · ${posleZ.rows[0].cancel_reason}`);
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
  chk('письмо называет сам адрес, а не «указанную почту»',
    server.zhurnal().includes('на почту zanyataya@pochta.test — она уже занята'));
}

console.log('── ПОЧТА ЗАНЯТА У ВТОРОГО АККАУНТА: КЛИЕНТ ВИДИТ АДРЕС ──');
{
  /* Постановка сорок третьей итерации: «Сейчас клиент видит „Этот
     адрес электронной почты уже зарегистрирован" и не понимает,
     какой из адресов». Причина стала по-аккаунтной, но клиенту
     уходит НЕ НОМЕР, а сам адрес — номер аккаунта человеку
     не говорит ничего, он называл их почтами.

     ⚠️ АДРЕСА У ДВУХ УЧАСТНИКОВ РАЗНЫЕ И ОБА НОВЫЕ: только
     так видно, что взят ВТОРОЙ, а не первый попавшийся. */
  const A = 'pervyy-duo@pochta.test';
  const B = 'vtoroy-duo@pochta.test';
  await klient.goto(`http://localhost:${PORT}/checkout/?plan=duo&period=1`, { waitUntil: 'networkidle' });
  const galkaD = klient.locator('input[name="balance"]');
  if (await galkaD.count()) await galkaD.uncheck();
  await klient.fill('input[name="login0"]', A);
  await klient.fill('input[name="password0"]', 'Pervyy-duo-8');
  await klient.fill('input[name="login1"]', B);
  await klient.fill('input[name="password1"]', 'Vtoroy-duo-8');
  await klient.check('input[name="consent"]');
  await nazhat(klient, 'button[type="submit"]');
  await nazhat(klient, 'button[type="submit"]');
  const zd = await p2.query(`select id from shop_order where status = 'paid' order by id desc limit 1`);
  const nomerD = Number(zd.rows[0].id);

  await admin.goto(`http://localhost:${PORT}/admin/orders/${nomerD}/`, { waitUntil: 'networkidle' });
  await nazhat(admin, 'button:has-text("Взять")');
  await admin.locator('.ad__shag[data-sost="seychas"] button:has-text("Отменить заказ")').first().click();
  await admin.waitForTimeout(400);
  const spisokD = await admin.$$eval('select[name="reason"] option', (e) => e.map((x) => x.textContent ?? ''));
  /* ⚠️ НОМЕР АККАУНТА ВИДИТ ТОЛЬКО СОТРУДНИК. Причина без
     номера («просто уже зарегистрирован») в списке на двоих
     не предлагается вовсе: она означала бы «у какого-то из двух». */
  chk('у заказа на двоих причина «уже зарегистрирован» по аккаунтам',
    spisokD.some((v) => /уже зарегистрирован, 1-й аккаунт/.test(v)) &&
      spisokD.some((v) => /уже зарегистрирован, 2-й аккаунт/.test(v)) &&
      !spisokD.some((v) => /^Этот адрес электронной почты уже зарегистрирован$/.test(v.trim())),
    spisokD.join(' | '));
  /* ⚠️ «НИ ОДНОГО» ОБЯЗАНО ИДТИ ВМЕСТЕ С «СПИСОК НЕ ПУСТ»:
     отрицание на пустом списке истинно по построению, и проверка
     зеленела бы там, где список не отрисовался вовсе. */
  chk('причин про третий аккаунт у заказа на двоих нет',
    spisokD.length > 1 && !spisokD.some((v) => /3-й аккаунт/.test(v)), spisokD.join(' | '));

  await admin.selectOption('select[name="reason"]', 'zanyata2');
  await admin.locator('.ad__shag[data-sost="seychas"] button:has-text("Отменить заказ, деньги")').first().click();
  await admin.locator('.ad__sure button[type="submit"]').first().click();
  await admin.waitForLoadState('networkidle');
  await admin.waitForTimeout(900);

  const posleD = await p2.query(
    'select status, cancel_reason, cancel_slot_idx from shop_order where id = $1',
    [nomerD],
  );
  /* ⚠️ В БАЗЕ — НОМЕР ВТОРОГО СЛОТА, А НЕ ЕГО АДРЕС. Адрес
     подставляет кабинет при чтении и один раз письмо при отправке:
     открытая почта в колонке пережила бы семидневное стирание
     шифротекстов и уехала бы в ночную копию, а в карточке админки
     её увидел бы любой сотрудник — `cancelReason` там не закрыт
     признаком `moy`, в отличие от `clientLogin` (закон 35, Р-151). */
  chk('в заказе стоит номер ВТОРОГО аккаунта, а адреса в базе нет',
    posleD.rows[0].status === 'cancelled' &&
      posleD.rows[0].cancel_reason === 'Этот адрес электронной почты уже зарегистрирован' &&
      Number(posleD.rows[0].cancel_slot_idx) === 1,
    `${posleD.rows[0].status} · слот ${posleD.rows[0].cancel_slot_idx} · ${posleD.rows[0].cancel_reason}`);
  chk('адреса аккаунта в колонке причины нет ни одного',
    !/@/.test(posleD.rows[0].cancel_reason ?? ''), posleD.rows[0].cancel_reason ?? '');

  /* ⚠️ ПИСЬМО НАЗЫВАЕТ ТОТ ЖЕ АДРЕС, И ТОЛЬКО ЕГО. Спрашиваем
     журнал за последние строки: адрес первого участника в тело
     этого письма попасть не имеет права. */
  const pismo = server.zhurnal().slice(server.zhurnal().lastIndexOf('На эту почту уже есть аккаунт Spotify'));
  chk('письмо про занятую почту называет второй адрес и не называет первый',
    pismo.includes(B) && !pismo.includes(A), pismo.replace(/\s+/g, ' ').slice(0, 140));

  /* ⚠️ КАБИНЕТ СПРАШИВАЕМ ЖИВОЙ, А НЕ БАЗУ: показать причину
     обязан он, и он же разводит её с фразой про баланс на две
     строки (постановка: «сейчас они слиплись без точки»). */
  await klient.goto(`http://localhost:${PORT}/cabinet/`, { waitUntil: 'networkidle' });
  chk('кабинет показывает причину с адресом второго аккаунта',
    (await klient.innerText('main')).includes(`Этот адрес электронной почты уже зарегистрирован: ${B}`));
  const dveStroki = await klient.evaluate(() => {
    const p = [...document.querySelectorAll('main .panel__note')];
    const i = p.findIndex((e) => /уже зарегистрирован/.test(e.textContent ?? ''));
    if (i < 0) return null;
    const sled = p[i + 1];
    return {
      prichinaOdna: !/лежат на балансе/.test(p[i].textContent ?? ''),
      balansRyadom: /Деньги за заказ лежат на балансе/.test(sled?.textContent ?? ''),
      raznyeKorobki: Boolean(sled) && p[i].getBoundingClientRect().bottom <= sled.getBoundingClientRect().top + 0.5,
    };
  });
  chk('причина и строка про баланс — два разных абзаца, а не одна строка',
    Boolean(dveStroki) && dveStroki.prichinaOdna && dveStroki.balansRyadom && dveStroki.raznyeKorobki,
    JSON.stringify(dveStroki));
}

console.log('── ДАТА ОКОНЧАНИЯ И НАПОМИНАНИЕ ЗА ТРИ ДНЯ ──');
{
  const srok = await p2.query(
    `select id, closed_at, expires_at, period,
            extract(epoch from (expires_at - closed_at)) / 86400 as dney
       from shop_order where status = 'done' and expires_at is not null order by id limit 1`,
  );
  /* ⚠️ С СОРОК ВТОРОЙ ИТЕРАЦИИ СРОК БЕРЁТСЯ ИЗ ДАТЫ, КОТОРУЮ ВВЁЛ
     ОПЕРАТОР, а не считается «выдача плюс срок тарифа»: у клиента
     на аккаунте мог остаться неистёкший срок, и Spotify называет
     другую дату. Проверяется РАВЕНСТВО с тем, что было введено выше,
     а не диапазон дней: диапазон прошёл бы и на прежнем коде. */
  const stalo = srok.rows[0]?.expires_at ? new Date(srok.rows[0].expires_at).toISOString().slice(0, 10) : '';
  chk('дата окончания взята из той, что ввёл оператор',
    stalo === svoyaData, `${stalo} против введённой ${svoyaData}`);
  chk('дата окончания поставлена при закрытии заказа',
    srok.rows.length === 1 && Number(srok.rows[0].dney) > 340 && Number(srok.rows[0].dney) < 372,
    `${Math.round(Number(srok.rows[0]?.dney ?? 0))} дней на ${srok.rows[0]?.period} мес`);
  const vSlote = await p2.query(
    `select count(*)::int as n from order_slot where order_id = $1 and ends_at = $2::date`,
    [srok.rows[0].id, svoyaData],
  );
  chk('дата легла и в строку аккаунта', vSlote.rows[0].n === 1, `${vSlote.rows[0].n}`);

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
  const schyotPopytok = async () =>
    (await p2.query(
      `select count(*)::int n from support_try where created_at > now() - interval '10 minutes'`,
    )).rows[0].n;

  const poslat = async (tekst, zhdatZapis = true) => {
    /* Окно после удачной отправки показывает подтверждение — закрываем
       его крестиком и открываем заново, как это делает человек. */
    await klient.click('.pd__krest');
    await klient.waitForTimeout(300);
    await klient.click('.pd__knopka');
    await klient.waitForSelector('textarea[name="tekst"]', { timeout: 15000 });
    await klient.fill('textarea[name="tekst"]', tekst);
    await klient.fill('input[name="svyaz"]', '@spotik_klient');
    await klient.waitForTimeout(2000);
    const bylo = await schyotPopytok();
    await otpravitIZhdat();
    if (!zhdatZapis) return;
    /* ⚠️ ЖДЁМ СОБЫТИЯ, А НЕ ИЗМЕНЕНИЯ ТЕКСТА, И ЭТО СТОИЛО ВЫКЛАДКИ
       № 123. Текст окна меняется и БЕЗ ответа сервера: форма
       спрашивает почту вошедшего отдельным действием и подставляет
       её в поле. На медленной машине этот ответ приходил ПОСЛЕ
       нажатия, `waitForFunction` считал его изменением и отпускал
       сторож раньше, чем попытка успевала записаться, — а лимит
       считает именно записи. Событие тут одно и однозначное: строка
       в `support_try`. Те же грабли, что в Р-94 и Р-97. */
    const do_ = Date.now();
    while (Date.now() - do_ < 20000 && (await schyotPopytok()) === bylo) {
      await klient.waitForTimeout(150);
    }
  };
  await poslat('Ещё одно обращение номер два, всё подробно.');
  await poslat('Ещё одно обращение номер три, всё подробно.');
  /* ⚠️ СЧЁТ ПОПЫТОК СНИМАЕТСЯ ДО ЧЕТВЁРТОЙ, И ЭТО НЕ ЛИШНЕЕ ЧИСЛО.
     Отбитое как машинное обращение отвечает «принято» и в счёт НЕ идёт
     (Р-119). Значит «четвёртое не отбито» имеет две разные причины —
     сломан лимит или одна из трёх не засчиталась, — и без этого числа
     они неразличимы: ровно на этом выкладка № 123 сказала «СБОЙ»
     и не сказала почему. */
  const popytok = (await p2.query(
    `select count(*)::int n from support_try where created_at > now() - interval '10 minutes'`)).rows[0].n;
  await poslat('Четвёртое подряд обращение, его пора отбить.', false);
  const chetvyortoe = (await klient.textContent('body')) ?? '';
  chk('три обращения записаны в счёт', popytok === 3, `${popytok} из 3`);
  chk('четвёртое подряд обращение отбито по частоте',
    /Обращение уже отправлено/.test(chetvyortoe),
    chetvyortoe.replace(/\s+/g, ' ').match(/Обращени[^.]{0,60}/)?.[0] ?? 'нет строки про обращение');

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

console.log('── СКРЫТОЕ СОЧЕТАНИЕ ТАРИФ × СРОК ИСЧЕЗАЕТ С САЙТА ──');
{
  /* ⚠️ СОСТОЯНИЕ КАТАЛОГА ЗДЕСЬ УЖЕ НЕ УМОЛЧАНИЕ, И ЭТО ХОРОШО:
     выше по прогону админка выключила «на одного · три месяца»
     и поставила скидку. Значит на полугоде скрыт «На троих»
     (цены нет вовсе), а на трёх месяцах — ещё и «Индивидуальный»,
     и проверяются обе причины сразу: нет цены и ячейка выключена. */
  const snyat = () =>
    klient.$$eval('.cards__slot', (els) =>
      els.map((e) => {
        const k = e.querySelector('.card');
        return {
          imya: (e.querySelector('.card__name')?.textContent ?? '').trim(),
          off: e.hasAttribute('data-off'),
          inert: e.hasAttribute('inert'),
          w: Math.round(e.getBoundingClientRect().width),
          vybran: k?.getAttribute('aria-checked') === 'true',
          prozr: Number(getComputedStyle(k).opacity),
        };
      }));
  const srok = async (podpis) => {
    await klient.locator('.seg__btn', { hasText: podpis }).first().click();
    await klient.waitForTimeout(900);
  };

  await klient.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  const na1 = await snyat();
  chk('на месяце видны все включённые тарифы',
    na1.length >= 3 && na1.every((v) => !v.off),
    na1.map((v) => `${v.imya}${v.off ? ' (скрыт)' : ''}`).join(' · '));
  const shirina1 = na1.find((v) => v.imya === 'На двоих')?.w ?? 0;

  /* Выбираем именно тот тариф, который сейчас пропадёт: без этого
     «выбор мягко переходит на первый доступный» не проверяется
     вовсе — он и так стоял бы на доступном. */
  await klient.locator('.card', { hasText: 'На троих' }).first().click();
  await klient.waitForTimeout(250);
  chk('«На троих» выбран', (await snyat()).find((v) => v.imya === 'На троих')?.vybran === true);

  /* ⚠️ ПЛАВНОСТЬ СУДИТСЯ ПО ПРОМЕЖУТОЧНОЙ ШИРИНЕ, А НЕ ПО ОБЪЯВЛЕНИЮ
     В CSS. Опрашиваем ячейку, пока она схлопывается: при мгновенном
     переключении ширина идёт полная → ноль и промежуточного значения
     не бывает НИ В ОДИН кадр. Ждать фиксированные миллисекунды тут
     нельзя (Р-94): на медленном раннере ход начнётся позже. */
  const trioSel = '.cards__slot:has(.card__name:text-is("На троих"))';
  await klient.locator('.seg__btn', { hasText: '6 мес' }).first().click();
  let promezh = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 1500) {
    const w = await klient
      .$eval(trioSel, (e) => Math.round(e.getBoundingClientRect().width))
      .catch(() => -1);
    if (w > 4 && w < shirina1 - 10) { promezh = w; break; }
    if (w === 0) break;
  }
  chk('карточка исчезает ПЛАВНО, а не рывком',
    promezh > 4 && promezh < shirina1 - 10,
    promezh ? `поймана на ${promezh} px при полной ${shirina1}` : 'промежуточной ширины не было ни в один кадр');

  await klient.waitForTimeout(900);
  const na6 = await snyat();
  const trio6 = na6.find((v) => v.imya === 'На троих');
  const vidnye6 = na6.filter((v) => !v.off);
  chk('на полугоде «На троих» скрыт целиком',
    Boolean(trio6?.off) && (trio6?.w ?? 99) < 4 && (trio6?.prozr ?? 1) < 0.05,
    `ширина ${trio6?.w} px, прозрачность ${trio6?.prozr}`);
  chk('скрытая карточка выведена из обхода клавиатурой', trio6?.inert === true,
    `inert у скрытой ${trio6?.inert}, ячеек ${na6.length}, имена ${na6.map((v) => `${v.imya}${v.off ? '(скрыт)' : ''}`).join(' · ')}`);
  chk('выбор мягко перешёл на первый доступный',
    !trio6?.vybran && vidnye6[0]?.vybran === true,
    `выбран «${na6.find((v) => v.vybran)?.imya ?? 'никто'}»`);
  chk('оставшиеся съехались и стали шире',
    (vidnye6.find((v) => v.imya === 'На двоих')?.w ?? 0) > shirina1 + 40,
    `${shirina1} → ${vidnye6.find((v) => v.imya === 'На двоих')?.w} px`);
  /* ⚠️ И КНОПКА БОЛЬШЕ НЕ ПРЕДЛАГАЕТ МЕСЯЧНУЮ ЦЕНУ. Ровно это
     и было дефектом: «при сроке 6 мес видна карточка „На троих“
     с ценой 459 ₽ за месяц». */
  const ssylka = (await klient.getAttribute('.order .btn', 'href')) ?? '';
  const nadpis = ((await klient.textContent('.order .btn')) ?? '').replace(/\s+/g, ' ');
  chk('кнопка ведёт на выбранный срок и не зовёт «за месяц»',
    /period=6/.test(ssylka) && !/plan=trio/.test(ssylka) && !/за месяц/.test(nadpis),
    `${ssylka} · ${nadpis}`);

  /* Обратно: карточка возвращается, соседи расходятся. */
  await srok('1 мес');
  const nazad1 = await snyat();
  const trio1 = nazad1.find((v) => v.imya === 'На троих');
  chk('на месяце карточка вернулась и раскрылась',
    !trio1?.off && (trio1?.w ?? 0) > 40 && (trio1?.prozr ?? 0) > 0.9,
    `ширина ${trio1?.w} px, прозрачность ${trio1?.prozr}`);

  /* ⚠️ ПРИ «УМЕНЬШИТЬ ДВИЖЕНИЕ» — СРАЗУ, БЕЗ ДВИЖЕНИЯ. Проверяется
     ОТДЕЛЬНОЙ страницей с этой настройкой: ширина обязана стать
     нулевой ещё до того, как истёк бы ход. */
  const tihaya = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  await tihaya.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await tihaya.locator('.seg__btn', { hasText: '6 мес' }).first().click();
  await tihaya.waitForTimeout(120);
  const bystro = await tihaya
    .$eval(trioSel, (e) => Math.round(e.getBoundingClientRect().width))
    .catch(() => -1);
  chk('при «уменьшить движение» карточка исчезает сразу', bystro >= 0 && bystro < 4, `${bystro} px через 120 мс`);
  await tihaya.close();
}

console.log('── СЕРТИФИКАТЫ: ТОТ ЖЕ ВЫБОР, ЧТО НА ГЛАВНОЙ ──');
{
  /* Постановка: «тариф выбирается такими же карточками… срок —
     такими же небольшими пилюлями». Проверяется ЖИВОЙ страницей:
     те же классы и та же логика скрытия, что на лендинге. */
  await klient.goto(`http://localhost:${PORT}/sertifikaty/`, { waitUntil: 'networkidle' });
  const kart = await klient.locator('.vybor-kart .cards .card').count();
  const plashek = await klient.locator('.vybor-kart .seg .seg__btn').count();
  chk('на странице сертификатов карты тарифов и плашки срока',
    kart >= 3 && plashek >= 2, `${kart} карт, ${plashek} плашек срока`);
  /* Кайма и свет за картой — те же, что на лендинге: судим
     по вычисленному стилю, а не по имени класса. */
  const est = await klient.evaluate(() => {
    const k = document.querySelector('.vybor-kart .card');
    const sv = document.querySelector('.vybor-kart .cards__glow');
    return {
      r: Math.round(parseFloat(getComputedStyle(k).borderTopLeftRadius) || 0),
      kayma: Boolean(k?.querySelector('.card__edge')),
      ten: getComputedStyle(sv).boxShadow,
    };
  });
  chk('у карты сертификатов та же кайма и тот же свет сзади',
    est.kayma && est.r >= 18 && /px/.test(est.ten) && est.ten !== 'none',
    `радиус ${est.r} px, свет ${est.ten.slice(0, 40)}`);

  await klient.locator('.vybor-kart .seg__btn', { hasText: '6 мес' }).first().click();
  await klient.waitForTimeout(900);
  const sert6 = await klient.$$eval('.vybor-kart .cards__slot', (els) =>
    els.map((e) => ({
      imya: (e.querySelector('.card__name')?.textContent ?? '').trim(),
      off: e.hasAttribute('data-off'),
    })));
  chk('скрытое сочетание не предлагается и в подарок',
    sert6.find((v) => v.imya === 'На троих')?.off === true,
    sert6.map((v) => `${v.imya}${v.off ? ' (скрыт)' : ''}`).join(' · '));
  const darSsylka = (await klient.getAttribute('.panel .btn', 'href')) ?? '';
  chk('кнопка подарка ведёт на настоящий тариф со сроком',
    /gift=1/.test(darSsylka) && /period=6/.test(darSsylka) && !/plan=trio/.test(darSsylka),
    darSsylka);
}

console.log('── ПЛАШКА ПРО РАБОЧЕЕ ВРЕМЯ ──');
{
  /* ⚠️ СУДИМ ПО НЕЗАВИСИМО ПОСЧИТАННОМУ МОСКОВСКОМУ ЧАСУ, А НЕ ПО
     НАШЕЙ ЖЕ ФУНКЦИИ. Спроси сторож `rabocheeVremya()` — он проверял
     бы модель предмета (Р-47) и был бы зелёным при любой ошибке
     внутри неё. Здесь час берётся у `Intl` прямо тут, а плашка —
     с живой страницы; сходиться они обязаны в любой час суток.
     Границы (09:59, 10:00, 21:59, 22:00) и зима проверяются
     подменой времени отдельно: `scripts/verify-chasy.mjs`. */
  const chasMsk = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow', hour: '2-digit', hour12: false })
      .format(new Date()),
  );
  const dolzhna = chasMsk < 10 || chasMsk >= 22;
  await klient.goto(`http://localhost:${PORT}/checkout/?plan=duo&period=12`, { waitUntil: 'networkidle' });
  /* ⚠️ КЛАСС У ПЛАШКИ СВОЙ С СОРОК ВТОРОЙ ИТЕРАЦИИ: она больше
     не тихая подсказка `panel__note--plate`, а яркая плашка
     с зелёным акцентом и знаком часов (постановка «чтобы бросалась
     в глаза»). Судим по ВЫЧИСЛЕННОМУ стилю, а не по объявлению:
     класс доказал бы только, что правило написано. */
  const plashka = await klient.evaluate(() => {
    const el = [...document.querySelectorAll('.plashka-chasy')]
      .find((e) => /рабочее время/.test(e.textContent ?? ''));
    if (!el) return null;
    const panely = [...document.querySelectorAll('form.ozhivayet > .panel')];
    const st = getComputedStyle(el);
    /* ⚠️ ЦВЕТ ЧИТАЕТСЯ ХОЛСТОМ, А НЕ РАЗБОРОМ СТРОКИ, И ЭТО ТЕ ЖЕ
       ГРАБЛИ, ЧТО У ПЛАШКИ ПРО VPN (см. выше и раздел 5 CLAUDE.md).
       Подложка задана `color-mix`, и браузер отдаёт её как
       `color(srgb 0.077 0.175 0.112)` — доли единицы, — а разбор
       числами сравнивал 0.175 с 0.077 + 4 и падал на ИСПРАВНОЙ
       плашке. Поймано прогоном в этой среде: прежний Chromium
       отдавал ту же запись как `rgb(…)`, и проверка проходила
       по счастливой случайности. Холст приводит любую запись
       к одному виду. */
    const cv = document.createElement('canvas');
    cv.width = 1;
    cv.height = 1;
    const g2 = cv.getContext('2d');
    const px = (c) => {
      g2.clearRect(0, 0, 1, 1);
      g2.fillStyle = c;
      g2.fillRect(0, 0, 1, 1);
      const d = g2.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2]];
    };
    return {
      tekst: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
      /* Плашка стоит МЕЖДУ панелями, а не внутри панели тарифа. */
      snaruzhi: el.parentElement?.classList.contains('ozhivayet') === true,
      posleTarifa: Boolean(panely[0] && el.compareDocumentPosition(panely[0]) & Node.DOCUMENT_POSITION_PRECEDING),
      doAkkaunta: Boolean(panely[1] && el.compareDocumentPosition(panely[1]) & Node.DOCUMENT_POSITION_FOLLOWING),
      fon: px(st.backgroundColor),
      tsvet: px(st.color),
      kayma: st.boxShadow,
      znak: el.querySelectorAll('svg').length,
    };
  });
  chk('плашка стоит ровно тогда, когда в Москве не рабочее время',
    Boolean(plashka) === dolzhna,
    `в Москве ${String(chasMsk).padStart(2, '0')} ч — плашка ${plashka ? 'есть' : 'её нет'}`);
  if (plashka) {
    chk('плашка называет часы работы', /10:00–22:00 по Москве/.test(plashka.tekst), plashka.tekst);
    chk('плашка стоит между тарифом и «Аккаунтом»',
      plashka.snaruzhi && plashka.posleTarifa && plashka.doAkkaunta,
      `вне панели ${plashka.snaruzhi}, после тарифа ${plashka.posleTarifa}, до аккаунта ${plashka.doAkkaunta}`);
    /* ⚠️ «ЯРКАЯ» СУДИТСЯ ПО ЧИСЛАМ, А НЕ ПО ВПЕЧАТЛЕНИЮ: зелёного
       в подложке больше, чем красного и синего (то есть подложка
       зеленит), текст белый, кайма есть, знак нарисован. */
    chk('плашка зеленит подложкой',
      plashka.fon[1] > plashka.fon[0] + 4 && plashka.fon[1] > plashka.fon[2] + 4,
      plashka.fon.slice(0, 3).join(','));
    chk('текст плашки белый', plashka.tsvet.slice(0, 3).every((v) => v > 240), plashka.tsvet.slice(0, 3).join(','));
    chk('у плашки есть кайма и знак часов',
      /rgb/.test(plashka.kayma) && plashka.znak === 1,
      `кайма ${plashka.kayma ? 'есть' : 'нет'}, знаков ${plashka.znak}`);
  }

  /* ⚠️ ЧАСЫ УСТРОЙСТВА НЕ РЕШАЮТ НИЧЕГО — прямое требование
     постановки. Открываем ту же страницу в браузере, живущем
     в Окленде (разница с Москвой девять-десять часов, то есть
     «рабочее» и «нерабочее» там почти всегда разные), и плашка
     обязана остаться такой же. */
  const chuzhoyChas = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    timezoneId: 'Pacific/Auckland',
  });
  await chuzhoyChas.context().addCookies(await klient.context().cookies());
  await chuzhoyChas.goto(`http://localhost:${PORT}/checkout/?plan=duo&period=12`, { waitUntil: 'networkidle' });
  const uNego = await chuzhoyChas.evaluate(() =>
    [...document.querySelectorAll('.plashka-chasy')].some((e) => /рабочее время/.test(e.textContent ?? '')));
  const ihChas = await chuzhoyChas.evaluate(() => new Date().getHours());
  chk('плашка считается по Москве, а не по часам устройства',
    uNego === dolzhna,
    `на устройстве ${ihChas} ч, в Москве ${chasMsk} ч — плашка ${uNego ? 'есть' : 'её нет'}`);
  await chuzhoyChas.close();
}

console.log('── ЧАСЫ РАБОТЫ В ХИРО ──');
{
  for (const [w, h, imya] of [[390, 844, 'телефон'], [1920, 1080, 'десктоп']]) {
    const p = await browser.newPage({ viewport: { width: w, height: h } });
    await p.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
    const v = await p.evaluate(() => {
      const el = document.querySelector('.hero__hours');
      if (!el) return null;
      const b = el.getBoundingClientRect();
      const nota = document.querySelector('.hero__note')?.getBoundingClientRect();
      const stage = document.querySelector('.hero__stage')?.getBoundingClientRect();
      /* ⚠️ «СПРАВА» МЕРЯЕТСЯ ОТ ПОЛЯ СТРАНИЦЫ, А НЕ ОТ КРАЯ ЭКРАНА.
         У `.shell` есть потолок ширины: на 1920 он 1680, и до края
         экрана от него 184 px законного воздуха — от сцены эта
         проверка провалилась бы на исправной вёрстке. */
      const poleEl = document.querySelector('.hero__foot');
      const pole = poleEl?.getBoundingClientRect();
      /* ⚠️ И ОТ ЕГО СОДЕРЖИМОГО, А НЕ ОТ БОРДЕР-БОКСА: у `.shell`
         поле страницы 20/40/64 px лежит ВНУТРИ бокса, и правый край
         текста до бордер-бокса законно не достаёт. */
      const polePad = poleEl ? parseFloat(getComputedStyle(poleEl).paddingRight) || 0 : 0;
      return {
        tekst: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
        vidno: b.width > 20 && b.height > 6 && getComputedStyle(el).visibility !== 'hidden',
        /* «Справа внизу»: правый край плотно к правому краю поля,
           и низ строки не выше низа соседнего текста. */
        sprava: pole ? pole.right - polePad - b.right < 3 : false,
        /* ⚠️ ОТКАЗ ОБЯЗАН НАЗЫВАТЬ ЧИСЛО, А НЕ «false»: по одному
           булеву не отличить «поле не нашлось» от «строка не дотянула
           двух пикселей». */
        zazor: pole ? Math.round((pole.right - polePad - b.right) * 100) / 100 : null,
        estPole: Boolean(pole),
        vnizu: nota ? b.bottom >= nota.bottom - 2 : false,
        /* И строка не вылезает за сцену: у неё `overflow: hidden`,
           и вылезшее не съезжает вниз, а МОЛЧА ОБРЕЗАЕТСЯ (Р-16). */
        vEkrane: stage ? b.bottom <= stage.bottom + 1 : false,
      };
    });
    chk(`часы работы видны в хиро (${imya})`,
      Boolean(v?.vidno) && /10:00–22:00 по Москве/.test(v?.tekst ?? ''), v?.tekst ?? 'строки нет');
    chk(`часы стоят справа внизу и не вылезают за экран (${imya})`,
      Boolean(v?.sprava && v?.vnizu && v?.vEkrane),
      `зазор справа ${v?.zazor} px (поле найдено: ${v?.estPole}), внизу ${v?.vnizu}, в экране ${v?.vEkrane}`);
    await p.close();
  }
}

console.log('── ТЕКСТЫ ВХОДА И ОФОРМЛЕНИЯ, МЕНЮ, КНОПКИ ОПЛАТЫ ──');
{
  /* ⚠️ ЗАГОЛОВОК ВХОДА ВИДЕН ТОЛЬКО НЕ ВОШЕДШЕМУ, поэтому нужен
     ЧИСТЫЙ контекст: у `klient` сессия есть с начала прогона. */
  const gost = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await gost.goto(`http://localhost:${PORT}/checkout/?plan=solo&period=1`, { waitUntil: 'networkidle' });
  const vhod = await gost.innerText('main');
  chk('заголовок входа на оформлении новый',
    /Сначала войдите в личный кабинет — на эту же почту будет приходить информация о заказе/.test(vhod),
    vhod.replace(/\s+/g, ' ').match(/Сначала[^.]{0,90}/)?.[0] ?? 'заголовка нет');

  /* ⚠️ ВОЗДУХ МЕЖДУ СТРОКОЙ ПРО ПОЛИТИКУ И КНОПКОЙ — ЗАМЕР, А НЕ
     КЛАСС. Постановка: «кнопка слишком близко». Меряем ФАКТИЧЕСКИЙ
     зазор между низом строки и верхом кнопки на телефоне. */
  const zazor = await gost.evaluate(() => {
    const p = [...document.querySelectorAll('.panel__note')].find((e) => /политикой конфиденциальности/.test(e.textContent ?? ''));
    const b = [...document.querySelectorAll('button[type="submit"]')].find((e) => /Получить код/.test(e.textContent ?? ''));
    if (!p || !b) return null;
    return Math.round(b.getBoundingClientRect().top - p.getBoundingClientRect().bottom);
  });
  chk('между строкой про политику и кнопкой есть воздух', zazor !== null && zazor >= 14, `${zazor} px`);

  /* ── МЕНЮ БЕЗ ПОЧТЫ И ТЕЛЕФОНА ──────────────────────────────── */
  await gost.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await gost.click('.nav__burger');
  await gost.waitForTimeout(700);
  const menyu = await gost.evaluate(() => {
    const m = document.querySelector('.menu');
    return {
      otkryto: m?.getAttribute('data-open') === '1',
      pocht: (m?.innerHTML ?? '').includes('mailto:'),
      tel: (m?.innerHTML ?? '').includes('tel:'),
      slovo: Boolean(m?.querySelector('.menu__mark')),
    };
  });
  chk('меню открылось', menyu.otkryto);
  chk('в меню нет ни почты, ни телефона', !menyu.pocht && !menyu.tel,
    `почта ${menyu.pocht}, телефон ${menyu.tel}`);
  chk('слово внизу меню осталось', menyu.slovo);

  /* ── КНОПКА «ВЕРНУТЬСЯ НА САЙТ» НА ОБЕИХ СТРАНИЦАХ ОПЛАТЫ ────── */
  for (const [adres, imya] of [['/pay/ok/', 'успешной'], ['/pay/fail/', 'неуспешной']]) {
    await gost.goto(`http://localhost:${PORT}${adres}`, { waitUntil: 'networkidle' });
    const est = await gost.evaluate(() =>
      [...document.querySelectorAll('a')].some((a) => /Вернуться на сайт/.test(a.textContent ?? '') && a.getAttribute('href') === '/'));
    chk(`на ${imya} странице оплаты есть «Вернуться на сайт» на главную`, est);
  }
  await gost.close();

  /* ── СТРОКА ПОД ЗАГОЛОВКОМ ОФОРМЛЕНИЯ ───────────────────────── */
  await klient.goto(`http://localhost:${PORT}/checkout/?plan=solo&period=1`, { waitUntil: 'networkidle' });
  const vidno = await klient.innerText('main');
  chk('строка под заголовком говорит про информацию о заказе',
    /Информация о заказе придёт на /.test(vidno) && !/Заказ оформляется на/.test(vidno),
    vidno.replace(/\s+/g, ' ').match(/Информация о заказе[^.]{0,40}/)?.[0] ?? 'строки нет');
  chk('ссылка на личный кабинет рядом осталась',
    await klient.evaluate(() => [...document.querySelectorAll('a')].some((a) => a.getAttribute('href') === '/cabinet/' && /Личный кабинет/.test(a.textContent ?? ''))));
}

console.log('── ПОДСКАЗКА ПОЧТ ПРИ ПРОДЛЕНИИ ──');
{
  /* Постановка: «когда клиент выбирает „Продлить существующий" и встаёт
     в поле почты, под полем плавно выезжает список почт, которые он уже
     указывал в заказах из этого личного кабинета… При „На двоих"
     у каждого участника свой список. Почта, уже выбранная у другого
     участника, в списке не предлагается».

     ⚠️ СПРАШИВАЕТСЯ ЖИВАЯ СТРАНИЦА, А НЕ НАШ ЖЕ ЗАПРОС К БАЗЕ:
     подсказка обязана появиться у поля, а не «данные доехали». */
  await klient.goto(`http://localhost:${PORT}/checkout/?plan=duo&period=1`, { waitUntil: 'networkidle' });
  /* Оба участника — на продление: подсказка только там. */
  for (const i of [0, 1]) {
    await klient.locator(`.uchastnik >> nth=${i}`).locator('button:has-text("Продлить существующий")').click();
  }
  await klient.waitForTimeout(300);

  const zakryt = await klient.evaluate(() => {
    const el = document.querySelector('.pochty');
    return el ? getComputedStyle(el).gridTemplateRows : 'нет списка';
  });
  chk('до фокуса список схлопнут', /^0px$/.test(zakryt), zakryt);

  await klient.locator('input[name="login0"]').focus();
  await klient.waitForTimeout(500);
  /* ⚠️ СПИСОК БЕРЁТСЯ В ПРЕДЕЛАХ СВОЕГО УЧАСТНИКА. Списки обоих лежат
     в разметке всегда (схлопнутый — это `grid-template-rows: 0fr`),
     и общий селектор собрал бы оба сразу: проверка «второму
     не предлагается» тогда не значила бы ничего. */
  const spisok = await klient.locator('.uchastnik').nth(0).locator('.pochty__p').allTextContents();
  chk('под полем есть подсказки почт', spisok.length > 0, spisok.join(' · ') || 'пусто');
  chk('в подсказке есть почта из прошлых заказов',
    spisok.some((v) => /moy@akkaunt\.test/.test(v)), spisok.join(' · '));
  chk('паролей в подсказке нет ни одного',
    !spisok.some((v) => /parol/i.test(v)), spisok.join(' · '));

  /* Нажатие подставляет почту. */
  const vybrannaya = spisok.find((v) => /@/.test(v)) ?? '';
  await klient.locator('.uchastnik').nth(0).locator('.pochty__p').first().click();
  await klient.waitForTimeout(300);
  chk('нажатие подставило почту в поле',
    (await klient.locator('input[name="login0"]').inputValue()) === vybrannaya,
    `${await klient.locator('input[name="login0"]').inputValue()} против ${vybrannaya}`);

  /* ⚠️ УЖЕ ВЫБРАННАЯ ПОЧТА ВТОРОМУ УЧАСТНИКУ НЕ ПРЕДЛАГАЕТСЯ. Один
     и тот же аккаунт нельзя продлить дважды в одном заказе. */
  await klient.locator('input[name="login1"]').focus();
  await klient.waitForTimeout(500);
  const uVtorogo = await klient.locator('.uchastnik').nth(1).locator('.pochty__p').allTextContents();
  chk('почта, взятая первым участником, второму не предлагается',
    !uVtorogo.includes(vybrannaya), `${uVtorogo.join(' · ') || 'список пуст'}`);

  /* ⚠️ ПРИ «НОВОМ АККАУНТЕ» ПОДСКАЗКИ НЕТ ВОВСЕ: там человек называет
     почту, на которой аккаунта ещё НЕТ, и предлагать ему адреса
     с готовым Premium значило бы вести его прямо в отказ. */
  await klient.locator('.uchastnik >> nth=0').locator('button:has-text("Новый аккаунт")').click();
  await klient.locator('input[name="login0"]').focus();
  await klient.waitForTimeout(400);
  const uNovogo = await klient.evaluate(() => {
    const p = document.querySelector('.uchastnik input[name="login0"]')?.closest('.field');
    return p?.querySelector('.pochty') ? 'есть' : 'нет';
  });
  chk('у нового аккаунта подсказки почт нет вовсе', uNovogo === 'нет', uNovogo);
}

console.log('── НАЗВАНИЕ ТАРИФА МЕНЯЕТСЯ В АДМИНКЕ ──');
{
  /* Постановка: «дать менять названия тарифов: название на сайте
     (русское) и название для сотрудников (английское). Новое русское
     название должно появляться везде, где тариф назван».

     ⚠️ ПРАВИМ ЧЕРЕЗ АДМИНКУ, А НЕ ВСТАВКОЙ В БАЗУ: лендинг
     статический с `revalidate`, и правка в обход админки до него
     не доехала бы — `revalidatePath` зовёт действие, а не запрос. */
  await admin.goto(`http://localhost:${PORT}/admin/settings/`, { waitUntil: 'networkidle' });
  const stroka = admin.locator('form:has(input[name="nameEn"])').filter({ has: admin.locator('input[value="Duo"]') });
  /* ⚠️ СНАЧАЛА ПРАВИМ ТОЛЬКО ПОЛНОЕ ИМЯ, ОСТАВИВ КОРОТКОЕ
     ПУСТЫМ. Так проверяется главное про третье поле: пустое короткое
     значит «на карточке стоит полное», и переименование одного поля
     доезжает до карточки само. Подставь форма в короткое поле
     ДЕЙСТВУЮЩЕЕ значение — админ сохранил бы вместе с новым именем
     старое короткое, и карточка осталась бы с прежним словом: ровно
     дефект Р-142, вернувшийся через форму. */
  await stroka.locator('input[name="name"]').fill('Для двоих');
  await stroka.locator('input[name="short"]').fill('');
  await stroka.locator('input[name="nameEn"]').fill('Pair');
  await stroka.locator('button[type="submit"]').click();
  await admin.waitForLoadState('networkidle');
  await admin.waitForTimeout(900);
  {
    await klient.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
    let k = await klient.$$eval('.card__name', (e) => e.map((x) => x.textContent ?? ''));
    let n = 1;
    while (n < 20 && !k.includes('Для двоих')) {
      await klient.waitForTimeout(500);
      await klient.reload({ waitUntil: 'networkidle' });
      k = await klient.$$eval('.card__name', (e) => e.map((x) => x.textContent ?? ''));
      n += 1;
    }
    chk('пустое короткое — на карточке стоит ПОЛНОЕ имя',
      k.includes('Для двоих') && !k.includes('На двоих'), `заходов ${n}, карточки: ${k.join(' | ')}`);
    const pusto = await admin.locator('form:has(input[value="Pair"]) input[name="short"]').inputValue();
    chk('форма показывает незаданное короткое имя ПУСТЫМ', pusto === '', pusto || 'пусто');
  }

  await admin.goto(`http://localhost:${PORT}/admin/settings/`, { waitUntil: 'networkidle' });
  const stroka1 = admin.locator('form:has(input[name="nameEn"])').filter({ has: admin.locator('input[value="Pair"]') });
  await stroka1.locator('input[name="name"]').fill('Для двоих');
  /* ⚠️ ПОЛЕЙ ТРИ С СОРОК ТРЕТЬЕЙ ИТЕРАЦИИ: полное имя
     и КОРОТКОЕ для карточки (постановка, открытый вопрос 99).
     Ставим их РАЗНЫМИ нарочно — иначе не видно, какое из двух
     куда поехало. */
  await stroka1.locator('input[name="short"]').fill('Двое');
  await stroka1.locator('input[name="nameEn"]').fill('Pair');
  await stroka1.locator('button[type="submit"]').click();
  await admin.waitForLoadState('networkidle');
  await admin.waitForTimeout(900);
  chk('название сохранено', /Название сохранено/.test((await admin.innerText('main.ad')) ?? ''));

  /* ⚠️ ЛЕНДИНГ СТАТИЧЕСКИЙ (закон 36), и после `revalidatePath('/')`
     Next вправе отдать ПРОШЛУЮ страницу, а новую собрать в фоне.
     Поэтому ждём СОБЫТИЯ — появления нового имени, — а не одного
     захода: фиксированная выдержка тут была бы гонкой (Р-94). */
  await klient.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  let glavnaya = await klient.innerText('main');
  let zahodov = 1;
  /* ⚠️ ЖДЁМ КОРОТКОЕ ИМЯ, А НЕ ПОЛНОЕ, И ЭТО НЕ ПРИДИРКА:
     с сорок третьей итерации на карточке стоит КОРОТКОЕ, а полное
     показывается под сеткой — у ВЫБРАННОГО тарифа. По умолчанию
     выбран первый, то есть «на одного», и «Для двоих» на свежей
     главной не встречается вовсе. */
  while (zahodov < 20 && !/Двое/.test(glavnaya)) {
    await klient.waitForTimeout(500);
    await klient.reload({ waitUntil: 'networkidle' });
    glavnaya = await klient.innerText('main');
    zahodov += 1;
  }
  /* ⚠️ НА КАРТОЧКЕ СТОИТ КОРОТКОЕ, А ПОД СЕТКОЙ ПОЛНОЕ —
     ровно так и просили. Спрашиваем САМУ карточку, а не текст
     страницы: под сеткой стоят оба имени разом, и по тексту
     целиком их не развести. */
  const kartochki = await klient.$$eval('.card__name', (e) => e.map((x) => x.textContent ?? ''));
  chk('на карточке главной стоит КОРОТКОЕ имя',
    kartochki.includes('Двое') && !kartochki.includes('Для двоих') && !kartochki.includes('На двоих'),
    `заходов ${zahodov}, карточки: ${kartochki.join(' | ')}`);

  /* Выбрали эту карточку — под сеткой обязано встать ПОЛНОЕ имя. */
  await klient.locator('.card').filter({ has: klient.locator('.card__name', { hasText: 'Двое' }) }).first().click();
  await klient.waitForTimeout(300);
  const podSetkoy = await klient.innerText('main');
  chk('новое русское название стоит на главной под сеткой',
    /Для двоих/.test(podSetkoy) && !/На двоих/.test(podSetkoy),
    podSetkoy.replace(/\s+/g, ' ').match(/Для двоих|На двоих/)?.[0] ?? 'ни одного');

  await klient.goto(`http://localhost:${PORT}/sertifikaty/`, { waitUntil: 'networkidle' });
  const kartySert = await klient.$$eval('.card__name', (e) => e.map((x) => x.textContent ?? ''));
  chk('на карточке сертификатов стоит КОРОТКОЕ имя',
    kartySert.includes('Двое') && !kartySert.includes('Для двоих'), kartySert.join(' | '));
  /* ⚠️ А СВОДКА «К ОПЛАТЕ» НА ТОЙ ЖЕ СТРАНИЦЕ — ПОЛНОЕ ИМЯ:
     короткое живёт только на карточке, а сводка — это «везде, где
     сейчас стоит полное» (постановка, Р-152). */
  await klient.locator('.card').filter({ has: klient.locator('.card__name', { hasText: 'Двое' }) }).first().click();
  await klient.waitForTimeout(300);
  const svodka = (await klient.innerText('.sum')) ?? '';
  chk('в сводке «К оплате» на сертификатах стоит ПОЛНОЕ имя',
    /Для двоих/.test(svodka) && !/Двое/.test(svodka.replace(/Для двоих/g, '')),
    svodka.replace(/\s+/g, ' ').slice(0, 80));

  await klient.goto(`http://localhost:${PORT}/checkout/?plan=duo&period=1`, { waitUntil: 'networkidle' });
  /* ⚠️ В ОФОРМЛЕНИИ ПОЛНОЕ, И КОРОТКОГО ТАМ НЕТ ВОВСЕ:
     «полное — везде, где сейчас стоит полное» (постановка). */
  const oform = await klient.innerText('main');
  chk('новое название стоит и в оформлении', /Для двоих/.test(oform));
  /* ⚠️ БЕЗ `\b`, И ЭТО НЕ НЕБРЕЖНОСТЬ: в JS граница слова
     считается по `[A-Za-z0-9_]`, кириллица в неё не входит вовсе,
     и `/\bДвое\b/` не совпадает НИ С ЧЕМ — проверка была бы
     вакуумной и зеленела бы на любом коде. Границы тут и не нужно:
     «Двое» с прописной Д в законных текстах оформления
     не встречается («Для двоих», «На двоих» — со строчной). */
  chk('короткого имени в оформлении нет', !/Двое/.test(oform),
    oform.replace(/\s+/g, ' ').slice(0, 90));

  await klient.goto(`http://localhost:${PORT}/cabinet/`, { waitUntil: 'networkidle' });
  chk('новое название стоит и в кабинете', /Для двоих/.test(await klient.innerText('main')));

  /* ⚠️ АНГЛИЙСКОЕ ИМЯ ВИДЯТ ТОЛЬКО СОТРУДНИКИ (закон 40). Проверяем
     ОБЕ стороны: английское появилось И русского не осталось. */
  await admin.goto(`http://localhost:${PORT}/admin/`, { waitUntil: 'networkidle' });
  await nazhat(admin, '.ad__lang-btn[value="en"]');
  const poAngliyski = await admin.innerText('main.ad');
  chk('в английской админке стоит английское имя',
    /Pair/.test(poAngliyski) && !/Для двоих/.test(poAngliyski),
    poAngliyski.replace(/\s+/g, ' ').match(/Pair|Для двоих/)?.[0] ?? 'ни одного');
  await nazhat(admin, '.ad__lang-btn[value="ru"]');
  const poRusski = await admin.innerText('main.ad');
  chk('в русской админке стоит русское имя',
    /Для двоих/.test(poRusski) && !/Pair/.test(poRusski));

  /* Вернули как было: оба поля пустые. */
  await admin.goto(`http://localhost:${PORT}/admin/settings/`, { waitUntil: 'networkidle' });
  const stroka2 = admin.locator('form:has(input[name="nameEn"])').filter({ has: admin.locator('input[value="Pair"]') });
  await stroka2.locator('input[name="name"]').fill('');
  await stroka2.locator('input[name="short"]').fill('');
  await stroka2.locator('input[name="nameEn"]').fill('');
  await stroka2.locator('button[type="submit"]').click();
  await admin.waitForLoadState('networkidle');
  await admin.waitForTimeout(900);
  chk('очистка всех полей вернула имя из кода',
    /вернулось к тому, что в коде/.test((await admin.innerText('main.ad')) ?? ''));
  const vBaze2 = await p2.query(`select count(*)::int as n from plan_name where plan_id = 'duo'`);
  chk('строки своего имени в базе не осталось', vBaze2.rows[0].n === 0, `${vBaze2.rows[0].n}`);
}

console.log('── ИСТОРИЯ РАБОТЫ: ДВА СОТРУДНИКА, ПЕРЕДАЧА ИЗ РУК В РУКИ ──');
{
  /* Постановка сорок четвёртой итерации: «Сотрудников будет
     несколько, и администратору нужно видеть, кто какой заказ взял,
     выполнил или отменил, и сколько сделал каждый… Если заказ
     передавали из рук в руки, видны все записи по порядку».

     Проверка ровно та, которую просили: два сотрудника, один берёт
     заказ и возвращает в очередь, второй берёт и выполняет; ещё один
     заказ отменяется с причиной; администратор видит всё это
     в карточке, в списке и в статистике за сегодня.

     ⚠️ ВТОРОЙ СОТРУДНИК ЗАВОДИТСЯ СТРОКОЙ В БАЗЕ, А НЕ ВХОДОМ
     ОКРУЖЕНИЯ: `SPOTIK_ADMINS` уже прочитан при старте службы, и
     второй адрес оттуда не доехал бы до этого прогона. Роль ему —
     `operator`: на нём же проверяется, что чужих почт он не видит. */
  const OPER = 'oper@spotik.test';
  await p2.query(`insert into staff (email, role) values ($1, 'operator') on conflict (email) do nothing`, [OPER]);

  /** Оформить и оплатить простой заказ; вернуть его номер. */
  const novyyZakaz = async (pochta, parol) => {
    await klient.goto(`http://localhost:${PORT}/checkout/?plan=solo&period=1`, { waitUntil: 'networkidle' });
    const galka = klient.locator('input[name="balance"]');
    if (await galka.count()) await galka.uncheck();
    await klient.fill('input[name="login0"]', pochta);
    await klient.fill('input[name="password0"]', parol);
    await klient.check('input[name="consent"]');
    await nazhat(klient, 'button[type="submit"]');
    await nazhat(klient, 'button[type="submit"]');
    const r = await p2.query(`select id from shop_order where status = 'paid' order by id desc limit 1`);
    return Number(r.rows[0].id);
  };

  const oper = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await voyti(oper, OPER, '/admin/login/');

  /* ── Заказ, который передают из рук в руки ─────────────────────── */
  const peredannyy = await novyyZakaz('peredacha@pochta.test', 'Peredacha-88');

  await admin.goto(`http://localhost:${PORT}/admin/orders/${peredannyy}/`, { waitUntil: 'networkidle' });
  await nazhat(admin, 'button:has-text("Взять")');
  await nazhat(admin, 'button:has-text("Вернуть в очередь")');

  await oper.goto(`http://localhost:${PORT}/admin/orders/${peredannyy}/`, { waitUntil: 'networkidle' });
  await nazhat(oper, 'button:has-text("Взять")');
  await shagVpered(oper, '.ad__shag[data-sost="seychas"] button:has-text("отметить выполненным")');
  await shagVpered(oper, '.ad__shag[data-sost="seychas"] button:has-text("Завершить заказ")');

  const sost = await p2.query('select status from shop_order where id = $1', [peredannyy]);
  chk('переданный заказ выполнен вторым сотрудником', sost.rows[0].status === 'done', sost.rows[0].status);

  /* ── Заказ, который отменяют с причиной ────────────────────────── */
  const otmenyonnyy = await novyyZakaz('otmena-44@pochta.test', 'Otmena44-88');
  await admin.goto(`http://localhost:${PORT}/admin/orders/${otmenyonnyy}/`, { waitUntil: 'networkidle' });
  await nazhat(admin, 'button:has-text("Взять")');
  await admin.locator('.ad__shag[data-sost="seychas"] button:has-text("Отменить заказ")').first().click();
  await admin.waitForTimeout(400);
  await admin.selectOption('select[name="reason"]', 'drugoe');
  await admin.locator('.ad__shag[data-sost="seychas"] button:has-text("Отменить заказ, деньги")').first().click();
  await admin.locator('.ad__sure button[type="submit"]').first().click();
  await admin.waitForLoadState('networkidle');
  await admin.waitForTimeout(900);

  /* ── Заказ, оставленный В РАБОТЕ: на нём проверяется колонка
        очереди «кто взял». ──────────────────────────────────────── */
  const vRabote = await novyyZakaz('vrabote-44@pochta.test', 'Vrabote44-88');
  await oper.goto(`http://localhost:${PORT}/admin/orders/${vRabote}/`, { waitUntil: 'networkidle' });
  await nazhat(oper, 'button:has-text("Взять")');

  /* ── 1. КАРТОЧКА: короткая история по порядку ──────────────────── */
  await admin.goto(`http://localhost:${PORT}/admin/orders/${peredannyy}/`, { waitUntil: 'networkidle' });
  const istoriya = await admin.evaluate(() => {
    const kartochki = [...document.querySelectorAll('.ad__card')];
    const k = kartochki.find((c) => /История работы/.test(c.querySelector('h3')?.textContent ?? ''));
    if (!k) return null;
    return [...k.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => (td.textContent ?? '').trim()),
    );
  });
  chk('в карточке есть блок истории', Array.isArray(istoriya) && istoriya.length > 0,
    istoriya ? `${istoriya.length} записей` : 'блока нет');
  /* ⚠️ ПРОВЕРЯЕТСЯ ПОРЯДОК И ПАРЫ «СОБЫТИЕ — КТО», а не просто
     наличие четырёх строк: передача из рук в руки видна только тем,
     что «Взял» стоит ДВАЖДЫ и во второй раз за другим человеком. */
  const shagi = (istoriya ?? []).map((r) => `${r[0]}:${r[1]}`);
  chk('история показывает всю передачу по порядку',
    shagi.join(' → ') ===
      `Взял в работу:${ADMIN} → Вернул в очередь:${ADMIN} → Взял в работу:${OPER} → Выполнил:${OPER}`,
    shagi.join(' → '));

  /* ⚠️ ВРЕМЯ СУДИТСЯ ПО НЕЗАВИСИМО ПОСЧИТАННОМУ МОСКОВСКОМУ ЧАСУ,
     а не по тому, что показала страница сама себе (Р-47, Р-136).
     И отдельно — что часовой пояс браузера не решает ничего: та же
     карточка открывается браузером, живущим в Окленде, и время
     в ней обязано остаться тем же. */
  const chasMsk = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow', hour: '2-digit', hour12: false }).format(new Date()),
  );
  const chasUtc = new Date().getUTCHours();
  const posledn = (istoriya ?? []).at(-1) ?? [];
  const chasNaEkrane = Number((posledn[2] ?? '').match(/(\d{2}):\d{2}$/)?.[1] ?? -1);
  chk('время последней записи — московский час',
    chasNaEkrane === chasMsk, `на экране ${chasNaEkrane}, по Москве ${chasMsk}, UTC ${chasUtc}`);

  const oklend = await browser.newPage({ viewport: { width: 1280, height: 900 }, timezoneId: 'Pacific/Auckland' });
  await oklend.context().addCookies(await admin.context().cookies());
  await oklend.goto(`http://localhost:${PORT}/admin/orders/${peredannyy}/`, { waitUntil: 'networkidle' });
  const uOklenda = await oklend.evaluate(() => {
    const k = [...document.querySelectorAll('.ad__card')].find((c) =>
      /История работы/.test(c.querySelector('h3')?.textContent ?? ''),
    );
    const tr = k ? [...k.querySelectorAll('tbody tr')].at(-1) : null;
    return tr ? ([...tr.querySelectorAll('td')].at(-1)?.textContent ?? '').trim() : '';
  });
  chk('часовой пояс браузера время истории не двигает',
    uOklenda === (posledn[2] ?? '—'), `Окленд «${uOklenda}» против «${posledn[2] ?? ''}»`);
  await oklend.close();

  /* ── 2. СПИСКИ: колонка с почтой сотрудника ────────────────────── */
  await admin.goto(`http://localhost:${PORT}/admin/`, { waitUntil: 'networkidle' });
  const vSpiskah = await admin.evaluate((nomera) => {
    const kletka = (id) => {
      const a = [...document.querySelectorAll('td a')].find((x) => x.textContent?.trim() === String(id));
      if (!a) return null;
      const tr = a.closest('tr');
      const tabl = a.closest('table');
      const shapka = [...(tabl?.querySelectorAll('thead th') ?? [])].map((th) => (th.textContent ?? '').trim());
      const i = shapka.indexOf('Сотрудник');
      if (i < 0) return null;
      return ([...tr.querySelectorAll('td')][i]?.textContent ?? '').trim();
    };
    return { done: kletka(nomera.done), cancelled: kletka(nomera.cancelled), work: kletka(nomera.work) };
  }, { done: peredannyy, cancelled: otmenyonnyy, work: vRabote });
  chk('у выполненного заказа в списке стоит тот, кто ВЫПОЛНИЛ',
    vSpiskah.done === OPER, `${vSpiskah.done}`);
  chk('у отменённого заказа в списке стоит тот, кто ОТМЕНИЛ',
    vSpiskah.cancelled === ADMIN, `${vSpiskah.cancelled}`);
  chk('у заказа в работе в очереди стоит тот, кто ВЗЯЛ',
    vSpiskah.work === OPER, `${vSpiskah.work}`);

  /* ── 3. СТАТИСТИКА ЗА СЕГОДНЯ: по сотрудникам ──────────────────── */
  await admin.goto(`http://localhost:${PORT}/admin/stats/?p=day`, { waitUntil: 'networkidle' });
  /* ⚠️ ЗАГОЛОВКИ СНИМАЮТСЯ `textContent`, А НЕ `innerText`: у `.ad th`
     стоит `text-transform: uppercase` (см. ниже про «ORDERS COMPLETED»). */
  const blokLyudi = await admin.evaluate(() => {
    const k = [...document.querySelectorAll('.ad__card')].find((c) =>
      /По сотрудникам/.test(c.querySelector('h3')?.textContent ?? ''),
    );
    if (!k) return null;
    return {
      shapka: [...k.querySelectorAll('thead th')].map((th) => (th.textContent ?? '').trim()),
      stroki: [...k.querySelectorAll('tbody tr')].map((tr) =>
        [...tr.querySelectorAll('td')].map((td) => (td.textContent ?? '').trim()),
      ),
    };
  });
  const poLyudyam = blokLyudi?.stroki ?? null;
  chk('в статистике есть блок по сотрудникам', Array.isArray(poLyudyam) && poLyudyam.length > 0,
    poLyudyam ? `${poLyudyam.length} строк` : 'блока нет');
  const strokaOper = (poLyudyam ?? []).find((r) => r[0] === OPER);
  chk('второй сотрудник показан с числом выполненных и разбивкой по тарифам',
    Boolean(strokaOper) && strokaOper[1] === '1' && /Индивидуальный — 1/.test(strokaOper[2] ?? ''),
    strokaOper ? strokaOper.join(' | ') : 'строки нет');
  /* ⚠️ ОТМЕНА В «ВЫПОЛНЕНО» НЕ ИДЁТ. Считаются события `vypolnil`,
     и заказ, отменённый администратором, его счётчика не трогает. */
  const vypolnilPoBaze = await p2.query(
    `select count(*)::int as n from order_event e join staff f on f.id = e.staff_id
      where e.vid = 'vypolnil' and f.email = $1 and e.created_at > now() - interval '1 day'`,
    [OPER],
  );
  chk('число на экране сходится с журналом в базе',
    Number(strokaOper?.[1] ?? -1) === vypolnilPoBaze.rows[0].n, `${strokaOper?.[1]} против ${vypolnilPoBaze.rows[0].n}`);

  /* ── 3а. КОЛОНКА «ОТМЕНИЛ» (сорок пятая итерация) ───────────────
     Постановка: «рядом с выполненными колонка „Отменил" — сколько
     заказов сотрудник отменил за выбранный период, с той же
     разбивкой по тарифам. Отмены самим покупателем сюда не входят».

     ⚠️ ЧИСЛА СУДЯТСЯ ОТДЕЛЬНЫМ ЗАПРОСОМ К БАЗЕ, а не пересчётом той же
     арифметикой, какой их считает страница (Р-47). */
  chk('в блоке по сотрудникам есть колонка «Отменил» и её разбивка',
    Array.isArray(blokLyudi?.shapka) && blokLyudi.shapka.includes('Отменил') &&
      blokLyudi.shapka.includes('Отменил по тарифам'),
    blokLyudi ? blokLyudi.shapka.join(' | ') : 'блока нет');

  /* ⚠️ ПОДПИСИ СВЕДЕНЫ К ОДНОЙ ФОРМЕ (сорок шестая итерация):
     «Выполнил» и «Отменил», по тарифам — «Выполнил по тарифам»
     и «Отменил по тарифам». Проверяется и отсутствие прежней
     формы: она говорила о заказах, а соседняя — о человеке. */
  chk('подписи колонок по сотрудникам одной формы',
    Array.isArray(blokLyudi?.shapka) && blokLyudi.shapka.includes('Выполнил') &&
      blokLyudi.shapka.includes('Выполнил по тарифам') &&
      !blokLyudi.shapka.includes('Выполнено заказов'),
    blokLyudi ? blokLyudi.shapka.join(' | ') : 'блока нет');

  const strokaAdmin = (poLyudyam ?? []).find((r) => r[0] === ADMIN);
  const otmenilPoBaze = await p2.query(
    `select count(*)::int as n from order_event e join staff f on f.id = e.staff_id
      where e.vid = 'otmenil' and f.email = $1 and e.created_at > now() - interval '1 day'`,
    [ADMIN],
  );
  chk('у администратора число отменённых сходится с журналом в базе',
    Boolean(strokaAdmin) && otmenilPoBaze.rows[0].n > 0 &&
      Number(strokaAdmin[3]) === otmenilPoBaze.rows[0].n,
    strokaAdmin ? `${strokaAdmin[3]} против ${otmenilPoBaze.rows[0].n}` : 'строки нет');

  /** Сумма чисел в разбивке вида «Имя — 2 · Имя — 1». */
  const summaRazbivki = (t) =>
    (t ?? '').split('·').reduce((a, x) => a + Number((x.match(/—\s*(\d+)\s*$/) ?? [])[1] ?? 0), 0);
  chk('разбивка отмен по тарифам сходится с самим числом',
    Boolean(strokaAdmin) && /Индивидуальный — \d+/.test(strokaAdmin[4] ?? '') &&
      summaRazbivki(strokaAdmin[4]) === Number(strokaAdmin[3]),
    strokaAdmin ? `«${strokaAdmin[4]}» против ${strokaAdmin[3]}` : 'строки нет');

  /* ⚠️ ВЫПОЛНЕННОЕ И ОТМЕНЁННОЕ НЕ ПЕРЕТЕКАЮТ ДРУГ В ДРУГА: второй
     сотрудник за этот период ничего не отменял, и в его строке ноль,
     а не его же выполненный заказ. */
  chk('у второго сотрудника отмен нет, а выполненное на месте',
    strokaOper?.[3] === '0' && strokaOper?.[1] === '1', `${strokaOper?.[1]} / ${strokaOper?.[3]}`);

  /* ⚠️ ОТМЕНЫ САМИМ ПОКУПАТЕЛЕМ В БЛОК НЕ ИДУТ, и проверка
     не вакуумная: сначала база обязана подтвердить, что такие отмены
     за период ЕСТЬ (их делает проверка «отменённый покупателем заказ
     исчезает» выше), и только потом сумма колонки сравнивается
     с числом отмен, у которых сотрудник ЕСТЬ. */
  const otmenVsego = await p2.query(
    `select count(*) filter (where e.staff_id is not null)::int as sotrudnikami,
            count(*) filter (where e.staff_id is null)::int as pokupatelyami
       from order_event e
      where e.vid = 'otmenil' and e.created_at > now() - interval '1 day'`,
  );
  const summaKolonki = (poLyudyam ?? []).reduce((a, r) => a + Number(r[3] || 0), 0);
  chk('отмены самим покупателем в блок не попадают',
    otmenVsego.rows[0].pokupatelyami > 0 && summaKolonki === otmenVsego.rows[0].sotrudnikami,
    `на экране ${summaKolonki}, сотрудниками ${otmenVsego.rows[0].sotrudnikami}, покупателями ${otmenVsego.rows[0].pokupatelyami}`);

  /* ── 4. АНГЛИЙСКАЯ АДМИНКА ─────────────────────────────────────── */
  await admin.goto(`http://localhost:${PORT}/admin/orders/${peredannyy}/`, { waitUntil: 'networkidle' });
  await nazhat(admin, '.ad__lang-btn[value="en"]');
  const poEn = await admin.innerText('main.ad');
  chk('в английской админке подписи истории английские',
    /Work history/.test(poEn) && /Took the order/.test(poEn) && /Put back in the queue/.test(poEn) &&
      /Completed/.test(poEn) && !/История работы/.test(poEn) && !/Взял в работу/.test(poEn),
    poEn.replace(/\s+/g, ' ').match(/Work history|История работы/)?.[0] ?? 'ни одного');
  await admin.goto(`http://localhost:${PORT}/admin/stats/?p=day`, { waitUntil: 'networkidle' });
  /* ⚠️ ПЕРЕЗАГРУЗКА ПОСЛЕ СМЕНЫ ЯЗЫКА: этот адрес уже открывали
     этой же вкладкой несколько строк назад, и проверять надо
     отрисовку, а не то, что осталось у браузера в кэше. */
  await admin.reload({ waitUntil: 'networkidle' });
  const statEn = await admin.innerText('main.ad');
  /* ⚠️ ЗАГОЛОВКИ ТАБЛИЦ СНИМАЮТСЯ `textContent`, А НЕ `innerText`:
     у `.ad th` стоит `text-transform: uppercase`, и `innerText`
     отдаёт ОТРИСОВАННЫЙ текст — «ORDERS COMPLETED». Проверка
     на «Orders completed» честно падала на исправном коде, и это
     тот же класс, что `innerText` против `textContent` в Р-139:
     спрашивать надо ту величину, о которой судишь. */
  const shapkiEn = await admin.evaluate(() => {
    const k = [...document.querySelectorAll('.ad__card')].find((c) =>
      /By staff/.test(c.querySelector('h3')?.textContent ?? ''),
    );
    return k ? [...k.querySelectorAll('thead th')].map((th) => (th.textContent ?? '').trim()) : null;
  });
  chk('в английской статистике блок по сотрудникам английский',
    Array.isArray(shapkiEn) && shapkiEn.includes('Orders completed') && shapkiEn.includes('Staff') &&
      shapkiEn.includes('Orders cancelled') && shapkiEn.includes('Cancelled by plan') &&
      /By staff/.test(statEn) && !/По сотрудникам/.test(statEn) && !/Отменил/.test(statEn),
    `${shapkiEn ? shapkiEn.join(' | ') : 'блока нет'} · русского нет ${!/По сотрудникам/.test(statEn)}`);
  await admin.goto(`http://localhost:${PORT}/admin/`, { waitUntil: 'networkidle' });
  await nazhat(admin, '.ad__lang-btn[value="ru"]');

  /* ── 5. ИСПОЛНИТЕЛЬ ЧУЖИХ ПОЧТ НЕ ВИДИТ ────────────────────────── */
  /* ⚠️ СПРАШИВАЕТСЯ ЖИВАЯ СТРАНИЦА, А НЕ НАША ЖЕ ФУНКЦИЯ ОТБОРА
     (Р-47). И заказ взят ДЛЯ ЭТОГО: у выполненного им заказа его
     собственный адрес в карточке стоит законно — «взял …», — поэтому
     присутствие ЧУЖОГО адреса и есть признак утечки. */
  await oper.goto(`http://localhost:${PORT}/admin/orders/${peredannyy}/`, { waitUntil: 'networkidle' });
  const uOperaKarta = await oper.innerText('main.ad');
  chk('исполнителю блока истории не видно',
    !/История работы/.test(uOperaKarta) && !uOperaKarta.includes(ADMIN),
    uOperaKarta.includes(ADMIN) ? 'чужой адрес на экране' : 'чисто');
  /* ⚠️ И САМИХ ДАННЫХ В РАЗМЕТКЕ НЕТ: спрятать блок стилем значило бы
     оставить чужие адреса в исходнике страницы (Р-148). */
  const vRazmetke = await oper.content();
  chk('чужого адреса нет и в разметке страницы', !vRazmetke.includes(ADMIN));

  await oper.goto(`http://localhost:${PORT}/admin/stats/?p=day`, { waitUntil: 'networkidle' });
  const uOperaStat = await oper.innerText('main.ad');
  /* ⚠️ СВОЯ ПОЧТА В ШАПКЕ РАЗДЕЛА — ЗАКОННА И БЫЛА ТАМ ВСЕГДА
     («у него всё как сейчас»): раздел подписывает, кем ты вошёл.
     Признак утечки — ЧУЖОЙ адрес, и ищем мы именно его. */
  chk('исполнителю блока по сотрудникам не видно',
    !/По сотрудникам/.test(uOperaStat) && !uOperaStat.includes(ADMIN),
    uOperaStat.includes(ADMIN) ? 'чужой адрес на экране'
      : (uOperaStat.replace(/\s+/g, ' ').match(/По сотрудникам/)?.[0] ?? 'чисто'));
  /* Сам раздел статистики ему по-прежнему открыт (Р-147): заказы
     по тарифам на месте, и это прямая постановка — «сами заказы
     по тарифам оставь». */
  chk('сама статистика исполнителю открыта', /По тарифам и срокам/.test(uOperaStat) && /Заказов/.test(uOperaStat));

  /* ── ПУНКТ 1: У ОПЕРАТОРА НЕТ НИ ДЕНЕГ, НИ РЕКЛАМЫ ──────────────
     Постановка: «Убирай на сервере: данные о деньгах не должны
     уходить оператору вообще, а не прятаться разметкой». Поэтому
     проверяется И экран, И РАЗМЕТКА: спрячь мы строку стилем — сумма
     всё равно лежала бы в исходнике страницы (то же, что с деньгами
     заказа, Р-148). */
  const uOperaStatHtml = await oper.content();
  chk('у исполнителя в статистике нет выручки',
    !/Выручка/.test(uOperaStat) && !/деньги, прошедшие через кассу/.test(uOperaStat) &&
      !/Выручка/.test(uOperaStatHtml),
    uOperaStat.replace(/\s+/g, ' ').match(/Выручка[^·]{0,40}/)?.[0] ?? 'чисто');
  chk('у исполнителя нет раздела «Ссылка с метками»',
    !/Ссылка с метками/.test(uOperaStat) && !/Ссылка с метками/.test(uOperaStatHtml));

  /* ⚠️ НЕВАКУУМНО: у АДМИНИСТРАТОРА за тот же период обе вещи
     на месте. Без этой строки проверка выше проходила бы и на пустой
     странице, и на сломанной статистике. */
  await admin.goto(`http://localhost:${PORT}/admin/stats/?p=day`, { waitUntil: 'networkidle' });
  const uAdminaStat = await admin.innerText('main.ad');
  chk('у администратора выручка и ссылка с метками на месте',
    /Выручка/.test(uAdminaStat) && /деньги, прошедшие через кассу/.test(uAdminaStat) &&
      /Ссылка с метками/.test(uAdminaStat),
    `выручка ${/Выручка/.test(uAdminaStat)} · метки ${/Ссылка с метками/.test(uAdminaStat)}`);

  await oper.goto(`http://localhost:${PORT}/admin/`, { waitUntil: 'networkidle' });
  const shapkiUOpera = await oper.$$eval('table thead th', (e) => e.map((x) => (x.textContent ?? '').trim()));
  chk('исполнителю колонки с почтой сотрудника не видно',
    shapkiUOpera.length > 0 && !shapkiUOpera.includes('Сотрудник'), shapkiUOpera.join(' | '));

  /* ── 6. ЧЕГО НЕТ В БАЗЕ, ТО ПУСТО ─────────────────────────────── */
  /* Постановка, пункт 6: «Если данных нет, поле пустое, без ошибок».
     Заказ, у которого событий нет вовсе, — это оплаченный
     и не взятый: у него в колонке прочерк, а карточка открывается
     с пустой историей. */
  const nikem = await novyyZakaz('bez-istorii@pochta.test', 'Bezistorii-88');
  await admin.goto(`http://localhost:${PORT}/admin/orders/${nikem}/`, { waitUntil: 'networkidle' });
  const pustaya = await admin.evaluate(() => {
    const k = [...document.querySelectorAll('.ad__card')].find((c) =>
      /История работы/.test(c.querySelector('h3')?.textContent ?? ''),
    );
    return k ? (k.textContent ?? '') : null;
  });
  chk('у заказа без событий история пуста и без ошибок',
    typeof pustaya === 'string' && /Записей нет/.test(pustaya), pustaya === null ? 'блока нет вовсе' : 'есть');

  await oper.close();
}

console.log('── ТАРИФЫ ПО ОПЕРАТОРАМ И ЧУЖИЕ ЗАКАЗЫ ──');
{
  /* Постановка сорок шестой итерации, пункты 2 и 3, и проверка ровно
     та, которую просили: «два оператора с разными тарифами — каждый
     видит и может взять только свои. Первый берёт заказ, второй его
     не видит и по прямой ссылке получает „Заказ недоступен".
     Переименуй тариф и поменяй цену — галочки на месте».

     ⚠️ ДВА ТРЕБОВАНИЯ РАЗВЕДЕНЫ ДВУМЯ ЗАКАЗАМИ, И ИНАЧЕ ПРОВЕРКА
     НИЧЕГО НЕ ЗНАЧИЛА БЫ. На заказе, тариф которого второму и так
     запрещён, «не видит» верно по ДВУМ причинам сразу, и какая
     из них сработала — не различить. Поэтому:
       заказ «Индивидуальный» — разрешён только первому: он и ловит
         разделение по тарифам (пункт 3);
       заказ «На двоих» — разрешён ОБОИМ, и первый его берёт: на нём
         и только на нём проверяется, что взятый другим заказ
         пропадает у второго целиком (пункт 2). */
  const OP1 = 'tarif1@spotik.test';
  const OP2 = 'tarif2@spotik.test';
  for (const e of [OP1, OP2]) {
    await p2.query(`insert into staff (email, role) values ($1, 'operator') on conflict (email) do nothing`, [e]);
  }
  const nomerStaff = async (e) => Number((await p2.query('select id from staff where email = $1', [e])).rows[0].id);
  const id1 = await nomerStaff(OP1);
  const id2 = await nomerStaff(OP2);

  const op1 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const op2 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await voyti(op1, OP1, '/admin/login/');
  await voyti(op2, OP2, '/admin/login/');

  /** Оформить и оплатить заказ выбранного тарифа; вернуть номер. */
  const zakazTarifa = async (plan, mest, metka) => {
    await klient.goto(`http://localhost:${PORT}/checkout/?plan=${plan}&period=1`, { waitUntil: 'networkidle' });
    const galka = klient.locator('input[name="balance"]');
    if (await galka.count()) await galka.uncheck();
    for (let i = 0; i < mest; i += 1) {
      await klient.fill(`input[name="login${i}"]`, `${metka}-${i}@pochta.test`);
      await klient.fill(`input[name="password${i}"]`, `Tarify46-${i}8`);
    }
    await klient.check('input[name="consent"]');
    await nazhat(klient, 'button[type="submit"]');
    await nazhat(klient, 'button[type="submit"]');
    const r = await p2.query(`select id from shop_order where status = 'paid' order by id desc limit 1`);
    return Number(r.rows[0].id);
  };

  /** Номера заказов, которые сотрудник видит у себя в очереди. */
  const ocheredNa = async (stranica) => {
    await stranica.goto(`http://localhost:${PORT}/admin/`, { waitUntil: 'networkidle' });
    return stranica.$$eval('table tbody tr td:first-child a', (e) =>
      e.map((x) => Number((x.textContent ?? '').trim())).filter((n) => Number.isFinite(n)),
    );
  };

  /** Отметить оператору разрешённые тарифы галочками и сохранить.

      ⚠️ ОБЫЧНЫЙ КЛИК С ОЖИДАНИЕМ ОТРИСОВКИ, А НЕ `nazhat`: серверное
      действие адреса не меняет, и `nazhat` впустую ждал бы перехода
      все свои десять секунд. */
  const zadatTarify = async (staffId, razresheno) => {
    await admin.goto(`http://localhost:${PORT}/admin/staff/`, { waitUntil: 'networkidle' });
    for (const plan of ['solo', 'duo', 'trio']) {
      const g = admin.locator(`input[form="tarify-${staffId}"][value="${plan}"]`);
      if (razresheno.includes(plan)) await g.check();
      else await g.uncheck();
    }
    await admin.locator(`form#tarify-${staffId} button[type="submit"]`).click();
    await admin.waitForLoadState('networkidle');
    await admin.waitForTimeout(900);
  };

  /* ── 1. НОВЫЙ ОПЕРАТОР ПОЛУЧАЕТ ВСЕ ТАРИФЫ ──────────────────────
     Постановка прямо: «Новый оператор по умолчанию получает все
     тарифы». В базе это выражено ОТСУТСТВИЕМ строк (миграция 013),
     поэтому спрашиваем и базу, и живой экран: галочки обязаны стоять
     все до одной. */
  const zapretovSrazu = await p2.query('select count(*)::int as n from staff_plan_off where staff_id = any($1::bigint[])', [[id1, id2]]);
  chk('у нового оператора запретов в базе нет ни одного', zapretovSrazu.rows[0].n === 0, String(zapretovSrazu.rows[0].n));
  await admin.goto(`http://localhost:${PORT}/admin/staff/`, { waitUntil: 'networkidle' });
  const galkiSrazu = await admin.$$eval(`input[form="tarify-${id1}"]`, (e) => e.map((x) => x.checked));
  chk('у нового оператора отмечены все тарифы',
    galkiSrazu.length === 3 && galkiSrazu.every(Boolean), galkiSrazu.join(','));

  /* ── 2. ВТОРОЙ ОПЕРАТОР ТЕРЯЕТ «ИНДИВИДУАЛЬНЫЙ» ПРЯМО ПРИ
        ОТКРЫТОЙ ОЧЕРЕДИ — ЭТО И ЕСТЬ ПРОВЕРКА СЕРВЕРА ────────────
     ⚠️ ОЧЕРЕДЬ ОТКРЫВАЕТСЯ ДО СНЯТИЯ ГАЛОЧКИ, И КНОПКА «ВЗЯТЬ»
     НАЖИМАЕТСЯ ПОСЛЕ. Это ровно тот обход, от которого постановка
     и требует «проверку на сервере»: разметка у него на экране
     уже устарела, а взятие обязано отказать. Проверь мы только
     пропажу строки из очереди — доказано было бы, что страница
     её не рисует, и ничего больше. */
  const zakazSolo = await zakazTarifa('solo', 1, 'solo46');
  const doSnyatiya = await ocheredNa(op2);
  chk('до снятия галочки заказ виден второму оператору', doSnyatiya.includes(zakazSolo), doSnyatiya.join(','));

  await zadatTarify(id1, ['solo', 'duo']);
  await zadatTarify(id2, ['duo']);

  const zapisano = await p2.query(
    'select staff_id, plan_id from staff_plan_off where staff_id = any($1::bigint[]) order by staff_id, plan_id',
    [[id1, id2]],
  );
  chk('в базе лежат ЗАПРЕТЫ, а не разрешения',
    zapisano.rows.length === 3 &&
      zapisano.rows.some((r) => Number(r.staff_id) === id1 && r.plan_id === 'trio') &&
      zapisano.rows.some((r) => Number(r.staff_id) === id2 && r.plan_id === 'solo') &&
      zapisano.rows.some((r) => Number(r.staff_id) === id2 && r.plan_id === 'trio'),
    zapisano.rows.map((r) => `${r.staff_id}:${r.plan_id}`).join(' '));

  /* Кнопка на СТАРОЙ, уже неверной странице второго оператора.
     ⚠️ ЖДЁМ ПЕРЕХОДА, А НЕ ТИШИНЫ В СЕТИ: действие кончается
     `redirect` на карточку заказа, и `networkidle` наступает раньше,
     чем роутер её отрисует. */
  await nazhat(op2, `form:has(input[name="order"][value="${zakazSolo}"]) button[type="submit"]`);
  const posleObhoda = await p2.query('select status, operator_id from shop_order where id = $1', [zakazSolo]);
  chk('сервер не даёт взять заказ чужого тарифа',
    posleObhoda.rows[0].status === 'paid' && posleObhoda.rows[0].operator_id === null,
    `${posleObhoda.rows[0].status} / ${posleObhoda.rows[0].operator_id}`);
  chk('после отказа он видит «Заказ недоступен»',
    /Заказ недоступен/.test(await op2.innerText('main.ad')));

  /* ── 3. КАЖДЫЙ ВИДИТ ТОЛЬКО СВОИ ТАРИФЫ ─────────────────────────
     ⚠️ ПРОВЕРКА НЕВАКУУМНАЯ: сначала заказ обязан быть виден ПЕРВОМУ
     оператору, и только потом отсутствие его у второго что-то значит.
     Пустая очередь иначе проходила бы обе строки разом. */
  const u1 = await ocheredNa(op1);
  const u2 = await ocheredNa(op2);
  chk('заказ разрешённого тарифа виден первому оператору', u1.includes(zakazSolo), u1.join(','));
  chk('заказ чужого тарифа второму оператору не виден', !u2.includes(zakazSolo), u2.join(','));

  const chuzhoyTarif = await op2.goto(`http://localhost:${PORT}/admin/orders/${zakazSolo}/`, { waitUntil: 'networkidle' });
  const tekstChuzhogo = await op2.innerText('main.ad');
  chk('по прямой ссылке чужой тариф — «Заказ недоступен»',
    chuzhoyTarif.status() === 200 && /Заказ недоступен/.test(tekstChuzhogo) &&
      !/solo46-0@pochta\.test/.test(tekstChuzhogo),
    tekstChuzhogo.replace(/\s+/g, ' ').slice(0, 80));

  /* ── 4. ВЗЯТЫЙ ДРУГИМ ЗАКАЗ ПРОПАДАЕТ ЦЕЛИКОМ (пункт 2) ─────────
     Тариф «На двоих» разрешён ОБОИМ, поэтому здесь работает ровно
     то, что просили: первый берёт — второй перестаёт видеть. */
  const zakazDuo = await zakazTarifa('duo', 2, 'duo46');
  const doVzyatiya = await ocheredNa(op2);
  chk('свободный заказ общего тарифа виден обоим', doVzyatiya.includes(zakazDuo), doVzyatiya.join(','));

  await op1.goto(`http://localhost:${PORT}/admin/orders/${zakazDuo}/`, { waitUntil: 'networkidle' });
  await nazhat(op1, 'button:has-text("Взять")');
  const vzyal = await p2.query('select operator_id from shop_order where id = $1', [zakazDuo]);
  chk('первый оператор заказ взял', Number(vzyal.rows[0].operator_id) === id1, String(vzyal.rows[0].operator_id));

  const posleVzyatiya = await ocheredNa(op2);
  chk('взятый другим заказ у второго из очереди пропал', !posleVzyatiya.includes(zakazDuo), posleVzyatiya.join(','));

  const chuzhoy = await op2.goto(`http://localhost:${PORT}/admin/orders/${zakazDuo}/`, { waitUntil: 'networkidle' });
  const tekstChuzhoy = await op2.innerText('main.ad');
  const razmetkaChuzhoy = await op2.content();
  chk('по прямой ссылке чужой заказ — «Заказ недоступен» без имени и почты',
    chuzhoy.status() === 200 && /Заказ недоступен/.test(tekstChuzhoy) &&
      !tekstChuzhoy.includes(OP1) && !razmetkaChuzhoy.includes(OP1) &&
      !razmetkaChuzhoy.includes('duo46-0@pochta.test'),
    tekstChuzhoy.replace(/\s+/g, ' ').slice(0, 80));

  /* ⚠️ И СВОЙ ЗАКАЗ ПРИ ЭТОМ ОТКРЫВАЕТСЯ, а «взял: почта» на нём
     не пишется вовсе: постановка — «Подписи „взял: {почта}"
     у оператора нет нигде». */
  await op1.goto(`http://localhost:${PORT}/admin/orders/${zakazDuo}/`, { waitUntil: 'networkidle' });
  const svoy = await op1.innerText('main.ad');
  chk('свой заказ первому оператору открыт и назван своим',
    /ваш/.test(svoy) && !/взял /.test(svoy) && !svoy.includes(OP2), svoy.replace(/\s+/g, ' ').slice(0, 90));

  /* ⚠️ САМООБНОВЛЕНИЕ ХОДИТ ЧЕРЕЗ ТУ ЖЕ ДВЕРЬ. Отдай маршрут очередь
     целиком — и всё, чего страница не показала, приехало бы
     следующим тиком опроса, в JSON. */
  const json = await op2.evaluate(async () => (await (await fetch('/api/admin/queue/', { cache: 'no-store' })).json()));
  chk('в JSON самообновления чужих заказов и почт нет',
    !json.rows.some((r) => r.id === zakazDuo || r.id === zakazSolo) &&
      !json.rows.some((r) => r.operator !== null),
    JSON.stringify(json.rows.map((r) => [r.id, r.operator])).slice(0, 90));

  /* ── 5. ЗАКАЗ ОСТАЁТСЯ У ОПЕРАТОРА, ДАЖЕ ЕСЛИ ГАЛОЧКУ СНЯЛИ ──── */
  await zadatTarify(id1, ['solo']);
  await op1.goto(`http://localhost:${PORT}/admin/orders/${zakazDuo}/`, { waitUntil: 'networkidle' });
  chk('взятый заказ остаётся у оператора после снятия галочки',
    !/Заказ недоступен/.test(await op1.innerText('main.ad')) &&
      (await op1.locator('.ad__shag[data-sost="seychas"]').count()) > 0);

  /* ── 6. АДМИНИСТРАТОР ВИДИТ ВСЁ И БЕРЁТ ЛЮБОЙ ЗАКАЗ ───────────── */
  const uAdmina = await ocheredNa(admin);
  chk('администратору видны оба заказа', uAdmina.includes(zakazSolo) && uAdmina.includes(zakazDuo), uAdmina.join(','));
  await admin.goto(`http://localhost:${PORT}/admin/orders/${zakazSolo}/`, { waitUntil: 'networkidle' });
  await nazhat(admin, 'button:has-text("Взять")');
  const vzyalAdmin = await p2.query('select operator_id from shop_order where id = $1', [zakazSolo]);
  chk('администратор берёт заказ любого тарифа',
    vzyalAdmin.rows[0].operator_id !== null, String(vzyalAdmin.rows[0].operator_id));

  /* ── 7. ПЕРЕИМЕНОВАНИЕ И ЦЕНА ГАЛОЧЕК НЕ СБРАСЫВАЮТ ─────────────
     Постановка: «Галочки привязаны к самому тарифу, а не к названию
     или цене». Правится и то, и другое — через живую админку,
     а не вставкой в базу: вставкой проверялось бы не то, что делает
     человек. */
  const doPravki = await p2.query(
    'select plan_id from staff_plan_off where staff_id = $1 order by plan_id',
    [id2],
  );
  await admin.goto(`http://localhost:${PORT}/admin/settings/`, { waitUntil: 'networkidle' });

  /* Имя: форма с тремя полями имени у строки тарифа `duo`. */
  const formaImeni = admin
    .locator('form')
    .filter({ has: admin.locator('input[name="plan"][value="duo"]') })
    .filter({ has: admin.locator('input[name="nameEn"]') })
    .first();
  await formaImeni.locator('input[name="name"]').fill('На двоих ПЕРЕИМЕНОВАН');
  await formaImeni.locator('input[name="short"]').fill('Двое');
  await formaImeni.locator('input[name="nameEn"]').fill('Duo renamed');
  await formaImeni.locator('button[type="submit"]').click();
  await admin.waitForLoadState('networkidle');
  await admin.waitForTimeout(900);

  /* Цена: форма БЕЗ поля `until` — иначе это форма скидки. */
  await admin.goto(`http://localhost:${PORT}/admin/settings/`, { waitUntil: 'networkidle' });
  const formaCeny = admin
    .locator('form')
    .filter({ has: admin.locator('input[name="plan"][value="duo"]') })
    .filter({ has: admin.locator('input[name="period"][value="1"]') })
    .filter({ has: admin.locator('input[name="price"]') })
    .filter({ hasNot: admin.locator('input[name="until"]') })
    .first();
  await formaCeny.locator('input[name="price"]').fill('777');
  await formaCeny.locator('button[type="submit"]').click();
  await admin.waitForLoadState('networkidle');
  await admin.waitForTimeout(900);

  const cenaVBaze = await p2.query(
    `select price_kop from plan_price where plan_id = 'duo' and period = 1`,
  );
  const imyaVBaze = await p2.query(`select name from plan_name where plan_id = 'duo'`);
  chk('правки имени и цены действительно применились',
    Number(cenaVBaze.rows[0]?.price_kop) === 77700 && imyaVBaze.rows[0]?.name === 'На двоих ПЕРЕИМЕНОВАН',
    `${cenaVBaze.rows[0]?.price_kop} · ${imyaVBaze.rows[0]?.name}`);

  const poslePravki = await p2.query(
    'select plan_id from staff_plan_off where staff_id = $1 order by plan_id',
    [id2],
  );
  chk('переименование и цена галочек не сбрасывают',
    JSON.stringify(doPravki.rows) === JSON.stringify(poslePravki.rows) && poslePravki.rows.length === 2,
    `${doPravki.rows.map((r) => r.plan_id).join(',')} → ${poslePravki.rows.map((r) => r.plan_id).join(',')}`);

  await admin.goto(`http://localhost:${PORT}/admin/staff/`, { waitUntil: 'networkidle' });
  const galkiPosle = await admin.$$eval(`input[form="tarify-${id2}"]`, (e) =>
    e.map((x) => `${x.value}:${x.checked ? 1 : 0}`),
  );
  chk('на экране галочки после переименования те же',
    galkiPosle.join(' ') === 'solo:0 duo:1 trio:0', galkiPosle.join(' '));

  /* ── 8. ТАРИФ, КОТОРЫЙ НИКТО НЕ МОЖЕТ ВЫПОЛНИТЬ ────────────────
     ⚠️ ПРОВЕРКА НЕВАКУУМНАЯ С ОБЕИХ СТОРОН: сначала предупреждения
     про «На двоих» быть НЕ ДОЛЖНО (его может второй), и только потом
     оно обязано появиться, когда его снимут у всех. */
  const doZapreta = await admin.innerText('main.ad');
  chk('пока тариф кому-то разрешён, предупреждения нет',
    !/никто не может выполнить/.test(doZapreta));
  /* ⚠️ СНИМАТЬ НАДО У ВСЕХ ДЕЙСТВУЮЩИХ ОПЕРАТОРОВ, А НЕ У ДВОИХ
     НАШИХ. Предупреждение по построению считается по живым
     операторам, а в базе к этому моменту есть и третий — тот,
     на котором шла проверка истории работы. Оставь мы его
     с полными правами, предупреждение не появилось бы, и это
     было бы верным поведением, а не поломкой. */
  const zhivye = await p2.query(
    `select id from staff where role = 'operator' and not disabled order by id`,
  );
  for (const r of zhivye.rows) await zadatTarify(Number(r.id), []);
  await admin.goto(`http://localhost:${PORT}/admin/staff/`, { waitUntil: 'networkidle' });
  const sZapretom = await admin.innerText('main.ad');
  chk('«этот тариф сейчас никто не может выполнить» появилось',
    /Этот тариф сейчас никто не может выполнить/.test(sZapretom),
    sZapretom.replace(/\s+/g, ' ').match(/Этот тариф[^\n]{0,60}/)?.[0] ?? 'нет');

  /* ── 9. АНГЛИЙСКАЯ АДМИНКА ─────────────────────────────────────── */
  await nazhat(admin, '.ad__lang-btn[value="en"]');
  await admin.goto(`http://localhost:${PORT}/admin/staff/`, { waitUntil: 'networkidle' });
  const staffEn = await admin.innerText('main.ad');
  chk('в английской админке тарифы операторов подписаны по-английски',
    /Operator plans/.test(staffEn) && /Nobody can fulfil this plan/.test(staffEn) &&
      !/Тарифы оператора/.test(staffEn) && !/никто не может выполнить/.test(staffEn),
    staffEn.replace(/\s+/g, ' ').match(/Operator plans|Тарифы оператора/)?.[0] ?? 'ни одного');
  await nazhat(admin, '.ad__lang-btn[value="ru"]');

  /* ⚠️ ВОЗВРАЩАЕМ ИМЯ И ЦЕНУ КАК БЫЛИ. Это настройка, она переживает
     конец прогона, и оставленное переименование роняет СЛЕДУЮЩИЙ
     прогон на ровном месте: он ищет в админке «Duo», а там стоит наше
     «Duo renamed». Проверено настоящим падением. */
  await admin.goto(`http://localhost:${PORT}/admin/settings/`, { waitUntil: 'networkidle' });
  const vernut = admin
    .locator('form')
    .filter({ has: admin.locator('input[name="plan"][value="duo"]') })
    .filter({ has: admin.locator('input[name="nameEn"]') })
    .first();
  await vernut.locator('input[name="name"]').fill('');
  await vernut.locator('input[name="short"]').fill('');
  await vernut.locator('input[name="nameEn"]').fill('');
  await vernut.locator('button[type="submit"]').click();
  await admin.waitForLoadState('networkidle');
  await admin.waitForTimeout(900);
  const vernuli = await p2.query(`select count(*)::int as n from plan_name where plan_id = 'duo'`);
  chk('имя тарифа возвращено как было', vernuli.rows[0].n === 0, String(vernuli.rows[0].n));

  await op1.close();
  await op2.close();
}

chk('ни одной ошибки JavaScript', oshibkiJS.length === 0, oshibkiJS.slice(0, 3).join(' | '));

await p2.end();
await browser.close();
server.close();
console.log(bad ? `\nПРОВАЛ: ${bad} проверок не прошло` : '\nМАГАЗИН РАБОТАЕТ: заказ, оплата, выдача, сертификат');
process.exit(bad ? 1 : 0);

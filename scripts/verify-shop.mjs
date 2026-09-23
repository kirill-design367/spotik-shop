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
await pool.query(`truncate balance_move, payment, order_slot, certificate, shop_order,
  session, login_code, app_user, staff, plan_price, setting restart identity cascade`);
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

await voyti(klient, KLIENT, '/checkout/?plan=duo&period=12&mode=new');
chk('вход по коду из письма', klient.url().includes('/checkout/'), klient.url().replace(`http://localhost:${PORT}`, ''));

// Второй участник — на продление: там принимается чужой пароль.
await klient.click('text=Участник 2 >> xpath=following::button[normalize-space()="Продлить существующий"][1]').catch(async () => {
  const knopki = await klient.$$('button[role="radio"]');
  await knopki[knopki.length - 1].click();
});
await klient.fill('input[name="login1"]', 'moy@akkaunt.test');
await klient.fill('input[name="password1"]', 'ochen-tayny-parol');
await klient.check('input[name="consent"]');
await nazhat(klient, 'button[type="submit"]');
chk('заказ создан и ведёт на оплату', klient.url().includes('/pay/test/'), klient.url().replace(`http://localhost:${PORT}`, ''));

await nazhat(klient, 'button[type="submit"]');
chk('после оплаты мы в кабинете', klient.url().includes('/cabinet/'));
const telo1 = await klient.textContent('body');
chk('заказ помечен оплаченным', /Оплачен, ждёт оператора/.test(telo1 ?? ''));

console.log('── ПАРОЛЬ КЛИЕНТА НЕ ЛЕЖИТ ОТКРЫТЫМ ТЕКСТОМ ──');
const p2 = new pg.Pool({ connectionString: URL_BAZY, max: 1 });
const sy = await p2.query('select in_password_enc from order_slot where in_password_enc is not null');
chk(
  'в базе шифротекст, а не пароль',
  sy.rows.length === 1 && !sy.rows[0].in_password_enc.includes('ochen-tayny-parol') && sy.rows[0].in_password_enc.startsWith('v1.'),
  sy.rows[0]?.in_password_enc.slice(0, 18) + '…',
);
chk('пароля нет в журнале сервера', !server.zhurnal().includes('ochen-tayny-parol'));

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

await admin.fill('input[name="login"]', 'novyy@pochta.test');
await admin.fill('input[name="mailPass"]', 'pochta-123');
await admin.fill('input[name="spotifyPass"]', 'spotify-456');
await nazhat(admin, 'button:has-text("Сохранить доступы")');
await nazhat(admin, 'button:has-text("Premium включён")');
await nazhat(admin, 'button:has-text("Отметить весь заказ")');
const posle = await admin.textContent('body');
/* ⚠️ `\s*`, А НЕ ПРОБЕЛ: подпись и значение стоят соседними `dt`
   и `dd`, и между ними в `textContent` нет ни одного знака. */
chk('заказ закрыт', /Заказ закрыт/.test(posle ?? '') && /Состояние\s*выполнен/.test((posle ?? '').replace(/\s+/g, ' ')));

await klient.reload({ waitUntil: 'networkidle' });
const telo2 = await klient.textContent('body');
chk('кабинет показывает выданные доступы', /novyy@pochta\.test/.test(telo2 ?? '') && /spotify-456/.test(telo2 ?? ''));
chk('заказ в кабинете «Готов»', /Готов/.test(telo2 ?? ''));

console.log('── TELEGRAM НЕ ОТВЕТИЛ: ОПЛАТА ЦЕЛА, УВЕДОМЛЕНИЕ В ОЧЕРЕДИ ──');
const ochered2 = await p2.query(
  'select vid, tekst, popytok, sent_at, sleduyushchaya_v > now() as pozzhe from notify_outbox order by id',
);
const oplachen = ochered2.rows.find((r) => r.vid === 'zakaz_oplachen');
const zakryt = ochered2.rows.find((r) => r.vid === 'zakaz_zakryt');
chk('оплата прошла, хотя Telegram недоступен', ochered2.rows.length > 0 && bad === 0);
chk(
  'уведомление об оплате легло в очередь',
  Boolean(oplachen) && /Новый оплаченный заказ № 1/.test(oplachen?.tekst ?? ''),
);
chk(
  'в уведомлении тариф, срок, число участников и ссылка в админку',
  /На двоих/.test(oplachen?.tekst ?? '') &&
    /год/.test(oplachen?.tekst ?? '') &&
    /Участников: 2/.test(oplachen?.tekst ?? '') &&
    /\/admin\/orders\/1\//.test(oplachen?.tekst ?? ''),
  (oplachen?.tekst ?? '').replace(/\n/g, ' · '),
);
chk('уведомление о выполнении называет исполнителя', /Исполнитель: admin@spotik\.test/.test(zakryt?.tekst ?? ''));
/* ⚠️ ПОПЫТОК МОЖЕТ БЫТЬ УЖЕ НЕ ОДНА, И ЭТО НОРМА: минутный будильник
   очереди успевает сработать за время прогона. Проверяется не число,
   а состояние — не отправлено и назначено на ПОЗЖЕ. */
chk(
  'не отправлено и назначен повтор',
  Number(oplachen?.popytok) >= 1 && oplachen?.sent_at === null && oplachen?.pozzhe === true,
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
await drug.fill('input[name="login1"]', 'drug@akkaunt.test');
await drug.fill('input[name="password1"]', 'drugoy-tayny-parol');
await drug.check('input[name="consent"]');
await nazhat(drug, 'button:has-text("Активировать")');
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
  'пароль второго участника в базе шифротекстом',
  parolDruga.rows.length === 1 && parolDruga.rows[0].in_password_enc.startsWith('v1.') && !parolDruga.rows[0].in_password_enc.includes('drugoy-tayny-parol'),
);
chk('пароля из сертификата нет в журнале', !server.zhurnal().includes('drugoy-tayny-parol'));

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

chk('ни одной ошибки JavaScript', oshibkiJS.length === 0, oshibkiJS.slice(0, 3).join(' | '));

await p2.end();
await browser.close();
server.close();
console.log(bad ? `\nПРОВАЛ: ${bad} проверок не прошло` : '\nМАГАЗИН РАБОТАЕТ: заказ, оплата, выдача, сертификат');
process.exit(bad ? 1 : 0);

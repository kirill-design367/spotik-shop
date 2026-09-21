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

async function voyti(page, pochta, kuda) {
  await page.goto(`http://localhost:${PORT}${kuda}`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', pochta);
  await page.click('button[type="submit"]');
  await page.waitForSelector('input[name="code"]', { timeout: 15000 });
  const kod = await kodIzZhurnala(pochta);
  if (!kod) {
    console.log('--- журнал сервера ---\n' + server.zhurnal().slice(-3000) + '\n--- конец ---');
    throw new Error(`кода для ${pochta} нет в журнале`);
  }
  await page.fill('input[name="code"]', kod);
  await nazhat(page, 'button[type="submit"]');
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
chk('заказ виден в очереди', /Order queue/.test(ochered ?? '') && /На двоих/.test(ochered ?? ''));

await nazhat(admin, 'button:has-text("Take")');
chk('заказ взят и открылся', /\/admin\/orders\//.test(admin.url()), admin.url().replace(`http://localhost:${PORT}`, ''));
const karta = await admin.textContent('body');
chk('оператору виден пароль клиента', /ochen-tayny-parol/.test(karta ?? ''));

await admin.fill('input[name="login"]', 'novyy@pochta.test');
await admin.fill('input[name="mailPass"]', 'pochta-123');
await admin.fill('input[name="spotifyPass"]', 'spotify-456');
await nazhat(admin, 'button:has-text("Save credentials")');
await nazhat(admin, 'button:has-text("Premium is on")');
await nazhat(admin, 'button:has-text("Mark the whole order done")');
const posle = await admin.textContent('body');
chk('заказ закрыт', /Order is closed/.test(posle ?? '') && /State\s*done/.test((posle ?? '').replace(/\s+/g, ' ')));

await klient.reload({ waitUntil: 'networkidle' });
const telo2 = await klient.textContent('body');
chk('кабинет показывает выданные доступы', /novyy@pochta\.test/.test(telo2 ?? '') && /spotify-456/.test(telo2 ?? ''));
chk('заказ в кабинете «Готов»', /Готов/.test(telo2 ?? ''));

console.log('── СЕРТИФИКАТ ──');
await admin.goto(`http://localhost:${PORT}/admin/settings/`, { waitUntil: 'networkidle' });
const stroki = await admin.$$('tbody tr');
for (const tr of stroki) {
  const t = (await tr.textContent()) ?? '';
  if (t.includes('Сертификат') && t.includes('Год')) {
    await tr.$eval('input[name="price"]', (el) => ((el).value = '1990'));
    await tr.$eval('button', (b) => b.click());
    await admin.waitForLoadState('networkidle');
    await admin.waitForTimeout(400);
    break;
  }
}
const ceny = await admin.textContent('body');
chk('цена сертификата сохранена', /Price saved/.test(ceny ?? ''));

await klient.goto(`http://localhost:${PORT}/checkout/?plan=gift&period=12`, { waitUntil: 'networkidle' });
await klient.check('input[name="consent"]');
await nazhat(klient, 'button[type="submit"]');
await nazhat(klient, 'button[type="submit"]');
const telo3 = await klient.textContent('body');
const kodSert = (telo3 ?? '').match(/SPOTIK-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/)?.[0] ?? '';
chk('сертификат выдан и код виден в кабинете', Boolean(kodSert), kodSert);

const p3 = await p2.query('select code_hash, code_enc from certificate');
chk('кода сертификата нет в базе открытым текстом', p3.rows.length === 1 && !p3.rows[0].code_enc.includes(kodSert) && p3.rows[0].code_enc.startsWith('v1.'));

const drug = await browser.newPage({ viewport: { width: 1280, height: 900 } });
drug.on('pageerror', (e) => oshibkiJS.push(String(e.message)));
await voyti(drug, DARENYY, '/certificate/');
await drug.fill('input[name="code"]', kodSert);
await nazhat(drug, 'button:has-text("Проверить код")');
await drug.check('input[name="consent"]');
await nazhat(drug, 'button:has-text("Активировать")');
chk('сертификат активирован, заказ в кабинете', drug.url().includes('/cabinet/'), drug.url().replace(`http://localhost:${PORT}`, ''));
const teloD = await drug.textContent('body');
chk('заказ по сертификату сразу у оператора', /Оплачен, ждёт оператора/.test(teloD ?? ''));

await drug.goto(`http://localhost:${PORT}/certificate/`, { waitUntil: 'networkidle' });
await drug.fill('input[name="code"]', kodSert);
await nazhat(drug, 'button:has-text("Проверить код")');
const povtor = await drug.textContent('body');
chk('код одноразовый', /уже активирован/.test(povtor ?? ''));

console.log('── ОПЛАТА ПОДТВЕРЖДАЕТСЯ ТОЛЬКО УВЕДОМЛЕНИЕМ ──');
const otvet = await fetch(`http://localhost:${PORT}/api/pay/result/`, { method: 'POST' });
chk('уведомление без подписи отвергнуто', otvet.status === 400, `статус ${otvet.status}`);

const baz = await p2.query(`select status, balance_kop, money_kop from shop_order order by id`);
chk('суммы разложены по заказу', baz.rows[0].money_kop !== '0', `картой ${baz.rows[0].money_kop} коп.`);

console.log('── ОТМЕНА ВОЗВРАЩАЕТ ДЕНЬГИ НА БАЛАНС ──');
// Берём заказ по сертификату и отменяем его: денег там нет, зато
// проверяется, что сертификат оживает.
await admin.goto(`http://localhost:${PORT}/admin/`, { waitUntil: 'networkidle' });
await nazhat(admin, 'button:has-text("Take")');
await admin.fill('input[name="reason"]', 'Проверка отмены');
await nazhat(admin, 'button:has-text("Cancel order")');
const otmena = await admin.textContent('body');
chk('заказ отменён', /Order is cancelled/.test(otmena ?? ''));
const sert2 = await p2.query('select used_at from certificate');
chk('сертификат снова годен', sert2.rows[0].used_at === null);

chk('ни одной ошибки JavaScript', oshibkiJS.length === 0, oshibkiJS.slice(0, 3).join(' | '));

await p2.end();
await browser.close();
server.close();
console.log(bad ? `\nПРОВАЛ: ${bad} проверок не прошло` : '\nМАГАЗИН РАБОТАЕТ: заказ, оплата, выдача, сертификат');
process.exit(bad ? 1 : 0);

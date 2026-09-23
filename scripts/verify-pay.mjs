/**
 * ПРОВЕРКА ПРИЁМА ОПЛАТЫ: подпись Робокассы и единственная дверь.
 *
 * Живого магазина Робокассы у проекта пока нет, но проверить можно
 * ровно то, что от него зависит, — НАШУ сторону протокола. Сервер
 * поднимается с тестовыми паролями, заказ создаётся через браузер,
 * а уведомление мы шлём сами, подписывая его так, как подписала бы
 * Робокасса.
 *
 * Что здесь доказывается:
 *   • подпись паролем №2 принимается, и заказ становится оплаченным;
 *   • подпись паролем №1 (тем, что уезжает в браузер человека)
 *     НЕ принимается — иначе «оплачено» мог бы сказать кто угодно,
 *     кто хоть раз видел ссылку на оплату;
 *   • старый набор имён (`out_summ`/`inv_id`/`crc`) тоже работает;
 *   • сумма с шестью знаками после точки читается: живая Робокасса
 *     присылала `1.000000`, и строгая проверка отвергла настоящий
 *     платёж при списанных деньгах;
 *   • недоплата оплатой не считается;
 *   • повтор уведомления ничего не ломает — Робокасса повторяет его,
 *     пока не получит `OK<номер>`;
 *   • возврат человека на страницу успеха НИЧЕГО не подтверждает.
 *
 * ⚠️ БОЕВАЯ ПОДПИСЬ ПРОВЕРЯЕТСЯ ОТДЕЛЬНЫМ СЕРВЕРОМ, и это вторая
 * половина скрипта. Поднимается ВТОРОЕ приложение — с `ROBOKASSA_TEST=0`,
 * боевой парой паролей и НЕ-MD5 алгоритмом у ResultURL, — и на нём
 * доказывается:
 *   • ссылка на оплату в боевом режиме идёт БЕЗ `IsTest=1`
 *     и подписана БОЕВЫМ паролем №1;
 *   • уведомление, подписанное ТЕСТОВЫМ паролем №2, отвергается:
 *     режим меняет не только флажок, но и пару паролей;
 *   • алгоритм хеша берётся ИЗ НАСТРОЙКИ, а не зашит: та же подпись
 *     по md5 отвергается, по sha256 принимается;
 *   • незаданный алгоритм работает по md5 — так подписана ссылка.
 *
 * Нужна живая база: `DATABASE_URL`. Без неё скрипт пропускается.
 */
import { createHash } from 'node:crypto';
import { launch } from './browser.mjs';
import { serveOut } from './serve-out.mjs';
import pg from 'pg';
import { execFileSync } from 'node:child_process';

const URL_BAZY = process.env.DATABASE_URL || '';
if (!URL_BAZY) {
  console.log('DATABASE_URL не задан — проверка оплаты пропущена');
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

const PORT = 4182;
const PORT_BOY = 4183;
const LOGIN = 'spotik-test';
const P1 = 'test-parol-odin';
const P2 = 'test-parol-dva';
/* Боевая пара — ДРУГИЕ строки, и это весь смысл проверки: режим
   переключает не флажок `IsTest`, а пароли. */
const B1 = 'boy-parol-odin';
const B2 = 'boy-parol-dva';
const KLIENT = 'payer@spotik.test';

/* ⚠️ СХЕМУ НАКАТЫВАЕМ САМИ. Сторож должен работать на ПУСТОЙ базе:
   в CI она поднимается сервисом и таблиц в ней нет вовсе, а забытая
   строка `node scripts/migrate.mjs` в workflow даёт отказ, который
   читается как «сломан магазин», хотя сломана подготовка. */
execFileSync(process.execPath, ['scripts/migrate.mjs'], { stdio: 'inherit', env: process.env });

const pool = new pg.Pool({ connectionString: URL_BAZY, max: 1 });
await pool.query(`truncate balance_move, payment, order_slot, certificate, shop_order,
  session, login_code, app_user, staff, plan_price, setting restart identity cascade`);

const server = await serveOut(PORT, {
  env: {
    DATABASE_URL: URL_BAZY,
    SPOTIK_CRYPTO_KEY: Buffer.from('spotik-proverka-klyuch-32-bayta!').toString('base64'),
    SPOTIK_SITE_URL: `http://localhost:${PORT}`,
    ROBOKASSA_TEST: '1',
    ROBOKASSA_LOGIN: LOGIN,
    ROBOKASSA_TEST_PASS1: P1,
    ROBOKASSA_TEST_PASS2: P2,
    ROBOKASSA_ALGO: 'md5',
    // Имитатор обязан молчать, когда настоящий магазин настроен.
    SPOTIK_FAKE_PAY_SECRET: 'proverka',
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

const hesh = (algo, s) => createHash(algo).update(s, 'utf8').digest('hex');
const md5 = (s) => hesh('md5', s);
const poslatNa = async (port, pary) => {
  const b = new URLSearchParams(pary);
  const r = await fetch(`http://localhost:${port}/api/pay/result/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: b,
  });
  return { status: r.status, telo: (await r.text()).trim() };
};
const poslat = (pary) => poslatNa(PORT, pary);

/**
 * Разбор ссылки на оплату.
 *
 * ⚠️ РУКАМИ, А НЕ `URLSearchParams`. В подпись идёт РАСКОДИРОВАННЫЙ
 * чек, а в строке он лежит закодированным ровно один раз (Р-88);
 * разобрав ссылку готовым разборщиком, мы получили бы чек, который
 * уже никак не отличить от дважды закодированного.
 */
function razobratSsylku(url) {
  const pary = {};
  for (const kusok of url.slice(url.indexOf('?') + 1).split('&')) {
    const i = kusok.indexOf('=');
    pary[kusok.slice(0, i)] = kusok.slice(i + 1);
  }
  return pary;
}
const statusZakaza = async (id) =>
  (await pool.query('select status from shop_order where id = $1', [id])).rows[0]?.status;

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
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

/* Ссылку на оплату снимаем С ПЕРЕХОДА БРАУЗЕРА, а не собираем сами:
   сети до auth.robokassa.ru нет и переход оборвётся, но запрос
   к тому моменту уже случился — и в нём ровно то, что увидела бы
   Робокасса. Собери мы её тем же кодом, что и сайт, проверка
   пользовалась бы моделью предмета (Р-47). */
let posledniyaSsylka = '';
page.on('request', (r) => {
  if (r.url().startsWith('https://auth.robokassa.ru/')) posledniyaSsylka = r.url();
});

async function novyZakaz(plan, period, port = PORT) {
  posledniyaSsylka = '';
  await page.goto(`http://localhost:${port}/checkout/?plan=${plan}&period=${period}`, { waitUntil: 'networkidle' });
  if (await page.$('input[name="email"]')) {
    await page.fill('input[name="email"]', KLIENT);
    await page.click('button[type="submit"]');
    const kodovoe = page.locator('input[autocomplete="one-time-code"]');
    await kodovoe.waitFor({ state: 'visible', timeout: 15000 });
    await kodovoe.fill(await kodIzZhurnala(KLIENT));
    await page.locator('form').filter({ has: kodovoe }).first().locator('button[type="submit"]').click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(400);
  }
  await page.check('input[name="consent"]');
  await page.click('button[type="submit"]');
  // Робокасса настроена, значит уходим на её адрес — сети до неё нет,
  // и переход оборвётся. Это нормально: счёт уже выставлен.
  await page.waitForTimeout(2500);
  const r = await pool.query('select id, order_id, amount_kop from payment order by id desc limit 1');
  return r.rows[0];
}

console.log('── ССЫЛКА НА ОПЛАТУ ──');
const p1 = await novyZakaz('solo', 12);
chk('счёт выставлен', Boolean(p1), p1 ? `платёж ${p1.id} на ${p1.amount_kop} коп.` : '');
chk('сумма счёта равна цене тарифа', p1 && Number(p1.amount_kop) === 269000, `${p1?.amount_kop} коп.`);
{
  const q = razobratSsylku(posledniyaSsylka);
  const chekJson = decodeURIComponent(q.Receipt ?? '');
  chk('браузер ушёл на Робокассу', posledniyaSsylka.startsWith('https://auth.robokassa.ru/'), posledniyaSsylka.slice(0, 60));
  chk('в тестовом режиме стоит IsTest=1', q.IsTest === '1');
  chk('номер счёта в ссылке — это payment.id', q.InvId === String(p1.id), q.InvId);
  chk(
    'ссылка подписана ТЕСТОВЫМ паролем №1',
    q.SignatureValue === md5(`${LOGIN}:${q.OutSum}:${q.InvId}:${chekJson}:${P1}`),
  );
  chk('чек в подписи РАСКОДИРОВАННЫЙ', chekJson.startsWith('{"items"'), chekJson.slice(0, 40));
}

console.log('── УВЕДОМЛЕНИЕ ──');
const sum = (Number(p1.amount_kop) / 100).toFixed(2);

let r = await poslat({ OutSum: sum, InvId: String(p1.id), SignatureValue: md5(`${sum}:${p1.id}:${P1}`) });
chk('подпись ПАРОЛЕМ №1 отвергнута', r.status === 400, `статус ${r.status}`);
chk('заказ остался неоплаченным', (await statusZakaza(p1.order_id)) === 'new');

r = await poslat({ OutSum: sum, InvId: String(p1.id), SignatureValue: md5(`${sum}:${p1.id}:чужой`) });
chk('чужая подпись отвергнута', r.status === 400, `статус ${r.status}`);

const menshe = (Number(p1.amount_kop) / 100 - 1).toFixed(2);
r = await poslat({ OutSum: menshe, InvId: String(p1.id), SignatureValue: md5(`${menshe}:${p1.id}:${P2}`) });
chk('недоплата принята протоколом, но заказ не оплачен', r.status === 200 && (await statusZakaza(p1.order_id)) === 'new', `статус ${r.status}`);

r = await poslat({ OutSum: sum, InvId: String(p1.id), SignatureValue: md5(`${sum}:${p1.id}:${P2}`) });
chk('верная подпись принята', r.status === 200 && r.telo === `OK${p1.id}`, r.telo);
chk('заказ стал оплаченным', (await statusZakaza(p1.order_id)) === 'paid');

r = await poslat({ OutSum: sum, InvId: String(p1.id), SignatureValue: md5(`${sum}:${p1.id}:${P2}`) });
chk('повтор уведомления не ломает ничего', r.status === 200 && (await statusZakaza(p1.order_id)) === 'paid');

console.log('── СТАРЫЙ НАБОР ИМЁН И ШЕСТЬ ЗНАКОВ ПОСЛЕ ТОЧКИ ──');
const p2 = await novyZakaz('solo', 1);
const sum6 = (Number(p2.amount_kop) / 100).toFixed(6);
r = await poslat({ out_summ: sum6, inv_id: String(p2.id), crc: md5(`${sum6}:${p2.id}:${P2}`) });
chk('старый набор имён принят', r.status === 200 && r.telo === `OK${p2.id}`, `${r.status} ${r.telo}`);
chk('сумма с шестью знаками прочитана', (await statusZakaza(p2.order_id)) === 'paid', sum6);

console.log('── ВОЗВРАТ ЧЕЛОВЕКА НИЧЕГО НЕ ПОДТВЕРЖДАЕТ ──');
const p3 = await novyZakaz('solo', 3);
const sum3 = (Number(p3.amount_kop) / 100).toFixed(2);
await page.goto(
  `http://localhost:${PORT}/pay/ok/?OutSum=${sum3}&InvId=${p3.id}&SignatureValue=${md5(`${sum3}:${p3.id}:${P1}`)}`,
  { waitUntil: 'networkidle' },
);
const telo = await page.textContent('body');
chk('страница успеха не объявляет заказ оплаченным', !/Оплата подтверждена/.test(telo ?? ''));
chk('заказ по-прежнему не оплачен', (await statusZakaza(p3.order_id)) === 'new', await statusZakaza(p3.order_id));

console.log('── ИМИТАТОР ВЫКЛЮЧЕН НА НАСТОЯЩИХ КЛЮЧАХ ──');
const im = await fetch(`http://localhost:${PORT}/api/pay/fake/?secret=proverka&payment=${p3.id}`, { method: 'POST' });
chk('путь имитатора не существует', im.status === 404, `статус ${im.status}`);
/* Дверей у имитатора две: служебный путь и страница с кнопкой.
   Закрыта обязана быть и вторая, и закрыта НАСТОЯЩИМ отказом —
   страница со словами «не найдено» отвечает двести, и снаружи её
   от живой не отличить. Ровно этим и проверяется боевой сервер. */
const ims = await fetch(`http://localhost:${PORT}/pay/test/?payment=${p3.id}`);
chk('страницы тестовой оплаты нет', ims.status === 404, `статус ${ims.status}`);

/*
 * ── БОЕВОЙ РЕЖИМ ──────────────────────────────────────────────────
 *
 * Второй сервер поднимается с `ROBOKASSA_TEST=0` и ОБЕИМИ парами
 * паролей сразу: тестовая в окружении есть, и если бы режим менял
 * только флажок `IsTest`, подпись тестовым паролем №2 прошла бы.
 *
 * ⚠️ У RESULT URL ЗДЕСЬ SHA-256, А У ССЫЛКИ АЛГОРИТМ НЕ ЗАДАН ВОВСЕ.
 * Это и есть проверка требования «алгоритм задаётся настройкой,
 * а не задан — работаем по md5»: ссылка обязана сойтись по md5,
 * уведомление — по sha256, и оба числа берутся из РАЗНЫХ настроек.
 *
 * Кука сессии не знает о порте, а база одна на оба сервера, поэтому
 * входить заново не нужно: человек тот же самый.
 */
console.log('── БОЕВОЙ РЕЖИМ: ДРУГАЯ ПАРА ПАРОЛЕЙ ──');
const boy = await serveOut(PORT_BOY, {
  env: {
    DATABASE_URL: URL_BAZY,
    SPOTIK_CRYPTO_KEY: Buffer.from('spotik-proverka-klyuch-32-bayta!').toString('base64'),
    SPOTIK_SITE_URL: `http://localhost:${PORT_BOY}`,
    ROBOKASSA_TEST: '0',
    ROBOKASSA_LOGIN: 'spotikshop',
    ROBOKASSA_PASS1: B1,
    ROBOKASSA_PASS2: B2,
    // Тестовая пара нарочно оставлена: она НЕ должна сработать.
    ROBOKASSA_TEST_PASS1: P1,
    ROBOKASSA_TEST_PASS2: P2,
    ROBOKASSA_ALGO_RESULT: 'sha256',
    SPOTIK_FAKE_PAY_SECRET: 'proverka',
  },
});

const pb = await novyZakaz('solo', 12, PORT_BOY);
chk('счёт выставлен на боевых ключах', Boolean(pb), pb ? `платёж ${pb.id}` : '');
{
  const q = razobratSsylku(posledniyaSsylka);
  const chekJson = decodeURIComponent(q.Receipt ?? '');
  chk('в боевом режиме IsTest в ссылке нет вовсе', q.IsTest === undefined, q.IsTest ?? 'нет');
  chk('в ссылке боевой логин магазина', q.MerchantLogin === 'spotikshop', q.MerchantLogin);
  chk(
    'ссылка подписана БОЕВЫМ паролем №1 по md5 (алгоритм не задан)',
    q.SignatureValue === md5(`spotikshop:${q.OutSum}:${q.InvId}:${chekJson}:${B1}`),
  );
  chk(
    'тем же местом ТЕСТОВЫЙ пароль №1 уже не подходит',
    q.SignatureValue !== md5(`spotikshop:${q.OutSum}:${q.InvId}:${chekJson}:${P1}`),
  );
}

const sumB = (Number(pb.amount_kop) / 100).toFixed(2);
r = await poslatNa(PORT_BOY, { OutSum: sumB, InvId: String(pb.id), SignatureValue: hesh('sha256', `${sumB}:${pb.id}:${P2}`) });
chk('ТЕСТОВЫЙ пароль №2 в боевом режиме отвергнут', r.status === 400, `статус ${r.status}`);

r = await poslatNa(PORT_BOY, { OutSum: sumB, InvId: String(pb.id), SignatureValue: md5(`${sumB}:${pb.id}:${B2}`) });
chk('боевой пароль №2, но md5 вместо sha256 — отвергнут', r.status === 400, `статус ${r.status}`);
chk('заказ остался неоплаченным', (await statusZakaza(pb.order_id)) === 'new');

r = await poslatNa(PORT_BOY, { OutSum: sumB, InvId: String(pb.id), SignatureValue: hesh('sha256', `${sumB}:${pb.id}:${B2}`) });
chk('БОЕВАЯ подпись по sha256 принята', r.status === 200 && r.telo === `OK${pb.id}`, `${r.status} ${r.telo}`);
chk('заказ стал оплаченным', (await statusZakaza(pb.order_id)) === 'paid');

const imB = await fetch(`http://localhost:${PORT_BOY}/api/pay/fake/?secret=proverka&payment=${pb.id}`, { method: 'POST' });
chk('имитатора нет и на боевых ключах', imB.status === 404, `статус ${imB.status}`);

await pool.end();
await browser.close();
boy.close();
server.close();
console.log(bad ? `\nПРОВАЛ: ${bad} проверок не прошло` : '\nОПЛАТА: подпись проверяется, дверь одна');
process.exit(bad ? 1 : 0);

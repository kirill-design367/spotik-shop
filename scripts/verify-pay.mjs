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
const LOGIN = 'spotik-test';
const P1 = 'test-parol-odin';
const P2 = 'test-parol-dva';
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

const md5 = (s) => createHash('md5').update(s, 'utf8').digest('hex');
const poslat = async (pary) => {
  const b = new URLSearchParams(pary);
  const r = await fetch(`http://localhost:${PORT}/api/pay/result/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: b,
  });
  return { status: r.status, telo: (await r.text()).trim() };
};
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

async function novyZakaz(plan, period) {
  await page.goto(`http://localhost:${PORT}/checkout/?plan=${plan}&period=${period}`, { waitUntil: 'networkidle' });
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

await pool.end();
await browser.close();
server.close();
console.log(bad ? `\nПРОВАЛ: ${bad} проверок не прошло` : '\nОПЛАТА: подпись проверяется, дверь одна');
process.exit(bad ? 1 : 0);

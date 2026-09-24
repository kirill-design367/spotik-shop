/**
 * СЧЁТЧИК СТОИТ ТАМ, ГДЕ РАЗРЕШЕНО, И НЕ СТОИТ ТАМ, ГДЕ ЗАПРЕЩЕНО.
 *
 * Постановка про Метрику состоит из двух половин, и вторая важнее
 * первой: счётчика НЕ ДОЛЖНО БЫТЬ в кабинете и в админке, потому что
 * вебвизор пишет страницу целиком, а там лежат выданные пароли
 * от чужих аккаунтов Spotify и почта клиента (закон 35, Р-87).
 *
 * ⚠️ СУДИМ ПО ЖИВОЙ СТРАНИЦЕ, А НЕ ПО НАШЕЙ ЖЕ МОДЕЛИ (Р-47).
 * Функция `schyotchikUmesten` — это и есть модель предмета: спроси
 * сторож её, и дырка в ней спряталась бы от него по построению.
 * Поэтому сторож открывает страницу браузером и смотрит, что
 * в ней НАРИСОВАНО: есть ли `window.ym`, ушёл ли запрос
 * к `mc.yandex.ru`, встречается ли номер счётчика в разметке.
 *
 * ⚠️ И ОТДЕЛЬНО — ЧТО СЧЁТЧИК ГРУЗИТСЯ ПОСЛЕ `load`. Это не про
 * аккуратность, а про планку: PageSpeed 95 на мобильной держится
 * ровно тем, что чужой скрипт не отнимает главный поток в те
 * миллисекунды, за которые считают LCP и TBT.
 */
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';
import { execFileSync } from 'node:child_process';

const PORT = 4293;
const SCHYOTCHIK = '113005479';
const BAZA = process.env.DATABASE_URL || 'postgres://spotik:spotik@localhost:5432/spotik';

/* Схема нужна, чтобы оформление показало форму, а не «сервис
   недоступен». Сторож при этом НИЧЕГО НЕ ПИШЕТ в базу — он только
   открывает страницы, — и потому уживается рядом со сквозными
   проверками, которые таблицы очищают. */
execFileSync(process.execPath, ['scripts/migrate.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: BAZA },
});

const server = await serveOut(PORT, { env: { DATABASE_URL: BAZA } });
const browser = await launch();
let bad = 0;

const chk = (chto, uslovie, chem = '') => {
  if (uslovie) console.log(`  OK   ${chto}${chem ? `  ${chem}` : ''}`);
  else {
    console.log(`  СБОЙ ${chto}${chem ? `  ${chem}` : ''}`);
    bad += 1;
  }
};

const adres = (p) => `http://localhost:${PORT}${PREFIX}${p}`;

/**
 * Открыть страницу так, как её увидит человек, и вернуть всё, что
 * сторожу нужно знать о счётчике.
 *
 * ⚠️ ЗАПРОС К `mc.yandex.ru` ПЕРЕХВАТЫВАЕТСЯ И ОТВЕЧАЕТСЯ ПУСТЫМ
 * СКРИПТОМ. Настоящая библиотека сюда всё равно не доедет — сети
 * наружу в среде нет, — а ждать её падения значило бы ждать таймаут
 * на каждой странице. Заодно перехват и отвечает на главный вопрос:
 * ушёл ли запрос ПОСЛЕ события `load`.
 */
async function otkryt(put, kontekst = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, ...kontekst });
  await page.addInitScript(() => {
    window.__byloLoad = false;
    addEventListener('load', () => {
      window.__byloLoad = true;
    });
  });
  await page.route('**/mc.yandex.ru/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'window.__tagPosleLoad = window.__byloLoad === true; window.__tagPrishyol = true;',
    }),
  );
  await page.goto(adres(put), { waitUntil: 'networkidle' });
  const html = await page.content();
  const d = await page.evaluate(() => ({
    ym: typeof window.ym,
    ochered: JSON.stringify([...((window.ym && window.ym.a) || [])].map((a) => [...a])),
    prishyol: window.__tagPrishyol === true,
    posleLoad: window.__tagPosleLoad === true,
    sloy: typeof window.dataLayer,
    tegov: [...document.scripts].filter((s) => s.src.includes('mc.yandex.ru')).length,
  }));
  return { page, html, ...d };
}

console.log('ЯНДЕКС МЕТРИКА: где счётчик есть и где его нет.\n');

console.log('── ПУБЛИЧНЫЕ СТРАНИЦЫ: СЧЁТЧИК ЕСТЬ ──');
{
  const r = await otkryt('/');
  chk('лендинг: очередь счётчика заведена', r.ym === 'function');
  chk('лендинг: счётчик поднялся', r.prishyol && r.tegov === 1);
  chk('лендинг: библиотека пришла ПОСЛЕ load', r.posleLoad);
  chk('номер счётчика тот самый', r.ochered.includes(SCHYOTCHIK), SCHYOTCHIK);
  for (const [imya, znachenie] of [
    ['ssr', 'true'],
    ['webvisor', 'true'],
    ['clickmap', 'true'],
    ['ecommerce', '"dataLayer"'],
    ['accurateTrackBounce', 'true'],
    ['trackLinks', 'true'],
  ]) {
    chk(`параметр ${imya}`, new RegExp(`${imya}\\s*:\\s*${znachenie.replace(/"/g, '"')}`).test(r.html), znachenie);
  }
  await r.page.close();
}
{
  const r = await otkryt('/oferta/');
  chk('оферта: счётчик есть', r.ym === 'function' && r.tegov === 1);
  chk('оферта: про Метрику в тексте сказано', /Яндекс Метрика/.test(r.html));
  await r.page.close();
}

console.log('\n── ЦЕЛИ ──');
{
  const r = await otkryt('/checkout/?plan=solo&period=12');
  chk('оформление: цель «начато оформление» отправлена', r.ochered.includes('oformlenie_nachato'), 'reachGoal');
  const polya = await r.page.evaluate(() =>
    [...document.querySelectorAll('input')]
      .filter((i) => i.type === 'email' || i.type === 'password' || i.name === 'code')
      .map((i) => `${i.name}:${i.className.includes('ym-disable-keys') && i.className.includes('ym-hide-content') ? 'закрыто' : 'ОТКРЫТО'}`),
  );
  chk(
    'почта и пароль закрыты от вебвизора',
    polya.length > 0 && polya.every((p) => p.endsWith('закрыто')),
    polya.join(' '),
  );
  await r.page.close();
}
{
  const r = await otkryt('/certificate/');
  const kod = await r.page.evaluate(() => {
    const i = document.querySelector('input[name="code"]');
    return i ? i.className : null;
  });
  chk(
    'код сертификата закрыт от вебвизора',
    Boolean(kod && kod.includes('ym-disable-keys') && kod.includes('ym-hide-content')),
    kod ?? 'поля нет',
  );
  await r.page.close();
}

/**
 * ⚠️ ЧТО ИМЕННО ЗДЕСЬ ПРОВЕРЯЕТСЯ — И ПОЧЕМУ НЕ «НЕТ НОМЕРА
 * В РАЗМЕТКЕ».
 *
 * Скрипт счётчика отдаётся КАЖДОЙ страницей, а решение принимает
 * сам, в браузере, по `location.pathname`: корневая раскладка одна
 * на весь сайт, и узнать адрес на сервере она может только через
 * `headers()` — а это переводит лендинг на посчитанный ответ
 * и отменяет закон 36. Значит номер счётчика лежит в разметке
 * и кабинета тоже. Вреда в этом нет: номер публичный, он виден
 * на любой странице сайта и ничего не открывает.
 *
 * Первая редакция сторожа падала именно на нём — и падала зря:
 * она проверяла ПРИЗНАК («строки нет»), а не то, что важно
 * («ничего не записано»). Важное наблюдаемо целиком: `window.ym`
 * не заведён, `window.dataLayer` не создан, запрос
 * к `mc.yandex.ru` не уходил, тега с ним на странице нет.
 * Всё это — следы РАБОТЫ счётчика, и ни одного из них быть
 * не должно.
 */
console.log('\n── КАБИНЕТ И АДМИНКА: СЧЁТЧИК НЕ ДЕЛАЕТ НИЧЕГО ──');
for (const put of ['/cabinet/', '/admin/login/', '/admin/']) {
  const r = await otkryt(put);
  chk(`${put} — window.ym не заведён`, r.ym === 'undefined', r.ym);
  chk(`${put} — слой данных не создан`, r.sloy === 'undefined', r.sloy);
  chk(`${put} — запроса к Метрике не было`, !r.prishyol && r.tegov === 0);
  await r.page.close();
}

console.log('\n── МЕТКИ КАМПАНИИ ──');
{
  const kontekst = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await kontekst.newPage();
  const kuka = async () =>
    (await kontekst.cookies()).find((c) => c.name === 'spotik_utm')?.value ?? null;

  await page.goto(adres('/?utm_source=yandex&utm_medium=cpc&utm_campaign=vesna&utm_term=spotify&utm_content=b1'), {
    waitUntil: 'domcontentloaded',
  });
  const k1 = await kuka();
  chk('метки сняты с первого захода', Boolean(k1), k1 ?? '');
  for (const m of ['utm_source=yandex', 'utm_medium=cpc', 'utm_campaign=vesna', 'utm_term=spotify', 'utm_content=b1'])
    chk(`  ${m}`, (k1 ?? '').includes(m));

  /* ⚠️ ВТОРАЯ СТРАНИЦА БЕЗ АДРЕСНЫХ МЕТОК: постановка требует,
     чтобы метки жили до конца сессии, «даже если человек перешёл
     на другие страницы». */
  await page.goto(adres('/oferta/'), { waitUntil: 'domcontentloaded' });
  chk('метки живут на другой странице', (await kuka()) === k1);

  /* ⚠️ И ПОБЕЖДАЕТ ПЕРВЫЙ ЗАХОД. Иначе возврат из поиска затирал бы
     настоящий источник, и в отчёте вся реклама выглядела бы как
     переходы из поиска. */
  await page.goto(adres('/?utm_source=drugoy&utm_medium=email'), { waitUntil: 'domcontentloaded' });
  chk('повторный заход метки НЕ затирает', (await kuka()) === k1, await kuka());

  /* Кука сеансовая: у неё нет срока жизни вовсе. */
  const c = (await kontekst.cookies()).find((x) => x.name === 'spotik_utm');
  chk('кука сеансовая и не уезжает на чужие сайты', c?.expires === -1 && c?.sameSite === 'Lax', `expires=${c?.expires} sameSite=${c?.sameSite}`);
  await kontekst.close();
}

await browser.close();
await server.close();

console.log('');
if (bad) {
  console.log(`СБОЙ: провалено проверок — ${bad}`);
  process.exit(1);
}
console.log('МЕТРИКА НА МЕСТЕ: публичные страницы со счётчиком, кабинет и админка — без.');

/**
 * КАРТОЧКА СЕРТИФИКАТА: ЦЕНА БЕРЁТСЯ У ПОДАРЕННОГО ТАРИФА.
 *
 * Постановка двадцать восьмой итерации сняла у сертификата
 * собственную цену: он стоит ровно столько, сколько тариф и срок,
 * которые в нём подарены (Р-93). На лендинге это значит четыре вещи,
 * и ни одну из них на глаз не проверить:
 *
 *   1. на карточке «Сертификат» стоит ЦЕНА, а не заглушка,
 *      и равна она цене выбранного в подарок тарифа;
 *   2. при выборе этой карточки под сеткой встаёт выбор тарифа
 *      («на одного / на двоих / на троих»), а не выбор аккаунта;
 *   3. срок берётся из общего переключателя, и ограничения те же,
 *      что у тарифов: «на троих» — только месяц;
 *   4. кнопка ведёт на оформление с НАСТОЯЩИМ тарифом и признаком
 *      `gift=1`: отдельного тарифа `gift` в заказе больше нет.
 *
 * ⚠️ СУДИМ ПО ГОТОВОМУ КАДРУ, А НЕ ПО НАШЕЙ ЖЕ АРИФМЕТИКЕ (Р-47).
 * Цена читается со СТРАНИЦЫ — и с карточки сертификата, и с карточки
 * того тарифа, который подарен; сходятся они или нет, решает
 * сравнение двух строк на экране, а не пересчёт `lib/plans.ts`.
 */
import { launch } from './browser.mjs';
import { serveOut, PREFIX } from './serve-out.mjs';

const PORT = 4291;

const server = await serveOut(PORT);
const browser = await launch();
let bad = 0;

const chk = (chto, uslovie, chem = '') => {
  if (uslovie) console.log(`  OK   ${chto}${chem ? `  ${chem}` : ''}`);
  else {
    console.log(`  СБОЙ ${chto}${chem ? `  ${chem}` : ''}`);
    bad += 1;
  }
};

console.log('СЕРТИФИКАТ НА ЛЮБОЙ ТАРИФ: цена и выбор под сеткой.\n');

for (const [w, h] of [
  [390, 844],
  [1920, 1080],
]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(`http://localhost:${PORT}${PREFIX}/`, { waitUntil: 'networkidle' });

  /** Цена на карточке по её названию. */
  const cenaKarty = (imya) =>
    page.evaluate((n) => {
      const karty = [...document.querySelectorAll('.card')];
      const k = karty.find((x) => x.querySelector('.card__name')?.textContent?.trim() === n);
      return k?.querySelector('.card__price')?.textContent?.trim() ?? null;
    }, imya);

  const nazhat = async (selektor, imya) => {
    await page.evaluate(
      ([s, n]) => {
        const el = [...document.querySelectorAll(s)].find((x) => x.textContent?.trim() === n);
        el?.click();
      },
      [selektor, imya],
    );
    await page.waitForTimeout(120);
  };

  console.log(`  ── ${w}×${h} ──`);

  // Срок по умолчанию — год. Сертификат дарит «на одного».
  const godSolo = await cenaKarty('На одного');
  const godSert = await cenaKarty('Сертификат');
  chk('заглушки цены на сертификате нет', !/уточняется/i.test(godSert ?? ''), godSert ?? '—');
  chk('цена сертификата равна цене подаренного тарифа', Boolean(godSolo) && godSert === godSolo, `${godSert} = ${godSolo}`);

  // Выбираем карточку сертификата: под сеткой обязан появиться выбор тарифа.
  await nazhat('.card .card__name', 'Сертификат');
  const podSetkoy = await page.evaluate(() =>
    [...document.querySelectorAll('.order__opts .row__opt')].map((b) => b.textContent?.trim()),
  );
  chk(
    'под сеткой выбор тарифа, а не аккаунта',
    podSetkoy.join('|') === 'На одного|На двоих|На троих',
    podSetkoy.join(' · '),
  );

  // Дарим «на двоих»: цена на карточке обязана переехать.
  await nazhat('.order__opts .row__opt', 'На двоих');
  const godDuo = await cenaKarty('На двоих');
  const godSert2 = await cenaKarty('Сертификат');
  chk('цена едет за выбранным подарком', godSert2 === godDuo && godSert2 !== godSolo, `${godSert2} = ${godDuo}`);

  const ssylka = await page.evaluate(() => document.querySelector('.order .btn')?.getAttribute('href') ?? '');
  chk(
    'кнопка ведёт на настоящий тариф с признаком подарка',
    ssylka.includes('plan=duo') && ssylka.includes('gift=1') && ssylka.includes('period=12'),
    ssylka,
  );

  // «На троих» — только месяц: то же ограничение, что у самого тарифа.
  await nazhat('.order__opts .row__opt', 'На троих');
  const sertTrio = await cenaKarty('Сертификат');
  const trio = await cenaKarty('На троих');
  chk('«на троих» падает на месяц, как и сам тариф', sertTrio === trio && /за месяц/.test(sertTrio ?? ''), sertTrio ?? '—');
  const ssylka2 = await page.evaluate(() => document.querySelector('.order .btn')?.getAttribute('href') ?? '');
  chk('и в адрес уезжает месяц', ssylka2.includes('plan=trio') && ssylka2.includes('period=1') && ssylka2.includes('gift=1'), ssylka2);

  // Обычная карточка про подарок ничего не знает: там выбор аккаунта.
  await nazhat('.card .card__name', 'На одного');
  const opts = await page.evaluate(() =>
    [...document.querySelectorAll('.order__opts .row__opt')].map((b) => b.textContent?.trim()),
  );
  chk('у обычного тарифа под сеткой прежний выбор аккаунта', opts.join('|') === 'Новый аккаунт|Продлить существующий', opts.join(' · '));
  const ssylka3 = await page.evaluate(() => document.querySelector('.order .btn')?.getAttribute('href') ?? '');
  chk('и признака подарка в адресе нет', !ssylka3.includes('gift=') && ssylka3.includes('plan=solo'), ssylka3);

  await page.close();
}

await browser.close();
server.close();
console.log(bad ? `\nПРОВАЛ: ${bad} проверок не прошло` : '\nСЕРТИФИКАТ: цена идёт за подарком, отдельной цены нет');
process.exit(bad ? 1 : 0);

/**
 * ПЕРЕВОДЧИК БРАУЗЕРА НЕ ТРОГАЕТ ДАННЫЕ.
 *
 * Помощник открывал русскую админку браузером, который сам переводит
 * страницу на английский, — и переводчик переписал почту клиента
 * вместе с надписями: «aairatttttttt@gmail.com» на одном экране
 * и с другим числом «t» на другом. Почты аккаунтов и пароли оператор
 * вводит в Spotify руками, поэтому та же беда на них — это аккаунт,
 * заведённый не на ту почту, и пароль, который не подойдёт (Р-166).
 *
 * Как проверяется. Настоящего переводчика в браузере стенда нет,
 * поэтому стоит ЕГО ПОДОБИЕ, и ведёт оно себя как Google: каждый
 * текстовый узел, который переводчику разрешено трогать, ПОДМЕНЯЕТСЯ
 * двумя `<font>` с переписанным до неузнаваемости текстом; подписи-
 * атрибуты переписываются тоже. Правила пропуска те же, что у Chrome:
 * `translate="no"` наследуется (свойство `el.translate`), класс
 * `notranslate` закрывает поддерево. Дальше спрашивается ГОТОВЫЙ ТЕКСТ:
 * сколько раз каждая почта, пароль, код и метка из базы стояли на экране
 * до «перевода», столько же обязаны стоять и после. Счёт, а не «нашлось
 * хоть раз»: защищённая почта в шапке иначе прятала бы незащищённую
 * ту же почту в истории заказа. Список данных берётся ИЗ БАЗЫ, а не из
 * разметки: проверка по тем же признакам, которыми размечена страница,
 * была бы моделью предмета (Р-47).
 *
 * Кроме страниц как есть — состояния, которых в данных `verify-shop` нет
 * или которые видны только после действия: шаг кода входа у клиента
 * и сотрудника, старые выданные доступы, ответы действий с почтой,
 * задача «Отмена подписки», — и ЖИВЫЕ места: очередь и кабинет
 * перерисовываются поверх «переведённой» страницы, и страница обязана
 * не упасть. Переводчик Google подменяет узлы, а React пишет в свои,
 * и голый текст рядом с элементом роняет его на `removeChild`.
 *
 * ⚠️ ЗАПУСКАЕТСЯ РУКАМИ И СРАЗУ ПОСЛЕ `verify-shop`: данные берёт его,
 * а `verify-pay` и `verify-metrika` чистят базу под себя. В выкладке
 * её нет — закон 47 называет шаги выкладки поимённо. Сессии заводятся
 * прямо в базе, мимо кода входа: код выдаётся не чаще раза в минуту,
 * а страниц здесь десятки. Данные проверка меняет (отменяет заказ,
 * заводит сотрудника) — после неё снова гоняется `verify-shop`.
 *
 *     DATABASE_URL=postgres://…@127.0.0.1/… node scripts/verify-perevod.mjs
 */
import pg from 'pg';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { launch } from './browser.mjs';
import { serveOut } from './serve-out.mjs';

const URL_BAZY = process.env.DATABASE_URL || '';
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(URL_BAZY)) {
  console.error('DATABASE_URL не задан или ведёт не на localhost — проверка заводит сессии и на чужой базе не запускается');
  process.exit(1);
}

const PORT = 4191;
/* Тот же ключ, что у `verify-shop`: иначе его шифротексты не прочесть. */
const KLYUCH = Buffer.from('spotik-proverka-klyuch-32-bayta!');

const rasshifrovat = (s) => {
  const [v, vektor, metka, telo] = String(s).split('.');
  if (v !== 'v1') return null;
  try {
    const r = createDecipheriv('aes-256-gcm', KLYUCH, Buffer.from(vektor, 'base64'));
    r.setAuthTag(Buffer.from(metka, 'base64'));
    return Buffer.concat([r.update(Buffer.from(telo, 'base64')), r.final()]).toString('utf8');
  } catch {
    return null;
  }
};
const zashifrovat = (otkrytoe) => {
  const vektor = randomBytes(12);
  const sh = createCipheriv('aes-256-gcm', KLYUCH, vektor);
  const telo = Buffer.concat([sh.update(otkrytoe, 'utf8'), sh.final()]);
  return ['v1', vektor.toString('base64'), sh.getAuthTag().toString('base64'), telo.toString('base64')].join('.');
};
const otpechatok = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

const pool = new pg.Pool({ connectionString: URL_BAZY, max: 2 });
const q = async (sql, p = []) => (await pool.query(sql, p)).rows;

/* ⚠️ СРАЗУ ПОСЛЕ `verify-shop`, А НЕ ПОСЛЕ `verify-pay` И `verify-metrika`:
   те чистят базу под себя и оставляют в ней одного покупателя без
   сотрудников и паролей. Первый прогон так и вышел — страницы чистые,
   а три вида данных не встретились ни разу; проверка на вакуумность
   внизу это поймала, а здесь сказано словами заранее. */
if (!(await q('select 1 from shop_order limit 1')).length || !(await q('select 1 from staff limit 1')).length) {
  console.error('в базе нет заказов или сотрудников — прогоните verify-shop прямо перед этой проверкой: данные берутся его');
  process.exit(1);
}
/* ⚠️ И ЭТО ИМЕННО ЕГО ДАННЫЕ: шифротекст обязан читаться проверочным
   ключом. Боевая база тоже живёт на localhost — на ней проверка
   заводила бы сессии настоящим людям и правила язык настоящим
   сотрудникам; там её ключ не читает ни одной строки. */
const shifry = await q(`select in_login_enc from order_slot where in_login_enc is not null limit 20`);
if (!shifry.some((r) => rasshifrovat(r.in_login_enc) !== null)) {
  console.error('шифротексты базы не читаются проверочным ключом — это не данные verify-shop, проверка не запускается');
  process.exit(1);
}

/* ── Что обязано дойти до экрана как есть ─────────────────────── */
/* Значение, которое стоит и в НАШЕМ тексте — в словаре админки,
   в каталоге, в причинах, — данными не считается: на экране оно
   законно переводится там, где оно надпись («yandex» в подсказке
   генератора ссылок). Такие значения выбрасываются, и это печатается. */
const NASH_TEKST = ['lib/admin/slova.ts', 'lib/plans.ts', 'lib/admin/prichiny.ts']
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');
const DANNYE = new Map(); // значение → вид
const vybrosheno = [];
const dobavit = (v, vid) => {
  if (typeof v !== 'string' || v.trim().length < 4 || DANNYE.has(v)) return;
  if (NASH_TEKST.includes(v)) {
    if (!vybrosheno.includes(v)) vybrosheno.push(v);
    return;
  }
  DANNYE.set(v, vid);
};
for (const r of await q('select email from app_user')) dobavit(r.email, 'почта клиента');
for (const r of await q('select email from staff')) dobavit(r.email, 'почта сотрудника');
for (const r of await q(`select in_login_enc, in_password_enc, out_login_enc, out_mail_pass_enc, out_password_enc
                           from order_slot`)) {
  dobavit(rasshifrovat(r.in_login_enc), 'почта аккаунта');
  dobavit(rasshifrovat(r.in_password_enc), 'пароль');
  dobavit(rasshifrovat(r.out_login_enc), 'почта аккаунта');
  dobavit(rasshifrovat(r.out_mail_pass_enc), 'пароль');
  dobavit(rasshifrovat(r.out_password_enc), 'пароль');
}
for (const r of await q('select code_enc, tail from certificate')) {
  dobavit(rasshifrovat(r.code_enc), 'код сертификата');
  dobavit(r.tail, 'хвост кода');
}
for (const r of await q(`select utm_source, utm_medium, utm_campaign, utm_term, utm_content from shop_order`))
  for (const v of Object.values(r)) dobavit(v, 'метка кампании');
console.log(`данных из базы: ${DANNYE.size}; выброшено как совпавшее с нашим текстом: ${vybrosheno.join(', ') || 'ничего'}`);

/* ── Сессии мимо кода входа ────────────────────────────────────── */
const mointokeny = [];
const sessiya = async (scope, userId, staffId) => {
  const token = randomBytes(24).toString('hex');
  mointokeny.push(otpechatok(token));
  await q(
    `insert into session (token_hash, scope, user_id, staff_id, expires_at)
     values ($1, $2, $3, $4, now() + interval '1 hour')`,
    [otpechatok(token), scope, userId, staffId],
  );
  return token;
};

/* ── Подобие переводчика ───────────────────────────────────────── */
/* Каждая буква и цифра обрастает знаком: любые данные, до которых
   «переводчик» дотянулся, перестают совпадать с собой. Правила
   пропуска — ровно те, что у Chrome: `translate` наследуется, класс
   `notranslate` закрывает поддерево. Поля ввода переводчики
   не трогают, и здесь они не трогаются тоже. */
const PEREVODCHIK = () => {
  const mozhno = (el) => el && el.translate !== false && !el.closest('.notranslate');
  const iskazit = (s) => s.replace(/[\p{L}\p{N}]/gu, (m) => m + 'ˈ');
  const hod = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const uzly = [];
  while (hod.nextNode()) uzly.push(hod.currentNode);
  for (const u of uzly) {
    const el = u.parentElement;
    if (!el || el.closest('script,style,noscript,template,textarea')) continue;
    if (!mozhno(el) || el.hasAttribute('data-perevedeno')) continue;
    /* Как Google: узел не правится, а ПОДМЕНЯЕТСЯ двумя `<font>`.
       Внутри `<option>` элементов не бывает — там правится текст. */
    if (el.tagName === 'OPTION') {
      u.nodeValue = iskazit(u.nodeValue);
      continue;
    }
    const vneshniy = document.createElement('font');
    const vnutrenniy = document.createElement('font');
    vneshniy.style.verticalAlign = vnutrenniy.style.verticalAlign = 'inherit';
    vnutrenniy.setAttribute('data-perevedeno', '');
    vnutrenniy.textContent = iskazit(u.nodeValue);
    vneshniy.appendChild(vnutrenniy);
    u.replaceWith(vneshniy);
  }
  for (const el of document.body.querySelectorAll('[title],[placeholder],[alt],[aria-label]')) {
    if (!mozhno(el) || el.hasAttribute('data-perevedeno-a')) continue;
    el.setAttribute('data-perevedeno-a', '');
    for (const a of ['title', 'placeholder', 'alt', 'aria-label'])
      if (el.hasAttribute(a)) el.setAttribute(a, iskazit(el.getAttribute(a)));
  }
};
/* Текст страницы: все текстовые узлы и подписи-атрибуты. Узлы идут
   через перевод строки, чтобы два соседних узла не склеились
   в «данные», которых на экране нет. */
const TEKST = () => {
  const out = [];
  const hod = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (hod.nextNode()) {
    const el = hod.currentNode.parentElement;
    if (!el || el.closest('script,style,noscript,template')) continue;
    out.push(hod.currentNode.nodeValue);
  }
  for (const el of document.body.querySelectorAll('[title],[placeholder],[alt],[aria-label]'))
    for (const a of ['title', 'placeholder', 'alt', 'aria-label']) if (el.hasAttribute(a)) out.push(el.getAttribute(a));
  return out.join('\n');
};
const skolko = (tekst, d) => tekst.split(d).length - 1;

let bad = 0;
const vidano = new Map(); // вид → сколько раз проверено на экране
const chk = (chto, uslovie, chem = '') => {
  if (uslovie) console.log(`  OK   ${chto}${chem ? `  ${chem}` : ''}`);
  else {
    console.log(`  СБОЙ ${chto}${chem ? `  ${chem}` : ''}`);
    bad += 1;
  }
};

/**
 * Перевести страницу и сверить данные.
 *
 * `ozhidaem` — значения, которые на ЭТОЙ странице обязаны быть: без них
 * «на экране 0» проходило бы молча, хотя страница могла и не отрисоваться
 * (сессию не приняли — и вместо кабинета форма входа).
 */
const perevesti = async (page, imya, ozhidaem = []) => {
  const do_ = await page.evaluate(TEKST);
  const nado = [...DANNYE.keys()].filter((d) => do_.includes(d));
  const nehvataet = ozhidaem.filter((d) => d && !do_.includes(d));
  if (ozhidaem.length) chk(`${imya}: нужные данные на экране`, nehvataet.length === 0, nehvataet.join(', '));
  const bylo = new Map(nado.map((d) => [d, skolko(do_, d)]));
  await page.evaluate(PEREVODCHIK);
  /* Полсекунды после «перевода»: живые места страницы успевают
     перерисоваться поверх подменённых узлов. */
  await page.waitForTimeout(500);
  const posle = await page.evaluate(TEKST);
  const poteryany = nado.filter((d) => skolko(posle, d) < bylo.get(d));
  for (const d of nado) vidano.set(DANNYE.get(d), (vidano.get(DANNYE.get(d)) ?? 0) + bylo.get(d));
  chk(
    `${imya}: данные пережили перевод`,
    poteryany.length === 0,
    poteryany.length
      ? `переведено ${poteryany.length} из ${nado.length}: ${poteryany
          .map((d) => `${DANNYE.get(d)} «${d}» (${skolko(posle, d)} из ${bylo.get(d)})`)
          .join(', ')}`
      : `на экране ${nado.length} значений, ${[...bylo.values()].reduce((a, b) => a + b, 0)} раз`,
  );
};

/* Ошибки страницы ловятся на всём её веку — и на перерисовке поверх
   «переведённых» узлов тоже. */
const novayaStranica = async (ctx) => {
  const page = await ctx.newPage();
  page.oshibki = [];
  page.on('pageerror', (e) => page.oshibki.push(String(e?.message ?? e)));
  return page;
};
const neUpala = (page, imya) => {
  chk(`${imya}: страница не упала`, page.oshibki.length === 0, page.oshibki.join(' | '));
  page.oshibki.length = 0;
};
const proverit = async (page, put, imya, { ozhidaem = [], deystvie } = {}) => {
  await page.goto(`http://localhost:${PORT}${put}`, { waitUntil: 'networkidle' });
  if (deystvie) await deystvie(page);
  await perevesti(page, imya, ozhidaem);
  neUpala(page, imya);
};

const kontekst = async (kuka) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  if (kuka) await ctx.addCookies([{ ...kuka, url: `http://localhost:${PORT}` }]);
  return ctx;
};
const kukaSotrudnika = async (id) => ({ name: 'spotik_a', value: await sessiya('staff', null, id) });
const kukaKlienta = async (id) => ({ name: 'spotik_s', value: await sessiya('client', id, null) });

const server = await serveOut(PORT, {
  env: {
    DATABASE_URL: URL_BAZY,
    SPOTIK_CRYPTO_KEY: KLYUCH.toString('base64'),
    SPOTIK_SITE_URL: `http://localhost:${PORT}`,
    ROBOKASSA_TEST: '1',
  },
});
const browser = await launch();
const sotrudniki = await q('select id, email, role, lang, queue_sec from staff where not disabled order by id');

try {
  /* ── Страницы как есть ─────────────────────────────────────── */
  const zakazy = await q(
    `select o.id, u.email from shop_order o join app_user u on u.id = o.user_id order by o.id`,
  );
  for (const s of sotrudniki) {
    for (const yazyk of ['ru', 'en']) {
      await q('update staff set lang = $1 where id = $2', [yazyk, s.id]);
      const ctx = await kontekst(await kukaSotrudnika(s.id));
      const page = await novayaStranica(ctx);
      console.log(`— ${s.role} ${s.email}, ${yazyk}`);
      const puti = ['/admin/', '/admin/stats/', '/admin/stats/?p=day'];
      if (s.role === 'admin') puti.push('/admin/staff/', '/admin/certificates/', '/admin/settings/');
      for (const p of puti) await proverit(page, p, p, { ozhidaem: [s.email] });
      for (const z of zakazy)
        await proverit(page, `/admin/orders/${z.id}/`, `заказ ${z.id}`, {
          /* Администратор видит любой заказ, а с ним почту клиента. */
          ozhidaem: s.role === 'admin' ? [s.email, z.email] : [s.email],
        });
      await ctx.close();
    }
    await q('update staff set lang = $1 where id = $2', [s.lang, s.id]);
  }

  const klienty = await q(
    `select u.id, u.email from app_user u where exists (select 1 from shop_order o where o.user_id = u.id) order by u.id`,
  );
  for (const k of klienty) {
    const ctx = await kontekst(await kukaKlienta(k.id));
    const page = await novayaStranica(ctx);
    console.log(`— клиент ${k.email}`);
    const kody = (await q('select code_enc from certificate where buyer_id = $1', [k.id]))
      .map((r) => rasshifrovat(r.code_enc))
      .filter(Boolean);
    await proverit(page, '/cabinet/', 'кабинет', { ozhidaem: [k.email, ...kody] });
    await proverit(page, '/checkout/?plan=solo&period=1', 'оформление', { ozhidaem: [k.email] });
    /* Подсказка прошлых почт выезжает под полем при продлении:
       выбираем «Продлить» и встаём в поле почты. */
    await proverit(page, '/checkout/?plan=solo&period=1', 'оформление, подсказка почт', {
      ozhidaem: [k.email],
      deystvie: async (p) => {
        const prodlit = p.locator('button', { hasText: 'Продлить' }).first();
        if (await prodlit.count()) await prodlit.click();
        const pole = p.locator('input[type="email"]').first();
        if (await pole.count()) await pole.focus();
        await p.waitForTimeout(400);
      },
    });
    await proverit(page, '/certificate/', 'активация сертификата');
    await ctx.close();
  }

  /* ── Страница восстановления пароля: ссылка заводится здесь же ── */
  const slot = (await q(`select id, order_id, in_login_enc from order_slot where in_login_enc is not null order by id limit 1`))[0];
  chk('есть аккаунт для страницы восстановления', Boolean(slot));
  if (slot) {
    const token = randomBytes(24).toString('hex');
    await q(
      `insert into recovery_link (token_fp, order_id, slot_id, expires_at) values ($1, $2, $3, now() + interval '1 hour')`,
      [otpechatok(token), slot.order_id, slot.id],
    );
    const ctx = await kontekst();
    const page = await novayaStranica(ctx);
    await proverit(page, `/vosstanovlenie/?t=${token}`, 'восстановление пароля', {
      ozhidaem: [rasshifrovat(slot.in_login_enc)],
    });
    await ctx.close();
    await q('delete from recovery_link where token_fp = $1', [otpechatok(token)]);
  }

  /* ── Шаг кода входа: «Код из письма на …» и «Код отправлен на …» ── */
  console.log('— шаг кода входа');
  {
    const pochta = `perevod-${randomBytes(3).toString('hex')}@spotik.test`;
    DANNYE.set(pochta, 'почта клиента');
    const ctx = await kontekst();
    const page = await novayaStranica(ctx);
    await page.goto(`http://localhost:${PORT}/cabinet/`, { waitUntil: 'networkidle' });
    await page.fill('input[type="email"][name="email"]', pochta);
    await page.locator('form:has(input[name="email"]) button[type="submit"]').first().click();
    await page.waitForSelector('input[name="code"]', { timeout: 15000 }).catch(() => null);
    await perevesti(page, 'вход клиента, шаг кода', [pochta]);
    neUpala(page, 'вход клиента, шаг кода');
    await ctx.close();
  }
  {
    const admin = sotrudniki.find((s) => s.role === 'admin');
    const ctx = await kontekst();
    const page = await novayaStranica(ctx);
    await page.goto(`http://localhost:${PORT}/admin/login/`, { waitUntil: 'networkidle' });
    await page.fill('input[type="email"][name="email"]', admin.email);
    await page.locator('form:has(input[name="email"]) button[type="submit"]').first().click();
    await page.waitForSelector('input[name="code"]', { timeout: 15000 }).catch(() => null);
    await perevesti(page, 'вход в админку, шаг кода', [admin.email]);
    neUpala(page, 'вход в админку, шаг кода');
    await ctx.close();
  }

  const admin = sotrudniki.find((s) => s.role === 'admin');
  const operator = sotrudniki.find((s) => s.role === 'operator');
  /* Дальше кнопки ищутся по русским надписям. */
  await q(`update staff set lang = 'ru' where id = $1`, [admin.id]);

  /* ── Старые выданные доступы: в данных verify-shop их нет ────── */
  console.log('— старые выданные доступы');
  {
    const z = (
      await q(
        `select o.id, o.user_id, s.id as slot from shop_order o join order_slot s on s.order_id = o.id
          where o.status = 'done' and o.kind = 'plan' and o.secrets_wiped_at is null order by o.id limit 1`,
      )
    )[0];
    chk('есть выполненный заказ для старых доступов', Boolean(z));
    if (z) {
      const vydano = { login: 'stary-login@vydano.test', pochty: 'StaraPochta-77', spotify: 'StaryySpotify-88' };
      DANNYE.set(vydano.login, 'почта аккаунта');
      DANNYE.set(vydano.pochty, 'пароль');
      DANNYE.set(vydano.spotify, 'пароль');
      await q(
        `update order_slot set out_login_enc = $1, out_mail_pass_enc = $2, out_password_enc = $3 where id = $4`,
        [zashifrovat(vydano.login), zashifrovat(vydano.pochty), zashifrovat(vydano.spotify), z.slot],
      );
      const ctx = await kontekst(await kukaKlienta(z.user_id));
      const page = await novayaStranica(ctx);
      await proverit(page, '/cabinet/', 'кабинет, старые доступы', { ozhidaem: [vydano.login, vydano.pochty, vydano.spotify] });
      await ctx.close();
    }
  }

  /* ── Ответы действий с почтой ─────────────────────────────────── */
  console.log('— ответы действий');
  {
    const ctx = await kontekst(await kukaSotrudnika(admin.id));
    const page = await novayaStranica(ctx);
    /* «{email} теперь оператор.» */
    const novyy = `perevod-sotrudnik-${randomBytes(3).toString('hex')}@spotik.test`;
    DANNYE.set(novyy, 'почта сотрудника');
    await page.goto(`http://localhost:${PORT}/admin/staff/`, { waitUntil: 'networkidle' });
    const forma = page.locator('form:has(select[name="role"])').first();
    await forma.locator('input[name="email"]').fill(novyy);
    await forma.locator('button[type="submit"]').click();
    await page.waitForSelector('p.ok', { timeout: 15000 }).catch(() => null);
    await perevesti(page, 'сотрудник добавлен', [novyy]);
    neUpala(page, 'сотрудник добавлен');

    /* «Тарифы и сроки сохранены: {email}» */
    await page.goto(`http://localhost:${PORT}/admin/staff/`, { waitUntil: 'networkidle' });
    const kto = ((await page.locator('.ad__op-kto').first().textContent()) ?? '').trim();
    const opEmail = sotrudniki.map((s) => s.email).find((e) => kto.startsWith(e)) ?? null;
    await page.locator('button', { hasText: 'Сохранить тарифы и сроки' }).first().click();
    await page.waitForSelector('p.ok', { timeout: 15000 }).catch(() => null);
    await perevesti(page, 'тарифы оператора сохранены', [opEmail]);
    neUpala(page, 'тарифы оператора сохранены');

    /* «Задача «Отмена подписки» ушла {kto}» — у выполненного заказа,
       который выполнял оператор: тогда задача уходит ему, и в ответе
       его почта. */
    const cel = (
      await q(
        `select o.id, f.email from shop_order o
           join lateral (select e.staff_id from order_event e where e.order_id = o.id and e.vid = 'vypolnil'
                          order by e.created_at desc, e.id desc limit 1) v on true
           join staff f on f.id = v.staff_id
          where o.status = 'done' and o.kind = 'plan' and f.role = 'operator' and not f.disabled
            and not exists (select 1 from sub_cancel c where c.order_id = o.id)
          order by o.closed_at desc limit 1`,
      )
    )[0];
    chk('есть выполненный оператором заказ для отмены подписки', Boolean(cel));
    if (cel) {
      await page.goto(`http://localhost:${PORT}/admin/`, { waitUntil: 'networkidle' });
      const stroka = page.locator('tr', { has: page.locator(`a[href="/admin/orders/${cel.id}/"]`) });
      chk('заказ виден в «Недавно закрытых»', (await stroka.count()) > 0, `№ ${cel.id}`);
      if (await stroka.count()) {
        await stroka.locator('.ad__otmena-v button', { hasText: 'Отменить' }).click();
        await stroka.locator('.ad__otmena-v button[type="submit"]').click();
        await stroka.locator('.ok').waitFor({ timeout: 15000 }).catch(() => null);
        await perevesti(page, 'отмена выполненного заказа', [cel.email]);
        neUpala(page, 'отмена выполненного заказа');
        /* Задача «Отмена подписки» на карточке: у администратора
           «Задача у {kto}» и аккаунты с почтой и паролем. */
        const akk = (await q('select in_login_enc, in_password_enc from order_slot where order_id = $1', [cel.id])).flatMap(
          (r) => [rasshifrovat(r.in_login_enc), rasshifrovat(r.in_password_enc)].filter(Boolean),
        );
        await proverit(page, `/admin/orders/${cel.id}/`, 'задача «Отмена подписки», администратор', {
          ozhidaem: [cel.email, ...akk],
        });
        const opCtx = await kontekst(await kukaSotrudnika((await q('select id from staff where email = $1', [cel.email]))[0].id));
        const opPage = await novayaStranica(opCtx);
        await proverit(opPage, `/admin/orders/${cel.id}/`, 'задача «Отмена подписки», её оператор', { ozhidaem: akk });
        await opCtx.close();
      }
    }
    await ctx.close();
  }

  /* ── Живые места поверх «переведённой» страницы ──────────────── */
  console.log('— живые места');
  {
    /* Очередь: оператор берёт заказ, пока страница «переведена»;
       через опрос в строке встают его почта и «взял: …». */
    const z = (await q(`select id from shop_order where kind = 'plan' and status = 'done' order by id limit 1`))[0];
    await q(`update shop_order set status = 'paid', operator_id = null, taken_at = null where id = $1`, [z.id]);
    await q('update staff set queue_sec = 10 where id = $1', [admin.id]);
    const ctx = await kontekst(await kukaSotrudnika(admin.id));
    const page = await novayaStranica(ctx);
    await page.goto(`http://localhost:${PORT}/admin/`, { waitUntil: 'networkidle' });
    await perevesti(page, 'очередь до обновления', [admin.email]);
    const bylo = skolko(await page.evaluate(TEKST), operator.email);
    await q(`update shop_order set status = 'in_work', operator_id = $2, taken_at = now() where id = $1`, [z.id, operator.id]);
    let stalo = bylo;
    for (let i = 0; i < 30 && stalo <= bylo; i++) {
      await page.waitForTimeout(500);
      stalo = skolko(await page.evaluate(TEKST), operator.email);
    }
    chk('очередь обновилась сама поверх «перевода»', stalo > bylo, `почта взявшего: было ${bylo}, стало ${stalo}`);
    neUpala(page, 'очередь, обновление поверх «перевода»');
    /* Google переводит и то, что дорисовалось, — и снова сверяем. */
    await perevesti(page, 'очередь после обновления');
    neUpala(page, 'очередь после обновления');
    await ctx.close();
  }
  {
    /* Кабинет: заказ закрывается, пока страница «переведена»; через
       опрос отпечатка встаёт «Premium включён на почте …». */
    const z = (
      await q(
        /* Годится и заказ в работе: сценарии выше уже забрали часть
           выполненных — один отменён подпиской, один снова в очереди. */
        `select o.id, o.user_id from shop_order o
          where o.kind = 'plan' and o.status in ('done', 'in_work', 'paid') and o.secrets_wiped_at is null
            and exists (select 1 from order_slot s where s.order_id = o.id and s.in_login_enc is not null)
            and not exists (select 1 from order_slot s where s.order_id = o.id and s.out_login_enc is not null)
          order by o.id desc limit 1`,
      )
    )[0];
    chk('есть заказ для живого кабинета', Boolean(z));
    if (z) {
      const pochty = (await q('select in_login_enc from order_slot where order_id = $1', [z.id]))
        .map((r) => rasshifrovat(r.in_login_enc))
        .filter(Boolean);
      await q(`update shop_order set status = 'in_work', closed_at = null where id = $1`, [z.id]);
      const ctx = await kontekst(await kukaKlienta(z.user_id));
      const page = await novayaStranica(ctx);
      await page.goto(`http://localhost:${PORT}/cabinet/`, { waitUntil: 'networkidle' });
      await perevesti(page, 'кабинет до обновления');
      const vstalo = () => page.locator('.cred__stroka b', { hasText: pochty[0] }).count();
      const bylo = await vstalo();
      await q(`update shop_order set status = 'done', closed_at = now() where id = $1`, [z.id]);
      let stalo = bylo;
      for (let i = 0; i < 50 && stalo <= bylo; i++) {
        await page.waitForTimeout(500);
        stalo = await vstalo();
      }
      chk('кабинет обновился сам поверх «перевода»', stalo > bylo, `«Premium включён на почте»: было ${bylo}, стало ${stalo}`);
      neUpala(page, 'кабинет, обновление поверх «перевода»');
      await perevesti(page, 'кабинет после обновления', pochty);
      neUpala(page, 'кабинет после обновления');
      await ctx.close();
    }
  }

  console.log('проверено на экране по видам (раз):', Object.fromEntries(vidano));
  for (const vid of ['почта клиента', 'почта сотрудника', 'почта аккаунта', 'пароль', 'метка кампании', 'код сертификата', 'хвост кода'])
    chk(`проверка не вакуумная: «${vid}» встречалась на экране`, (vidano.get(vid) ?? 0) > 0);
} finally {
  for (const s of sotrudniki)
    await q('update staff set lang = $1, queue_sec = $2 where id = $3', [s.lang, s.queue_sec, s.id]);
  if (mointokeny.length) await q('delete from session where token_hash = any($1)', [mointokeny]);
  await browser.close();
  await server.close();
  await pool.end();
}

console.log(bad ? `\nСБОЕВ: ${bad}` : '\nвсе проверки пройдены');
process.exit(bad ? 1 : 0);

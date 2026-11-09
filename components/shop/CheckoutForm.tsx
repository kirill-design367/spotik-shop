'use client';

import { useActionState, useState } from 'react';
import { Soglasie } from './Soglasie';
import { deystvieOformit, deystvieProveritPromo, type Otvet } from '@/lib/server/actions-client';
import { rubli } from '@/lib/server/money';
import { cel, CELI } from '@/lib/metrika';
import { Pole, PoleParolya } from './Polya';
import { parolNeGoditsya, pochtaNeVerna, PRAVILO_PAROLYA } from '@/lib/proverka';
import { CHASY_SLOVAMI } from '@/lib/chasy';
import { useUhodNaOplatu } from './uhod';
import EgipetPlashka from '@/components/EgipetPlashka';
import { VPN_OPLATA_TEKST, procentSkidki } from '@/lib/plans';
import { kodPromo, PREDEL_KODA, skidkaKop } from '@/lib/promokod';
import CenaSoSkidkoy from './CenaSoSkidkoy';
import Bukvalno from '@/components/Bukvalno';

export type SrokVybor = {
  period: number;
  kop: number;
  label: string;
  /** Аккаунт на этой паре привязан к Египту (сорок девятая итерация). */
  egipet: boolean;
  /** Цена до скидки тарифа — есть только у пары со скидкой (Р-170). */
  bezSkidki?: number;
};

export type TarifVybor = {
  id: string;
  name: string;
  people: number;
  note: string;
  sroki: SrokVybor[];
};

export type Vvod = {
  planId: string;
  planName: string;
  people: number;
  sertifikat: boolean;
  sroki: SrokVybor[];
  /** Весь каталог: «Изменить» открывает и тарифы, и сроки. */
  tarify: TarifVybor[];
  zametka: string;
  periodPoUmolchaniyu: number;
  rezhimPoUmolchaniyu: 'new' | 'renew';
  /** Почты из заказа, который продлевают по ссылке из письма. */
  pochtyPoUmolchaniyu: string[];
  /**
   * Все почты, которые человек уже указывал в своих заказах.
   * Пусто — подсказки не будет вовсе (постановка).
   */
  pochtyPodskazki: string[];
  balansKop: number;
  /** Посчитано НА СЕРВЕРЕ и по Москве — см. `lib/chasy.ts`. */
  vneRabochego: boolean;
};

/**
 * Оформление заказа.
 *
 * ⚠️ УЧАСТНИКОВ СТОЛЬКО, СКОЛЬКО МЕСТ В ТАРИФЕ, и число это приходит
 * с сервера. На сервере оно проверяется ЗАНОВО (lib/server/orders.ts):
 * поле формы — это то, что человек может переписать в браузере,
 * и «на одного» за 299 рублей на троих оформляться не должно.
 *
 * ⚠️ ДАННЫЕ АККАУНТА ЧЕЛОВЕК ВВОДИТ В ОБОИХ СЛУЧАЯХ С ТРИДЦАТЬ
 * ЧЕТВЁРТОЙ ИТЕРАЦИИ. У Spotify нет двухфакторной проверки, значит
 * аккаунт можно завести прямо на почту клиента:
 *   НОВЫЙ АККАУНТ    — человек вводит СВОЮ почту и пароль, КОТОРЫЙ
 *                      ХОЧЕТ; оператор заводит аккаунт ровно на эти
 *                      данные и включает Premium. Выдавать нечего:
 *                      доступ с самого начала у человека;
 *   ПРОДЛИТЬ СВОЙ    — почта и пароль СВОЕГО аккаунта Spotify.
 * И то, и другое уезжает на сервер и ложится в базу только
 * шифротекстом (закон 35).
 *
 * ⚠️ ПРОВЕРКА ИДЁТ НАШЕЙ, А НЕ БРАУЗЕРНОЙ. У формы стоит `noValidate`,
 * правила лежат в `lib/proverka` и зовутся ТЕМ ЖЕ модулем на сервере:
 * две копии правил разошлись бы молча. Сообщения — набором сайта,
 * под своим полем, а не всплывающей подсказкой браузера.
 */
export default function CheckoutForm({ vvod }: { vvod: Vvod }) {
  const [planId, setPlanId] = useState<string>(vvod.planId);
  const [period, setPeriod] = useState<number>(vvod.periodPoUmolchaniyu);
  /* ⚠️ СПИСОК ВАРИАНТОВ ЗАКРЫТ, ПОКА НЕ НАЖАЛИ «ИЗМЕНИТЬ», НО ИЗ РАЗМЕТКИ
     НЕ УБРАН. Человек выбрал тариф и срок на лендинге — переспрашивать
     его тем же списком значит показывать лишний экран. А из разметки
     список не уходит потому, что без скрипта поменять выбор было бы
     нечем вовсе; закрытый он выведен из обхода `inert`. */
  const [menyaem, setMenyaem] = useState(false);
  const tarif = vvod.tarify.find((t) => t.id === planId);
  const sroki = tarif ? tarif.sroki : vvod.sroki;
  const mest = vvod.sertifikat ? 0 : (tarif?.people ?? vvod.people);
  const [rezhimy, setRezhimy] = useState<('new' | 'renew')[]>(
    Array.from({ length: vvod.sertifikat ? 0 : vvod.people }, () => vvod.rezhimPoUmolchaniyu),
  );
  const [tratit, setTratit] = useState(vvod.balansKop > 0);
  const [dannye, setDannye] = useState<{ login: string; password: string }[]>(
    Array.from({ length: vvod.sertifikat ? 0 : vvod.people }, (_, i) => ({
      login: vvod.pochtyPoUmolchaniyu[i] ?? '',
      password: '',
    })),
  );
  const [bedy, setBedy] = useState<{ login: string | null; password: string | null }[]>(
    Array.from({ length: vvod.sertifikat ? 0 : vvod.people }, () => ({ login: null, password: null })),
  );

  /**
   * Смена тарифа тянет за собой три вещи, и все три обязаны поехать
   * в один ход: мест в тарифе может стать больше или меньше, срок
   * может у нового тарифа не существовать вовсе (у «На троих» есть
   * только месяц), а уже введённые данные участников терять нельзя.
   */
  const smenitTarif = (id: string) => {
    const t = vvod.tarify.find((x) => x.id === id);
    if (!t) return;
    setPlanId(id);
    if (!t.sroki.some((s) => s.period === period)) setPeriod(t.sroki[0]?.period ?? 1);
    if (vvod.sertifikat) return;
    const n = t.people;
    setRezhimy((s) => Array.from({ length: n }, (_, i) => s[i] ?? vvod.rezhimPoUmolchaniyu));
    setDannye((s) => Array.from({ length: n }, (_, i) => s[i] ?? { login: '', password: '' }));
    setBedy((s) => Array.from({ length: n }, (_, i) => s[i] ?? { login: null, password: null }));
  };
  const [bedaSoglasiya, setBedaSoglasiya] = useState<string | null>(null);
  /* ⚠️ ПРОМОКОД (Р-167). Поле, которое человек набирает, НЕ ИМЕЕТ ИМЕНИ
     и в форму не уезжает: уезжает скрытое `promo` — код, который сервер
     уже признал годным. Набрал и не нажал «Применить» — значит скидки
     он не видел, и платить по ней было бы неожиданностью в обе стороны.
     Сервер всё равно проверяет код ЗАНОВО при создании заказа и занимает
     активацию в той же транзакции: проверка здесь — только чтобы новая
     цена была видна ДО оплаты. */
  const [promoVvod, setPromoVvod] = useState('');
  const [promo, setPromo] = useState<{ kod: string; skidkaProc: number } | null>(null);
  const [promoBeda, setPromoBeda] = useState<string | null>(null);
  const [promoIdyot, setPromoIdyot] = useState(false);
  const primenit = async () => {
    const kod = kodPromo(promoVvod);
    if (!kod) {
      setPromoBeda('Введите промокод.');
      return;
    }
    setPromoIdyot(true);
    setPromoBeda(null);
    try {
      const o = await deystvieProveritPromo(kod);
      if ('oshibka' in o) {
        setPromo(null);
        setPromoBeda(o.oshibka);
      } else {
        setPromo(o);
        setPromoVvod(o.kod);
      }
    } catch {
      setPromoBeda('Не получилось проверить промокод. Попробуйте ещё раз.');
    } finally {
      setPromoIdyot(false);
    }
  };
  const [otvet, oformit, idyot] = useActionState<Otvet, FormData>(deystvieOformit, {});
  /* ⚠️ НА РОБОКАССУ УХОДИТ БРАУЗЕР, А НЕ РОУТЕР NEXT. Прежде это
     делал `redirect()` внутри серверного действия, и нажатие «назад»
     со страницы оплаты роняло сайт «Application error» — разбор
     в `uhod.ts` и в Р-143. */
  useUhodNaOplatu(otvet.kuda);
  const uhodim = Boolean(otvet.kuda);

  const pravitDannye = (i: number, klyuch: 'login' | 'password', v: string) => {
    setDannye((s) => s.map((x, j) => (j === i ? { ...x, [klyuch]: v } : x)));
    setBedy((s) => s.map((x, j) => (j === i ? { ...x, [klyuch]: null } : x)));
  };

  /**
   * Проверка перед отправкой. Возвращает true, когда всё в порядке.
   *
   * ⚠️ `preventDefault` ОСТАНАВЛИВАЕТ И СЕРВЕРНОЕ ДЕЙСТВИЕ: React
   * вешает своё на submit и уважает отмену. Поэтому отдельного
   * «не отправлять» держать не нужно.
   */
  const vsyoLiVerno = (): boolean => {
    if (vvod.sertifikat) {
      const ok = (document.querySelector('input[name="consent"]') as HTMLInputElement | null)?.checked;
      setBedaSoglasiya(ok ? null : 'Без согласия оформить заказ нельзя');
      return Boolean(ok);
    }
    const svezhie = dannye.slice(0, mest).map((d) => ({
      login: pochtaNeVerna(d.login),
      password: parolNeGoditsya(d.password),
    }));
    setBedy(svezhie);
    const soglasie = (document.querySelector('input[name="consent"]') as HTMLInputElement | null)?.checked;
    setBedaSoglasiya(soglasie ? null : 'Без согласия оформить заказ нельзя');
    return Boolean(soglasie) && svezhie.every((b) => !b.login && !b.password);
  };

  /**
   * Что предложить участнику `i`.
   *
   * ⚠️ ПОЧТА, УЖЕ ВЫБРАННАЯ У ДРУГОГО УЧАСТНИКА, В СПИСОК НЕ ИДЁТ —
   * постановка. Один и тот же аккаунт Spotify нельзя продлить дважды
   * в одном заказе, и предлагать это значило бы вести человека
   * в отказ. Сравнение по нижнему регистру: почта от регистра
   * не зависит.
   */
  const podskazkiDlya = (i: number): string[] => {
    const zanyaty = dannye
      .slice(0, mest)
      .map((d, j) => (j === i ? '' : d.login.trim().toLowerCase()))
      .filter(Boolean);
    return vvod.pochtyPodskazki.filter((p) => !zanyaty.includes(p.toLowerCase()));
  };

  const vybrannyy = sroki.find((s) => s.period === period);
  const cena = vybrannyy?.kop ?? 0;
  const srokLabel = vybrannyy?.label ?? '';
  /* ⚠️ ПЛАШКА ИДЁТ ЗА ВЫБРАННОЙ ПАРОЙ, А НЕ ЗА ПРИШЕДШЕЙ С ГЛАВНОЙ:
     человек может сменить тариф и срок в «Изменить», и плашка обязана
     появиться или уйти вслед за этим. У сертификата её нет, как и у
     плашки часов: покупатель подарка аккаунт не заводит. */
  const egipet = !vvod.sertifikat && Boolean(sroki.find((s) => s.period === period)?.egipet);
  const imyaTarifa = vvod.sertifikat ? `Сертификат · ${tarif?.name ?? vvod.planName}` : (tarif?.name ?? vvod.planName);
  /* ⚠️ ПРОМОКОД СЧИТАЕТСЯ ОТ ТЕКУЩЕЙ ЦЕНЫ, ТО ЕСТЬ УЖЕ СО СКИДКОЙ ТАРИФА,
     и ДО баланса — той же `skidkaKop`, что и сервер (Р-167). */
  const skidkaPromo = promo ? skidkaKop(cena, promo.skidkaProc) : 0;
  const itogo = cena - skidkaPromo;
  const sBalansa = tratit ? Math.min(vvod.balansKop, itogo) : 0;
  const kOplate = itogo - sBalansa;

  return (
    /* ⚠️ ЦЕЛЬ ШЛЁТСЯ НА ОТПРАВКЕ ФОРМЫ, А НЕ ПОСЛЕ ОТВЕТА СЕРВЕРА:
       удачное действие уводит человека на Робокассу перенаправлением,
       и кадра, в котором можно было бы что-то отправить, не остаётся
       вовсе. `onSubmit` при этом идёт ПОСЛЕ проверки браузером
       обязательных полей — на незаполненной галочке согласия он
       не сработает. */
    <form
      /* ⚠️ `ozhivayet` ВКЛЮЧАЕТ ПОЯВЛЕНИЕ БЛОКОВ, и это чистый CSS:
         панели приезжают снизу со сдвигом по очереди. Ни наблюдателя,
         ни скрипта — страница короткая и вся видна сразу, а при
         «уменьшить движение» появление снято медиазапросом. */
      className="ozhivayet"
      action={oformit}
      noValidate
      onSubmit={(e) => {
        if (!vsyoLiVerno()) {
          e.preventDefault();
          return;
        }
        cel(CELI.perehodKOplate);
      }}
    >
      <input type="hidden" name="plan" value={planId} />
      <input type="hidden" name="period" value={period} />
      {/* ⚠️ СЕРТИФИКАТ — ПРИЗНАК, А НЕ ТАРИФ (Р-93). Тариф и срок
          у него настоящие, и цена берётся у них; на сервере признак
          означает ровно одно: участников не спрашиваем, а после
          оплаты выдаём код. */}
      {vvod.sertifikat ? <input type="hidden" name="gift" value="1" /> : null}

      {otvet.oshibka ? <p className="err">{otvet.oshibka}</p> : null}

      {/* ⚠️ ВЫБОР ПОКАЗАН ОДНОЙ СТРОКОЙ, А НЕ СПИСКОМ (тридцать седьмая
          итерация). Человек только что выбрал тариф и срок на лендинге;
          повтор всего списка на следующем экране читается как «выбор
          не засчитан». Строка называет, что выбрано, и цену, а варианты
          открываются по «Изменить».

          ⚠️ НЕВЫБРАННЫЕ НЕ ПОДСВЕЧЕНЫ НИЧЕМ: ни волосяной каймы,
          ни яркого текста — отмечен только выбранный, зелёным полем.
          Видимость невыбранной плашки держит СВЕТ СВЕРХУ в её заливке,
          как у плашек срока на лендинге, а не обводка. */}
      <div className="panel vybor">
        <div className="vybor__stroka">
          <span className="vybor__t">{imyaTarifa}</span>
          <span className="vybor__s">{srokLabel}</span>
          <span className="vybor__c">
            <CenaSoSkidkoy kop={cena} bylo={vybrannyy?.bezSkidki} klass="tnum summa" kluch={cena} />
          </span>
          <button
            type="button"
            className="vybor__izm"
            aria-expanded={menyaem}
            onClick={() => setMenyaem((v) => !v)}
          >
            {menyaem ? 'Свернуть' : 'Изменить'}
          </button>
        </div>
        <p className="panel__note vybor__z">{tarif?.note ?? vvod.zametka}</p>

        <div className="vybor__varianty" data-on={menyaem ? '' : undefined}>
          <div className="vybor__nutro" {...(menyaem ? {} : { inert: '' as unknown as boolean })}>
            <p className="field__label">Тариф</p>
            <div className="pick" role="radiogroup" aria-label="Тариф">
              {vvod.tarify.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={t.id === planId}
                  className="pick__btn"
                  onClick={() => smenitTarif(t.id)}
                >
                  {t.name}
                </button>
              ))}
            </div>
            <p className="field__label">Срок</p>
            <div className="pick" role="radiogroup" aria-label="Срок подписки">
              {sroki.map((s) => (
                <button
                  key={s.period}
                  type="button"
                  role="radio"
                  aria-checked={period === s.period}
                  className="pick__btn"
                  onClick={() => setPeriod(s.period)}
                >
                  {s.label} · {rubli(s.kop)}
                  {s.bezSkidki && s.bezSkidki > s.kop ? (
                    <span className="skidka-plashka pick__skidka">−{procentSkidki(s.bezSkidki, s.kop)}%</span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ⚠️ ПЛАШКА ПРО РАБОЧЕЕ ВРЕМЯ СТОИТ МЕЖДУ ТАРИФОМ И АККАУНТОМ,
          и это место названо постановкой. Смысл её ровно один: человек,
          оформляющий заказ ночью, должен знать, что доступ включат
          утром, а не решить, что мы пропали.

          ⚠️ ВРЕМЯ ПОСЧИТАЛ СЕРВЕР И ПО МОСКВЕ (`lib/chasy.ts`).
          Спроси мы часы устройства — плашка врала бы ровно тем, кому
          она нужнее всего: человеку из Владивостока, у которого утро,
          а у оператора в Москве ещё ночь.

          ⚠️ У СЕРТИФИКАТА ЕЁ НЕТ, И ЭТО НЕ ПРОПУСК. Код сертификата
          выдаёт не оператор, а сам сервер сразу после оплаты: обещать
          там «выполним в рабочее время» значило бы сказать неправду. */}
      {vvod.vneRabochego && !vvod.sertifikat ? (
        /* ⚠️ С СОРОК ВТОРОЙ ИТЕРАЦИИ ПЛАШКА ЯРКАЯ: зелёный акцент
           и знак часов — постановка «чтобы бросалась в глаза». Текст
           не тронут ни словом. Зелёное здесь КАЙМА И ЗНАК, а не поле:
           сплошная зелёная заливка читалась бы как вторая зелёная
           зона в кадре и спорила бы с кнопкой оплаты.
           ⚠️ Знак рисуем сами: чужих иконочных шрифтов в проекте
           нет ни одного. */
        <p className="panel__note plashka-chasy">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M12 7.4V12l3.4 2.1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <span>Заказ будет выполнен в рабочее время сервиса ({CHASY_SLOVAMI}).</span>
        </p>
      ) : null}

      {/* ⚠️ ПЛАШКА ПРО ЕГИПЕТСКИЙ VPN — РЯДОМ С ПЛАШКОЙ ЧАСОВ И С ТЕМ ЖЕ
          ВОЗДУХОМ (постановка сорок девятой итерации). Стоит в разметке
          всегда и показывается признаком: при смене тарифа или срока
          она плавно появляется и уходит, а снятый узел не анимируется
          ничем. */}
      {!vvod.sertifikat ? <EgipetPlashka pokaz={egipet} /> : null}

      {!vvod.sertifikat ? (
        <div className="panel">
          <h2 className="panel__h">{mest === 1 ? 'Аккаунт' : `Аккаунты — ${mest}`}</h2>
          {rezhimy.slice(0, mest).map((r, i) => (
            <div key={i} className="uchastnik">
              {mest > 1 ? <p className="field__label">Участник {i + 1}</p> : null}
              <input type="hidden" name={`mode${i}`} value={r} />
              <div className="pick" role="radiogroup" aria-label={`Аккаунт участника ${i + 1}`}>
                {(
                  [
                    ['new', 'Новый аккаунт'],
                    ['renew', 'Продлить существующий'],
                  ] as const
                ).map(([k, t]) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={r === k}
                    className="pick__btn"
                    onClick={() => setRezhimy((s) => s.map((x, j) => (j === i ? k : x)))}
                  >
                    {t}
                  </button>
                ))}
              </div>
              {/* ⚠️ ПОЛЯ ОДНИ И ТЕ ЖЕ В ОБОИХ РЕЖИМАХ, РАЗНЫЕ ТОЛЬКО
                  ПОДПИСИ. Разводить их разметкой значило бы завести
                  две формы вместо одной и два места, где правила
                  пароля могут разойтись. */}
              <div className="row2">
                <Pole
                  imya={`login${i}`}
                  tip="email"
                  podpis={r === 'new' ? 'Почта для нового аккаунта Spotify' : 'Почта аккаунта Spotify'}
                  znachenie={dannye[i]?.login ?? ''}
                  menyat={(v) => pravitDannye(i, 'login', v)}
                  beda={bedy[i]?.login}
                  /* ⚠️ ПОДСКАЗКА ТОЛЬКО НА ПРОДЛЕНИИ — постановка.
                     При «новом аккаунте» человек называет почту,
                     на которой аккаунта ЕЩЁ НЕТ: подсказывать ему
                     адреса, где Premium уже стоит, значило бы вести
                     его прямо в отказ «эта почта уже занята». */
                  pochty={r === 'renew' ? podskazkiDlya(i) : undefined}
                  podskazka={
                    r === 'new'
                      ? 'Мы заведём аккаунт на неё и включим Premium'
                      : 'Та, на которую заведён ваш аккаунт Spotify'
                  }
                />
                <PoleParolya
                  imya={`password${i}`}
                  podpis={r === 'new' ? 'Пароль, который мы поставим' : 'Пароль от аккаунта Spotify'}
                  znachenie={dannye[i]?.password ?? ''}
                  menyat={(v) => pravitDannye(i, 'password', v)}
                  beda={bedy[i]?.password}
                  podskazka={PRAVILO_PAROLYA}
                />
              </div>
            </div>
          ))}
          {/* ⚠️ ОБЕЩАНИЯ «СТИРАЕТСЯ ЧЕРЕЗ СЕМЬ ДНЕЙ» БОЛЬШЕ НЕТ (Р-172):
              доступы не стираются, и текст обязан говорить правду. */}
          <p className="panel__note">
            {rezhimy.includes('renew')
              ? 'Пароль нужен, чтобы включить Premium на аккаунте. Пароль хранится зашифрованным и виден только исполнителю заказа.'
              : 'Аккаунт заведём мы — на указанную почту и с указанным паролем. Пароль хранится зашифрованным и виден только исполнителю заказа.'}
          </p>
        </div>
      ) : (
        <div className="panel">
          <h2 className="panel__h">Сертификат</h2>
          <p className="panel__note" style={{ marginTop: 0 }}>
            После оплаты код придёт вам на почту и появится в личном кабинете. Тариф и срок
            зашиты в коде: тот, кому вы его подарите, введёт код на сайте, увидит, что
            подарено, и сам выберет — завести новый аккаунт или продлить свой.
            {(tarif?.people ?? vvod.people) > 1
              ? ` Аккаунтов в этом тарифе ${tarif?.people ?? vvod.people}, и все ${tarif?.people ?? vvod.people} он оформит сам.`
              : ''}
          </p>
        </div>
      )}

      <div className="panel">
        <h2 className="panel__h">К оплате</h2>
        <p className="sum">
          <span>{imyaTarifa} · {srokLabel}</span>
          {/* ⚠️ `key` ПО ЗНАЧЕНИЮ — ЭТО И ЕСТЬ ВЕСЬ ПРИЁМ. Сменился
              срок — React монтирует другой узел, и анимация появления
              играет заново: число «пересчитывается с движением», как
              и просили. Без ключа узел тот же, анимация уже отыграла,
              и цифра менялась бы молча. */}
          <CenaSoSkidkoy kop={cena} bylo={vybrannyy?.bezSkidki} klass="tnum summa" kluch={cena} />
        </p>

        {/* ⚠️ ПОЛЕ ПРОМОКОДА БЕЗ ИМЕНИ, а `promo` — скрытое поле с уже
            принятым кодом (см. состояние выше). Enter в поле применяет
            код, а не отправляет заказ: человек, набравший код и нажавший
            Enter, ждёт новой цены, а не перехода на оплату. */}
        <input type="hidden" name="promo" value={promo?.kod ?? ''} />
        <div className="field promo">
          <label className="field__label" htmlFor="promo-vvod">
            Промокод
          </label>
          {promo ? (
            <div className="promo__est">
              <span>
                <Bukvalno className="promo__kod">{promo.kod}</Bukvalno> · −{promo.skidkaProc}%
              </span>
              <button
                type="button"
                className="vybor__izm"
                onClick={() => {
                  setPromo(null);
                  setPromoBeda(null);
                }}
              >
                Убрать
              </button>
            </div>
          ) : (
            <div className="promo__ryad">
              <input
                id="promo-vvod"
                className="field__input promo__pole ym-disable-keys"
                type="text"
                inputMode="text"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                translate="no"
                maxLength={PREDEL_KODA + 8}
                value={promoVvod}
                aria-invalid={promoBeda ? true : undefined}
                aria-describedby={promoBeda ? 'promo-beda' : undefined}
                onChange={(e) => {
                  setPromoVvod(e.target.value);
                  setPromoBeda(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void primenit();
                  }
                }}
              />
              <button type="button" className="btn btn--ghost btn--sm" disabled={promoIdyot} onClick={() => void primenit()}>
                {promoIdyot ? 'Проверяем…' : 'Применить'}
              </button>
            </div>
          )}
          {promoBeda ? (
            <p className="field__beda" id="promo-beda" role="alert">
              {promoBeda}
            </p>
          ) : null}
        </div>
        {promo && skidkaPromo > 0 ? (
          <p className="sum">
            <span>
              Промокод <Bukvalno>{promo.kod}</Bukvalno> (−{promo.skidkaProc}%)
            </span>
            <span key={skidkaPromo} className="tnum summa">−{rubli(skidkaPromo)}</span>
          </p>
        ) : null}
        {vvod.balansKop > 0 ? (
          <>
            <label className="check">
              <input type="checkbox" name="balance" checked={tratit} onChange={(e) => setTratit(e.target.checked)} />
              <span>
                Списать с баланса — на нём {rubli(vvod.balansKop)}
              </span>
            </label>
            {sBalansa > 0 ? (
              <p className="sum">
                <span>С баланса</span>
                <span className="tnum">−{rubli(sBalansa)}</span>
              </p>
            ) : null}
          </>
        ) : null}
        <p className="sum sum--total">
          <span>{kOplate > 0 ? 'Картой или через СБП' : 'К доплате'}</span>
          <span key={kOplate} className="tnum summa">{rubli(kOplate)}</span>
        </p>

        <Soglasie beda={bedaSoglasiya} />

        {/* ⚠️ ПОДСКАЗКА ПРО VPN СТОИТ ПРЯМО ПЕРЕД ПЕРЕХОДОМ К ОПЛАТЕ,
            и она не предупреждение. С включённым VPN страница
            подтверждения банка (3-D Secure, `acs1.sbrf.ru` у Сбера)
            ОБРЫВАЕТ соединение: российские банки зарубежных адресов
            не пускают. Человек видит ERR_CONNECTION_CLOSED и решает,
            что сломан наш сайт.
            ⚠️ И ОНА НЕ ПЫТАЕТСЯ УГАДАТЬ, ВКЛЮЧЁН ЛИ VPN. Угадывание
            по часовому поясу или по адресу ошибается в обе стороны,
            а цена ошибки — красная плашка человеку, у которого всё
            в порядке. Спокойная строка мелким набором стоит всегда,
            когда в деле есть банк.
            ⚠️ С ТРИДЦАТЬ ТРЕТЬЕЙ ИТЕРАЦИИ ЭТО ПЛАШКА, А НЕ СТРОКА:
            серая строка в ряду других терялась. Подложка светлее
            панели, углы скруглены общим токеном, красного и значка
            тревоги нет вовсе — это подсказка, а не ошибка. */}
        {kOplate > 0 ? (
          <p className="panel__note panel__note--plate">{VPN_OPLATA_TEKST}</p>
        ) : null}

        <button type="submit" className="btn btn--wide" disabled={idyot || uhodim || promoIdyot || cena <= 0}>
          {idyot || uhodim
            ? uhodim
              ? 'Переходим к оплате…'
              : 'Оформляем…'
            : kOplate > 0
              ? `Перейти к оплате · ${rubli(kOplate)}`
              : 'Оформить'}
        </button>
      </div>
    </form>
  );
}

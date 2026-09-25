'use client';

import { useActionState, useState } from 'react';
import { Soglasie } from './Soglasie';
import { deystvieOformit, type Otvet } from '@/lib/server/actions-client';
import { rubli } from '@/lib/server/money';
import { cel, CELI } from '@/lib/metrika';
import { Pole, PoleParolya } from './Polya';
import { parolNeGoditsya, pochtaNeVerna, PRAVILO_PAROLYA } from '@/lib/proverka';

export type SrokVybor = { period: number; kop: number; label: string };

export type Vvod = {
  planId: string;
  planName: string;
  people: number;
  sertifikat: boolean;
  sroki: SrokVybor[];
  periodPoUmolchaniyu: number;
  rezhimPoUmolchaniyu: 'new' | 'renew';
  /** Почты из заказа, который продлевают по ссылке из письма. */
  pochtyPoUmolchaniyu: string[];
  balansKop: number;
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
  const [period, setPeriod] = useState<number>(vvod.periodPoUmolchaniyu);
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
  const [bedaSoglasiya, setBedaSoglasiya] = useState<string | null>(null);
  const [otvet, oformit, idyot] = useActionState<Otvet, FormData>(deystvieOformit, {});

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
    const svezhie = dannye.map((d) => ({
      login: pochtaNeVerna(d.login),
      password: parolNeGoditsya(d.password),
    }));
    setBedy(svezhie);
    const soglasie = (document.querySelector('input[name="consent"]') as HTMLInputElement | null)?.checked;
    setBedaSoglasiya(soglasie ? null : 'Без согласия оформить заказ нельзя');
    return Boolean(soglasie) && svezhie.every((b) => !b.login && !b.password);
  };

  const cena = vvod.sroki.find((s) => s.period === period)?.kop ?? 0;
  const sBalansa = tratit ? Math.min(vvod.balansKop, cena) : 0;
  const kOplate = cena - sBalansa;

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
      <input type="hidden" name="plan" value={vvod.planId} />
      <input type="hidden" name="period" value={period} />
      {/* ⚠️ СЕРТИФИКАТ — ПРИЗНАК, А НЕ ТАРИФ (Р-93). Тариф и срок
          у него настоящие, и цена берётся у них; на сервере признак
          означает ровно одно: участников не спрашиваем, а после
          оплаты выдаём код. */}
      {vvod.sertifikat ? <input type="hidden" name="gift" value="1" /> : null}

      {otvet.oshibka ? <p className="err">{otvet.oshibka}</p> : null}

      <div className="panel">
        <h2 className="panel__h">Срок</h2>
        <div className="pick" role="radiogroup" aria-label="Срок подписки">
          {vvod.sroki.map((s) => (
            <button
              key={s.period}
              type="button"
              role="radio"
              aria-checked={period === s.period}
              className="pick__btn"
              onClick={() => setPeriod(s.period)}
            >
              {s.label} · {rubli(s.kop)}
            </button>
          ))}
        </div>
      </div>

      {!vvod.sertifikat ? (
        <div className="panel">
          <h2 className="panel__h">
            {vvod.people === 1 ? 'Аккаунт' : `Аккаунты — ${vvod.people}`}
          </h2>
          {rezhimy.map((r, i) => (
            <div key={i} style={{ marginBottom: i === rezhimy.length - 1 ? 0 : 24 }}>
              {vvod.people > 1 ? <p className="field__label">Участник {i + 1}</p> : null}
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
          <p className="panel__note">
            {rezhimy.includes('renew')
              ? 'Пароль нужен, чтобы включить Premium на аккаунте. Он хранится зашифрованным, виден только исполнителю заказа и стирается через семь дней после его закрытия.'
              : 'Аккаунт заведём мы — на указанную почту и с указанным паролем. Пароль хранится зашифрованным, виден только исполнителю заказа и стирается через семь дней после закрытия заказа.'}
          </p>
        </div>
      ) : (
        <div className="panel">
          <h2 className="panel__h">Сертификат</h2>
          <p className="panel__note" style={{ marginTop: 0 }}>
            После оплаты код придёт вам на почту и появится в личном кабинете. Тариф и срок
            зашиты в коде: тот, кому вы его подарите, введёт код на сайте, увидит, что
            подарено, и сам выберет — завести новый аккаунт или продлить свой.
            {vvod.people > 1
              ? ` Аккаунтов в этом тарифе ${vvod.people}, и все ${vvod.people} он оформит сам.`
              : ''}
          </p>
        </div>
      )}

      <div className="panel">
        <h2 className="panel__h">К оплате</h2>
        <p className="sum">
          <span>{vvod.planName}</span>
          {/* ⚠️ `key` ПО ЗНАЧЕНИЮ — ЭТО И ЕСТЬ ВЕСЬ ПРИЁМ. Сменился
              срок — React монтирует другой узел, и анимация появления
              играет заново: число «пересчитывается с движением», как
              и просили. Без ключа узел тот же, анимация уже отыграла,
              и цифра менялась бы молча. */}
          <span key={cena} className="tnum summa">{rubli(cena)}</span>
        </p>
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
          <p className="panel__note panel__note--plate">
            Если у вас включён VPN, выключите его на время оплаты — банк может не
            пропустить платёж.
          </p>
        ) : null}

        <button type="submit" className="btn btn--wide" disabled={idyot || cena <= 0}>
          {idyot ? 'Оформляем…' : kOplate > 0 ? `Перейти к оплате · ${rubli(kOplate)}` : 'Оформить'}
        </button>
      </div>
    </form>
  );
}

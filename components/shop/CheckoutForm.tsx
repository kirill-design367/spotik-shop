'use client';

import { useActionState, useState } from 'react';
import { deystvieOformit, type Otvet } from '@/lib/server/actions-client';
import { rubli } from '@/lib/server/money';

export type SrokVybor = { period: number; kop: number; label: string };

export type Vvod = {
  planId: string;
  planName: string;
  people: number;
  sertifikat: boolean;
  sroki: SrokVybor[];
  periodPoUmolchaniyu: number;
  rezhimPoUmolchaniyu: 'new' | 'renew';
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
 * У каждого участника ровно два пути:
 *   НОВЫЙ АККАУНТ    — человек не вводит ничего, аккаунт заводит оператор;
 *   ПРОДЛИТЬ СВОЙ    — человек вводит почту и пароль СВОЕГО аккаунта
 *                      Spotify. Пароль уезжает на сервер и ложится
 *                      в базу только зашифрованным.
 */
export default function CheckoutForm({ vvod }: { vvod: Vvod }) {
  const [period, setPeriod] = useState<number>(vvod.periodPoUmolchaniyu);
  const [rezhimy, setRezhimy] = useState<('new' | 'renew')[]>(
    Array.from({ length: vvod.sertifikat ? 0 : vvod.people }, () => vvod.rezhimPoUmolchaniyu),
  );
  const [tratit, setTratit] = useState(vvod.balansKop > 0);
  const [otvet, oformit, idyot] = useActionState<Otvet, FormData>(deystvieOformit, {});

  const cena = vvod.sroki.find((s) => s.period === period)?.kop ?? 0;
  const sBalansa = tratit ? Math.min(vvod.balansKop, cena) : 0;
  const kOplate = cena - sBalansa;

  return (
    <form action={oformit}>
      <input type="hidden" name="plan" value={vvod.planId} />
      <input type="hidden" name="period" value={period} />

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
              {r === 'new' ? (
                <p className="panel__note">
                  Вводить ничего не нужно: мы заведём аккаунт сами и пришлём логин с паролем
                  в личный кабинет.
                </p>
              ) : (
                <div className="row2">
                  <label className="field">
                    <span className="field__label">Почта аккаунта Spotify</span>
                    <input type="email" name={`login${i}`} required autoComplete="off" />
                  </label>
                  <label className="field">
                    <span className="field__label">Пароль от аккаунта Spotify</span>
                    <input type="password" name={`password${i}`} required autoComplete="off" />
                  </label>
                </div>
              )}
            </div>
          ))}
          {rezhimy.includes('renew') ? (
            <p className="panel__note">
              Пароль нужен, чтобы включить Premium на вашем аккаунте. Он хранится
              зашифрованным, виден только исполнителю заказа и стирается через семь дней
              после его закрытия.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="panel">
          <h2 className="panel__h">Сертификат</h2>
          <p className="panel__note" style={{ marginTop: 0 }}>
            После оплаты код придёт вам на почту и появится в личном кабинете. Тот, кому вы
            его подарите, введёт код на сайте и сам выберет: завести новый аккаунт или
            продлить свой.
          </p>
        </div>
      )}

      <div className="panel">
        <h2 className="panel__h">К оплате</h2>
        <p className="sum">
          <span>{vvod.planName}</span>
          <span className="tnum">{rubli(cena)}</span>
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
          <span className="tnum">{rubli(kOplate)}</span>
        </p>

        <label className="check">
          <input type="checkbox" name="consent" required />
          <span>
            Согласен на обработку персональных данных согласно{' '}
            <a href="/privacy/" target="_blank" rel="noreferrer">
              политике конфиденциальности
            </a>
            .
          </span>
        </label>

        <button type="submit" className="btn btn--wide" disabled={idyot || cena <= 0}>
          {idyot ? 'Оформляем…' : kOplate > 0 ? `Перейти к оплате · ${rubli(kOplate)}` : 'Оформить'}
        </button>
      </div>
    </form>
  );
}

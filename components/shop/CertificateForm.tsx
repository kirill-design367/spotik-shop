'use client';

import { useActionState, useState } from 'react';
import { Pole, PoleParolya } from './Polya';
import { parolNeGoditsya, pochtaNeVerna, PRAVILO_PAROLYA } from '@/lib/proverka';
import { Soglasie } from './Soglasie';
import { deystvieAktivirovat, deystvieProveritKodSertifikata, type Otvet } from '@/lib/server/actions-client';
import { cel, CELI, BEZ_ZAPISI } from '@/lib/metrika';

/**
 * Активация сертификата.
 *
 * Шаг первый — код: проверяем его до входа, чтобы человек не заводил
 * сессию ради чужой опечатки. Шаг второй — вход (если нужен) и выбор
 * аккаунта. Заказ уходит оператору без оплаты: деньги взяты
 * при покупке сертификата.
 *
 * ⚠️ СКОЛЬКО УЧАСТНИКОВ — ГОВОРИТ КОД, А НЕ ФОРМА (Р-93). Сертификат
 * дарит любой тариф, и «на двоих» означает два аккаунта: число мест
 * приходит с сервера вместе с ответом «код принят» и там же
 * проверяется заново при активации. Поле в разметке человек правит
 * в браузере за секунду, и сертификат «на одного» оформлялся бы
 * на троих.
 */
export default function CertificateForm({ voshyol }: { voshyol: boolean }) {
  const [proverka, proverit, idyot1] = useActionState<Otvet, FormData>(deystvieProveritKodSertifikata, {});
  const [itog, aktivirovat, idyot2] = useActionState<Otvet, FormData>(deystvieAktivirovat, {});
  const [kod, setKod] = useState('');
  const [rezhimy, setRezhimy] = useState<Record<number, 'new' | 'renew'>>({});
  const [dannye, setDannye] = useState<Record<number, { login: string; password: string }>>({});
  const [bedy, setBedy] = useState<Record<number, { login: string | null; password: string | null }>>({});
  const [bedaSoglasiya, setBedaSoglasiya] = useState<string | null>(null);

  const pravitDannye = (i: number, klyuch: 'login' | 'password', v: string) => {
    setDannye((s) => ({ ...s, [i]: { ...(s[i] ?? { login: '', password: '' }), [klyuch]: v } }));
    setBedy((s) => ({ ...s, [i]: { ...(s[i] ?? { login: null, password: null }), [klyuch]: null } }));
  };

  /* Отказ при активации несёт те же сведения о подарке, что и проверка
     кода: иначе после неверно заполненного поля форма схлопнулась бы
     в один аккаунт, и на «двоих» пришлось бы начинать заново. */
  const dar = itog.dar ?? proverka.dar;
  const kodPrinyat = proverka.shag === 'vybor' && Boolean(dar);
  const mest = dar?.mest ?? 1;

  /** Проверка перед активацией — та же, что в оформлении. */
  const vsyoLiVerno = (): boolean => {
    const svezhie: Record<number, { login: string | null; password: string | null }> = {};
    let chisto = true;
    for (let i = 0; i < mest; i += 1) {
      const d = dannye[i] ?? { login: '', password: '' };
      svezhie[i] = { login: pochtaNeVerna(d.login), password: parolNeGoditsya(d.password) };
      if (svezhie[i]!.login || svezhie[i]!.password) chisto = false;
    }
    setBedy(svezhie);
    const soglasie = (document.querySelector('input[name="consent"]') as HTMLInputElement | null)?.checked;
    setBedaSoglasiya(soglasie ? null : 'Без согласия активировать сертификат нельзя');
    return chisto && Boolean(soglasie);
  };

  return (
    <>
      <form action={proverit} className="panel">
        <h2 className="panel__h">Код сертификата</h2>
        {proverka.oshibka ? <p className="err">{proverka.oshibka}</p> : null}
        <label className="field">
          <span className="field__label">SPOTIK-XXXX-XXXX-XXXX</span>
          <input
            type="text"
            name="code"
            required
            autoComplete="off"
            spellCheck={false}
            className={BEZ_ZAPISI}
            value={kod}
            onChange={(e) => setKod(e.target.value)}
            placeholder="SPOTIK-"
          />
        </label>
        <button type="submit" className="btn btn--wide" disabled={idyot1}>
          {idyot1 ? 'Проверяем…' : kodPrinyat ? 'Проверить другой код' : 'Проверить код'}
        </button>
      </form>

      {kodPrinyat ? (
        <div className="panel">
          <h2 className="panel__h">Вам подарено</h2>
          <p className="sum sum--total" style={{ marginTop: 0 }}>
            <span>{dar!.chto}</span>
            <span className="tnum">{mest === 1 ? '1 аккаунт' : `${mest} аккаунта`}</span>
          </p>
          <p className="panel__note">
            Платить ничего не нужно: сертификат уже оплачен. Осталось решить, куда включать
            Premium{mest > 1 ? ' по каждому аккаунту' : ''}.
          </p>
        </div>
      ) : null}

      {kodPrinyat && voshyol ? (
        /* ⚠️ ЦЕЛЬ НА ОТПРАВКЕ, А НЕ НА УДАЧЕ: действие уводит
           в кабинет перенаправлением, а в кабинете счётчика нет
           вовсе — по постановке. Отступление названо в отчёте. */
        <form
          action={aktivirovat}
          noValidate
          onSubmit={(e) => {
            if (!vsyoLiVerno()) {
              e.preventDefault();
              return;
            }
            cel(CELI.sertifikatAktivirovan);
          }}
          className="panel"
        >
          <h2 className="panel__h">{mest === 1 ? 'Куда включать Premium' : `Куда включать Premium — ${mest} аккаунта`}</h2>
          {itog.oshibka ? <p className="err">{itog.oshibka}</p> : null}
          <input type="hidden" name="code" value={kod} />

          {Array.from({ length: mest }, (_, i) => {
            const rezhim = rezhimy[i] ?? 'new';
            return (
              <div key={i} style={{ marginBottom: i === mest - 1 ? 0 : 24 }}>
                {mest > 1 ? <p className="field__label">Участник {i + 1}</p> : null}
                <input type="hidden" name={`mode${i}`} value={rezhim} />
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
                      aria-checked={rezhim === k}
                      className="pick__btn"
                      onClick={() => setRezhimy((s) => ({ ...s, [i]: k }))}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                {/* Данные аккаунта человек вводит в обоих случаях —
                    как и в оформлении (тридцать четвёртая итерация). */}
                <div className="row2">
                  <Pole
                    imya={`login${i}`}
                    tip="email"
                    podpis={rezhim === 'new' ? 'Почта для нового аккаунта Spotify' : 'Почта аккаунта Spotify'}
                    znachenie={dannye[i]?.login ?? ''}
                    menyat={(v) => pravitDannye(i, 'login', v)}
                    beda={bedy[i]?.login}
                    podskazka={
                      rezhim === 'new'
                        ? 'Мы заведём аккаунт на неё и включим Premium'
                        : 'Та, на которую заведён аккаунт Spotify'
                    }
                  />
                  <PoleParolya
                    imya={`password${i}`}
                    podpis={rezhim === 'new' ? 'Пароль, который мы поставим' : 'Пароль от аккаунта Spotify'}
                    znachenie={dannye[i]?.password ?? ''}
                    menyat={(v) => pravitDannye(i, 'password', v)}
                    beda={bedy[i]?.password}
                    podskazka={PRAVILO_PAROLYA}
                  />
                </div>
              </div>
            );
          })}

          <Soglasie beda={bedaSoglasiya} />
          <button type="submit" className="btn btn--wide" disabled={idyot2}>
            {idyot2 ? 'Активируем…' : 'Активировать сертификат'}
          </button>
        </form>
      ) : null}
    </>
  );
}

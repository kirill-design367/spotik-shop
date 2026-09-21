'use client';

import { useActionState, useState } from 'react';
import { deystvieAktivirovat, deystvieProveritKodSertifikata, type Otvet } from '@/lib/server/actions-client';

/**
 * Активация сертификата.
 *
 * Шаг первый — код: проверяем его до входа, чтобы человек не заводил
 * сессию ради чужой опечатки. Шаг второй — вход (если нужен) и выбор
 * аккаунта. Заказ уходит оператору без оплаты: деньги взяты
 * при покупке сертификата.
 */
export default function CertificateForm({ voshyol }: { voshyol: boolean }) {
  const [proverka, proverit, idyot1] = useActionState<Otvet, FormData>(deystvieProveritKodSertifikata, {});
  const [itog, aktivirovat, idyot2] = useActionState<Otvet, FormData>(deystvieAktivirovat, {});
  const [kod, setKod] = useState('');
  const [rezhim, setRezhim] = useState<'new' | 'renew'>('new');

  const kodPrinyat = proverka.shag === 'vybor';

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
            value={kod}
            onChange={(e) => setKod(e.target.value)}
            placeholder="SPOTIK-"
          />
        </label>
        <button type="submit" className="btn btn--wide" disabled={idyot1}>
          {idyot1 ? 'Проверяем…' : kodPrinyat ? 'Проверить другой код' : 'Проверить код'}
        </button>
      </form>

      {kodPrinyat && voshyol ? (
        <form action={aktivirovat} className="panel">
          <h2 className="panel__h">Куда включать Premium</h2>
          {itog.oshibka ? <p className="err">{itog.oshibka}</p> : null}
          <input type="hidden" name="code" value={kod} />
          <input type="hidden" name="mode0" value={rezhim} />
          <div className="pick" role="radiogroup" aria-label="Аккаунт">
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
                onClick={() => setRezhim(k)}
              >
                {t}
              </button>
            ))}
          </div>
          {rezhim === 'renew' ? (
            <div className="row2">
              <label className="field">
                <span className="field__label">Почта аккаунта Spotify</span>
                <input type="email" name="login0" required autoComplete="off" />
              </label>
              <label className="field">
                <span className="field__label">Пароль от аккаунта Spotify</span>
                <input type="password" name="password0" required autoComplete="off" />
              </label>
            </div>
          ) : (
            <p className="panel__note">
              Вводить ничего не нужно: мы заведём аккаунт сами и пришлём логин с паролем
              в личный кабинет.
            </p>
          )}
          <label className="check">
            <input type="checkbox" name="consent" required />
            <span>
              Согласен на обработку персональных данных согласно{' '}
              <a href="/privacy/" target="_blank" rel="noreferrer">политике конфиденциальности</a>.
            </span>
          </label>
          <button type="submit" className="btn btn--wide" disabled={idyot2}>
            {idyot2 ? 'Активируем…' : 'Активировать сертификат'}
          </button>
        </form>
      ) : null}
    </>
  );
}

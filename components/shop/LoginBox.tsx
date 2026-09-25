'use client';

import { useActionState } from 'react';
import { deystviePrositKod, deystvieVoyti, type Otvet } from '@/lib/server/actions-client';
import { BEZ_ZAPISI } from '@/lib/metrika';

/**
 * Вход по коду на почту. Паролей нет вовсе.
 *
 * ⚠️ ДВА ДЕЙСТВИЯ, А НЕ ОДНА ФОРМА С ВЕТКОЙ. Первое просит код,
 * второе его проверяет. Одной формой это делалось бы «если поле
 * кода пустое — значит запросить», и первый же человек, отправивший
 * пустой код случайно, получил бы второе письмо вместо ошибки.
 *
 * ⚠️ РАБОТАЕТ ПРЯМО НА СТРАНИЦЕ ОФОРМЛЕНИЯ, без ухода на отдельный
 * вход — прямое требование постановки. Поэтому `next` передаётся
 * адресом возврата, а не берётся из истории.
 */
export default function LoginBox({ next, zagolovok }: { next: string; zagolovok?: string }) {
  const [prosil, prositKod, idyot1] = useActionState<Otvet, FormData>(deystviePrositKod, {});
  const [voshyol, voyti, idyot2] = useActionState<Otvet, FormData>(deystvieVoyti, {});

  const email = voshyol.email || prosil.email || '';
  const kodZaproshen = prosil.shag === 'kod' || voshyol.shag === 'kod';
  const oshibka = voshyol.oshibka || prosil.oshibka;

  return (
    <div className="panel">
      <h2 className="panel__h">{zagolovok ?? 'Вход по коду из письма'}</h2>
      {oshibka ? <p className="err">{oshibka}</p> : null}

      {!kodZaproshen ? (
        <form action={prositKod}>
          <label className="field">
            <span className="field__label">Почта</span>
            <input type="email" name="email" required autoComplete="email" className={BEZ_ZAPISI} defaultValue={email} placeholder="you@example.com" />
          </label>
          {/* ⚠️ СТРОКА СТОИТ ПОД ПОЛЕМ ПОЧТЫ, А НЕ ГАЛОЧКОЙ. Вход
              по коду — это не оформление заказа: галочку здесь человек
              снять не может, и превращать её в препятствие незачем.
              Мелким набором, ссылкой на сам документ. */}
          <p className="panel__note">
            Продолжая, вы соглашаетесь с{' '}
            <a href="/politika/" target="_blank" rel="noreferrer">политикой конфиденциальности</a>.
          </p>
          <button type="submit" className="btn btn--wide" disabled={idyot1}>
            {idyot1 ? 'Отправляем…' : 'Получить код'}
          </button>
          <p className="panel__note">
            Пароля у нас нет: мы присылаем шестизначный код. Он действует десять минут.
          </p>
        </form>
      ) : (
        <form action={voyti}>
          <input type="hidden" name="email" value={email} />
          <input type="hidden" name="next" value={next} />
          <label className="field">
            <span className="field__label">Код из письма на {email}</span>
            <input
              type="text"
              name="code"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              className={BEZ_ZAPISI}
              maxLength={6}
              placeholder="000000"
            />
          </label>
          <button type="submit" className="btn btn--wide" disabled={idyot2}>
            {idyot2 ? 'Проверяем…' : 'Войти'}
          </button>
          <p className="panel__note">
            Не пришло? Проверьте папку «Спам». Новый код можно запросить через минуту.
          </p>
        </form>
      )}
    </div>
  );
}

'use client';

import { useActionState } from 'react';
import { deystvieOplatit, type Otvet } from '@/lib/server/actions-client';
import { useUhodNaOplatu } from './uhod';

/**
 * «Оплатить» в кабинете.
 *
 * ⚠️ КЛИЕНТСКИЙ КОМПОНЕНТ ЗДЕСЬ НУЖЕН РОВНО ЗАТЕМ, ЧТОБЫ УЙТИ
 * НА РОБОКАССУ БРАУЗЕРОМ. Прежняя кнопка была обычной формой
 * в серверной разметке, а действие делало `redirect()` на чужой
 * домен — и возврат назад ронял сайт (см. `uhod.ts`, Р-143).
 *
 * Отказ показывается строкой рядом с кнопкой: раньше он уходил
 * в `?error=pay`, и человек видел кабинет без единого следа нажатия.
 */
export default function KnopkaOplaty({ zakaz, podpis }: { zakaz: number; podpis: string }) {
  const [otvet, oplatit, idyot] = useActionState<Otvet, FormData>(deystvieOplatit, {});
  useUhodNaOplatu(otvet.kuda);
  return (
    <form action={oplatit}>
      <input type="hidden" name="order" value={zakaz} />
      <button type="submit" className="btn btn--sm" disabled={idyot || Boolean(otvet.kuda)}>
        {idyot || otvet.kuda ? 'Переходим к оплате…' : podpis}
      </button>
      {otvet.oshibka ? <p className="field__beda">{otvet.oshibka}</p> : null}
    </form>
  );
}

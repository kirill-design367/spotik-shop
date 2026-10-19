import type { ReactNode } from 'react';
import { PODSTANOVKI_DANNYE, type Klyuch, type Perevod, type Podstanovki } from '@/lib/admin/slova';
import { frazaSDannymi } from '@/components/Bukvalno';

/**
 * Надпись админки с подстановками — узлами, а не строкой.
 *
 * То же, что `t(k, p)`, только почты из подстановок (`PODSTANOVKI_DANNYE`)
 * встают своими узлами под `translate="no"`: переводчик браузера
 * переводит фразу вокруг и не трогает адрес внутри (Р-166). Звать
 * её надо везде, где в надпись может приехать почта, — и у ответов
 * серверных действий тоже: их `polya` несут адрес сотрудника.
 */
export function nadpis(t: Perevod, k: Klyuch, p?: Podstanovki): ReactNode {
  const dannye: Record<string, string> = {};
  const prochee: Podstanovki = {};
  for (const [imya, v] of Object.entries(p ?? {})) {
    if (PODSTANOVKI_DANNYE.includes(imya)) dannye[imya] = String(v);
    else prochee[imya] = v;
  }
  /* Без почты фраза остаётся СТРОКОЙ: одна строка внутри элемента —
     это `textContent`, и подмена узлов переводчиком React не мешает. */
  if (!Object.keys(dannye).length) return t(k, prochee);
  return frazaSDannymi((metki) => t(k, { ...prochee, ...metki }), dannye);
}

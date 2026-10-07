'use client';

import { useActionState, useState } from 'react';
import { adminOtmenitVypolnenny, type OtvetA } from '@/lib/server/actions-admin';
import { slovar, type Yazyk } from '@/lib/admin/slova';

/**
 * «Отменить» у выполненного заказа в «Недавно закрытых».
 *
 * Постановка сорок девятой итерации: «„Отменить" у выполненного заказа
 * спрашивает подтверждение. Затем создаётся задача „Отмена подписки"».
 *
 * ⚠️ СПРАШИВАЕМ СВОИМ БЛОКОМ, А НЕ `confirm()`: системное окно приходит
 * шрифтом и языком системы, а админка двуязычная (Р-145). Вопрос
 * называет последствия прямо — деньги не возвращаются, письма нет:
 * «Вы уверены?» без них спрашивает не о том.
 *
 * ⚠️ ОТВЕТ ОДИН НА СТРОКУ, И ОН ЗДЕСЬ ЖЕ: после удачи строка сама
 * перерисуется «отменён» (страница перечитана `revalidatePath`),
 * а сообщение говорит, кому ушла задача.
 *
 * ⚠️ ПОЭТОМУ КОМПОНЕНТ СТОИТ В СТРОКЕ И ПОСЛЕ ОТМЕНЫ (`mozhno = false`),
 * а не снимается вместе с кнопкой. Сними его страница — React потерял
 * бы состояние, и сообщение «задача ушла такому-то» исчезало бы в тот
 * же миг, что и появлялось: поймано ручной проверкой.
 */
export default function OtmenaVypolnennogo({ zakaz, y, mozhno }: { zakaz: number; y: Yazyk; mozhno: boolean }) {
  const t = slovar(y);
  const [sprosili, setSprosili] = useState(false);
  const [otvet, otmenit, idyot] = useActionState<OtvetA, FormData>(adminOtmenitVypolnenny, {});

  if (otvet.ok) return <span className="ok">{t(otvet.ok, otvet.polya)}</span>;
  if (!mozhno) return null;

  return (
    <form action={otmenit} className="ad__otmena-v">
      <input type="hidden" name="order" value={zakaz} />
      {otvet.error ? <span className="err">{t(otvet.error, otvet.polya)}</span> : null}
      {!sprosili ? (
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSprosili(true)}>
          {t('sc.cancel')}
        </button>
      ) : (
        <span className="ad__sure ad__sure--v-stroke">
          <span>{t('sc.sure')}</span>
          <span className="ad__actions">
            <button type="submit" className="btn btn--sm" disabled={idyot}>
              {idyot ? t('z.cancelling') : t('w.yes')}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSprosili(false)} disabled={idyot}>
              {t('w.no')}
            </button>
          </span>
        </span>
      )}
    </form>
  );
}

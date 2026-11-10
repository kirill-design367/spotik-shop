'use client';

import { useActionState, useState } from 'react';
import { deystvieOtzyv, type Otvet } from '@/lib/server/actions-client';
import { IMYA_MAX, TEKST_MAX, bedaImeni, bedaTeksta, chistyTekst, znakov } from '@/lib/otzyv';

/**
 * «Оставить отзыв» у выполненного заказа (пятьдесят четвёртая итерация).
 *
 * Свёрнута до кнопки: форма в каждой карточке выполненного заказа
 * развернула бы кабинет на экран вниз.
 *
 * ⚠️ У ФОРМЫ НЕТ `data-otmena`, И ЭТО НЕ ЗАБЫВЧИВОСТЬ: по этому признаку
 * `Svorachivanie` схлопывает карточку заказа, а отзыв карточку
 * не убирает — она остаётся со строкой «Отзыв на проверке».
 *
 * ⚠️ ПОЛЕ ИМЕНИ ПУСТОЕ, И ЗАРАНЕЕ ЕГО НЕ ЗАПОЛНЯЕТ НИЧТО — ни почта,
 * ни её часть (поправка после рецензии): имя появится на открытой
 * странице, и подставь мы туда почту, человек мог бы опубликовать её,
 * не заметив. Отсюда же `autoComplete="off"`.
 *
 * ⚠️ СОГЛАСИЕ НА ПУБЛИКАЦИЮ — ОТДЕЛЬНАЯ ГАЛОЧКА, ПО УМОЛЧАНИЮ СНЯТАЯ.
 * Имя и текст распространяются на открытой странице (152-ФЗ, ст. 10.1),
 * поэтому согласие отдельное, а без него отправить нельзя — и проверка
 * стоит на сервере, а не только здесь. Имя галочки не `consent`: так
 * называется согласие оформления, и его ищут по имени.
 *
 * Правила длины — те же `lib/otzyv.ts`, что на сервере.
 */
export default function OtzyvForma({
  zakaz,
  status,
}: {
  zakaz: number;
  /** Отзыв уже есть — его статус; нет — `null`. */
  status: 'moderaciya' | 'opublikovan' | 'skryt' | null;
}) {
  const [otkryt, setOtkryt] = useState(false);
  const [otvet, otpravit, idyot] = useActionState<Otvet, FormData>(deystvieOtzyv, {});
  const [imya, setImya] = useState('');
  const [tekst, setTekst] = useState('');
  const [soglasie, setSoglasie] = useState(false);
  const [beda, setBeda] = useState<{ imya: string | null; tekst: string | null; soglasie: string | null }>({
    imya: null,
    tekst: null,
    soglasie: null,
  });

  /* ⚠️ «СПАСИБО» ЖИВЁТ ЗДЕСЬ, А СТРОКУ СТАТУСА РИСУЕТ ЭТОТ ЖЕ
     КОМПОНЕНТ. После отправки страница перерисовывается, и отзыв
     у заказа уже есть: нарисуй строку страница, а форму — отдельная
     ветка, и форма снялась бы вместе с ответом действия — «Спасибо»
     не увидел бы никто (тот же урок, что у «Отменить», Р-160). */
  if (otvet.ladno === 'otzyv') {
    return <p className="ok otzyv-forma__ok">Спасибо! Отзыв ушёл на проверку — после неё он появится на главной.</p>;
  }
  /* Скрытый клиенту словом «скрыт» не называется. */
  if (status) {
    return (
      <p className="panel__note otzyv-status">
        {status === 'moderaciya' ? 'Отзыв на проверке' : status === 'opublikovan' ? 'Отзыв опубликован' : 'Спасибо за отзыв'}
      </p>
    );
  }

  if (!otkryt) {
    return (
      <div className="otzyv-forma__start">
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOtkryt(true)}>
          Оставить отзыв
        </button>
      </div>
    );
  }

  const n = znakov(chistyTekst(tekst));
  const id = `otz-${zakaz}`;
  return (
    <form
      action={otpravit}
      noValidate
      className="otzyv-forma"
      onSubmit={(e) => {
        const svezhie = {
          imya: bedaImeni(imya),
          tekst: bedaTeksta(tekst),
          soglasie: soglasie ? null : 'Отметьте согласие на публикацию',
        };
        setBeda(svezhie);
        if (svezhie.imya || svezhie.tekst || svezhie.soglasie) e.preventDefault();
      }}
    >
      <input type="hidden" name="order" value={zakaz} />
      {otvet.oshibka ? <p className="err">{otvet.oshibka}</p> : null}
      <p className="panel__note otzyv-forma__pro">
        Имя (или ник) и текст появятся на главной странице после проверки.
      </p>

      <div className="field">
        <label className="field__label" htmlFor={`${id}-imya`}>Имя или ник</label>
        <input
          id={`${id}-imya`}
          type="text"
          name="otzyv_imya"
          value={imya}
          autoComplete="off"
          spellCheck={false}
          translate="no"
          aria-invalid={beda.imya ? true : undefined}
          onChange={(e) => {
            setImya(e.target.value);
            setBeda((b) => ({ ...b, imya: null }));
          }}
        />
        {beda.imya ? (
          <p className="field__beda">{beda.imya}</p>
        ) : (
          <p className="field__hint">До {IMYA_MAX} знаков</p>
        )}
      </div>

      <div className="field">
        <label className="field__label" htmlFor={`${id}-tekst`}>Отзыв</label>
        <textarea
          id={`${id}-tekst`}
          name="otzyv_tekst"
          rows={5}
          value={tekst}
          translate="no"
          aria-invalid={beda.tekst ? true : undefined}
          aria-describedby={`${id}-schet`}
          onChange={(e) => {
            setTekst(e.target.value);
            setBeda((b) => ({ ...b, tekst: null }));
          }}
        />
        {/* Счётчик под полем — поправка после рецензии: предел в 600 знаков
            человек должен видеть ДО отправки, а не узнать из отказа. */}
        <p
          id={`${id}-schet`}
          className={`otzyv-forma__schet tnum${n > TEKST_MAX ? ' otzyv-forma__schet--mnogo' : ''}`}
        >
          {n} / {TEKST_MAX}
        </p>
        {beda.tekst ? <p className="field__beda">{beda.tekst}</p> : null}
      </div>

      <label className="check">
        <input
          type="checkbox"
          name="soglasie_otzyv"
          checked={soglasie}
          onChange={(e) => {
            setSoglasie(e.target.checked);
            setBeda((b) => ({ ...b, soglasie: null }));
          }}
          aria-invalid={beda.soglasie ? true : undefined}
        />
        <span>Согласен на публикацию имени и текста отзыва на сайте</span>
      </label>
      {beda.soglasie ? <p className="field__beda otzyv-forma__beda">{beda.soglasie}</p> : null}

      <div className="otzyv-forma__knopki">
        <button type="submit" className="btn btn--sm" disabled={idyot}>
          {idyot ? 'Отправляем…' : 'Отправить'}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOtkryt(false)} disabled={idyot}>
          Отмена
        </button>
      </div>
    </form>
  );
}

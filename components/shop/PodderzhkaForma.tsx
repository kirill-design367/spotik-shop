'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { deystvieKtoYa, deystvieObrashchenie, type Otvet } from '@/lib/server/actions-client';
import { svyazNeVerna } from '@/lib/proverka';
import { BEZ_ZAPISI } from '@/lib/metrika';

/**
 * Форма обращения. Два поля, как в постановке: описание проблемы
 * и удобный способ связи.
 *
 * ⚠️ ВТОРОЕ ПОЛЕ ПРИНИМАЕТ ЛИБО НИК, ЛИБО ПОЧТУ — и ничего третьего.
 * Правило живёт в `lib/proverka` и зовётся ТЕМ ЖЕ модулем на сервере:
 * форма — это то, что правится в браузере.
 *
 * ⚠️ ПОЛЕ `website` — ЛОВУШКА ДЛЯ ОБХОДЧИКА, а не забытый огрызок.
 * Человек его не видит вовсе; заполнено — обращение молча не уходит
 * никуда, и ответ при этом обычный (см. `lib/server/podderzhka.ts`).
 */
export default function PodderzhkaForma({
  pochta,
  zakryt,
}: {
  /** Почта, если страница её уже знает (кабинет). */
  pochta?: string | null;
  zakryt?: () => void;
}) {
  const [otvet, otpravit, idyot] = useActionState<Otvet, FormData>(deystvieObrashchenie, {});
  const [tekst, setTekst] = useState('');
  const [svyaz, setSvyaz] = useState(pochta ?? '');
  const [svoya, setSvoya] = useState<boolean>(Boolean(pochta));
  const [beda, setBeda] = useState<{ tekst: string | null; svyaz: string | null }>({ tekst: null, svyaz: null });
  /* ⚠️ ВРЕМЯ ОТКРЫТИЯ БЕРЁТСЯ НА ПЕРВОМ ЖЕ РЕНДЕРЕ, А НЕ В ЭФФЕКТЕ.
     Раньше `useRef(0)` и запись в эффекте: скрытое поле уезжало
     в разметку С НУЛЁМ, а ноль на сервере значит «время неизвестно,
     не отбивать» — то есть минимальное время на заполнение (закон 46)
     работало только у тех, кто набирал текст руками и тем вызывал
     перерисовку. Обходчик, заполняющий поля через DOM, эту защиту
     обходил, ничего для этого не делая. Расхождения разметки тут
     взяться неоткуда: форма клиентская и на сервере не рисуется
     вовсе. */
  const otkryto = useRef(Date.now());
  useEffect(() => {
    /* ⚠️ ПОЧТА СПРАШИВАЕТСЯ ПРИ ОТКРЫТИИ ФОРМЫ, А НЕ РИСУЕТСЯ
       РАСКЛАДКОЙ. Прочитай её раскладка — лендинг стал бы
       динамическим (закон 36). Не ответило — поле просто пустое. */
    if (pochta) return;
    let zhivo = true;
    void deystvieKtoYa()
      .then((r) => {
        if (zhivo && r.email) {
          setSvyaz((v) => (v ? v : r.email!));
          setSvoya(true);
        }
      })
      .catch(() => {});
    return () => {
      zhivo = false;
    };
  }, [pochta]);

  if (otvet.shag === 'prinyato') {
    return (
      <div>
        <p className="ok">
          Обращение принято. Ответим в рабочее время — с 10:00 до 22:00 по Москве.
        </p>
        {zakryt ? (
          <button type="button" className="btn btn--sm" onClick={zakryt}>
            Закрыть
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <form
      action={otpravit}
      noValidate
      onSubmit={(e) => {
        const svezhie = {
          tekst: tekst.trim().length >= 10 ? null : 'Опишите проблему хотя бы одним предложением',
          svyaz: svyazNeVerna(svyaz),
        };
        setBeda(svezhie);
        if (svezhie.tekst || svezhie.svyaz) e.preventDefault();
      }}
    >
      {otvet.oshibka ? <p className="err">{otvet.oshibka}</p> : null}
      <input type="hidden" name="otkryto" value={otkryto.current} />
      {/* Ловушка: скрыта от глаза и от скринридера, но заполняема. */}
      <div className="lovushka" aria-hidden="true">
        <label>
          Сайт
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="pd-tekst">Опишите вашу проблему</label>
        <textarea
          id="pd-tekst"
          name="tekst"
          rows={5}
          value={tekst}
          onChange={(e) => {
            setTekst(e.target.value);
            setBeda((b) => ({ ...b, tekst: null }));
          }}
          className={BEZ_ZAPISI}
          aria-invalid={beda.tekst ? true : undefined}
        />
        {beda.tekst ? <p className="field__beda">{beda.tekst}</p> : null}
      </div>

      <div className="field">
        <label className="field__label" htmlFor="pd-svyaz">
          Удобный способ связи: ник в Telegram или почта
        </label>
        <input
          id="pd-svyaz"
          type="text"
          name="svyaz"
          value={svyaz}
          onChange={(e) => {
            setSvyaz(e.target.value);
            setBeda((b) => ({ ...b, svyaz: null }));
          }}
          autoComplete="off"
          className={BEZ_ZAPISI}
          placeholder="@nickname или you@pochta.ru"
          aria-invalid={beda.svyaz ? true : undefined}
        />
        {beda.svyaz ? (
          <p className="field__beda">{beda.svyaz}</p>
        ) : (
          <p className="field__hint">
            {svoya ? 'Подставлена почта вашего аккаунта — её можно заменить' : 'Напишем туда, куда удобнее'}
          </p>
        )}
      </div>

      <button type="submit" className="btn btn--wide" disabled={idyot}>
        {idyot ? 'Отправляем…' : 'Отправить обращение'}
      </button>
    </form>
  );
}

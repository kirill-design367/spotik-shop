'use client';

import { useActionState, useEffect, useState } from 'react';
import { adminOtzyv, type OtvetA } from '@/lib/server/actions-admin';
import { slovar, type Perevod, type Yazyk } from '@/lib/admin/slova';
import { nadpis } from '@/components/admin/nadpis';
import { poMoskve } from '@/lib/admin/vremya';
import Bukvalno from '@/components/Bukvalno';
import { NA_GLAVNOY, POROG_POKAZA, TEKST_MAX, chistyTekst, znakov } from '@/lib/otzyv';
import type { OtzyvDlyaAdminki, StatusOtzyva } from '@/lib/server/otzyvy';

type Tarif = { id: string; imya: string };

/**
 * Отзывы: модерация, добавление, порядок (пятьдесят четвёртая итерация).
 *
 * ⚠️ СОСТОЯНИЕ ОДНО НА ВЕСЬ РАЗДЕЛ, а действие выбирает поле `op`.
 * Строка, которую опубликовали, переезжает из одного списка в другой,
 * и сообщение, живущее в ней самой, исчезало бы вместе с ней (тот же
 * урок, что у «Отменить» выполненного заказа, Р-160). Ответ встаёт
 * у формы добавления или над списками — смотря что нажимали (`step`).
 *
 * ⚠️ ОПУБЛИКОВАННЫЕ И СКРЫТЫЕ — ДВА СПИСКА (поправка после рецензии):
 * в общем списке «Выше» менялось бы и со скрытым соседом, а на сайте
 * от этого не сдвигалось бы ничего.
 *
 * ⚠️ ИМЯ И ТЕКСТ — ДАННЫЕ: под `Bukvalno` (закон 54). Их написал
 * человек, и переводчик браузера переписал бы ник вместе со словами.
 */
export default function OtzyvyAdminki({
  y,
  spiski,
  tarify,
  segodnya,
}: {
  y: Yazyk;
  spiski: Record<StatusOtzyva, OtzyvDlyaAdminki[]>;
  tarify: Tarif[];
  segodnya: string;
}) {
  const t = slovar(y);
  const en = y === 'en';
  const [st, act, idyot] = useActionState<OtvetA, FormData>(adminOtzyv, {});
  const [imya, setImya] = useState('');
  const [tekst, setTekst] = useState('');
  /* Удачно добавленный отзыв очищает форму: поля имени и текста
     ведомые (под ними счётчик), и сброс формы React до них не достаёт. */
  useEffect(() => {
    if (st.ok && st.step === 'dobavit') {
      setImya('');
      setTekst('');
    }
  }, [st]);

  const imyaTarifa = (id: string | null) => (id ? (tarify.find((x) => x.id === id)?.imya ?? id) : null);
  const nPub = spiski.opublikovan.length;
  const soobshchenie = (step: string) =>
    st.step === step ? (
      <>
        {st.error ? <p className="err">{t(st.error)}</p> : null}
        {st.ok ? <p className="ok">{nadpis(t, st.ok, st.polya)}</p> : null}
      </>
    ) : null;
  const dlina = znakov(chistyTekst(tekst));

  return (
    <>
      <h1>{t('rv.h')}</h1>
      <p className="hint">{t('rv.hint')}</p>
      <p className="hint">
        {nPub < POROG_POKAZA ? t('rv.porog', { n: nPub }) : t('rv.pokazan', { n: nPub })}
      </p>

      {soobshchenie('spisok')}

      <div className="ad__card">
        <h3>
          {t('rv.mod_h')}
          {spiski.moderaciya.length ? ` · ${spiski.moderaciya.length}` : ''}
        </h3>
        {!spiski.moderaciya.length ? <p className="hint">{t('rv.mod_none')}</p> : null}
        {spiski.moderaciya.map((o) => (
          <Stroka key={o.id} o={o} t={t} en={en} act={act} idyot={idyot} tarif={imyaTarifa(o.planId)} />
        ))}
      </div>

      <div className="ad__card">
        <h3>{t('rv.new_h')}</h3>
        {soobshchenie('dobavit')}
        <form action={act} className="ad__form" style={{ maxWidth: 'none' }}>
          <input type="hidden" name="op" value="dobavit" />
          <div className="ad__row">
            <label>
              {t('rv.imya')}
              <input
                type="text"
                name="imya"
                value={imya}
                onChange={(e) => setImya(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                translate="no"
                required
              />
            </label>
            <label>
              {t('rv.data')}
              {/* Позже сегодняшнего по Москве нельзя: `max` подсказывает
                  календарю, а проверяет всё равно сервер. */}
              <input type="date" name="data" defaultValue={segodnya} max={segodnya} required />
            </label>
            <label>
              {t('rv.tarif')}
              <select name="plan" defaultValue="">
                <option value="">{t('rv.bez_tarifa')}</option>
                {tarify.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.imya}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            {t('rv.tekst')}
            <textarea
              name="tekst"
              rows={5}
              value={tekst}
              onChange={(e) => setTekst(e.target.value)}
              translate="no"
              className="ad__textarea"
              required
            />
            <span className={`ad__schet tnum${dlina > TEKST_MAX ? ' ad__schet--mnogo' : ''}`}>
              {dlina} / {TEKST_MAX}
            </span>
          </label>
          <label className="ad__check">
            <input type="checkbox" name="srazu" defaultChecked />
            <span>{t('rv.srazu')}</span>
          </label>
          <div>
            <button type="submit" className="btn btn--sm" disabled={idyot}>
              {t('rv.dobavit')}
            </button>
          </div>
        </form>
      </div>

      <div className="ad__card">
        <h3>{t('rv.pub_h')}</h3>
        {!nPub ? <p className="hint">{t('rv.pub_none')}</p> : null}
        {spiski.opublikovan.map((o, i) => (
          <Stroka
            key={o.id}
            o={o}
            t={t}
            en={en}
            act={act}
            idyot={idyot}
            tarif={imyaTarifa(o.planId)}
            nomer={i + 1}
            naGlavnoy={i < NA_GLAVNOY}
            pervy={i === 0}
            posledny={i === nPub - 1}
          />
        ))}
      </div>

      <div className="ad__card">
        <h3>{t('rv.skr_h')}</h3>
        {!spiski.skryt.length ? <p className="hint">{t('rv.skr_none')}</p> : null}
        {spiski.skryt.map((o, i) => (
          <Stroka
            key={o.id}
            o={o}
            t={t}
            en={en}
            act={act}
            idyot={idyot}
            tarif={imyaTarifa(o.planId)}
            pervy={i === 0}
            posledny={i === spiski.skryt.length - 1}
          />
        ))}
      </div>
    </>
  );
}

/** Одна кнопка — одна маленькая форма: так `op` и `id` едут наверняка. */
function Knopka({
  act,
  op,
  id,
  podpis,
  idyot,
  glavnaya = false,
  vykl = false,
}: {
  act: (fd: FormData) => void;
  op: string;
  id: number;
  podpis: string;
  idyot: boolean;
  glavnaya?: boolean;
  vykl?: boolean;
}) {
  return (
    <form action={act}>
      <input type="hidden" name="op" value={op} />
      <input type="hidden" name="id" value={id} />
      <button type="submit" className={glavnaya ? 'btn btn--sm' : 'btn btn--ghost btn--sm'} disabled={idyot || vykl}>
        {podpis}
      </button>
    </form>
  );
}

function Stroka({
  o,
  t,
  en,
  act,
  idyot,
  tarif,
  nomer,
  naGlavnoy,
  pervy,
  posledny,
}: {
  o: OtzyvDlyaAdminki;
  t: Perevod;
  en: boolean;
  act: (fd: FormData) => void;
  idyot: boolean;
  tarif: string | null;
  nomer?: number;
  naGlavnoy?: boolean;
  pervy?: boolean;
  posledny?: boolean;
}) {
  const [sprosili, setSprosili] = useState(false);
  return (
    <div className="ad__otzyv" data-glavnaya={naGlavnoy ? '' : undefined}>
      <p className="ad__otzyv-kto">
        {nomer ? <span className="ad__otzyv-n tnum">{nomer}</span> : null}
        <b>
          <Bukvalno>{o.imya}</Bukvalno>
        </b>
        <span className="ad__otzyv-meta">
          {' · '}
          <Bukvalno className="tnum">{o.data}</Bukvalno>
          {tarif ? ` · ${tarif}` : ''}
          {' · '}
          {o.istochnik === 'klient' ? t('rv.ot_klienta') : t('rv.vruchnuyu')}
          {o.orderId ? (
            <>
              {' · '}
              <a href={`/admin/orders/${o.orderId}/`}>
                {t('t.order')} № {o.orderId}
              </a>
            </>
          ) : null}
        </span>
      </p>
      <p className="ad__otzyv-tekst">
        <Bukvalno>{o.tekst}</Bukvalno>
      </p>
      {o.status === 'moderaciya' && o.soglasie ? (
        <p className="hint">{t('rv.soglasie', { kogda: poMoskve(o.soglasie, en) })}</p>
      ) : null}
      <div className="ad__otzyv-knopki">
        {o.status !== 'opublikovan' ? (
          <Knopka act={act} op="opublikovat" id={o.id} podpis={t('rv.opublikovat')} idyot={idyot} glavnaya />
        ) : null}
        {o.status !== 'skryt' ? <Knopka act={act} op="skryt" id={o.id} podpis={t('rv.skryt')} idyot={idyot} /> : null}
        {o.status !== 'moderaciya' ? (
          <>
            <Knopka act={act} op="vyshe" id={o.id} podpis={t('rv.vyshe')} idyot={idyot} vykl={pervy} />
            <Knopka act={act} op="nizhe" id={o.id} podpis={t('rv.nizhe')} idyot={idyot} vykl={posledny} />
          </>
        ) : null}
        {/* ⚠️ УДАЛИТЬ — ТОЛЬКО ЗАВЕДЁННЫЙ ВРУЧНУЮ, и с подтверждением своим
            блоком, а не `confirm()`: админка двуязычная (Р-145). Отзыв
            клиента не удаляется — «Скрыть» и есть отзыв его согласия. */}
        {o.istochnik === 'admin' ? (
          !sprosili ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSprosili(true)} disabled={idyot}>
              {t('rv.udalit')}
            </button>
          ) : (
            <form action={act} className="ad__sure ad__sure--v-stroke">
              <input type="hidden" name="op" value="udalit" />
              <input type="hidden" name="id" value={o.id} />
              <span>{t('rv.udalit_sure')}</span>
              <span className="ad__actions">
                <button type="submit" className="btn btn--sm" disabled={idyot}>
                  {t('w.yes')}
                </button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSprosili(false)} disabled={idyot}>
                  {t('w.no')}
                </button>
              </span>
            </form>
          )
        ) : null}
      </div>
    </div>
  );
}

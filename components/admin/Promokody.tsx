'use client';

import { useActionState } from 'react';
import {
  adminPromoIzmenit,
  adminPromoOtklyuchit,
  adminPromoZavesti,
  type OtvetA,
} from '@/lib/server/actions-admin';
import { slovar, type Perevod, type Yazyk } from '@/lib/admin/slova';
import { nadpis } from '@/components/admin/nadpis';
import { poMoskve } from '@/lib/admin/vremya';
import Bukvalno from '@/components/Bukvalno';
import { PREDEL_KODA } from '@/lib/promokod';

export type KodNaEkrane = {
  kod: string;
  skidkaProc: number;
  doDaty: string;
  aktivaciy: number;
  ispolzovano: number;
  ostalos: number;
  otklyuchen: boolean;
  pochemu: 'istyok' | 'konchilis' | 'otklyuchen' | null;
  primeneniya: { orderId: number; email: string; skidkaKop: number; kogda: string; vernulas: boolean }[];
};

const rub = (kop: number) => `${(kop / 100).toFixed(2).replace(/\.00$/, '')} ₽`;

/**
 * Промокоды: заведение, правка, отключение (Р-167).
 *
 * ⚠️ СООБЩЕНИЕ ОДНО НА ДЕЙСТВИЕ, и у каждой карточки своё состояние:
 * ответ про один код не должен появляться под другим.
 */
export default function Promokody({
  y,
  spisok,
  poUmolchaniyuDo,
}: {
  y: Yazyk;
  spisok: KodNaEkrane[];
  poUmolchaniyuDo: string;
}) {
  const t = slovar(y);
  const [z, zavesti, idyot] = useActionState<OtvetA, FormData>(adminPromoZavesti, {});
  return (
    <>
      <h1>{t('pr.h')}</h1>
      <p className="hint">{t('pr.hint')}</p>

      <div className="ad__card">
        <h3>{t('pr.new_h')}</h3>
        {z.error ? <p className="err">{t(z.error)}</p> : null}
        {z.ok ? <p className="ok">{nadpis(t, z.ok, z.polya)}</p> : null}
        <form action={zavesti} className="ad__form" style={{ maxWidth: 'none' }}>
          <div className="ad__row ad__row--4">
            <label>
              {t('pr.kod')}
              <input
                type="text"
                name="kod"
                placeholder="LETO25"
                maxLength={PREDEL_KODA}
                autoComplete="off"
                spellCheck={false}
                translate="no"
              />
            </label>
            <label>
              {t('pr.skidka')}
              <input type="number" name="skidka" min={1} max={100} defaultValue={10} required />
            </label>
            <label>
              {t('pr.do')}
              <input type="date" name="do" defaultValue={poUmolchaniyuDo} required />
            </label>
            <label>
              {t('pr.aktivaciy')}
              <input type="number" name="aktivaciy" min={1} max={10000} defaultValue={50} required />
            </label>
          </div>
          <button type="submit" className="btn btn--sm" disabled={idyot}>
            {t('pr.zavesti')}
          </button>
        </form>
        <p className="hint">{t('pr.kod_hint')}</p>
      </div>

      {!spisok.length ? <p className="hint">{t('pr.none')}</p> : null}
      {spisok.map((k) => (
        <Kartochka key={k.kod} k={k} t={t} en={y === 'en'} />
      ))}
    </>
  );
}

function Kartochka({ k, t, en }: { k: KodNaEkrane; t: Perevod; en: boolean }) {
  /* ⚠️ СОСТОЯНИЕ ОДНО НА ОБЕ ФОРМЫ КАРТОЧКИ, а действие выбирает поле
     `op`: при двух состояниях ответ «отключён» прятался за прошлым
     ответом «сохранён» — экран показывал не то, что сделано последним
     (ручная проверка). То же устройство, что у шагов заказа (закон 52). */
  const [otvet, deystvie, idyot] = useActionState<OtvetA, FormData>(
    (p, fd) => (fd.get('op') === 'vkl' ? adminPromoOtklyuchit(p, fd) : adminPromoIzmenit(p, fd)),
    {},
  );
  const sostoyanie =
    k.pochemu === 'istyok'
      ? t('pr.st_istyok')
      : k.pochemu === 'konchilis'
        ? t('pr.st_konchilis')
        : k.pochemu === 'otklyuchen'
          ? t('pr.st_otklyuchen')
          : t('pr.st_deystvuet');
  return (
    <div className="ad__card">
      <h3>
        <Bukvalno>{k.kod}</Bukvalno> · −{k.skidkaProc}%{' '}
        <span className={k.pochemu ? 'ad__tag' : 'ad__tag ad__tag--gift'}>{sostoyanie}</span>
      </h3>
      {otvet.error ? <p className="err">{t(otvet.error)}</p> : null}
      {otvet.ok ? <p className="ok">{nadpis(t, otvet.ok, otvet.polya)}</p> : null}
      <dl className="ad__kv">
        <dt>{t('pr.do')}</dt>
        <dd className="tnum">{k.doDaty}</dd>
        <dt>{t('pr.ostalos')}</dt>
        <dd className="tnum">
          {k.ostalos} / {k.aktivaciy}
        </dd>
        <dt>{t('pr.ispolzovano')}</dt>
        <dd className="tnum">{k.ispolzovano}</dd>
      </dl>

      {/* ⚠️ ПРАВКА МЕНЯЕТ СКИДКУ, СРОК И ЧИСЛО АКТИВАЦИЙ, НО НЕ САМ КОД:
          на него ссылаются заказы. Применённые скидки правка не трогает —
          у каждой лежит свой снимок. */}
      <form action={deystvie} className="ad__form" style={{ maxWidth: 'none' }}>
        <input type="hidden" name="op" value="pravka" />
        <input type="hidden" name="kod" value={k.kod} />
        <div className="ad__row">
          <label>
            {t('pr.skidka')}
            <input type="number" name="skidka" min={1} max={100} defaultValue={k.skidkaProc} required />
          </label>
          <label>
            {t('pr.do')}
            <input type="date" name="do" defaultValue={k.doDaty} required />
          </label>
          <label>
            {t('pr.aktivaciy')}
            <input type="number" name="aktivaciy" min={1} max={10000} defaultValue={k.aktivaciy} required />
          </label>
        </div>
        <button type="submit" className="btn btn--ghost btn--sm" disabled={idyot}>
          {t('pr.sohranit')}
        </button>
      </form>

      <form action={deystvie}>
        <input type="hidden" name="op" value="vkl" />
        <input type="hidden" name="kod" value={k.kod} />
        <input type="hidden" name="kak" value={k.otklyuchen ? '0' : '1'} />
        <button type="submit" className="btn btn--ghost btn--sm" disabled={idyot}>
          {k.otklyuchen ? t('pr.vklyuchit') : t('pr.otklyuchit')}
        </button>
      </form>

      <h4 className="ad__sub">{t('pr.kem')}</h4>
      {!k.primeneniya.length ? (
        <p className="hint">{t('pr.ne_primenyalsya')}</p>
      ) : (
        <div className="ad__scroll">
          <table>
            <thead>
              <tr>
                <th>{t('t.when')}</th>
                <th>{t('t.client')}</th>
                <th>{t('t.order')}</th>
                <th>{t('pr.skidka_rub')}</th>
              </tr>
            </thead>
            <tbody>
              {k.primeneniya.map((a) => (
                <tr key={`${a.orderId}-${a.kogda}`}>
                  <td className="tnum">{poMoskve(a.kogda, en)}</td>
                  <td>
                    <Bukvalno>{a.email}</Bukvalno>
                  </td>
                  <td className="tnum">
                    <a href={`/admin/orders/${a.orderId}/`}>№ {a.orderId}</a>
                  </td>
                  <td className="tnum">
                    −{rub(a.skidkaKop)}
                    {/* «Кем и когда» — с пометкой о возврате: строка без
                        неё читалась бы как потраченная активация. */}
                    {a.vernulas ? <span className="hint"> ({t('pr.vernulas')})</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

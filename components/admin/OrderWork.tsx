'use client';

import { useActionState, useState } from 'react';
import type { ZakazOperatoru, SlotOperatoru, Sobytie } from '@/lib/server/views';
import {
  adminOtmenaShag,
  adminOtmenaVzyat,
  adminRelease,
  adminShag,
  adminTake,
  type OtvetA,
} from '@/lib/server/actions-admin';
import { slovar, sostoyanie, type Klyuch, type Perevod, type Yazyk } from '@/lib/admin/slova';
import { imyaTarifaIz, srokKratkoDlyaSotrudnika, type ImenaTarifov } from '@/lib/plans';
import { prichinaSotrudniku, prichinyDlya } from '@/lib/admin/prichiny';
import { poMoskve } from '@/lib/admin/vremya';

/**
 * Рабочий экран оператора: ЗАКАЗ РАЗБИТ НА ШАГИ.
 *
 * Постановка сорок второй итерации: «Переделать так, чтобы разобрался
 * и пятилетний ребёнок: заказ разбит на шаги (по шагу на каждый
 * аккаунт плюс последний шаг „Завершение"); экран показывает только
 * текущий шаг с одной главной кнопкой; пройденные шаги свёрнуты
 * с галочкой; следующие видны серыми и недоступны».
 *
 * ⚠️ ТЕКУЩИЙ ШАГ ВЫВОДИТСЯ ИЗ БАЗЫ, А НЕ ХРАНИТСЯ ОТДЕЛЬНО. Это
 * первый аккаунт без отметки «готово»; все с отметкой — значит идёт
 * «Завершение». Своего поля «на каком шаге заказ» не заводится:
 * оно разошлось бы с отметками на первом же откате, и понять,
 * какое из двух чисел право, было бы нечем.
 *
 * ⚠️ СОСТОЯНИЕ У ЭКРАНА ОДНО, И ЭТО ТОЖЕ ПОСТАНОВКА («на экране нет
 * двух сообщений о состоянии одновременно»). Все шаги идут через ОДНО
 * серверное действие `adminShag` с полем `op`: прежде их было шесть,
 * и ответ каждого жил до следующей отправки своей формы — «Отмечено
 * выполненным» спокойно висело рядом с отказом отмены.
 *
 * ⚠️ ШАГА «КОД ДВУХФАКТОРНОЙ ПРОВЕРКИ» ЗДЕСЬ НЕТ ВОВСЕ и таймера
 * тоже: у Spotify такой проверки нет, и лишний шаг в инструкции
 * заставляет оператора искать то, чего не существует.
 */
export default function OrderWork({
  z,
  staffId,
  y,
  imena,
}: {
  z: ZakazOperatoru;
  staffId: number;
  y: Yazyk;
  imena: ImenaTarifov;
}) {
  const t = slovar(y);
  const moy = z.operatorId === staffId;
  const zakryt = z.status === 'done' || z.status === 'cancelled';
  const [otvet, shag, idyot] = useActionState<OtvetA, FormData>(adminShag, {});

  const neproydennyy = z.slots.findIndex((s) => !s.gotov);
  /** Номер текущего шага. Равен числу аккаунтов — значит «Завершение». */
  const tekushchiy = neproydennyy === -1 ? z.slots.length : neproydennyy;
  const vsego = z.slots.length + 1;
  const rub = (kop: number) => (kop / 100).toFixed(2);

  return (
    <>
      <div className="ad__card">
        <h3>{t('z.h', { n: z.id })}</h3>
        <dl className="ad__kv">
          <dt>{t('t.plan')}</dt>
          <dd>
            {imyaTarifaIz(imena, z.planId, y === 'en')} · {srokKratkoDlyaSotrudnika(z.period, y === 'en')}
            {z.bySertificate ? <span className="ad__tag ad__tag--gift">{t('q.gift')}</span> : null}
          </dd>
          <dt>{t('t.client')}</dt>
          <dd>{z.clientEmail}</dd>
          <dt>{t('t.state')}</dt>
          <dd>
            {sostoyanie(t, z.status)}
            {/* ⚠️ СВОЙ ЗАКАЗ НАЗЫВАЕТСЯ СВОИМ, А ЧУЖУЮ ПОЧТУ ВИДИТ
                ТОЛЬКО АДМИНИСТРАТОР: `operatorEmail` исполнителю
                не отдаётся вовсе (постановка сорок шестой итерации,
                пункт 2). Прежде здесь стояла почта в обоих случаях,
                и на своём же заказе оператор читал собственный адрес
                подписью «взял …». */}
            {moy ? ` · ${t('q.yours')}` : z.operatorEmail ? ` · ${t('z.taken_by', { kto: z.operatorEmail })}` : ''}
          </dd>
          {/* ⚠️ ДЕНЬГИ ВИДНЫ ТОЛЬКО АДМИНИСТРАТОРУ с сорок второй
              итерации (постановка). Строки нет не потому, что она
              спрятана стилем, а потому, что САМИХ ЧИСЕЛ в этой
              карточке нет: сервер их исполнителю не отдаёт вовсе
              (`zakazDlyaAdminki`). Признак подарочного заказа при
              этом остаётся — он рядом с тарифом, и по нему видно,
              что работы те же, а денег за заказом нет. */}
          {z.totalKop !== null && z.balanceKop !== null && z.moneyKop !== null ? (
            <>
              <dt>{t('z.money')}</dt>
              <dd>
                {z.bySertificate
                  ? t('z.money_gift')
                  : t('z.money_sum', {
                      total: rub(z.totalKop),
                      balance: rub(z.balanceKop),
                      card: rub(z.moneyKop),
                    })}
              </dd>
            </>
          ) : null}
          {/* Метки кампании — ДАННЫЕ, а не надпись: они не переводятся
              ни на каком языке админки (закон 40). */}
          {z.utm.length ? (
            <>
              <dt>{t('z.utm')}</dt>
              <dd className="ad__utm">
                {z.utm.map((m) => (
                  <span key={m.imya}>
                    {m.imya}={m.znachenie}
                  </span>
                ))}
              </dd>
            </>
          ) : null}
          {z.cancelReason ? (
            <>
              <dt>{t('z.cancel_reason')}</dt>
              <dd>{z.cancelReason}</dd>
            </>
          ) : null}
        </dl>

        {z.status === 'paid' && !z.operatorId ? (
          <form action={adminTake}>
            <input type="hidden" name="order" value={z.id} />
            <button type="submit" className="btn btn--sm">
              {t('z.take')}
            </button>
          </form>
        ) : null}
        {moy && z.status === 'in_work' ? (
          <form action={adminRelease}>
            <input type="hidden" name="order" value={z.id} />
            <button type="submit" className="btn btn--ghost btn--sm">
              {t('z.release')}
            </button>
          </form>
        ) : null}
        {/* ⚠️ ЗАКРЫТЫЙ ЗАКАЗ ГОВОРИТ ОБ ЭТОМ САМ. Шаги после закрытия
            остаются свёрнутыми, и без этой строки оператор видел бы
            страницу без единого следа того, что он только что сделал. */}
        {zakryt ? (
          <p className="ok">
            {z.status === 'done' ? t('z.done_note') : z.otmena ? t('sc.cancelled_note') : t('z.cancelled_note')}
          </p>
        ) : null}
        {z.secretsWiped ? <p className="hint">{t('z.wiped')}</p> : null}
      </div>

      {/* ⚠️ АККАУНТЫ ЗАКРЫТОГО ЗАКАЗА — «ОТКРЫТЬ» ИЗ НЕДАВНО ЗАКРЫТЫХ
          (сорок девятая итерация, пункт 8): «почты и пароли аккаунтов,
          на которые заказ создан или продлён, дату окончания подписки
          по каждому аккаунту». Блок рисуется, только если доступы
          расшифрованы ТОМУ, КТО СМОТРИТ — решает сервер
          (`dostupyVidny`), разметка ничего не прячет. */}
      {(z.status === 'done' || z.otmena) && z.dostupyVidny ? <Akkaunty z={z} t={t} /> : null}

      {/* ⚠️ ЗАДАЧА «ОТМЕНА ПОДПИСКИ» (пункт 9). Своё действие и своё
          состояние: у заказа шаги уже пройдены, и сообщение на экране
          одно по построению (закон 52). */}
      {z.otmena ? <ZadachaOtmeny z={z} t={t} /> : null}

      {/* ⚠️ ИСТОРИЯ — ТОЛЬКО АДМИНИСТРАТОРУ, и решает это не разметка:
          исполнителю сервер список не отдаёт вовсе (`istoriya === null`,
          постановка сорок четвёртой итерации, пункт 5). */}
      {z.istoriya ? <Istoriya spisok={z.istoriya} t={t} en={y === 'en'} /> : null}

      {!moy && !zakryt ? <p className="hint">{t('z.take_first')}</p> : null}

      {/* ⚠️ ОДНО МЕСТО ДЛЯ СООБЩЕНИЯ, И ОНО ЗДЕСЬ — ВЫШЕ ШАГОВ.
          Двух сообщений не бывает по построению: состояние одно. */}
      {moy && otvet.error ? <p className="err">{t(otvet.error, otvet.polya)}</p> : null}
      {moy && otvet.ok ? <p className="ok">{t(otvet.ok, otvet.polya)}</p> : null}

      {/* ⚠️ У ОТМЕНЁННОГО ЗАКАЗА ШАГОВ НЕТ ВОВСЕ, и это не экономия
          места. Шаг «Завершение» помечался пройденным по признаку
          «заказ закрыт», а отменённый закрыт тоже, — и на экране
          стояла зелёная галочка напротив завершения, которого
          не было, а непройденный аккаунт обещал «откроется, когда
          будет пройден текущий шаг». У отменённого заказа текущего
          шага нет и не будет: карточка выше уже говорит, что заказ
          отменён, почему и куда ушли деньги. */}
      {moy && z.status !== 'cancelled'
        ? z.slots.map((s) => (
            <ShagAkkaunta
              key={s.id}
              z={z}
              s={s}
              t={t}
              en={y === 'en'}
              vsego={vsego}
              tekushchiy={zakryt ? -1 : tekushchiy}
              shag={shag}
              idyot={idyot}
            />
          ))
        : null}

      {moy && z.status !== 'cancelled' ? (
        <ShagZaversheniya
          z={z}
          t={t}
          vsego={vsego}
          tekushchiy={zakryt ? -1 : tekushchiy}
          shag={shag}
          idyot={idyot}
        />
      ) : null}
    </>
  );
}

/**
 * КОРОТКАЯ ИСТОРИЯ РАБОТЫ НАД ЗАКАЗОМ.
 *
 * Постановка: «кто взял заказ, кто вернул его в очередь, кто
 * выполнил, кто отменил. У каждой записи — почта сотрудника,
 * с которой он вошёл в админку, дата и время по Москве. Если заказ
 * передавали из рук в руки, видны все записи по порядку».
 *
 * ⚠️ ПУСТАЯ ИСТОРИЯ — ЗАКОННОЕ СОСТОЯНИЕ, А НЕ ОШИБКА. У заказа,
 * который ещё никто не брал, событий нет вовсе; у старого — есть
 * то, что удалось восстановить из базы при заведении журнала
 * (миграция 012). Пункт 6 постановки ровно об этом.
 *
 * ⚠️ ВРЕМЯ РАСКЛАДЫВАЕТСЯ ПО МОСКВЕ ЯВНОЙ ЗОНОЙ, а не по часам
 * машины, с которой смотрят (`lib/admin/vremya.ts`).
 */
function Istoriya({ spisok, t, en }: { spisok: Sobytie[]; t: Perevod; en: boolean }) {
  const imya: Record<Sobytie['vid'], Klyuch> = {
    vzyal: 'h.vzyal',
    vernul: 'h.vernul',
    vypolnil: 'h.vypolnil',
    otmenil: 'h.otmenil',
    otmena_zaproshena: 'h.otmena_zaproshena',
    podpiska_otmenena: 'h.podpiska_otmenena',
  };
  return (
    <div className="ad__card">
      <h3>{t('h.h')}</h3>
      {!spisok.length ? (
        <p className="hint">{t('h.none')}</p>
      ) : (
        <>
          <div className="ad__scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('t.event')}</th>
                  <th>{t('t.staff')}</th>
                  <th>{t('t.when')}</th>
                </tr>
              </thead>
              <tbody>
                {spisok.map((e, i) => (
                  <tr key={`${e.kogda}-${i}`}>
                    <td>{t(imya[e.vid])}</td>
                    {/* ⚠️ ПУСТАЯ ПОЧТА ЗНАЧИТ «СОТРУДНИКА НЕ БЫЛО»,
                        и так выглядит отмена самим покупателем. */}
                    <td>{e.email ?? <span className="hint">{t('h.klient')}</span>}</td>
                    <td className="tnum">{poMoskve(e.kogda, en)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">{t('h.note')}</p>
        </>
      )}
    </div>
  );
}

/**
 * ГЛАВНАЯ КНОПКА ШАГА: сначала спрашивает, потом делает.
 *
 * Постановка: «Каждая главная кнопка шага сначала спрашивает „Вы
 * уверены, что всё заполнено верно?" — „Да" / „Нет", и только „Да"
 * проводит шаг».
 *
 * ⚠️ СПРАШИВАЕМ СВОИМИ СРЕДСТВАМИ, А НЕ `confirm()`. Системное окно
 * приходит шрифтом системы, на языке системы и в чужом визуальном
 * языке — ровно та причина, по которой у форм сайта стоит
 * `noValidate` (Р-114). Здесь вопрос набран тем же, чем всё
 * остальное, и переводится как любая другая надпись.
 */
function Glavnaya({
  t,
  podpis,
  idyot,
  hod,
}: {
  t: Perevod;
  podpis: string;
  idyot: boolean;
  hod?: string;
}) {
  const [sprosili, setSprosili] = useState(false);
  if (!sprosili) {
    return (
      <div className="ad__actions">
        <button type="button" className="btn btn--sm" onClick={() => setSprosili(true)} disabled={idyot}>
          {podpis}
        </button>
      </div>
    );
  }
  return (
    <div className="ad__sure">
      <p>{t('w.sure')}</p>
      <div className="ad__actions">
        <button type="submit" className="btn btn--sm" disabled={idyot}>
          {idyot ? (hod ?? t('o.saving')) : t('w.yes')}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSprosili(false)} disabled={idyot}>
          {t('w.no')}
        </button>
      </div>
    </div>
  );
}

/** Отмена заказа: закрытый список причин плюс тот же вопрос. */
function Otmena({
  z,
  t,
  en,
  shag,
  idyot,
}: {
  z: ZakazOperatoru;
  t: Perevod;
  /* ⚠️ ЯЗЫК ПРИХОДИТ ПРИЗНАКОМ, А НЕ УГАДЫВАЕТСЯ ПО НАДПИСИ. Причины
     отмены живут своей парой (`lib/admin/prichiny.ts`), потому что
     их русская половина — текст КЛИЕНТУ, а не надпись; выбрать
     половину надо явно. */
  en: boolean;
  shag: (fd: FormData) => void;
  idyot: boolean;
}) {
  const [otkryto, setOtkryto] = useState(false);
  if (!otkryto) {
    return (
      <div className="ad__actions">
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOtkryto(true)}>
          {t('w.cancel_open')}
        </button>
      </div>
    );
  }
  return (
    <form action={shag} className="ad__form">
      <input type="hidden" name="order" value={z.id} />
      <input type="hidden" name="op" value="otmena" />
      <label>
        {t('z.reason')}
        {/* ⚠️ СПИСОК ЗАКРЫТЫЙ, И ПУСТОГО ВЫБОРА В НЁМ НЕТ ВОВСЕ БЫТЬ
            НЕ МОЖЕТ: без причины отменить нельзя (постановка), и это
            проверяется ещё и на сервере — `required` человек снимает
            в браузере за секунду. */}
        <select name="reason" required defaultValue="">
          <option value="" disabled>
            {t('w.reason_pick')}
          </option>
          {prichinyDlya(z.slots.length).map((k) => (
            <option key={k} value={k}>
              {prichinaSotrudniku(k, en)}
            </option>
          ))}
        </select>
      </label>
      <p className="hint" style={{ margin: 0 }}>
        {t('w.reason_hint')}
      </p>
      <Glavnaya t={t} podpis={t('z.cancel_btn')} idyot={idyot} hod={t('z.cancelling')} />
      <div className="ad__actions">
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOtkryto(false)} disabled={idyot}>
          {t('w.no')}
        </button>
      </div>
    </form>
  );
}

/** Кнопка «Назад»: снимает отметку с предыдущего аккаунта. */
function Nazad({
  z,
  t,
  shag,
  idyot,
}: {
  z: ZakazOperatoru;
  t: Perevod;
  shag: (fd: FormData) => void;
  idyot: boolean;
}) {
  return (
    <form action={shag}>
      <input type="hidden" name="order" value={z.id} />
      <input type="hidden" name="op" value="nazad" />
      <button type="submit" className="btn btn--ghost btn--sm" disabled={idyot}>
        ← {t('w.back')}
      </button>
    </form>
  );
}

function ShagAkkaunta({
  z,
  s,
  t,
  en,
  vsego,
  tekushchiy,
  shag,
  idyot,
}: {
  z: ZakazOperatoru;
  s: SlotOperatoru;
  t: Perevod;
  en: boolean;
  vsego: number;
  tekushchiy: number;
  shag: (fd: FormData) => void;
  idyot: boolean;
}) {
  const proyden = s.gotov;
  const seychas = tekushchiy === s.idx;
  const zhdyot = !proyden && !seychas;
  const imya = `${z.slots.length > 1 ? t('u.account', { n: s.idx + 1 }) : ''}${s.mode === 'new' ? t('u.new') : t('u.renew')}`;
  /* Старый заказ: доступы заводил оператор, и доделывать его надо тем
     же способом, каким он начинался (до тридцать четвёртой итерации). */
  const staryy = s.mode === 'new' && !s.clientLogin && !s.clientPassword;

  return (
    <div className="ad__shag" data-sost={proyden ? 'proyden' : seychas ? 'seychas' : 'zhdyot'}>
      <h3>
        <span className="ad__shag-n" aria-hidden="true">
          {proyden ? '✓' : s.idx + 1}
        </span>
        <span>
          {t('w.step', { n: s.idx + 1, vsego })} · {imya}
        </span>
        {proyden ? <span className="ad__shag-p">{t('w.passed')}</span> : null}
      </h3>

      {zhdyot ? <p className="hint">{t('w.locked')}</p> : null}

      {seychas ? (
        <>
          <p className="hint">{staryy ? t('u.new_steps_old') : s.mode === 'renew' ? t('u.renew_steps') : t('u.new_steps')}</p>

          {!staryy ? (
            <dl className="ad__kv">
              <dt>{t('t.email')}</dt>
              <dd className="ad__secret">{s.clientLogin ?? t('u.wiped')}</dd>
              <dt>{t('u.password')}</dt>
              <dd className="ad__secret">{s.clientPassword ?? t('u.wiped')}</dd>
            </dl>
          ) : null}

          {staryy ? (
            <form action={shag} className="ad__form">
              <input type="hidden" name="order" value={z.id} />
              <input type="hidden" name="slot" value={s.id} />
              <input type="hidden" name="op" value="vydacha" />
              <div className="ad__row">
                <label>
                  {t('u.login_email')}
                  <input type="text" name="login" required autoComplete="off" defaultValue={s.outLogin ?? ''} />
                </label>
                <label>
                  {t('u.mailpass')}
                  <input type="text" name="mailPass" required autoComplete="off" defaultValue={s.outMailPass ?? ''} />
                </label>
                <label>
                  {t('u.spotpass')}
                  <input
                    type="text"
                    name="spotifyPass"
                    required
                    autoComplete="off"
                    defaultValue={s.outPassword ?? ''}
                  />
                </label>
              </div>
              <Glavnaya t={t} podpis={s.outLogin ? t('u.update_creds') : t('u.save_creds')} idyot={idyot} />
            </form>
          ) : (
            <form action={shag}>
              <input type="hidden" name="order" value={z.id} />
              <input type="hidden" name="slot" value={s.id} />
              <input type="hidden" name="op" value="gotov" />
              <Glavnaya
                t={t}
                podpis={s.mode === 'renew' ? t('u.renew_done') : t('u.new_done')}
                idyot={idyot}
              />
            </form>
          )}

          {/* ⚠️ «ОТМЕНИТЬ ЗАКАЗ» СТОИТ НА КАЖДОМ ШАГЕ, ГДЕ ОПЕРАТОР
              РАБОТАЕТ С ПОЧТАМИ И ПАРОЛЯМИ (постановка) — то есть
              на шагах аккаунтов, и только на них: на «Завершении»
              работать уже нечем. */}
          <Otmena z={z} t={t} en={en} shag={shag} idyot={idyot} />
          {/* На первом шаге назад идти некуда, и кнопки там нет. */}
          {s.idx > 0 ? <Nazad z={z} t={t} shag={shag} idyot={idyot} /> : null}
        </>
      ) : null}

      {proyden && s.endsAt ? (
        <p className="hint">
          {t('w.ends')}: {s.endsAt}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Последний шаг.
 *
 * ⚠️ У ПРОДЛЕНИЯ ДАТА ОКОНЧАНИЯ СПРАШИВАЕТСЯ, И ОНА ОБЯЗАТЕЛЬНА
 * (постановка). Причина не в аккуратности: у клиента на аккаунте мог
 * остаться неистёкший срок, и «сегодня плюс срок заказа» тогда врёт —
 * Spotify показывает дату позже. От введённой даты считается письмо
 * за три дня до конца (закон 44). Поле заранее заполнено расчётной
 * датой, и считает её СЕРВЕР (закон 49).
 *
 * ⚠️ У НОВОГО АККАУНТА ПОЛЯ НЕТ ВОВСЕ — «для новых аккаунтов как
 * сейчас»: официальной даты там взять негде, аккаунт только что
 * заведён, и срок считается от выдачи.
 */
function ShagZaversheniya({
  z,
  t,
  vsego,
  tekushchiy,
  shag,
  idyot,
}: {
  z: ZakazOperatoru;
  t: Perevod;
  vsego: number;
  tekushchiy: number;
  shag: (fd: FormData) => void;
  idyot: boolean;
}) {
  const nomer = z.slots.length;
  const seychas = tekushchiy === nomer;
  const zakryt = z.status === 'done' || z.status === 'cancelled';
  const prodleniya = z.slots.filter((s) => s.mode === 'renew');

  return (
    <div className="ad__shag" data-sost={zakryt ? 'proyden' : seychas ? 'seychas' : 'zhdyot'}>
      <h3>
        <span className="ad__shag-n" aria-hidden="true">
          {zakryt ? '✓' : nomer + 1}
        </span>
        <span>
          {t('w.step', { n: nomer + 1, vsego })} · {t('w.finish_h')}
        </span>
      </h3>

      {!seychas && !zakryt ? <p className="hint">{t('w.locked')}</p> : null}

      {seychas ? (
        <>
          <p className="hint">{t('w.all_done')}</p>
          <form action={shag} className="ad__form">
            <input type="hidden" name="order" value={z.id} />
            <input type="hidden" name="op" value="zavershit" />
            {prodleniya.map((s) => (
              <label key={s.id}>
                {z.slots.length > 1
                  ? `${t('u.account', { n: s.idx + 1 })}${t('w.ends')}`
                  : t('w.ends')}
                <input
                  type="date"
                  name={`ends_${s.id}`}
                  required
                  defaultValue={s.endsAt ?? z.raschyotnayaData}
                />
              </label>
            ))}
            {prodleniya.length ? (
              <p className="hint" style={{ margin: 0 }}>
                {t('w.ends_hint')}
              </p>
            ) : null}
            <Glavnaya t={t} podpis={t('w.finish_btn')} idyot={idyot} hod={t('z.closing')} />
          </form>
          <Nazad z={z} t={t} shag={shag} idyot={idyot} />
        </>
      ) : null}
    </div>
  );
}

/**
 * АККАУНТЫ ЗАКРЫТОГО ЗАКАЗА: почта, пароль и дата окончания по каждому.
 *
 * ⚠️ СТЁРТОЕ НАЗВАНО СЛОВАМИ, А НЕ ПРОПУЩЕНО — постановка: «Если они
 * уже стёрты, вместо пароля — „стёрт через 7 дней после закрытия"».
 * Почта стирается вместе с паролем (закон 35), и про неё сказано так же.
 *
 * ⚠️ ДАТА ОКОНЧАНИЯ — СВОЯ У ПРОДЛЕНИЯ, ОБЩАЯ У НОВОГО АККАУНТА.
 * У продления её ввёл оператор из Spotify (Р-145); у нового аккаунта
 * своей даты нет, и кончается он вместе с заказом (`expires_at`).
 */
function Akkaunty({ z, t }: { z: ZakazOperatoru; t: Perevod }) {
  const styort = t('sc.wiped');
  return (
    <div className="ad__card">
      <h3>{t('sc.accounts_h')}</h3>
      <div className="ad__scroll">
        <table>
          <thead>
            <tr>
              <th>{t('t.num')}</th>
              <th>{t('t.email')}</th>
              <th>{t('u.password')}</th>
              <th>{t('w.ends')}</th>
            </tr>
          </thead>
          <tbody>
            {z.slots.map((s) => (
              <tr key={s.id}>
                <td className="tnum">{s.idx + 1}</td>
                <td className="ad__secret">{s.clientLogin ?? s.outLogin ?? styort}</td>
                <td className="ad__secret">{s.clientPassword ?? s.outPassword ?? styort}</td>
                <td className="tnum">{s.endsAt ?? z.konchaetsya ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * ЗАДАЧА «ОТМЕНА ПОДПИСКИ» НА ЭКРАНЕ ЗАКАЗА.
 *
 * Постановка: «Оператор открывает задачу, видит почту и пароль,
 * отменяет подписку в Spotify и отмечает „Подписка отменена"
 * с подтверждением „Вы уверены?". Если на шаге „Назад" — как
 * в обычных заказах».
 *
 * ⚠️ ШАГИ ТЕ ЖЕ, ЧТО У ОБЫЧНОГО ЗАКАЗА: по одному на аккаунт, виден
 * только текущий, пройденные свёрнуты с галочкой, следующие недоступны,
 * и «Назад» снимает самую позднюю отметку. Отдельного шага
 * «Завершение» нет: последняя отметка и есть конец задачи — заводить
 * ещё одну кнопку с тем же смыслом незачем.
 */
function ZadachaOtmeny({ z, t }: { z: ZakazOperatoru; t: Perevod }) {
  const [otvet, shag, idyot] = useActionState<OtvetA, FormData>(adminOtmenaShag, {});
  const o = z.otmena!;
  const tekushchiy = z.slots.findIndex((s) => !s.podpiskaOtmenena);
  const vsego = z.slots.length;

  return (
    <div className="ad__card">
      <h3>{t('sc.task_h')}</h3>
      {o.zakryta ? <p className="ok">{t('sc.task_done')}</p> : null}
      {!o.zakryta && o.svobodna ? (
        <>
          <p className="hint">{t('sc.task_free')}</p>
          <form action={adminOtmenaVzyat}>
            <input type="hidden" name="order" value={z.id} />
            <button type="submit" className="btn btn--sm">
              {t('sc.take')}
            </button>
          </form>
        </>
      ) : null}
      {!o.zakryta && !o.svobodna && !o.moya ? (
        <p className="hint">{o.operatorEmail ? t('sc.task_of', { kto: o.operatorEmail }) : t('sc.task_other')}</p>
      ) : null}

      {/* Одно место для сообщения — выше шагов: состояние одно. */}
      {otvet.error ? <p className="err">{t(otvet.error, otvet.polya)}</p> : null}
      {otvet.ok ? <p className="ok">{t(otvet.ok, otvet.polya)}</p> : null}

      {!o.zakryta && o.moya ? (
        <>
          <p className="hint">{t('sc.task_how')}</p>
          {z.slots.map((s) => {
            const proyden = s.podpiskaOtmenena;
            const seychas = s.idx === tekushchiy;
            return (
              <div
                key={s.id}
                className="ad__shag"
                data-sost={proyden ? 'proyden' : seychas ? 'seychas' : 'zhdyot'}
              >
                <h3>
                  <span className="ad__shag-n" aria-hidden="true">
                    {proyden ? '✓' : s.idx + 1}
                  </span>
                  <span>
                    {t('w.step', { n: s.idx + 1, vsego })}
                    {vsego > 1 ? ` · ${t('u.account', { n: s.idx + 1 })}` : ''}
                  </span>
                  {proyden ? <span className="ad__shag-p">{t('sc.step_done')}</span> : null}
                </h3>
                {!proyden && !seychas ? <p className="hint">{t('w.locked')}</p> : null}
                {seychas ? (
                  <>
                    <dl className="ad__kv">
                      <dt>{t('t.email')}</dt>
                      <dd className="ad__secret">{s.clientLogin ?? s.outLogin ?? t('sc.wiped')}</dd>
                      <dt>{t('u.password')}</dt>
                      <dd className="ad__secret">{s.clientPassword ?? s.outPassword ?? t('sc.wiped')}</dd>
                    </dl>
                    <form action={shag}>
                      <input type="hidden" name="order" value={z.id} />
                      <input type="hidden" name="op" value="otmenena" />
                      <Glavnaya t={t} podpis={t('sc.mark')} idyot={idyot} />
                    </form>
                    {s.idx > 0 ? (
                      <form action={shag}>
                        <input type="hidden" name="order" value={z.id} />
                        <input type="hidden" name="op" value="nazad" />
                        <button type="submit" className="btn btn--ghost btn--sm" disabled={idyot}>
                          ← {t('w.back')}
                        </button>
                      </form>
                    ) : null}
                  </>
                ) : null}
              </div>
            );
          })}
          <form action={shag}>
            <input type="hidden" name="order" value={z.id} />
            <input type="hidden" name="op" value="vernut" />
            <button type="submit" className="btn btn--ghost btn--sm" disabled={idyot}>
              {t('sc.release')}
            </button>
          </form>
        </>
      ) : null}
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { OtpechatokKabineta } from '@/lib/server/otpechatok';

/**
 * Кабинет, который обновляется сам.
 *
 * ⚠️ ОБНОВЛЯЕТ СТРАНИЦУ `router.refresh()`, А НЕ ПЕРЕРИСОВКА
 * ПО JSON. Он перезапрашивает ту же серверную страницу и вклеивает
 * её на месте: позиция прокрутки, фокус и раскрытые поля остаются,
 * перезагрузки нет. Второй путь — отдать данные кабинета в JSON —
 * означал бы второе место, где решается, кому показывать выданные
 * пароли (Р-87); здесь их по-прежнему рисует только сервер.
 *
 * ⚠️ СНАЧАЛА ОТПЕЧАТОК, ПОТОМ ОБНОВЛЕНИЕ. Опрос спрашивает короткую
 * строку; совпала с прежней — не делается ничего вовсе. Так
 * выполняется «если ничего не изменилось — ничего
 * не перерисовывается»: без этого `refresh()` каждые пятнадцать
 * секунд гонял бы всю страницу и сбрасывал бы её состояние.
 *
 * ⚠️ ТОЛЬКО ВИДИМАЯ ВКЛАДКА. Кабинет держат открытым часами,
 * и фоновая вкладка опрашивала бы сервер зря. Проверка стоит
 * в самом тике, а не только в подписке: вкладку прячут и без
 * события.
 */
export default function KabinetZhivoy({ nachalo }: { nachalo: OtpechatokKabineta }) {
  const router = useRouter();
  const [poteryana, setPoteryana] = useState(false);
  const [novye, setNovye] = useState(false);
  /* ⚠️ ОТСЧЁТ ИДЁТ ОТ ОТПЕЧАТКА, СНЯТОГО ПРИ ОТРИСОВКЕ, а не от того,
     что увидит первый тик. Иначе изменение, случившееся за эти
     пятнадцать секунд, оказалось бы проглоченным: оператор выдал
     доступ сразу после загрузки, а человек не увидел бы его вовсе.
     Состояние React тут не нужно — от отпечатка ничего не зависит
     в разметке. */
  const otpechatok = useRef(nachalo.otpechatok);
  const bylo = useRef(nachalo.dostupov);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (stop || document.visibilityState !== 'visible') return;
      try {
        const r = await fetch('/api/cabinet/', { cache: 'no-store' });
        if (r.status === 401) {
          setPoteryana(true);
          return;
        }
        if (!r.ok) return;
        const d = (await r.json()) as OtpechatokKabineta;
        if (stop) return;
        setPoteryana(false);
        if (d.otpechatok === otpechatok.current) return;
        otpechatok.current = d.otpechatok;
        if (d.dostupov > bylo.current) setNovye(true);
        bylo.current = d.dostupov;
        router.refresh();
      } catch {
        /* Сеть моргнула — молчим и ждём следующего тика: показывать
           «связь потеряна» на одном неудачном запросе значило бы
           пугать человека каждым лифтом. */
      }
    };
    const id = setInterval(tick, 15_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      stop = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [router]);

  if (poteryana) {
    return (
      <p className="err" role="status">
        Сессия закончилась — войдите заново, чтобы видеть свои заказы.{' '}
        <a href="/cabinet/">Обновить страницу</a>
      </p>
    );
  }
  if (novye) {
    /* ⚠️ ЗАМЕТНО, НО НЕ НАВЯЗЧИВО: строка появляется над заказами
       и не исчезает сама. Человек мог отойти от экрана — всплывающее
       уведомление он бы пропустил, а постановка требует обратного. */
    return (
      <p className="ok cab__novoe" role="status">
        Доступы выданы — они ниже, в карточке заказа.
      </p>
    );
  }
  return null;
}

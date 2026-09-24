/**
 * Яндекс Метрика: номер счётчика и цели.
 *
 * ⚠️ ФАЙЛ БЕЗ 'use client' НАМЕРЕННО: номер счётчика нужен и разметке
 * (серверной), и обработчикам в браузере. Сами вызовы `ym` стоят
 * только в клиентских компонентах.
 *
 * ⚠️ ВЫЗОВ НИКОГДА НЕ ПАДАЕТ. Счётчика может не быть вовсе — его нет
 * в кабинете и в админке по постановке, его режет любой блокировщик,
 * и он не грузится, пока страница не догрузила основное. Цель, которая
 * уронила бы оформление заказа, хуже, чем цель, которая не сработала.
 */

export const SCHYOTCHIK = 113005479;

/**
 * Пять целей из постановки. Имена латиницей — это внешний контракт
 * кабинета Метрики, а не текст сайта: их вбивают в интерфейсе целей
 * руками, и кириллица там читается хуже.
 */
export const CELI = {
  oformlenieNachato: 'oformlenie_nachato',
  perehodKOplate: 'perehod_k_oplate',
  oplataProshla: 'oplata_proshla',
  sertifikatKuplen: 'sertifikat_kuplen',
  sertifikatAktivirovan: 'sertifikat_aktivirovan',
} as const;

/**
 * ⚠️ ПОЛЯ, КОТОРЫЕ ВЕБВИЗОР НЕ ИМЕЕТ ПРАВА ЗАПИСАТЬ.
 *
 * Постановка убрала счётчик из кабинета и админки именно затем, чтобы
 * вебвизор не писал чужие данные. Но оформление и активация — страницы
 * ПУБЛИЧНЫЕ, и цели «начато оформление» и «переход к оплате» без
 * счётчика на них не собрать; при этом ровно там человек вводит почту
 * и пароль от ЧУЖОГО аккаунта Spotify и код сертификата. Пароль
 * вебвизор не пишет сам, а почту и код — пишет.
 *
 * `ym-disable-keys` запрещает записывать набранное, `ym-hide-content`
 * заменяет содержимое звёздочками в самой записи. Ставится на КАЖДОЕ
 * такое поле поимённо: общего «выключить вебвизор на странице» нет,
 * а выключать его целиком значило бы потерять и цели.
 */
export const BEZ_ZAPISI = 'ym-disable-keys ym-hide-content';

type Ym = (id: number, metod: string, ...ostalnoe: unknown[]) => void;

/** Достижение цели. Нет счётчика — тихо ничего. */
export function cel(imya: string, polya?: Record<string, unknown>): void {
  try {
    const ym = (window as unknown as { ym?: Ym }).ym;
    if (typeof ym === 'function') ym(SCHYOTCHIK, 'reachGoal', imya, polya);
  } catch {
    /* пусто: цель не имеет права уронить страницу */
  }
}

export type TovarZakaza = {
  id: string;
  name: string;
  /** Рубли, а не копейки: Метрика считает выручку в валюте счёта. */
  price: number;
  quantity: number;
  category?: string;
};

/**
 * Электронная коммерция.
 *
 * ⚠️ СЛОЙ ДАННЫХ ЗАВОДИТСЯ ЗДЕСЬ, А НЕ В КОДЕ СЧЁТЧИКА. Счётчик
 * грузится ОТЛОЖЕННО, после основного содержимого, и покупка вполне
 * может случиться раньше: `dataLayer` — обычный массив, Метрика
 * разбирает его, когда поднимется. Не создай мы массив сами —
 * событие покупки пропало бы у тех, кто ушёл со страницы быстро.
 */
export function pokupka(zakaz: number, vsegoRub: number, tovary: TovarZakaza[]): void {
  try {
    const w = window as unknown as { dataLayer?: unknown[] };
    w.dataLayer = w.dataLayer || [];
    w.dataLayer.push({
      ecommerce: {
        currencyCode: 'RUB',
        purchase: {
          actionField: { id: String(zakaz), revenue: vsegoRub },
          products: tovary,
        },
      },
    });
  } catch {
    /* пусто */
  }
}

/**
 * Уведомления СОТРУДНИКАМ.
 *
 * ⚠️ КАНАЛА ПОКА НЕТ, И ЭТО ПО ПОСТАНОВКЕ: «канал не решён, отложим;
 * сейчас не делай, но устрой так, чтобы потом добавлялось в одном
 * месте без правок по всему коду».
 *
 * Поэтому здесь ровно одна функция, и зовут её все, кому есть что
 * сообщить команде. Сейчас она пишет строку в журнал сервера.
 * Когда канал выберут — почта, телеграм, вебхук, — меняется ТЕЛО
 * этой функции и ничего больше: ни один вызывающий не трогается.
 *
 * Персональных данных в событие класть нельзя: журнал читают все,
 * у кого есть доступ к серверу, а канал завтра может оказаться общим
 * чатом. Номер заказа — довольно.
 */

import { log } from './log';

export type SobytieKomande =
  | { vid: 'zakaz_oplachen'; zakaz: number; tarif: string; mest: number }
  | { vid: 'zakaz_po_sertifikatu'; zakaz: number; tarif: string }
  | { vid: 'zakaz_vzyat'; zakaz: number; kto: string }
  | { vid: 'zakaz_zakryt'; zakaz: number }
  | { vid: 'zakaz_otmenyon'; zakaz: number };

export async function soobshchitKomande(s: SobytieKomande): Promise<void> {
  const { vid, ...ostalnoe } = s;
  log.info(`команде: ${vid}`, ostalnoe as Record<string, string | number>);
}

import { SCHYOTCHIK } from '@/lib/metrika';

/**
 * Счётчик Яндекс Метрики.
 *
 * ⚠️ ЕГО НЕТ В КАБИНЕТЕ И В АДМИНКЕ, И ЭТО ГЛАВНОЕ В ЭТОМ ФАЙЛЕ.
 * Вебвизор пишет страницу целиком — движение указателя, содержимое
 * полей, весь текст на экране. В кабинете лежат выданные логины
 * и пароли от чужих аккаунтов Spotify, в админке — они же плюс почта
 * клиента. Записать это во внешний сервис нельзя ни при каком
 * раскладе (закон 35 и Р-87).
 *
 * ⚠️ ОТБОР ИДЁТ ПО АДРЕСУ, А НЕ ПО СПИСКУ РАЗРЕШЁННЫХ СТРАНИЦ.
 * Разрешительный список пришлось бы пополнять на каждой новой
 * странице, и забытая страница осталась бы БЕЗ счётчика — то есть
 * ошибка была бы тихой и в сторону «нет данных». Запретительный
 * ошибается в другую сторону: забудешь пополнить — счётчик окажется
 * там, где его быть не должно. Поэтому запрет стоит на ПРЕФИКСАХ
 * разделов, а не на отдельных адресах: всё, что появится внутри
 * `/cabinet/` и `/admin/`, закрыто с рождения.
 *
 * ⚠️ ЭТО СЕРВЕРНЫЙ КОМПОНЕНТ И ОБЫЧНЫЙ ИНЛАЙНОВЫЙ СКРИПТ, А НЕ
 * `next/script`. Клиентский компонент в КОРНЕВОЙ раскладке платит
 * своим кодом на КАЖДОЙ странице сайта, включая первый экран:
 * замерено — `next/script` с обёрткой стоил 6.6 КБ критического пути
 * (517.9 против 511.3). Адрес при этом читает сам браузер
 * (`location.pathname`), и это не хуже, а точнее: переходы на сайте
 * идут обычными ссылками, то есть полной загрузкой страницы.
 * И лендинг от этого не становится динамическим (закон 36):
 * ни `cookies()`, ни `headers()`, ни `searchParams` здесь нет.
 *
 * ⚠️ ОЧЕРЕДЬ ЗАВОДИТСЯ СРАЗУ, А ГРУЗИТСЯ БИБЛИОТЕКА ПОСЛЕ `load`.
 * Разделять это обязательно. Заглушка `ym` — три строки без единого
 * запроса: она складывает вызовы в массив, и настоящая библиотека
 * их разбирает, когда поднимется. Отложи мы и заглушку — цель
 * «оплата прошла», которую шлёт эффект React, ушла бы в никуда
 * у всех, кто закрыл вкладку раньше `load`. А грузить `tag.js`
 * сразу значило бы отдать ему главный поток ровно в те
 * миллисекунды, за которые нас и меряют.
 */

const ZAKRYTO = ['/cabinet', '/admin'];

export function schyotchikUmesten(put: string): boolean {
  return !ZAKRYTO.some((p) => put === p || put.startsWith(`${p}/`));
}

const KOD = `(function(){try{
var z=${JSON.stringify(ZAKRYTO)},p=location.pathname;
for(var i=0;i<z.length;i++){if(p===z[i]||p.indexOf(z[i]+"/")===0)return}
var m=window;m.ym=m.ym||function(){(m.ym.a=m.ym.a||[]).push(arguments)};m.ym.l=1*new Date();
m.dataLayer=m.dataLayer||[];
m.ym(${SCHYOTCHIK},"init",{ssr:true, webvisor:true, clickmap:true, ecommerce:"dataLayer", accurateTrackBounce:true, trackLinks:true});
var go=function(){for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src.indexOf("mc.yandex.ru/metrika/tag.js")>=0)return}
var k=document.createElement("script"),a=document.getElementsByTagName("script")[0];
k.async=1;k.src="https://mc.yandex.ru/metrika/tag.js?id=${SCHYOTCHIK}";a.parentNode.insertBefore(k,a)};
if(document.readyState==="complete")setTimeout(go,0);else addEventListener("load",function(){setTimeout(go,0)},{once:true});
}catch(e){}})()`;

export default function Metrika() {
  return <script dangerouslySetInnerHTML={{ __html: KOD }} />;
}

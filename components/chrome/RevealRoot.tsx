'use client';

import { useEffect } from 'react';

/**
 * ПОЯВЛЕНИЕ СТРОК ПРИ ВХОДЕ В КАДР.
 *
 * Один наблюдатель на всю страницу, никаких циклов rAF и никаких чтений
 * геометрии: IntersectionObserver считает пересечения сам, вне главного
 * потока, и снимает элемент с наблюдения сразу после показа.
 *
 * Скрытое состояние живёт под атрибутом data-rv на <html>, который ставит
 * короткий скрипт в <head>. Без JavaScript атрибута нет, и страница видна
 * целиком — прятать в CSS безусловно нельзя, отказ скрипта означал бы
 * пустую середину страницы. При «уменьшить движение» скрипт атрибут
 * не ставит, и сюда мы даже не доходим.
 *
 * ВАЖНАЯ ТОНКОСТЬ. Элемент, который на момент подписки УЖЕ уехал выше
 * экрана (человек успел прокрутить страницу до гидратации), не пересекается
 * с кадром и без отдельной ветки остался бы невидимым навсегда. Первый
 * вызов наблюдателя приходит для каждого элемента, поэтому там же и
 * проверяем: низ выше нуля — значит прокручен, показываем сразу.
 */
export default function RevealRoot() {
  useEffect(() => {
    const root = document.documentElement;
    if (!root.hasAttribute('data-rv')) return;

    let io: IntersectionObserver | null = null;
    // ПОДПИСКА ОТКЛАДЫВАЕТСЯ НА КАДР ПОСЛЕ ГИДРАТАЦИИ. Первый проход
    // наблюдателя считает пересечения сразу, и делать это в том же кадре,
    // где заводятся подписки на прокрутку и меряются границы хода, —
    // значит удлинить и без того самый дорогой кадр страницы. Замерено
    // (двенадцатая итерация): рывок первого колеса на холодной загрузке
    // 0.62 px против 0.04. Ждать не страшно: все строки лежат ниже
    // первого экрана, увидеть их за один кадр нельзя.
    const id = requestAnimationFrame(() => requestAnimationFrame(() => (io = setup())));

    function setup(): IntersectionObserver | null {
      const items = Array.from(document.querySelectorAll<HTMLElement>('.rv'));
      if (typeof IntersectionObserver === 'undefined') {
        items.forEach((el) => el.classList.add('is-in'));
        return null;
      }

      const obs = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting && e.boundingClientRect.bottom > 0) continue;
            e.target.classList.add('is-in');
            obs.unobserve(e.target);
          }
        },
        // строка считается пришедшей, когда поднялась над нижней десятой
        // экрана: иначе появление начинается ровно на кромке и не видно
        { rootMargin: '0px 0px -10% 0px', threshold: 0 },
      );
      items.forEach((el) => obs.observe(el));
      return obs;
    }

    return () => {
      cancelAnimationFrame(id);
      io?.disconnect();
    };
  }, []);

  return null;
}

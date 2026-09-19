'use client';

import { useEffect } from 'react';
import { bootScroll } from '@/lib/scroll';

/**
 * Поднимает слушатели прокрутки один раз на страницу. Ничего не рендерит.
 * Сглаживания нет: прокрутка нативная, морф считается прямо в обработчике
 * scroll — см. lib/scroll.
 */
export default function ScrollProvider() {
  useEffect(() => bootScroll(), []);
  return null;
}

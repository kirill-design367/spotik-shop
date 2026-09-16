'use client';

import { useEffect } from 'react';
import { bootScroll } from '@/lib/scroll';

/** Поднимает Lenis и ScrollTrigger один раз на страницу. Ничего не рендерит. */
export default function ScrollProvider() {
  useEffect(() => bootScroll(), []);
  return null;
}

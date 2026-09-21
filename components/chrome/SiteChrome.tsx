'use client';

import { usePathname } from 'next/navigation';
import Nav from './Nav';

/**
 * Шапка сайта — ВЕЗДЕ, КРОМЕ АДМИНКИ.
 *
 * Админка живёт под тем же корневым макетом: заводить второй корень
 * ради неё значит разнести `<html>` на два файла и получить два места,
 * где может разъехаться `<head>`. Вместо этого шапка сама решает,
 * рисоваться ли: в служебном разделе ссылки на якоря лендинга
 * бессмысленны, а её выворотка там просто лишняя работа в кадре.
 */
export default function SiteChrome() {
  const put = usePathname();
  if (put?.startsWith('/admin')) return null;
  return <Nav />;
}

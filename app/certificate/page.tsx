import '../shop.css';
import type { Metadata } from 'next';
import Sertifikaty from '@/components/shop/Sertifikaty';

export const metadata: Metadata = {
  title: 'Сертификат — Spotik Shop',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

/**
 * СТАРЫЙ АДРЕС АКТИВАЦИИ.
 *
 * Он стоит в письмах о купленном сертификате, в кабинете и в ссылках,
 * которые люди уже сохранили, поэтому перенаправлять его никуда
 * нельзя — открывается та же страница, только сразу на вкладке
 * «Активировать».
 */
export default function Certificate() {
  return <Sertifikaty nachalnaya="aktivirovat" />;
}

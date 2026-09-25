import '../shop.css';
import type { Metadata } from 'next';
import Sertifikaty from '@/components/shop/Sertifikaty';

export const metadata: Metadata = {
  title: 'Сертификаты — Spotik Shop',
  description: 'Подарить доступ к Spotify Premium: сертификат на любой тариф и срок.',
};
export const dynamic = 'force-dynamic';

export default function SertifikatyStranica() {
  return <Sertifikaty nachalnaya="podarit" />;
}

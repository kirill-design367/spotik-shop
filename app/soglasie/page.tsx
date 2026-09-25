import '../shop.css';
import type { Metadata } from 'next';
import { Pravo } from '@/components/legal/Pravo';

export const metadata: Metadata = { title: 'Согласие на обработку персональных данных — Spotik Shop' };

/**
 * ⚠️ СТРАНИЦА СТАТИЧЕСКАЯ, И ЭТО НЕ УКРАШЕНИЕ. Файл документа читается
 * с диска, и делать это на каждый заход незачем: текст меняется
 * выкладкой, а не в рантайме. Ни `cookies()`, ни `headers()` здесь
 * быть не должно — первое же из них перевело бы страницу
 * на посчитанный ответ вместе с чтением файла.
 */
export const dynamic = 'force-static';

export default function Stranica() {
  return <Pravo imya="soglasie" />;
}

import { YAZYKI, slovar, type Yazyk } from '@/lib/admin/slova';
import { adminSetLang } from '@/lib/server/actions-admin';

/**
 * Переключатель языка — В ШАПКЕ И ВИДЕН ВСЕГДА, включая страницу
 * входа: постановка. Это две обычные кнопки в форме, а не выпадающий
 * список, — языка ровно два, и лишний щелчок здесь не нужен.
 *
 * Серверный компонент: состояния у него нет вовсе, а выбор меняет
 * серверное действие. Значит на странице входа он работает и без
 * гидратации.
 */
export default function VyborYazyka({ y }: { y: Yazyk }) {
  const t = slovar(y);
  return (
    <form action={adminSetLang} className="ad__lang" aria-label={t('nav.lang')}>
      {YAZYKI.map((k) => (
        <button
          key={k.kod}
          type="submit"
          name="lang"
          value={k.kod}
          className="ad__lang-btn"
          aria-current={k.kod === y ? 'true' : undefined}
          lang={k.kod}
        >
          {k.imya}
        </button>
      ))}
    </form>
  );
}

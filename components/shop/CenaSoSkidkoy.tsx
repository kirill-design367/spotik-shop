import { rubli } from '@/lib/server/money';
import { procentSkidki } from '@/lib/plans';

/**
 * Цена со скидкой тарифа: яркая плашка «−N%», зачёркнутая старая цена
 * и рядом новая (Р-170). Скидки нет — только цена.
 *
 * ⚠️ ОДИН КУСОК НА ОФОРМЛЕНИЕ И СЕРТИФИКАТЫ, а процент — та же
 * `procentSkidki`, что у карт главной: три копии округления разошлись
 * бы на первой же скидке в 33,5 %.
 *
 * `klass` — классы самой новой цены (`tnum summa` даёт ей появление
 * при смене срока), `kluch` — её `key`, по которому анимация играет
 * заново.
 */
export default function CenaSoSkidkoy({
  kop,
  bylo,
  klass = 'tnum',
  kluch,
}: {
  kop: number;
  bylo?: number;
  klass?: string;
  kluch?: string | number;
}) {
  const est = typeof bylo === 'number' && bylo > kop;
  return (
    <span className="cena-sk">
      {est ? (
        <>
          <span className="skidka-plashka">−{procentSkidki(bylo, kop)}%</span>
          <s className="cena-sk__bylo tnum">{rubli(bylo)}</s>
        </>
      ) : null}
      <span key={kluch} className={klass}>
        {rubli(kop)}
      </span>
    </span>
  );
}

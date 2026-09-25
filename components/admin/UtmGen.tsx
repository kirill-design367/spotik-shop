'use client';

import { useState } from 'react';
import { slovar, type Yazyk } from '@/lib/admin/slova';

/**
 * Сборка рекламной ссылки с метками.
 *
 * ⚠️ СОБИРАЕТСЯ ЗДЕСЬ, А НЕ НА СЕРВЕРЕ. Ничего секретного в ссылке
 * нет, в базу она не ложится, и гонять форму туда-обратно ради
 * склейки пяти параметров незачем.
 *
 * ⚠️ ЗАГОТОВКА ДИРЕКТА СТАВИТ ПОДСТАНОВКИ, А НЕ ЧИСЛА. `{campaign_id}`
 * и `{ad_id}` Яндекс заменяет сам при переходе — то есть в заказ
 * приедет номер конкретной кампании и конкретного объявления,
 * а не то, что мы вписали руками.
 */
const DIREKT = {
  source: 'yandex',
  medium: 'cpc',
  campaign: '{campaign_id}',
  content: '{ad_id}',
  term: '{keyword}',
};

export default function UtmGen({ y, adres }: { y: Yazyk; adres: string }) {
  const t = slovar(y);
  const [pole, setPole] = useState({
    url: `${adres}/`,
    source: '',
    medium: '',
    campaign: '',
    content: '',
    term: '',
  });
  const [skopirovano, setSkopirovano] = useState(false);

  const metki: [string, string][] = [
    ['utm_source', pole.source],
    ['utm_medium', pole.medium],
    ['utm_campaign', pole.campaign],
    ['utm_content', pole.content],
    ['utm_term', pole.term],
  ];
  /* ⚠️ ФИГУРНЫЕ СКОБКИ ПОДСТАНОВОК НЕ КОДИРУЮТСЯ. Закодируй их —
     и Директ увидит `%7Bcampaign_id%7D`, то есть не свою подстановку,
     а просто строку, и подставлять ничего не станет. Всё остальное
     кодируется как обычно. */
  const hvost = metki
    .filter(([, v]) => v.trim())
    .map(([k, v]) => `${k}=${encodeURIComponent(v.trim()).replace(/%7B/g, '{').replace(/%7D/g, '}')}`)
    .join('&');
  const gotovo = hvost ? `${pole.url}${pole.url.includes('?') ? '&' : '?'}${hvost}` : pole.url;

  const polya: [keyof typeof pole, string][] = [
    ['url', t('g.url')],
    ['source', t('g.source')],
    ['medium', t('g.medium')],
    ['campaign', t('g.campaign')],
    ['content', t('g.content')],
    ['term', t('g.term')],
  ];

  return (
    <>
      <h2>{t('g.h')}</h2>
      <p className="hint">{t('g.hint')}</p>
      <div className="ad__form">
        {polya.map(([k, podpis]) => (
          <label key={k}>
            {podpis}
            <input
              type="text"
              value={pole[k]}
              onChange={(e) => {
                setPole((s) => ({ ...s, [k]: e.target.value }));
                setSkopirovano(false);
              }}
            />
          </label>
        ))}
        <div className="ad__actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              setPole((s) => ({ ...s, ...DIREKT }));
              setSkopirovano(false);
            }}
          >
            {t('g.direct')}
          </button>
        </div>
        <p className="hint">{t('g.direct_hint')}</p>
        <p className="ad__utm" style={{ wordBreak: 'break-all' }}>{gotovo}</p>
        <div className="ad__actions">
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => {
              /* ⚠️ БУФЕР МОЖЕТ БЫТЬ ЗАКРЫТ (нет https, отказ в правах),
                 и тогда обещать «скопировано» нельзя. */
              navigator.clipboard
                ?.writeText(gotovo)
                .then(() => setSkopirovano(true))
                .catch(() => setSkopirovano(false));
            }}
          >
            {skopirovano ? t('g.copied') : t('g.copy')}
          </button>
        </div>
      </div>
    </>
  );
}

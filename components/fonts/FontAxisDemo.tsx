'use client';

import { useMemo, useState } from 'react';
import { WORD, axesToCss, lerpAxes, ease, openAxesSeed, tightAxesSeed, type Axes } from '@/lib/wordmark';

/**
 * Ход осей от раскрытого состояния до сжатого.
 *
 * Показывает ровно ту математику, что работает на боевой странице
 * (lib/wordmark.ts), только ширина слова здесь фиксирована по контейнеру,
 * а не решается измерением — иначе на служебной странице пришлось бы
 * поднимать всю калибровку.
 */
const OPEN: Axes = { ...openAxesSeed(), wdth: 46 };
const TIGHT: Axes = { ...tightAxesSeed(OPEN), wdth: 59 };

const STOPS = [0, 0.25, 0.5, 0.75, 1];

export default function FontAxisDemo() {
  const [t, setT] = useState(0);
  const axes = useMemo(() => lerpAxes(OPEN, TIGHT, ease(t)), [t]);

  return (
    <section className="fp__cand">
      <div className="fp__bar">
        <p className="section__num">
          <b>Диапазон осей</b>
          <span className="eyebrow">Roboto Flex · от раскрытого до сжатого</span>
        </p>
        <span className="eyebrow tnum">прогресс {(t * 100).toFixed(0)}%</span>
      </div>

      <div className="fp__ladder">
        {STOPS.map((s) => (
          <div key={s} className="fp__rung">
            <span className="fp__rung-n tnum">{(s * 100).toFixed(0)}%</span>
            <span
              className="fp__rung-w"
              style={{
                fontFamily: "'Cand Roboto Flex', sans-serif",
                fontVariationSettings: axesToCss(lerpAxes(OPEN, TIGHT, ease(s))),
              }}
            >
              {WORD}
            </span>
          </div>
        ))}
      </div>

      <label className="fp__slider">
        <span className="eyebrow">Потянуть вручную</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.005}
          value={t}
          onChange={(e) => setT(Number(e.target.value))}
          aria-label="Прогресс сжатия вордмарка"
        />
      </label>

      <div
        className="fp__live"
        style={{ fontFamily: "'Cand Roboto Flex', sans-serif", fontVariationSettings: axesToCss(axes) }}
      >
        {WORD}
      </div>

      <dl className="fp__axes tnum">
        {(['YTUC', 'YOPQ', 'XOPQ', 'wdth', 'GRAD'] as const).map((k) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{axes[k].toFixed(1)}</dd>
            <dd className="fp__axes-note">
              {k === 'YTUC'
                ? 'высота прописных'
                : k === 'YOPQ'
                  ? 'горизонтальные штрихи'
                  : k === 'XOPQ'
                    ? 'вертикальные штрихи'
                    : k === 'wdth'
                      ? 'ширина'
                      : 'начертательная насыщенность'}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

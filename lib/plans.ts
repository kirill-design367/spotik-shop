/**
 * Тарифы. Цены условные — арт-директор заменит их своими.
 * Формат: срок в месяцах → сумма в рублях за весь срок.
 */
export type PeriodKey = 1 | 3 | 6 | 12;

export const PERIODS: { key: PeriodKey; label: string; short: string }[] = [
  { key: 1, label: 'Месяц', short: '1 мес' },
  { key: 3, label: 'Три месяца', short: '3 мес' },
  { key: 6, label: 'Полгода', short: '6 мес' },
  { key: 12, label: 'Год', short: '12 мес' },
];

export type Plan = {
  id: string;
  name: string;
  people: number;
  note: string;
  prices: Partial<Record<PeriodKey, number>>;
  hot?: boolean;
};

export const PLANS: Plan[] = [
  {
    id: 'solo',
    name: 'Индивидуальный',
    people: 1,
    note: 'Один аккаунт, одна фонотека, ничего лишнего.',
    prices: { 1: 299, 3: 799, 6: 1490, 12: 2690 },
  },
  {
    id: 'duo',
    name: 'На двоих',
    people: 2,
    note: 'Два независимых профиля: истории прослушиваний не смешиваются.',
    prices: { 1: 599, 3: 1590, 6: 2890, 12: 5290 },
    hot: true,
  },
  {
    id: 'trio',
    name: 'На троих',
    people: 3,
    note: 'Пока оформляется только на месяц. Остальные сроки — по запросу.',
    prices: { 1: 890 },
  },
];

/** 1 490 вместо 1490 — разряды обязательны, иначе цифра не читается. */
export function formatPrice(v: number): string {
  return v.toLocaleString('ru-RU').replace(/ /g, ' ');
}

/** Сколько стоит месяц при выбранном сроке. */
export function perMonth(total: number, months: PeriodKey): number {
  return Math.round(total / months);
}

/** Экономия относительно помесячной оплаты того же тарифа. */
export function savings(plan: Plan, months: PeriodKey): number {
  const monthly = plan.prices[1];
  const total = plan.prices[months];
  if (!monthly || !total || months === 1) return 0;
  return monthly * months - total;
}

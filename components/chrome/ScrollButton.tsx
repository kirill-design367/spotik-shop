'use client';

import { scrollToId } from '@/lib/scroll';

/**
 * Клиентский лист: кнопка, ведущая к секции.
 * Вынесена отдельно, чтобы сами секции оставались серверными компонентами
 * и не тащили в клиентский бандл ничего, кроме этого обработчика.
 */
export default function ScrollButton({
  to,
  children,
  variant = 'solid',
  className = '',
}: {
  to: string;
  children: React.ReactNode;
  variant?: 'solid' | 'ghost';
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`btn ${variant === 'ghost' ? 'btn--ghost' : ''} ${className}`.trim()}
      onClick={() => scrollToId(to)}
    >
      {children}
    </button>
  );
}

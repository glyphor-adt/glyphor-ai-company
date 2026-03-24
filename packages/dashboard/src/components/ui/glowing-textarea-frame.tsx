import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { MovingBorderContainer } from './MovingBorder';

/**
 * Inner field styles for textareas inside {@link GlowingTextareaFrame}.
 * Omit outer `border` / `rounded-lg` / `bg-base` — the frame provides the glow shell.
 */
export const glowingTextareaInnerClassName =
  'w-full min-h-[5rem] resize-y border-0 bg-transparent px-3 py-2 text-sm text-txt-primary placeholder:text-txt-faint outline-none ring-0 transition-colors focus:ring-0 disabled:opacity-50';

export function GlowingTextareaFrame({
  children,
  className,
  borderRadius = '0.75rem',
  innerClassName,
}: {
  children: ReactNode;
  className?: string;
  /** e.g. `0.75rem` for modals, `1rem` for wide editors */
  borderRadius?: string;
  innerClassName?: string;
}) {
  return (
    <MovingBorderContainer
      borderRadius={borderRadius}
      containerClassName={cn('w-full', className)}
      innerSurface="field"
      innerClassName={cn('flex flex-col overflow-hidden p-0', innerClassName)}
      glowActive
    >
      {children}
    </MovingBorderContainer>
  );
}

import React from 'react';
import { cn } from '../../lib/utils';

/**
 * Animated gradient border container.
 * Uses a rotating conic-gradient behind the content to create
 * a thin, continuously-moving colour trace around the border
 * (similar to Google Gemini's textarea).
 *
 * Requires the `.moving-border-spin` keyframes in index.css.
 */
export function MovingBorderContainer({
  children,
  borderRadius = '0.75rem',
  containerClassName,
  className,
}: {
  children: React.ReactNode;
  borderRadius?: string;
  containerClassName?: string;
  className?: string;
}) {
  return (
    <div
      className={cn('moving-border-container relative rounded-xl p-[1.5px]', containerClassName)}
      style={{ borderRadius }}
    >
      {/* Spinning conic-gradient — clipped to border-radius via overflow:hidden on parent */}
      <div
        className="moving-border-gradient pointer-events-none absolute inset-[-150%] z-0"
        aria-hidden
      />

      {/* Content — opaque bg masks the gradient; only the 1.5px padding gap is visible */}
      <div
        className={cn('relative z-10 h-full w-full bg-raised', className)}
        style={{ borderRadius: `calc(${borderRadius} - 1.5px)` }}
      >
        {children}
      </div>
    </div>
  );
}

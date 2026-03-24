import type { CSSProperties, ElementType, ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { GlowingEffect } from './glowing-effect';

/** Kept for any code that referenced the old moving-dot palette */
export const PALETTES = {
  prismMidnight: ['#00E0FF', '#00A3FF', '#1171ED', '#6E77DF'],
  gemini: ['#4285f4', '#a855f7', '#ec4899', '#4285f4'],
  aurora: ['#00ff87', '#60efff', '#0061ff', '#a855f7'],
  fire: ['#ff6b35', '#f7c948', '#ff3860', '#ff6b35'],
} as const;

export type PaletteKey = keyof typeof PALETTES;

export function MovingBorderContainer({
  children,
  borderRadius = '1.75rem',
  as: Component = 'div',
  containerClassName,
  innerClassName,
  glowActive = true,
  innerSurface = 'composer',
  ...otherProps
}: {
  children: ReactNode;
  borderRadius?: string;
  as?: ElementType;
  containerClassName?: string;
  innerClassName?: string;
  /** Pointer-proximity border sweep (Aceternity-style). */
  glowActive?: boolean;
  /** `composer` = chat/Ora shell; `field` = standard form textareas. */
  innerSurface?: 'composer' | 'field';
  [key: string]: unknown;
}) {
  const innerRadius = `calc(${borderRadius} - 2px)`;

  const innerStyle: CSSProperties =
    innerSurface === 'field'
      ? { borderRadius: innerRadius }
      : {
          borderRadius: innerRadius,
          background: 'rgb(var(--prism-card))',
          boxShadow:
            'inset 0 1px 0 rgba(255,255,255,0.05), inset 0 -1px 0 rgba(255,255,255,0.02)',
        };

  return (
    <Component
      className={cn(
        'relative isolate overflow-visible bg-transparent p-[2px]',
        innerSurface === 'field' && 'field-glow-shell',
        containerClassName,
      )}
      style={{ borderRadius }}
      {...otherProps}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 overflow-visible"
        style={{
          borderRadius,
          clipPath: `inset(0 round ${borderRadius})`,
        }}
      >
        {glowActive ? (
          <GlowingEffect
            blur={0}
            borderWidth={3}
            spread={80}
            glow
            disabled={false}
            proximity={64}
            inactiveZone={0.01}
            movementDuration={2}
            variant="cyan"
          />
        ) : (
          <GlowingEffect disabled glow={false} />
        )}
      </div>

      <div
        className={cn(
          'relative z-[1] flex h-full w-full antialiased chat-input-inner',
          innerSurface === 'composer' && 'items-center',
          innerSurface === 'field' && 'field-glow-inner items-stretch',
          innerClassName,
        )}
        style={innerStyle}
      >
        {children}
      </div>
    </Component>
  );
}

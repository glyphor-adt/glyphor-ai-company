import { memo, useCallback, useEffect, useRef, type CSSProperties } from 'react';
import { cn } from '../../lib/utils';

/** Prism / dashboard cyan accent — repeating conic for the border sweep */
const CYAN_REPEATING_CONIC = `repeating-conic-gradient(
  from 236.84deg at 50% 50%,
  rgba(0, 224, 255, 0.92) 0%,
  rgba(0, 163, 255, 0.55) calc(25% / var(--repeating-conic-gradient-times)),
  rgba(17, 113, 237, 0.68) calc(50% / var(--repeating-conic-gradient-times)),
  rgba(110, 119, 223, 0.45) calc(75% / var(--repeating-conic-gradient-times)),
  rgba(0, 224, 255, 0.92) calc(100% / var(--repeating-conic-gradient-times))
)`;

export interface GlowingEffectProps {
  blur?: number;
  inactiveZone?: number;
  proximity?: number;
  spread?: number;
  variant?: 'default' | 'white' | 'cyan';
  glow?: boolean;
  className?: string;
  disabled?: boolean;
  movementDuration?: number;
  borderWidth?: number;
}

const GlowingEffect = memo(
  ({
    blur = 0,
    inactiveZone = 0.7,
    proximity = 0,
    spread = 20,
    variant = 'default',
    glow = false,
    className,
    movementDuration = 2,
    borderWidth = 1,
    disabled = true,
  }: GlowingEffectProps) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const lastPosition = useRef({ x: 0, y: 0 });
    const animationFrameRef = useRef<number>(0);

    const handleMove = useCallback(
      (e?: PointerEvent | { x: number; y: number }) => {
        if (!containerRef.current) return;

        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }

        animationFrameRef.current = requestAnimationFrame(() => {
          const element = containerRef.current;
          if (!element) return;

          const { left, top, width, height } = element.getBoundingClientRect();
          const mouseX = e?.x ?? lastPosition.current.x;
          const mouseY = e?.y ?? lastPosition.current.y;

          if (e) {
            lastPosition.current = { x: mouseX, y: mouseY };
          }

          const center = [left + width * 0.5, top + height * 0.5];
          const distanceFromCenter = Math.hypot(mouseX - center[0], mouseY - center[1]);
          const inactiveRadius = 0.5 * Math.min(width, height) * inactiveZone;

          if (distanceFromCenter < inactiveRadius) {
            element.style.setProperty('--active', '0');
            return;
          }

          const isActive =
            mouseX > left - proximity &&
            mouseX < left + width + proximity &&
            mouseY > top - proximity &&
            mouseY < top + height + proximity;

          element.style.setProperty('--active', isActive ? '1' : '0');

          if (!isActive) return;

          // Cursor-follow coordinates relative to the element box.
          element.style.setProperty('--x', `${mouseX - left}px`);
          element.style.setProperty('--y', `${mouseY - top}px`);
        });
      },
      [inactiveZone, proximity],
    );

    useEffect(() => {
      if (disabled) return;

      const handleScroll = () => handleMove();
      const handlePointerMove = (e: PointerEvent) => handleMove(e);

      window.addEventListener('scroll', handleScroll, { passive: true });
      document.body.addEventListener('pointermove', handlePointerMove, {
        passive: true,
      });

      return () => {
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
        window.removeEventListener('scroll', handleScroll);
        document.body.removeEventListener('pointermove', handlePointerMove);
      };
    }, [handleMove, disabled]);

    const ringGradientCss =
      variant === 'white'
        ? `radial-gradient(
            ${Math.max(120, spread * 6)}px circle at var(--x) var(--y),
            rgba(255, 255, 255, 0.95) 0%,
            rgba(255, 255, 255, 0.6) 28%,
            rgba(255, 255, 255, 0.08) 50%,
            rgba(255, 255, 255, 0) 72%
          )`
        : variant === 'cyan'
          ? `radial-gradient(
              ${Math.max(140, spread * 7)}px circle at var(--x) var(--y),
              rgba(0, 224, 255, 0.95) 0%,
              rgba(0, 176, 255, 0.72) 25%,
              rgba(17, 113, 237, 0.32) 48%,
              rgba(0, 224, 255, 0) 72%
            )`
          : `radial-gradient(
              ${Math.max(120, spread * 6)}px circle at var(--x) var(--y),
              rgba(221, 123, 187, 0.9) 0%,
              rgba(215, 159, 30, 0.62) 25%,
              rgba(90, 146, 44, 0.3) 48%,
              rgba(76, 120, 148, 0) 72%
            )`;

    const blurGradientCss =
      variant === 'white'
        ? `radial-gradient(${Math.max(160, spread * 8)}px circle at var(--x) var(--y), rgba(255,255,255,0.22), rgba(255,255,255,0))`
        : variant === 'cyan'
          ? `radial-gradient(${Math.max(180, spread * 9)}px circle at var(--x) var(--y), rgba(0,224,255,0.32), rgba(0,224,255,0))`
          : `radial-gradient(${Math.max(170, spread * 8)}px circle at var(--x) var(--y), rgba(221,123,187,0.26), rgba(221,123,187,0))`;

    const layerStyle = {
      '--blur': `${blur}px`,
      '--spread': spread,
      '--x': '50%',
      '--y': '50%',
      '--active': '0',
      '--glowingeffect-border-width': `${borderWidth}px`,
      '--repeating-conic-gradient-times': '5',
      '--gradient': ringGradientCss,
    } as CSSProperties;

    return (
      <>
        {/* Inert border when pointer effect is off */}
        <div
          className={cn(
            'pointer-events-none absolute -inset-px hidden rounded-[inherit] border opacity-0 transition-opacity',
            glow && 'opacity-100',
            variant === 'white' && 'border-white',
            disabled && '!block',
          )}
        />
        <div
          ref={containerRef}
          style={layerStyle}
          className={cn(
            'pointer-events-none absolute inset-0 rounded-[inherit] opacity-100 transition-opacity',
            glow && 'opacity-100',
            className,
            disabled && '!hidden',
          )}
        >
          <div
            className={cn(
              'absolute inset-0 rounded-[inherit] p-[var(--glowingeffect-border-width)] opacity-[var(--active)] transition-opacity duration-200',
            )}
            style={{
              background: 'var(--gradient)',
              WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
              WebkitMaskComposite: 'xor',
              mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
              maskComposite: 'exclude',
            }}
          />
          <div
            className={cn(
              'absolute inset-0 rounded-[inherit] opacity-[calc(var(--active)*0.85)] transition-opacity duration-200',
              blur > 0 && 'blur-[var(--blur)]',
            )}
            style={{
              background: blurGradientCss,
            }}
          />
        </div>
      </>
    );
  },
);

GlowingEffect.displayName = 'GlowingEffect';

export { GlowingEffect };

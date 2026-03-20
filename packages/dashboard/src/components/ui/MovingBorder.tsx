import React, { useRef } from 'react';
import {
  motion,
  useAnimationFrame,
  useMotionTemplate,
  useMotionValue,
  useTransform,
} from 'motion/react';
import { cn } from '../../lib/utils';

/* ── Animated border tracer ─────────────────────────────── */

export function MovingBorder({
  children,
  duration = 3000,
  rx = '30%',
  ry = '30%',
  ...rest
}: {
  children: React.ReactNode;
  duration?: number;
  rx?: string;
  ry?: string;
  [key: string]: unknown;
}) {
  const pathRef = useRef<SVGRectElement>(null);
  const progress = useMotionValue(0);

  useAnimationFrame((time) => {
    const length = pathRef.current?.getTotalLength();
    if (length) {
      const pxPerMs = length / duration;
      progress.set((time * pxPerMs) % length);
    }
  });

  const x = useTransform(progress, (v) => pathRef.current?.getPointAtLength(v).x ?? 0);
  const y = useTransform(progress, (v) => pathRef.current?.getPointAtLength(v).y ?? 0);
  const transform = useMotionTemplate`translateX(${x}px) translateY(${y}px) translateX(-50%) translateY(-50%)`;

  return (
    <>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="none"
        className="absolute h-full w-full"
        width="100%"
        height="100%"
        {...rest}
      >
        <rect fill="none" width="100%" height="100%" rx={rx} ry={ry} ref={pathRef} />
      </svg>
      <motion.div
        style={{ position: 'absolute', top: 0, left: 0, display: 'inline-block', transform }}
      >
        {children}
      </motion.div>
    </>
  );
}

/* ── Container that wraps any element with a moving-border glow ── */

export function MovingBorderContainer({
  children,
  borderRadius = '0.75rem',
  containerClassName,
  borderClassName,
  duration,
  className,
}: {
  children: React.ReactNode;
  borderRadius?: string;
  containerClassName?: string;
  borderClassName?: string;
  duration?: number;
  className?: string;
}) {
  return (
    <div
      className={cn('relative overflow-hidden bg-transparent p-[1.5px]', containerClassName)}
      style={{ borderRadius }}
    >
      {/* Animated orbit layer */}
      <div className="absolute inset-0" style={{ borderRadius: `calc(${borderRadius} * 0.96)` }}>
        <MovingBorder duration={duration} rx="12" ry="12">
          <div
            className={cn(
              'h-24 w-24 opacity-80',
              borderClassName,
            )}
            style={{
              background:
                'radial-gradient(circle, #00E0FF 0%, #2DE6C8 30%, #C084FC 60%, transparent 80%)',
            }}
          />
        </MovingBorder>
      </div>

      {/* Content */}
      <div
        className={cn('relative h-full w-full', className)}
        style={{ borderRadius: `calc(${borderRadius} * 0.96)` }}
      >
        {children}
      </div>
    </div>
  );
}

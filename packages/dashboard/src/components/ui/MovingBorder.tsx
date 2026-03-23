import React, { useRef } from 'react';
import {
  motion,
  useAnimationFrame,
  useMotionValue,
  useTransform,
  useMotionTemplate,
} from 'motion/react';
import { cn } from '../../lib/utils';

// ── Palette presets ────────────────────────────────────────────────
export const PALETTES = {
  prismMidnight: ['#00E0FF', '#00A3FF', '#1171ED', '#6E77DF'],
  gemini: ['#4285f4', '#a855f7', '#ec4899', '#4285f4'],
  aurora: ['#00ff87', '#60efff', '#0061ff', '#a855f7'],
  fire: ['#ff6b35', '#f7c948', '#ff3860', '#ff6b35'],
} as const;

export type PaletteKey = keyof typeof PALETTES;

// ── Single trail dot ───────────────────────────────────────────────
function TrailDot({
  pathRef,
  duration,
  offsetFraction,
  color,
  opacity,
  size,
}: {
  pathRef: React.RefObject<SVGRectElement | null>;
  duration: number;
  offsetFraction: number;
  color: string;
  opacity: number;
  size: number;
}) {
  const progress = useMotionValue(0);

  useAnimationFrame((time) => {
    const path = pathRef.current;
    if (!path) return;
    const length = path.getTotalLength();
    if (!length) return;
    const pxPerMs = length / duration;
    const base = (time * pxPerMs) % length;
    const offset = offsetFraction * length * 0.35;
    progress.set((base - offset + length) % length);
  });

  const x = useTransform(progress, (val) => {
    const path = pathRef.current;
    return path ? path.getPointAtLength(val).x : 0;
  });

  const y = useTransform(progress, (val) => {
    const path = pathRef.current;
    return path ? path.getPointAtLength(val).y : 0;
  });

  const transform = useMotionTemplate`translate(${x}px, ${y}px) translate(-50%, -50%)`;

  return (
    <motion.div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: size,
        height: size,
        borderRadius: '50%',
        background: `radial-gradient(circle, ${color} 0%, ${color}88 30%, transparent 70%)`,
        opacity,
        filter: 'blur(12px)',
        transform,
        willChange: 'transform',
        pointerEvents: 'none',
      }}
    />
  );
}

// ── GradientMovingBorder (the SVG path + trail dots) ───────────────
export function GradientMovingBorder({
  duration = 12000,
  rx = '30%',
  ry = '30%',
  colors = PALETTES.prismMidnight,
  trailCount = 20,
  dotSize = 70,
}: {
  duration?: number;
  rx?: string;
  ry?: string;
  colors?: readonly string[] | string[];
  trailCount?: number;
  dotSize?: number;
}) {
  const pathRef = useRef<SVGRectElement>(null);

  const dots = Array.from({ length: trailCount }, (_, i) => {
    const t = i / trailCount;
    const colorIndex = Math.floor(t * colors.length) % colors.length;
    const opacity = 0.85 - t * 0.65;
    return (
      <TrailDot
        key={i}
        pathRef={pathRef}
        duration={duration}
        offsetFraction={i / trailCount}
        color={colors[colorIndex]}
        opacity={opacity}
        size={dotSize}
      />
    );
  });

  return (
    <>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="none"
        className="absolute h-full w-full"
        width="100%"
        height="100%"
      >
        <rect
          fill="none"
          width="100%"
          height="100%"
          rx={rx}
          ry={ry}
          ref={pathRef}
        />
      </svg>
      {dots}
    </>
  );
}

// ── Main container component ───────────────────────────────────────
export function MovingBorderContainer({
  children,
  borderRadius = '1.75rem',
  as: Component = 'div',
  containerClassName,
  innerClassName,
  duration = 12000,
  colors = PALETTES.prismMidnight,
  trailCount = 20,
  dotSize = 70,
  ...otherProps
}: {
  children: React.ReactNode;
  borderRadius?: string;
  as?: React.ElementType;
  containerClassName?: string;
  innerClassName?: string;
  duration?: number;
  colors?: readonly string[] | string[];
  trailCount?: number;
  dotSize?: number;
  [key: string]: any;
}) {
  return (
    <Component
      className={cn(
        'relative overflow-hidden bg-transparent p-[2px]',
        containerClassName,
      )}
      style={{ borderRadius }}
      {...otherProps}
    >
      {/* Animated gradient border layer — clip-path contains filter:blur which overflow:hidden often fails to clip */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{
          borderRadius: `calc(${borderRadius} * 0.96)`,
          clipPath: `inset(0 round calc(${borderRadius} * 0.96))`,
          isolation: 'isolate',
        }}
      >
        <GradientMovingBorder
          duration={duration}
          rx={borderRadius}
          ry={borderRadius}
          colors={colors}
          trailCount={trailCount}
          dotSize={dotSize}
        />
      </div>

      {/* Inner content */}
      <div
        className={cn(
          'relative flex h-full w-full items-center antialiased chat-input-inner',
          innerClassName,
        )}
        style={{
          borderRadius: `calc(${borderRadius} * 0.96)`,
          background: 'rgb(var(--prism-card))',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), inset 0 -1px 0 rgba(255,255,255,0.02)',
        }}
      >
        {children}
      </div>
    </Component>
  );
}

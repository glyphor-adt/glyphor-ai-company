"use client";

import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";

/** Tailwind `sm` is 640px — viewport widths below this get subtler particles. */
const MOBILE_MAX_WIDTH = 639;

function subscribeNarrow(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`);
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

function getNarrowSnapshot() {
  if (typeof window === "undefined") return false;
  return window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`).matches;
}

function getServerNarrowSnapshot() {
  return false;
}

function useIsBelowSm() {
  return useSyncExternalStore(subscribeNarrow, getNarrowSnapshot, getServerNarrowSnapshot);
}

type DottedGlowBackgroundProps = {
  className?: string;
  /** distance between dot centers in pixels */
  gap?: number;
  /** base radius of each dot in CSS px */
  radius?: number;
  /** dot color (will pulse by alpha) */
  color?: string;
  /** optional dot color for dark mode */
  darkColor?: string;
  /** shadow/glow color for bright dots */
  glowColor?: string;
  /** optional glow color for dark mode */
  darkGlowColor?: string;
  /** optional CSS variable name for light dot color (e.g. --color-zinc-900) */
  colorLightVar?: string;
  /** optional CSS variable name for dark dot color (e.g. --color-zinc-100) */
  colorDarkVar?: string;
  /** optional CSS variable name for light glow color */
  glowColorLightVar?: string;
  /** optional CSS variable name for dark glow color */
  glowColorDarkVar?: string;
  /** global opacity for the whole layer */
  opacity?: number;
  /** background radial fade opacity (0 = transparent background) */
  backgroundOpacity?: number;
  /** minimum per-dot speed in rad/s */
  speedMin?: number;
  /** maximum per-dot speed in rad/s */
  speedMax?: number;
  /** global speed multiplier for all dots */
  speedScale?: number;
  /** number of random white shimmer dots scattered across the canvas */
  shimmerCount?: number;
  /** color of shimmer dots */
  shimmerColor?: string;
  /** radius of shimmer dots */
  shimmerRadius?: number;
};

/**
 * Canvas-based dotted background that randomly glows and dims.
 * - Uses a stable grid of dots.
 * - Each dot gets its own phase + speed producing organic shimmering.
 * - Handles high-DPI and resizes via ResizeObserver.
 */
export const DottedGlowBackground = ({
  className,
  gap = 12,
  radius = 2,
  color = "rgba(0,0,0,0.7)",
  darkColor,
  glowColor = "rgba(0, 170, 255, 0.85)",
  darkGlowColor,
  colorLightVar,
  colorDarkVar,
  glowColorLightVar,
  glowColorDarkVar,
  opacity = 0.6,
  backgroundOpacity = 0,
  speedMin = 0.4,
  speedMax = 1.3,
  speedScale = 1,
  shimmerCount = 0,
  shimmerColor = "rgba(255,255,255,0.9)",
  shimmerRadius = 1,
}: DottedGlowBackgroundProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [resolvedColor, setResolvedColor] = useState<string>(color);
  const [resolvedGlowColor, setResolvedGlowColor] = useState<string>(glowColor);
  const isBelowSm = useIsBelowSm();

  // Resolve CSS variable value from the container or root
  const resolveCssVariable = (
    el: Element,
    variableName?: string,
  ): string | null => {
    if (!variableName) return null;
    const normalized = variableName.startsWith("--")
      ? variableName
      : `--${variableName}`;
    const fromEl = getComputedStyle(el as Element)
      .getPropertyValue(normalized)
      .trim();
    if (fromEl) return fromEl;
    const root = document.documentElement;
    const fromRoot = getComputedStyle(root).getPropertyValue(normalized).trim();
    return fromRoot || null;
  };

  const detectDarkMode = (): boolean => {
    const root = document.documentElement;
    if (root.classList.contains("dark")) return true;
    if (root.classList.contains("light")) return false;
    return (
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    );
  };

  // Keep resolved colors in sync with theme changes and prop updates
  useEffect(() => {
    const container = containerRef.current ?? document.documentElement;

    const compute = () => {
      const isDark = detectDarkMode();

      let nextColor: string = color;
      let nextGlow: string = glowColor;

      if (isDark) {
        const varDot = resolveCssVariable(container, colorDarkVar);
        const varGlow = resolveCssVariable(container, glowColorDarkVar);
        nextColor = varDot || darkColor || nextColor;
        nextGlow = varGlow || darkGlowColor || nextGlow;
      } else {
        const varDot = resolveCssVariable(container, colorLightVar);
        const varGlow = resolveCssVariable(container, glowColorLightVar);
        nextColor = varDot || nextColor;
        nextGlow = varGlow || nextGlow;
      }

      setResolvedColor(nextColor);
      setResolvedGlowColor(nextGlow);
    };

    compute();

    const mql = window.matchMedia
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;
    const handleMql = () => compute();
    mql?.addEventListener?.("change", handleMql);

    const mo = new MutationObserver(() => compute());
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    return () => {
      mql?.removeEventListener?.("change", handleMql);
      mo.disconnect();
    };
  }, [
    color,
    darkColor,
    glowColor,
    darkGlowColor,
    colorLightVar,
    colorDarkVar,
    glowColorLightVar,
    glowColorDarkVar,
  ]);

  useEffect(() => {
    const el = canvasRef.current;
    const container = containerRef.current;
    if (!el || !container) return;

    const ctx = el.getContext("2d");
    if (!ctx) return;

    /** Mobile (below sm): ~50% smaller dots, ~45% lower layer opacity, ~50% fewer shimmers, wider gap → ~50% fewer grid dots */
    const narrow = isBelowSm;
    const effectiveGap = narrow ? gap * 1.35 : gap;
    const effectiveRadius = narrow ? radius * 0.5 : radius;
    const layerOpacity = narrow ? opacity * 0.55 : opacity;
    const effectiveShimmerCount = narrow
      ? Math.max(0, Math.round(shimmerCount * 0.5))
      : shimmerCount;
    const effectiveShimmerRadius = narrow ? shimmerRadius * 0.5 : shimmerRadius;
    const glowBlurScale = narrow ? 0.5 : 1;
    const shimmerBlurScale = narrow ? 0.5 : 1;

    let raf = 0;
    let stopped = false;
    let isVisible = true;

    const dpr = Math.min(Math.max(1, window.devicePixelRatio || 1), 2);

    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      el.width = Math.max(1, Math.floor(width * dpr));
      el.height = Math.max(1, Math.floor(height * dpr));
      el.style.width = `${Math.floor(width)}px`;
      el.style.height = `${Math.floor(height)}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    // Precompute dot metadata for a medium-sized grid and regenerate on resize
    let dots: { x: number; y: number; phase: number; speed: number }[] = [];
    let shimmerDots: { x: number; y: number; phase: number; speed: number }[] = [];

    const regenDots = () => {
      dots = [];
      shimmerDots = [];
      const { width, height } = container.getBoundingClientRect();
      const cols = Math.ceil(width / effectiveGap) + 2;
      const rows = Math.ceil(height / effectiveGap) + 2;
      const min = Math.min(speedMin, speedMax);
      const max = Math.max(speedMin, speedMax);
      for (let i = -1; i < cols; i++) {
        for (let j = -1; j < rows; j++) {
          const x = i * effectiveGap + (j % 2 === 0 ? 0 : effectiveGap * 0.5); // offset every other row
          const y = j * effectiveGap;
          // Randomize phase and speed slightly per dot
          const phase = Math.random() * Math.PI * 2;
          const span = Math.max(max - min, 0);
          const speed = min + Math.random() * span; // configurable rad/s
          dots.push({ x, y, phase, speed });
        }
      }
      // Generate random shimmer dots
      for (let s = 0; s < effectiveShimmerCount; s++) {
        shimmerDots.push({
          x: Math.random() * width,
          y: Math.random() * height,
          phase: Math.random() * Math.PI * 2,
          speed: 0.3 + Math.random() * 0.8,
        });
      }
    };

    const regenThrottled = () => {
      regenDots();
    };

    regenDots();

    let last = performance.now();

    const draw = (now: number) => {
      if (stopped) return;
      if (!isVisible) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const dt = (now - last) / 1000; // seconds
      last = now;
      const { width, height } = container.getBoundingClientRect();

      ctx.clearRect(0, 0, el.width, el.height);
      ctx.globalAlpha = layerOpacity;

      // optional subtle background fade for depth (defaults to 0 = transparent)
      if (backgroundOpacity > 0) {
        const grad = ctx.createRadialGradient(
          width * 0.5,
          height * 0.4,
          Math.min(width, height) * 0.1,
          width * 0.5,
          height * 0.5,
          Math.max(width, height) * 0.7,
        );
        grad.addColorStop(0, "rgba(0,0,0,0)");
        grad.addColorStop(
          1,
          `rgba(0,0,0,${Math.min(Math.max(backgroundOpacity, 0), 1)})`,
        );
        ctx.fillStyle = grad as unknown as CanvasGradient;
        ctx.fillRect(0, 0, width, height);
      }

      // animate dots
      ctx.save();
      ctx.fillStyle = resolvedColor;

      const time = (now / 1000) * Math.max(speedScale, 0);
      for (let i = 0; i < dots.length; i++) {
        const d = dots[i];
        // Smooth sine wave 0..1..0 for organic shimmer
        const raw = Math.sin(time * d.speed + d.phase);
        const lin = raw * 0.5 + 0.5; // normalize to 0..1
        const a = 0.15 + 0.85 * lin; // 0.15..1.0 — dim baseline, bright peaks

        // draw glow when bright
        if (a > 0.5) {
          const glow = (a - 0.5) / 0.5; // 0..1
          ctx.shadowColor = resolvedGlowColor;
          ctx.shadowBlur = 10 * glow * glowBlurScale;
        } else {
          ctx.shadowColor = "transparent";
          ctx.shadowBlur = 0;
        }

        ctx.globalAlpha = a * layerOpacity;
        ctx.beginPath();
        ctx.arc(d.x, d.y, effectiveRadius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Draw shimmer dots (random white sparkle)
      if (shimmerDots.length > 0) {
        ctx.save();
        for (let s = 0; s < shimmerDots.length; s++) {
          const sd = shimmerDots[s];
          const raw = Math.sin(time * sd.speed * 1.4 + sd.phase);
          // Heavily biased toward invisible — only briefly flash bright
          const pulse = Math.max(0, raw * 2 - 1); // 0 most of the time, peaks at 1
          if (pulse <= 0.01) continue;
          ctx.globalAlpha = pulse * layerOpacity;
          ctx.shadowColor = shimmerColor;
          ctx.shadowBlur = 6 * pulse * shimmerBlurScale;
          ctx.fillStyle = shimmerColor;
          ctx.beginPath();
          ctx.arc(sd.x, sd.y, effectiveShimmerRadius, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      raf = requestAnimationFrame(draw);
    };

    const handleResize = () => {
      resize();
      regenThrottled();
    };

    const observer = new IntersectionObserver(
      (entries) => {
        isVisible = entries[0]?.isIntersecting ?? true;
      },
      { threshold: 0.1 },
    );
    observer.observe(container);

    window.addEventListener("resize", handleResize);
    raf = requestAnimationFrame(draw);

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", handleResize);
      observer.disconnect();
      ro.disconnect();
    };
  }, [
    gap,
    radius,
    resolvedColor,
    resolvedGlowColor,
    opacity,
    backgroundOpacity,
    speedMin,
    speedMax,
    speedScale,
    shimmerCount,
    shimmerColor,
    shimmerRadius,
    isBelowSm,
  ]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: "absolute", inset: 0, zIndex: 0 }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100%", height: "100%" }}
      />
    </div>
  );
};

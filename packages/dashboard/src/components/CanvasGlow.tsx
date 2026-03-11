import { useEffect, useRef } from 'react';

interface GlowSpot {
  color: string;
  baseX: number;
  baseY: number;
  radius: number;
  driftX: number;
  driftY: number;
  speed: number;
}

const GLOW_SPOTS: GlowSpot[] = [
  { color: '0,224,255', baseX: 0.2, baseY: 0.24, radius: 280, driftX: 0.05, driftY: 0.03, speed: 0.0007 },
  { color: '110,119,223', baseX: 0.72, baseY: 0.18, radius: 320, driftX: 0.04, driftY: 0.05, speed: 0.00055 },
  { color: '17,113,237', baseX: 0.54, baseY: 0.74, radius: 360, driftX: 0.06, driftY: 0.04, speed: 0.00045 },
];

export default function CanvasGlow() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    let animationId = 0;
    let width = 0;
    let height = 0;

    const resize = () => {
      const parent = canvas.parentElement;
      width = parent?.clientWidth ?? window.innerWidth;
      height = parent?.clientHeight ?? window.innerHeight;
      const pixelRatio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(width * pixelRatio);
      canvas.height = Math.floor(height * pixelRatio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    };

    const draw = (now: number) => {
      context.clearRect(0, 0, width, height);

      for (const spot of GLOW_SPOTS) {
        const x = width * (spot.baseX + Math.sin(now * spot.speed) * spot.driftX);
        const y = height * (spot.baseY + Math.cos(now * spot.speed * 0.92) * spot.driftY);
        const gradient = context.createRadialGradient(x, y, 0, x, y, spot.radius);
        gradient.addColorStop(0, `rgba(${spot.color}, 0.16)`);
        gradient.addColorStop(0.45, `rgba(${spot.color}, 0.07)`);
        gradient.addColorStop(1, `rgba(${spot.color}, 0)`);
        context.fillStyle = gradient;
        context.beginPath();
        context.arc(x, y, spot.radius, 0, Math.PI * 2);
        context.fill();
      }

      animationId = window.requestAnimationFrame(draw);
    };

    resize();
    animationId = window.requestAnimationFrame(draw);
    window.addEventListener('resize', resize);

    return () => {
      window.cancelAnimationFrame(animationId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="canvas-glow" aria-hidden="true" />;
}

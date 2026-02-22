import { AGENT_META } from '../lib/types';

/* ─── Agent Avatar ────────────────────────── */
export function AgentAvatar({
  role,
  size = 36,
  glow = false,
}: {
  role: string;
  size?: number;
  glow?: boolean;
}) {
  const meta = AGENT_META[role] ?? { color: '#64748b', icon: 'MdSmartToy' };
  return (
    <img
      src={`/avatars/${role}.png`}
      alt={role}
      className={`rounded-full object-cover ${glow ? 'agent-glow' : ''}`}
      style={{
        width: size,
        height: size,
        border: `1.5px solid ${meta.color}40`,
      }}
    />
  );
}

/* ─── Tier Badge (green / yellow / red) ──── */
export function TierBadge({ tier }: { tier: string }) {
  const colors: Record<string, string> = {
    green: 'bg-tier-green/15 text-tier-green border-tier-green/30',
    yellow: 'bg-tier-yellow/15 text-tier-yellow border-tier-yellow/30',
    red: 'bg-tier-red/15 text-tier-red border-tier-red/30',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${
        colors[tier] ?? colors.green
      }`}
    >
      {tier}
    </span>
  );
}

/* ─── Impact Badge ────────────────────────── */
export function ImpactBadge({ impact }: { impact: string }) {
  const colors: Record<string, string> = {
    low: 'bg-slate-500/15 text-slate-400 border-slate-500/25',
    medium: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
    high: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
    critical: 'bg-red-500/15 text-red-400 border-red-500/25',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider ${
        colors[impact] ?? colors.low
      }`}
    >
      {impact}
    </span>
  );
}

/* ─── Status Dot ──────────────────────────── */
export function StatusDot({ status }: { status: string }) {
  const bg =
    status === 'active' ? 'bg-tier-green' : status === 'idle' ? 'bg-tier-yellow' : 'bg-slate-600';
  return <span className={`inline-block h-2 w-2 rounded-full ${bg}`} />;
}

/* ─── Sparkline (SVG mini chart) ─────────── */
export function Sparkline({
  data,
  color = '#00E0FF',
  width = 80,
  height = 24,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg width={width} height={height} className="flex-shrink-0">
      <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" points={points} />
    </svg>
  );
}

/* ─── Card wrapper ────────────────────────── */
export function Card({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-border bg-surface p-5 transition-colors duration-200 ${className}`}>
      {children}
    </div>
  );
}

/* ─── Section header ──────────────────────── */
export function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-lg font-semibold text-txt-primary">{title}</h2>
      {action}
    </div>
  );
}

/* ─── Loading skeleton ────────────────────── */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`shimmer-bg rounded-lg ${className}`} />;
}

/* ─── Relative time helper ────────────────── */
export function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

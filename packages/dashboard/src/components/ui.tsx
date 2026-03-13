import { AGENT_META } from '../lib/types';
import { GLASS_CARD_BASE, GLASS_CARD_INTERACTIVE } from '../lib/glassCard';

function buildCardStyle(
  accent: string | undefined,
  style: React.CSSProperties | undefined,
): React.CSSProperties | undefined {
  if (!accent) return style;
  return {
    ...style,
    ['--card-accent-rgb' as string]: accent,
  } as React.CSSProperties;
}

/* ─── Agent Avatar ────────────────────────── */
export function AgentAvatar({
  role,
  size = 36,
  glow = false,
  avatarUrl,
}: {
  role: string;
  size?: number;
  glow?: boolean;
  avatarUrl?: string | null;
}) {
  const meta = AGENT_META[role] ?? { color: '#64748b', icon: 'MdSmartToy' };
  const fallbackAvatar = `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(role)}&radius=50&bold=true`;
  return (
    <img
      src={avatarUrl || `/avatars/${role}.png`}
      alt={role}
      onError={(e) => {
        const img = e.currentTarget;
        if (img.src !== fallbackAvatar) {
          img.src = fallbackAvatar;
          img.onerror = null;
        }
      }}
      className={`rounded-full object-cover ${glow ? 'agent-glow' : ''}`}
      style={{
        width: size,
        height: size,
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
    low: 'bg-prism-moderate/15 text-prism-moderate border-prism-moderate/25',
    medium: 'bg-prism-elevated/15 text-prism-elevated border-prism-elevated/25',
    high: 'bg-prism-high/15 text-prism-high border-prism-high/25',
    critical: 'bg-prism-critical/15 text-prism-critical border-prism-critical/25',
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
    status === 'active' ? 'bg-prism-fill-2' : status === 'idle' ? 'bg-prism-elevated' : 'bg-prism-moderate';
  return <span className={`inline-block h-2 w-2 rounded-full ${bg}`} />;
}

/* ─── Sparkline (SVG mini chart) ─────────── */
export function Sparkline({
  data,
  color = '#0891B2',
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
  accent,
  glow = false,
  interactive = false,
  style,
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  accent?: string;
  glow?: boolean;
  interactive?: boolean;
  style?: React.CSSProperties;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`glass-card glassmorphism ${interactive ? GLASS_CARD_INTERACTIVE : GLASS_CARD_BASE} p-5 ${interactive ? 'glass-card--interactive' : ''} ${glow ? 'glass-card--glow' : ''} ${className}`}
      style={buildCardStyle(accent, style)}
      {...rest}
    >
      {glow && <span className="glass-card__glow" aria-hidden="true" />}
      <div className="glass-card__content">
        {children}
      </div>
    </div>
  );
}

export function InnerCard({
  children,
  className = '',
  accent,
  style,
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  accent?: string;
  style?: React.CSSProperties;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`glass-raised glassmorphism glass-inner-card rounded-xl border border-primary/20 bg-black/25 backdrop-blur-[8px] px-4 py-3 ${className}`}
      style={buildCardStyle(accent, style)}
      {...rest}
    >
      <div className="glass-card__content">
        {children}
      </div>
    </div>
  );
}

/* ─── Section header ──────────────────────── */
export function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <div>
        <h2 className="text-lg font-semibold text-txt-primary">{title}</h2>
        {subtitle && <p className="text-xs text-txt-muted mt-0.5">{subtitle}</p>}
      </div>
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

/* ─── Page-level tab bar ──────────────────── */
export function PageTabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: T; label: string }[];
  active: T;
  onChange: (key: T) => void;
}) {
  return (
    <div className="glass-tabs flex gap-1 rounded-lg p-1 w-fit border border-border">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`rounded-md px-4 py-1.5 text-[13px] font-medium transition-all ${
            active === t.key
              ? 'bg-cyan/15 text-cyan backdrop-blur-sm'
              : 'text-txt-muted hover:text-txt-secondary hover:bg-white/5'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

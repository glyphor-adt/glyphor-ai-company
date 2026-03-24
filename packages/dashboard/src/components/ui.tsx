import { AGENT_META } from '../lib/types';
import { cn } from '../lib/utils';

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

/* ─── Badge Color Map (single source of truth) ──── */
export type BadgeColor =
  | 'red' | 'orange' | 'amber' | 'yellow' | 'green' | 'emerald'
  | 'teal' | 'cyan' | 'sky' | 'blue' | 'indigo' | 'violet'
  | 'purple' | 'pink' | 'gray';

/** CSS class for each badge color. Use directly in className when a component is not practical. */
export const BADGE_COLORS: Record<BadgeColor, string> = {
  red:     'badge-red',
  orange:  'badge-orange',
  amber:   'badge-amber',
  yellow:  'badge-yellow',
  green:   'badge-green',
  emerald: 'badge-emerald',
  teal:    'badge-teal',
  cyan:    'badge-cyan',
  sky:     'badge-sky',
  blue:    'badge-blue',
  indigo:  'badge-indigo',
  violet:  'badge-violet',
  purple:  'badge-purple',
  pink:    'badge-pink',
  gray:    'badge-gray',
};

/** Universal gradient badge. All badge rendering goes through this or the CSS classes above. */
export function Badge({
  children,
  color = 'gray',
  size,
  uppercase = false,
  className = '',
}: {
  children: React.ReactNode;
  color?: BadgeColor;
  size?: 'xs' | 'sm' | 'lg';
  uppercase?: boolean;
  className?: string;
}) {
  return (
    <span className={`badge ${BADGE_COLORS[color]} ${size ? `badge-${size}` : ''} ${uppercase ? 'badge-up' : ''} ${className}`}>
      {children}
    </span>
  );
}

/* ─── Tier Badge (green / yellow / red) ──── */
export function TierBadge({ tier }: { tier: string }) {
  const map: Record<string, BadgeColor> = { green: 'green', yellow: 'amber', red: 'red' };
  return <Badge color={map[tier] ?? 'green'}>{tier}</Badge>;
}

/* ─── Impact Badge ────────────────────────── */
export function ImpactBadge({ impact }: { impact: string }) {
  const map: Record<string, BadgeColor> = { low: 'gray', medium: 'amber', high: 'orange', critical: 'red' };
  return <Badge color={map[impact] ?? 'gray'} uppercase>{impact}</Badge>;
}

/* ─── Gradient Border Button ──────────────── */
type GradientVariant = 'primary' | 'approve' | 'reject' | 'purple' | 'warning' | 'neutral';
type GradientSize = 'sm' | 'md';

const GRADIENT_MAP: Record<GradientVariant, string> = {
  primary: 'from-[#00E0FF] to-[#3730A3]',
  approve: 'from-green-400 to-emerald-600',
  reject: 'from-red-500 to-rose-600',
  purple: 'from-[#C084FC] to-[#00E0FF]',
  warning: 'from-amber-400 to-yellow-600',
  neutral: 'from-gray-400 to-gray-600',
};

const SIZE_MAP: Record<GradientSize, string> = {
  sm: 'px-2.5 py-1 text-[11px] leading-4',
  md: 'px-4 py-2 text-sm',
};

export function GradientButton({
  children,
  variant = 'primary',
  size = 'sm',
  className = '',
  as: Component = 'button',
  ...rest
}: {
  children: React.ReactNode;
  variant?: GradientVariant;
  size?: GradientSize;
  className?: string;
  as?: React.ElementType;
  [key: string]: unknown;
}) {
  return (
    <Component
      className={`group relative inline-flex items-center justify-center overflow-hidden rounded-md bg-gradient-to-br ${GRADIENT_MAP[variant]} p-[1.5px] font-medium focus:outline-none ${className}`}
      {...rest}
    >
      <span className={`relative rounded-[5px] bg-base dark:bg-raised ${SIZE_MAP[size]} font-semibold text-txt-primary dark:text-white transition-all duration-75 ease-in group-hover:bg-transparent group-hover:text-white`}>
        {children}
      </span>
    </Component>
  );
}

/* ─── Normalized secondary actions (aligned with PageTabs / sidebar tones) ─── */

const outlineSecondarySizeClasses = {
  xs: 'rounded-md px-2.5 py-1 text-[11px]',
  sm: 'rounded-md px-3 py-1.5 text-[11px]',
  md: 'rounded-lg px-4 py-2 text-sm',
} as const;

const buttonToneMutedClassName =
  'font-medium text-prism-tertiary transition-colors hover:bg-prism-bg2 hover:text-prism-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/30 dark:text-white/70 dark:hover:bg-cyan/10 dark:hover:text-white';

export function ButtonOutlineSecondary({
  size = 'md',
  className,
  children,
  type = 'button',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: keyof typeof outlineSecondarySizeClasses;
}) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center border border-border bg-transparent',
        buttonToneMutedClassName,
        outlineSecondarySizeClasses[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Borderless cancel / secondary text button (e.g. modal footer next to primary). */
export function ButtonGhost({
  className,
  children,
  type = 'button',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm',
        buttonToneMutedClassName,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Modal / panel header dismiss (× or icon). */
export function ModalCloseButton({
  className,
  children = '×',
  type = 'button',
  'aria-label': ariaLabel = 'Close',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode }) {
  return (
    <button
      type={type}
      aria-label={ariaLabel}
      className={cn(
        'inline-flex items-center justify-center rounded-md p-1 text-lg leading-none text-prism-tertiary transition-colors hover:bg-prism-bg2 hover:text-prism-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/30 dark:text-white/70 dark:hover:bg-cyan/10 dark:hover:text-white',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Compact filter / watchlist chips (inactive + “All” active). */
export const filterChipButtonBaseClassName =
  'rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase transition-colors';

export const filterChipInactiveClassName = cn(
  filterChipButtonBaseClassName,
  'border border-transparent bg-raised text-prism-tertiary hover:bg-prism-bg2 hover:text-prism-primary dark:text-white/70 dark:hover:bg-cyan/10 dark:hover:text-white',
);

export const filterChipActiveAllClassName = cn(filterChipButtonBaseClassName, 'bg-cyan/20 text-cyan');

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
      className={`glass-surface glass-card-layout rounded-2xl border p-5 ${interactive ? 'transition-all hover:-translate-y-0.5 active:translate-y-0' : ''} ${glow ? 'glass-card--glow' : ''} ${className}`}
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
      className={`glass-surface glass-inner-layout rounded-xl border px-4 py-3 ${className}`}
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
          className={`rounded-md px-4 py-1.5 text-[13px] font-medium transition-colors ${
            active === t.key
              ? 'bg-cyan/15 font-semibold text-cyan backdrop-blur-sm'
              : 'text-prism-tertiary hover:bg-prism-bg2 hover:text-prism-primary dark:text-white/70 dark:hover:bg-cyan/10 dark:hover:text-white'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

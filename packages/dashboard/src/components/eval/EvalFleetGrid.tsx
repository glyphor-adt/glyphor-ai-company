import { useState, useEffect, useCallback } from 'react';
import { apiCall } from '../../lib/firebase';

/* ── Types ─────────────────────────────────────────────────── */

export interface FleetAgent {
  id: string;
  role: string;
  name: string;
  department: string | null;
  performance_score: number | null;
  prompt_version: number | null;
  prompt_source: string | null;
  exec_quality: number | null;
  team_quality: number | null;
  cos_quality: number | null;
  constitutional_score: number | null;
  success_rate: number | null;
  open_p0s: number;
  open_p1s: number;
  reflection_mutations: number;
  promoted_mutations: number;
  last_run_at: string | null;
}

export function scoreColor(score: number | null): string {
  if (score === null) return '#334155';
  if (score >= 0.75) return '#00E0FF';
  if (score >= 0.50) return '#F59E0B';
  return '#EF4444';
}

export function scoreLabel(score: number | null): 'healthy' | 'degraded' | 'unhealthy' | 'unknown' {
  if (score === null) return 'unknown';
  if (score >= 0.75) return 'healthy';
  if (score >= 0.50) return 'degraded';
  return 'unhealthy';
}

function formatRelative(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function isRecentRun(dateStr: string | null): boolean {
  if (!dateStr) return false;
  return Date.now() - new Date(dateStr).getTime() < 5 * 60 * 1000;
}

/* ── ScoreRadial ───────────────────────────────────────────── */

export function ScoreRadial({ score, color, size = 56 }: { score: number | null; color: string; size?: number }) {
  const pct = score ?? 0;
  const r = size * 0.357; // ~20 for size=56
  const circ = 2 * Math.PI * r;
  const dash = circ * pct;
  const center = size / 2;
  const fontSize = size * 0.214; // ~12 for size=56

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={center} cy={center} r={r} fill="none" stroke="#1e293b" strokeWidth="4" />
      <circle
        cx={center} cy={center} r={r} fill="none"
        stroke={color} strokeWidth="4"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${center} ${center})`}
        style={{ transition: 'stroke-dasharray 0.6s ease' }}
      />
      <text x={center} y={center + fontSize * 0.35} textAnchor="middle" fontSize={fontSize} fontWeight="600"
            fill={score === null ? '#475569' : color}>
        {score === null ? '—' : Math.round(pct * 100)}
      </text>
    </svg>
  );
}

/* ── EvalFleetGrid ─────────────────────────────────────────── */

interface EvalFleetGridProps {
  onAgentClick: (agent: FleetAgent) => void;
  filter?: string | null;
}

export default function EvalFleetGrid({ onAgentClick, filter }: EvalFleetGridProps) {
  const [agents, setAgents] = useState<FleetAgent[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const rows = await apiCall<FleetAgent[]>('/api/eval/fleet');
      setAgents(rows ?? []);
    } catch {
      setAgents([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 60_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const filtered = agents.filter(a => {
    if (!filter) return true;
    const label = scoreLabel(a.performance_score);
    if (filter === 'healthy' || filter === 'degraded' || filter === 'unhealthy') return label === filter;
    if (filter === 'p0') return a.open_p0s > 0;
    if (filter === 'self-improved') return a.reflection_mutations > 0 || a.promoted_mutations > 0;
    if (filter === 'shadow') return false; // handled at page level with shadow data
    return true;
  });

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-[160px] animate-pulse rounded-xl glass-surface" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {filtered.map(agent => (
        <div
          key={agent.id}
          style={{ '--rim': scoreColor(agent.performance_score) } as React.CSSProperties}
          className="relative rounded-xl glass-surface p-4 cursor-pointer
                     transition-all duration-200 hover:scale-[1.02]"
          onClick={() => onAgentClick(agent)}
        >
          {/* P0 badge — always visible */}
          {agent.open_p0s > 0 && (
            <span className="absolute top-2 right-2 bg-red-500 text-white text-[10px]
                           font-bold px-1.5 py-0.5 rounded-full z-10">
              P0 ×{agent.open_p0s}
            </span>
          )}

          {/* P1 badge */}
          {agent.open_p1s > 0 && agent.open_p0s === 0 && (
            <span className="absolute top-2 right-2 bg-amber-500 text-white text-[10px]
                           font-bold px-1.5 py-0.5 rounded-full z-10">
              P1 ×{agent.open_p1s}
            </span>
          )}

          {/* Running indicator */}
          {isRecentRun(agent.last_run_at) && (
            <span className="absolute top-2 left-2 h-2 w-2 rounded-full bg-[#00E0FF] animate-pulse" />
          )}

          <ScoreRadial score={agent.performance_score} color={scoreColor(agent.performance_score)} />

          <p className="text-sm font-semibold text-txt-primary mt-2 truncate">{agent.name}</p>
          <p className="text-xs text-txt-muted">{agent.department ?? 'Unassigned'}</p>

          {agent.prompt_source === 'reflection' && (
            <span className="text-[10px] text-[#00E0FF]/70 mt-1 block">↑ self-improved v{agent.prompt_version}</span>
          )}
          {agent.prompt_source === 'shadow_promoted' && (
            <span className="text-[10px] text-[#6E77DF]/70 mt-1 block">⇑ promoted v{agent.prompt_version}</span>
          )}

          <p className="text-[10px] text-txt-faint mt-2">
            {agent.last_run_at ? `last run ${formatRelative(agent.last_run_at)}` : 'no runs'}
          </p>
        </div>
      ))}
    </div>
  );
}

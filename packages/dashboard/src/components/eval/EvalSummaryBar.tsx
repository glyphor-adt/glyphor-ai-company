import { useState, useEffect, useCallback } from 'react';
import { apiCall } from '../../lib/firebase';
import type { FleetAgent } from './EvalFleetGrid';
import { scoreLabel } from './EvalFleetGrid';

interface WorldStateSummary {
  total: number;
  fresh: number;
  stale: number;
  expired: number;
}

interface EvalSummaryBarProps {
  agents: FleetAgent[];
  activeFilter: string | null;
  onFilterChange: (filter: string | null) => void;
}

export default function EvalSummaryBar({ agents, activeFilter, onFilterChange }: EvalSummaryBarProps) {
  const [worldSummary, setWorldSummary] = useState<WorldStateSummary | null>(null);

  const fetchWorldSummary = useCallback(async () => {
    try {
      const data = await apiCall<{ summary: WorldStateSummary }>('/api/eval/world-state');
      setWorldSummary(data.summary);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchWorldSummary();
    const interval = setInterval(fetchWorldSummary, 300_000);
    return () => clearInterval(interval);
  }, [fetchWorldSummary]);

  const total = agents.length;
  const healthy = agents.filter(a => scoreLabel(a.performance_score) === 'healthy').length;
  const degraded = agents.filter(a => scoreLabel(a.performance_score) === 'degraded').length;
  const unhealthy = agents.filter(a => scoreLabel(a.performance_score) === 'unhealthy').length;
  const p0Count = agents.filter(a => a.open_p0s > 0).length;
  const selfImproved = agents.filter(a => a.reflection_mutations > 0 || a.promoted_mutations > 0).length;

  function chip(label: string, count: number, filterKey: string | null, color?: string) {
    const isActive = activeFilter === filterKey;
    return (
      <button
        key={label}
        onClick={() => onFilterChange(isActive ? null : filterKey)}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all
          ${isActive
            ? 'bg-raised text-txt-primary ring-1 ring-border'
            : 'bg-raised/40 text-txt-secondary hover:bg-raised hover:text-txt-primary'
          }`}
      >
        {color && <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />}
        {count} {label}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border glass-surface px-5 py-3">
      <span className="text-xs font-semibold text-txt-muted mr-2">{total} agents</span>
      {chip('healthy', healthy, 'healthy', '#00E0FF')}
      {chip('degraded', degraded, 'degraded', '#F59E0B')}
      {chip('unhealthy', unhealthy, 'unhealthy', '#EF4444')}
      <span className="mx-1 h-4 w-px bg-raised" />
      {chip('P0s open', p0Count, 'p0', '#EF4444')}
      {chip('self-improved', selfImproved, 'self-improved', '#00E0FF')}
      {worldSummary && (
        <>
          <span className="mx-1 h-4 w-px bg-raised" />
          <span className="text-[11px] text-txt-muted">
            world state: {worldSummary.stale > 0 && <span className="text-amber-400">{worldSummary.stale} stale </span>}
            {worldSummary.expired > 0 && <span className="text-red-400">{worldSummary.expired} expired</span>}
            {worldSummary.stale === 0 && worldSummary.expired === 0 && <span className="text-[#00E0FF]">all fresh</span>}
          </span>
        </>
      )}
    </div>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { apiCall } from '../../lib/firebase';

/* ── Types ─────────────────────────────────────────────────── */

interface WorldStateEntry {
  id: string;
  domain: string;
  key: string;
  entity_id: string | null;
  written_by_agent: string | null;
  confidence: number | null;
  updated_at: string;
  valid_until: string | null;
  age_hours: number;
  freshness: 'fresh' | 'stale' | 'expired';
}

interface WorldStateResponse {
  summary: { total: number; fresh: number; stale: number; expired: number };
  entries: WorldStateEntry[];
}

/* ── DomainRow ─────────────────────────────────────────────── */

function DomainRow({ domain, entries }: { domain: string; entries: WorldStateEntry[] }) {
  const fresh = entries.filter(e => e.freshness === 'fresh').length;
  const stale = entries.filter(e => e.freshness === 'stale').length;
  const expired = entries.filter(e => e.freshness === 'expired').length;
  const total = entries.length;
  const sorted = [...entries].sort((a, b) => b.age_hours - a.age_hours);
  const oldest = sorted[0];

  return (
    <div className="py-3 border-b border-border">
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm font-medium text-txt-primary capitalize">{domain}</span>
        <span className="text-xs text-txt-muted">{total} keys</span>
      </div>

      {/* Stacked progress bar */}
      <div className="h-1.5 rounded-full bg-raised/40 flex overflow-hidden">
        {fresh > 0 && <div style={{ width: `${(fresh / total) * 100}%` }} className="bg-[#00E0FF]" />}
        {stale > 0 && <div style={{ width: `${(stale / total) * 100}%` }} className="bg-amber-500" />}
        {expired > 0 && <div style={{ width: `${(expired / total) * 100}%` }} className="bg-red-500" />}
      </div>

      <div className="flex justify-between mt-1.5">
        <span className="text-[10px] text-txt-faint">
          oldest: {oldest ? `${Math.round(oldest.age_hours)}h ago by ${oldest.written_by_agent ?? 'unknown'}` : '—'}
        </span>
        {expired > 0 && (
          <span className="text-[10px] text-red-400 font-medium">{expired} expired</span>
        )}
      </div>
    </div>
  );
}

/* ── WorldStateFreshnessPanel ──────────────────────────────── */

export default function WorldStateFreshnessPanel() {
  const [data, setData] = useState<WorldStateResponse | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const result = await apiCall<WorldStateResponse>('/api/eval/world-state');
      setData(result);
      // Auto-collapse if everything is fresh
      if (result.summary.stale === 0 && result.summary.expired === 0) {
        setCollapsed(true);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 300_000); // 5 min
    return () => clearInterval(interval);
  }, [refresh]);

  if (!data) return null;

  const { summary } = data;

  // Group entries by domain
  const byDomain = data.entries.reduce<Record<string, WorldStateEntry[]>>((acc, e) => {
    (acc[e.domain] ??= []).push(e);
    return acc;
  }, {});

  return (
    <div className="rounded-xl glass-surface p-5">
      {/* Summary header */}
      <button
        className="flex w-full items-center justify-between"
        onClick={() => setCollapsed(!collapsed)}
      >
        <h3 className="text-sm font-semibold text-txt-secondary uppercase tracking-widest">World State</h3>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[#00E0FF]">{summary.fresh} fresh</span>
            {summary.stale > 0 && <span className="text-amber-400">{summary.stale} stale</span>}
            {summary.expired > 0 && <span className="text-red-400">{summary.expired} expired</span>}
          </div>
          <svg
            className={`h-4 w-4 text-txt-faint transition-transform ${collapsed ? '' : 'rotate-180'}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {!collapsed && (
        <div className="mt-4">
          {Object.entries(byDomain)
            .sort(([, a], [, b]) => {
              // Domains with expired entries first
              const aExp = a.filter(e => e.freshness === 'expired').length;
              const bExp = b.filter(e => e.freshness === 'expired').length;
              return bExp - aExp;
            })
            .map(([domain, entries]) => (
              <DomainRow key={domain} domain={domain} entries={entries} />
            ))}
        </div>
      )}
    </div>
  );
}

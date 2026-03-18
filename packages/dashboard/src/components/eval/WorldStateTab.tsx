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

interface WorldStateTabProps {
  agentId: string;
}

/* ── Component ─────────────────────────────────────────────── */

export default function WorldStateTab({ agentId }: WorldStateTabProps) {
  const [entries, setEntries] = useState<WorldStateEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiCall<{ entries: WorldStateEntry[] }>('/api/eval/world-state');
      // Filter to entries written by or relevant to this agent
      const relevant = (data.entries ?? []).filter(
        e => e.written_by_agent === agentId || e.domain === 'agent_output',
      );
      setEntries(relevant);
    } catch {
      setEntries([]);
    }
    setLoading(false);
  }, [agentId]);

  useEffect(() => { refresh(); }, [refresh]);

  if (loading) {
    return <div className="h-[200px] animate-pulse rounded-lg bg-white/5" />;
  }

  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-white/5 bg-white/5 p-4 text-xs text-white/40 text-center">
        No world state entries for this agent.
      </div>
    );
  }

  function freshnessBadge(freshness: string) {
    const styles: Record<string, string> = {
      fresh: 'bg-[#00E0FF]/15 text-[#00E0FF]',
      stale: 'bg-amber-500/15 text-amber-400',
      expired: 'bg-red-500/15 text-red-400',
    };
    return (
      <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${styles[freshness] ?? styles.fresh}`}>
        {freshness}
      </span>
    );
  }

  return (
    <div className="space-y-2">
      {entries.map(entry => (
        <div key={entry.id} className="rounded-lg border border-white/5 bg-white/5 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-white/70">{entry.key}</span>
                {freshnessBadge(entry.freshness)}
              </div>
              <span className="text-[10px] text-white/30 mt-0.5 block">
                {entry.domain}{entry.entity_id ? ` / ${entry.entity_id}` : ''}
              </span>
            </div>
            {entry.confidence !== null && (
              <span className="text-[10px] text-white/30 shrink-0">
                conf: {(entry.confidence * 100).toFixed(0)}%
              </span>
            )}
          </div>

          <p className="text-[10px] text-white/30 mt-2">
            Updated {Math.round(entry.age_hours)}h ago
            {entry.written_by_agent && ` by ${entry.written_by_agent}`}
            {entry.valid_until && ` · expires ${new Date(entry.valid_until).toLocaleDateString()}`}
          </p>
        </div>
      ))}
    </div>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { apiCall } from '../../lib/firebase';

/* ── Types ─────────────────────────────────────────────────── */

interface Finding {
  id: string;
  severity: 'P0' | 'P1' | 'P2';
  finding_type: string;
  description: string | null;
  detected_at: string;
  resolved_at: string | null;
  days_open: number;
}

interface FindingsTabProps {
  agentId: string;
}

/* ── Component ─────────────────────────────────────────────── */

export default function FindingsTab({ agentId }: FindingsTabProps) {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [showClosed, setShowClosed] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await apiCall<Finding[]>(
        `/api/eval/agent/${encodeURIComponent(agentId)}/findings`,
      );
      setFindings(rows ?? []);
    } catch {
      setFindings([]);
    }
    setLoading(false);
  }, [agentId]);

  useEffect(() => { refresh(); }, [refresh]);

  async function resolveF(findingId: string) {
    try {
      await apiCall(`/api/eval/findings/${findingId}/resolve`, { method: 'PATCH' });
      refresh();
    } catch { /* ignore */ }
  }

  if (loading) {
    return <div className="h-[200px] animate-pulse rounded-lg bg-white/5" />;
  }

  const open = findings.filter(f => !f.resolved_at);
  const closed = findings.filter(f => f.resolved_at);

  function severityBadge(severity: string) {
    const colors: Record<string, string> = {
      P0: 'bg-red-500/20 text-red-400',
      P1: 'bg-amber-500/20 text-amber-400',
      P2: 'bg-white/10 text-white/50',
    };
    return (
      <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${colors[severity] ?? colors.P2}`}>
        {severity}
      </span>
    );
  }

  function renderFinding(f: Finding, allowResolve: boolean) {
    return (
      <div key={f.id} className="rounded-lg border border-white/5 bg-white/5 p-3 mb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {severityBadge(f.severity)}
            <span className="text-xs text-white/70 font-medium truncate">{f.finding_type}</span>
          </div>
          {allowResolve && (
            <button
              onClick={() => resolveF(f.id)}
              className="text-[10px] text-[#00E0FF]/70 hover:text-[#00E0FF] transition-colors shrink-0"
            >
              Mark resolved
            </button>
          )}
        </div>
        {f.description && (
          <p className="text-xs text-white/50 mt-1.5 leading-relaxed">{f.description}</p>
        )}
        <div className="flex items-center gap-3 mt-2 text-[10px] text-white/30">
          <span>Detected {new Date(f.detected_at).toLocaleDateString()}</span>
          {!f.resolved_at && f.days_open > 0 && (
            <span className={f.days_open > 7 ? 'text-red-400' : ''}>
              {Math.round(f.days_open)}d open
            </span>
          )}
          {f.resolved_at && (
            <span className="text-[#00E0FF]/50">Resolved {new Date(f.resolved_at).toLocaleDateString()}</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Open findings */}
      {open.length === 0 ? (
        <div className="rounded-lg border border-white/5 bg-white/5 p-4 text-xs text-white/40 text-center">
          No open findings — all clear ✓
        </div>
      ) : (
        <div>
          <h4 className="text-xs font-semibold text-white/50 uppercase tracking-widest mb-3">
            Open ({open.length})
          </h4>
          {open.map(f => renderFinding(f, true))}
        </div>
      )}

      {/* Closed findings — collapsible */}
      {closed.length > 0 && (
        <div>
          <button
            className="flex items-center gap-2 text-xs text-white/30 hover:text-white/50 transition-colors"
            onClick={() => setShowClosed(!showClosed)}
          >
            <svg
              className={`h-3 w-3 transition-transform ${showClosed ? 'rotate-90' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            {closed.length} resolved finding{closed.length !== 1 ? 's' : ''}
          </button>
          {showClosed && (
            <div className="mt-2 opacity-60">
              {closed.map(f => renderFinding(f, false))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

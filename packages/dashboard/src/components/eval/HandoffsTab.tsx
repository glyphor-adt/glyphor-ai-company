import { useState, useEffect, useCallback } from 'react';
import { apiCall } from '../../lib/firebase';

/* ── Types ─────────────────────────────────────────────────── */

interface HandoffHealthRow {
  upstream_agent_id: string;
  downstream_agent_id: string;
  handoff_count: number;
  avg_upstream_quality: number | null;
  avg_usability: number | null;
  context_loss_count: number;
  context_loss_rate_pct: number;
}

interface HandoffData {
  as_upstream: HandoffHealthRow[];
  as_downstream: HandoffHealthRow[];
}

interface HandoffsTabProps {
  agentId: string;
}

/* ── Component ─────────────────────────────────────────────── */

export default function HandoffsTab({ agentId }: HandoffsTabProps) {
  const [data, setData] = useState<HandoffData | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiCall<HandoffData>(`/api/eval/agent/${encodeURIComponent(agentId)}/handoffs`);
      setData(result);
    } catch {
      setData(null);
    }
    setLoading(false);
  }, [agentId]);

  useEffect(() => { refresh(); }, [refresh]);

  if (loading) {
    return <div className="h-[200px] animate-pulse rounded-lg bg-raised/40" />;
  }

  if (!data || (data.as_upstream.length === 0 && data.as_downstream.length === 0)) {
    return (
      <div className="glass-surface rounded-lg border border-border p-4 text-xs text-txt-muted text-center">
        No handoff traces for this agent yet.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {data.as_upstream.length > 0 && (
        <HandoffSection
          title="As Upstream (output consumed by others)"
          rows={data.as_upstream}
          partnerKey="downstream_agent_id"
        />
      )}
      {data.as_downstream.length > 0 && (
        <HandoffSection
          title="As Downstream (consuming others' output)"
          rows={data.as_downstream}
          partnerKey="upstream_agent_id"
        />
      )}
    </div>
  );
}

/* ── Handoff Section ───────────────────────────────────────── */

function HandoffSection({
  title,
  rows,
  partnerKey,
}: {
  title: string;
  rows: HandoffHealthRow[];
  partnerKey: 'upstream_agent_id' | 'downstream_agent_id';
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-txt-faint uppercase tracking-widest mb-3">
        {title}
      </p>
      <div className="space-y-2">
        {rows.map((row, i) => {
          const partner = row[partnerKey];
          const isRedFlag = row.context_loss_rate_pct > 30;

          return (
            <div
              key={i}
              className={`rounded-lg border p-3 ${
                isRedFlag
                  ? 'border-red-500/20 bg-red-500/5'
                  : 'border-border bg-raised/40'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-txt-secondary">{partner}</span>
                  <span className="text-[10px] text-txt-faint">{row.handoff_count} handoffs</span>
                  {isRedFlag && (
                    <span className="text-[10px] text-red-400 border border-red-400/20 bg-red-400/10 px-1.5 py-0.5 rounded-full">
                      high context loss
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 mt-2">
                <div>
                  <p className="text-[10px] text-txt-faint">Avg usability</p>
                  <p className="text-sm font-mono" style={{ color: scoreColor(row.avg_usability) }}>
                    {row.avg_usability != null
                      ? `${Math.round(row.avg_usability * 100)}%`
                      : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-txt-faint">Context loss</p>
                  <p className={`text-sm font-mono ${isRedFlag ? 'text-red-400' : 'text-txt-secondary'}`}>
                    {row.context_loss_rate_pct}%
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-txt-faint">Upstream quality</p>
                  <p className="text-sm font-mono" style={{ color: scoreColor(row.avg_upstream_quality) }}>
                    {row.avg_upstream_quality != null
                      ? `${Math.round(row.avg_upstream_quality * 100)}%`
                      : '—'}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function scoreColor(value: number | null): string {
  if (value == null) return '#666';
  if (value >= 0.75) return '#00E0FF';
  if (value >= 0.50) return '#F59E0B';
  return '#EF4444';
}

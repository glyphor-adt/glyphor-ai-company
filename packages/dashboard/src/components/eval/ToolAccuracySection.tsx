import { useState, useEffect, useCallback } from 'react';
import { apiCall } from '../../lib/firebase';

/* ── Types ─────────────────────────────────────────────────── */

interface ToolAccuracyData {
  avg_score: number | null;
  eval_count: number;
  problem_tools: Array<{
    tool_name: string;
    repeated_failures: number;
    redundant_calls: number;
  }>;
  retrieval_breakdown: {
    pinned_pct: number | null;
    semantic_pct: number | null;
  } | null;
  risk_tools: Array<{
    tool_name: string;
    fleet_risk: string;
    agent_underperforming_vs_fleet: boolean;
    call_count: number;
    agent_success_rate: number;
    fleet_success_rate: number | null;
  }>;
}

interface ToolAccuracySectionProps {
  agentId: string;
}

/* ── Helpers ───────────────────────────────────────────────── */

function scoreColor(score: number | null): string {
  if (score === null) return '#ffffff40';
  if (score >= 0.75) return '#00E0FF';
  if (score >= 0.50) return '#FFB800';
  return '#FF4D4D';
}

/* ── Component ─────────────────────────────────────────────── */

export default function ToolAccuracySection({ agentId }: ToolAccuracySectionProps) {
  const [data, setData] = useState<ToolAccuracyData | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiCall<ToolAccuracyData>(
        `/api/eval/agent/${encodeURIComponent(agentId)}/tool-accuracy`,
      );
      setData(result);
    } catch {
      setData(null);
    }
    setLoading(false);
  }, [agentId]);

  useEffect(() => { refresh(); }, [refresh]);

  if (loading) {
    return <div className="mt-6 pt-6 border-t border-border h-[80px] animate-pulse rounded-lg bg-raised/40" />;
  }

  if (!data || data.eval_count === 0) return null;

  return (
    <div className="mt-6 pt-6 border-t border-border">
      <h4 className="text-xs font-semibold text-txt-muted uppercase tracking-widest mb-4">
        Tool Usage
      </h4>

      {/* Score + count */}
      <div className="flex items-center gap-3 mb-4">
        <div className="text-2xl font-bold" style={{ color: scoreColor(data.avg_score) }}>
          {data.avg_score != null ? Math.round(data.avg_score * 100) : '—'}
        </div>
        <div className="text-xs text-txt-muted">
          avg tool accuracy<br />last {data.eval_count} eval{data.eval_count !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Problem tools — most frequently flagged */}
      {data.problem_tools.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-txt-faint uppercase tracking-widest">Frequent issues</p>
          {data.problem_tools.map((tool) => (
            <div key={tool.tool_name} className="flex justify-between items-center bg-raised/40 rounded-lg px-3 py-2">
              <span className="text-xs text-txt-secondary font-mono">{tool.tool_name}</span>
              <div className="flex gap-2 text-[10px]">
                {tool.repeated_failures > 0 && (
                  <span className="text-red-400">{tool.repeated_failures}&times; failed</span>
                )}
                {tool.redundant_calls > 0 && (
                  <span className="text-amber-400">{tool.redundant_calls}&times; redundant</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Retrieval breakdown — how tools are being selected */}
      {data.retrieval_breakdown && (data.retrieval_breakdown.pinned_pct != null || data.retrieval_breakdown.semantic_pct != null) && (
        <div className="mt-4">
          <p className="text-[10px] text-txt-faint uppercase tracking-widest mb-2">
            How tools are selected
          </p>
          <div className="h-1.5 rounded-full bg-raised/40 flex overflow-hidden">
            <div
              style={{ width: `${data.retrieval_breakdown.pinned_pct ?? 0}%` }}
              className="bg-[#6E77DF]"
              title="Pinned"
            />
            <div
              style={{ width: `${data.retrieval_breakdown.semantic_pct ?? 0}%` }}
              className="bg-[#00E0FF]"
              title="Semantic"
            />
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[10px] text-[#6E77DF]">
              {data.retrieval_breakdown.pinned_pct ?? 0}% pinned
            </span>
            <span className="text-[10px] text-[#00E0FF]">
              {data.retrieval_breakdown.semantic_pct ?? 0}% semantic
            </span>
          </div>
        </div>
      )}

      {/* Risk tools — fleet vs agent cross-signal */}
      {data.risk_tools?.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] text-txt-faint uppercase tracking-widest mb-2">Tool Risk Signals</p>
          <div className="space-y-1.5">
            {data.risk_tools.map((tool) => (
              <div key={tool.tool_name} className="flex justify-between items-center bg-raised/40 rounded-lg px-3 py-2">
                <span className="text-xs text-txt-secondary font-mono truncate mr-2">{tool.tool_name}</span>
                <div className="flex gap-1.5 shrink-0">
                  {tool.agent_underperforming_vs_fleet && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-lg badge badge-red">
                      underperforming
                    </span>
                  )}
                  {tool.fleet_risk === 'high' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-lg badge badge-red">
                      fleet: high risk
                    </span>
                  )}
                  {tool.fleet_risk === 'medium' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-lg badge badge-amber">
                      fleet: medium
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

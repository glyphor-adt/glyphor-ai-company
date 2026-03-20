import { useState, useEffect, useCallback } from 'react';
import { apiCall } from '../../lib/firebase';

/* ── Types ─────────────────────────────────────────────────── */

type GateStatus = 'pass' | 'fail' | 'warn' | 'insufficient_data';

interface GateValue {
  status: GateStatus;
  value: number | null;
  threshold: number;
}

interface AgentGateResult {
  agent_id: string;
  agent_name: string;
  overall: 'pass' | 'fail' | 'insufficient_data';
  gates: Record<string, GateValue>;
  warnings: string[];
  eval_run_count: number;
  insufficient_data_reason: string | null;
  last_evaluated_at: string;
}

interface GtmReadinessReport {
  generated_at: string;
  overall: 'READY' | 'NOT_READY' | 'INSUFFICIENT_DATA';
  marketing_department_ready: boolean;
  agents: AgentGateResult[];
  summary: {
    total_required: number;
    passing: number;
    failing: number;
    insufficient_data: number;
    blocking_issues: string[];
  };
}

interface GtmHistoryRow {
  id: string;
  generated_at: string;
  overall: string;
  marketing_department_ready: boolean;
  passing_count: number;
  failing_count: number;
  insufficient_data_count: number;
}

/* ── Component ─────────────────────────────────────────────── */

export default function GtmReadinessPanel() {
  const [report, setReport] = useState<GtmReadinessReport | null>(null);
  const [history, setHistory] = useState<GtmHistoryRow[]>([]);
  const [running, setRunning] = useState(false);

  const fetchLatest = useCallback(async () => {
    try {
      const data = await apiCall<GtmReadinessReport>('/api/eval/gtm-readiness/latest');
      setReport(data);
    } catch {
      setReport(null);
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const rows = await apiCall<GtmHistoryRow[]>('/api/eval/gtm-readiness/history');
      setHistory(rows ?? []);
    } catch {
      setHistory([]);
    }
  }, []);

  useEffect(() => {
    fetchLatest();
    fetchHistory();
  }, [fetchLatest, fetchHistory]);

  const handleRunNow = useCallback(async () => {
    setRunning(true);
    try {
      await apiCall('/gtm-readiness/run', { method: 'POST' });
      await fetchLatest();
      await fetchHistory();
    } catch {
      // silent — report fetch will show current state
    }
    setRunning(false);
  }, [fetchLatest, fetchHistory]);

  if (!report) {
    return (
      <div className="rounded-xl border border-border glass-surface p-6 animate-pulse">
        <div className="h-4 w-48 bg-raised/40 rounded mb-3" />
        <div className="h-8 w-32 bg-raised/40 rounded" />
      </div>
    );
  }

  const statusColor: Record<string, string> = {
    READY: '#00E0FF',
    NOT_READY: '#EF4444',
    INSUFFICIENT_DATA: '#F59E0B',
  };

  const color = statusColor[report.overall] ?? '#F59E0B';

  return (
    <div className="rounded-xl border border-border glass-surface overflow-hidden">
      {/* Header bar */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b border-border"
        style={{ borderLeft: `3px solid ${color}` }}
      >
        <div>
          <p className="text-[10px] font-semibold text-txt-faint uppercase tracking-widest">
            GTM Readiness — Marketing Department
          </p>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-2xl font-bold" style={{ color }}>
              {report.overall.replace(/_/g, ' ')}
            </span>
            {report.overall === 'READY' && (
              <span className="text-xs bg-[#00E0FF]/10 text-[#00E0FF] border border-[#00E0FF]/20 px-2 py-0.5 rounded-full">
                Ready to ship
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-6 text-center">
          <div>
            <p className="text-xl font-bold text-[#00E0FF]">{report.summary.passing}</p>
            <p className="text-[10px] text-txt-faint">passing</p>
          </div>
          <div>
            <p className="text-xl font-bold text-red-400">{report.summary.failing}</p>
            <p className="text-[10px] text-txt-faint">failing</p>
          </div>
          <div>
            <p className="text-xl font-bold text-amber-400">{report.summary.insufficient_data}</p>
            <p className="text-[10px] text-txt-faint">no data</p>
          </div>
          <button
            onClick={handleRunNow}
            disabled={running}
            className="text-xs text-txt-faint hover:text-txt-secondary border border-border
                       hover:border-txt-muted px-3 py-1.5 rounded-lg transition-colors
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {running ? 'Running…' : 'Run now'}
          </button>
        </div>
      </div>

      {/* Blocking issues — shown prominently when failing */}
      {report.summary.blocking_issues.length > 0 && (
        <div className="px-6 py-4 bg-red-500/5 border-b border-red-500/10">
          <p className="text-[10px] font-semibold text-red-400 uppercase tracking-widest mb-2">
            Blocking Issues
          </p>
          {report.summary.blocking_issues.map((issue, i) => (
            <p key={i} className="text-xs text-red-300/80 font-mono mb-1">{issue}</p>
          ))}
        </div>
      )}

      {/* Agent gate grid */}
      <div className="p-6 grid grid-cols-1 gap-3">
        {report.agents.map(agent => (
          <AgentGateRow key={agent.agent_id} agent={agent} />
        ))}
      </div>

      {/* History sparkline */}
      {history.length > 1 && (
        <div className="px-6 pb-4">
          <p className="text-[10px] text-txt-faint uppercase tracking-widest mb-2">
            Readiness history (30 days)
          </p>
          <GtmHistorySparkline history={history} />
        </div>
      )}
    </div>
  );
}

/* ── Agent Gate Row ─────────────────────────────────────────── */

const gateStatusColor: Record<GateStatus, string> = {
  pass: '#00E0FF',
  fail: '#EF4444',
  insufficient_data: '#F59E0B',
  warn: '#F59E0B',
};

const gateStatusIcon: Record<string, string> = {
  pass: '●',
  fail: '✕',
  insufficient_data: '○',
};

function AgentGateRow({ agent }: { agent: AgentGateResult }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3
                   hover:bg-raised/40 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <span style={{ color: gateStatusColor[agent.overall] }}>
            {gateStatusIcon[agent.overall] ?? '○'}
          </span>
          <span className="text-sm font-medium text-txt-primary">{agent.agent_name}</span>
          {agent.warnings.length > 0 && (
            <span className="text-[10px] text-amber-400 border border-amber-400/20
                             bg-amber-400/10 px-1.5 py-0.5 rounded-full">
              {agent.warnings.length} warning{agent.warnings.length > 1 ? 's' : ''}
            </span>
          )}
          {agent.overall === 'insufficient_data' && (
            <span className="text-[10px] text-txt-faint">{agent.insufficient_data_reason}</span>
          )}
        </div>
        <div className="flex items-center gap-4">
          {/* Gate pills — compact summary */}
          {Object.entries(agent.gates).map(([name, g]) => (
            <span
              key={name}
              className="w-2 h-2 rounded-full"
              style={{ background: gateStatusColor[g.status] }}
              title={`${name}: ${g.value ?? 'no data'}`}
            />
          ))}
          <span className="text-txt-faint text-xs">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {/* Expanded gate detail */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-border">
          <div className="grid grid-cols-3 gap-2 mt-3">
            {Object.entries(agent.gates).map(([name, g]) => (
              <div key={name} className="bg-raised/40 rounded-lg p-2.5">
                <p className="text-[10px] text-txt-faint mb-1">
                  {name.replace(/_/g, ' ')}
                </p>
                <p
                  className="text-sm font-mono"
                  style={{ color: gateStatusColor[g.status] }}
                >
                  {g.value != null
                    ? (g.value <= 1 && g.value >= 0 && name !== 'open_p0s' && name !== 'consecutive_aborts'
                        ? `${Math.round(g.value * 100)}`
                        : g.value)
                    : '—'
                  }
                </p>
                <p className="text-[10px] text-txt-faint">
                  min {g.threshold <= 1 && g.threshold > 0
                    ? `${Math.round(g.threshold * 100)}`
                    : g.threshold}
                </p>
              </div>
            ))}
          </div>

          {agent.warnings.length > 0 && (
            <div className="mt-3 space-y-1">
              {agent.warnings.map((w, i) => (
                <p key={i} className="text-[11px] text-amber-400/70">⚠ {w}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── History Sparkline ──────────────────────────────────────── */

function GtmHistorySparkline({ history }: { history: GtmHistoryRow[] }) {
  const items = [...history].reverse();

  const dotColor = (overall: string) => {
    if (overall === 'READY') return '#00E0FF';
    if (overall === 'NOT_READY') return '#EF4444';
    return '#F59E0B';
  };

  return (
    <div className="flex items-center gap-1">
      {items.map((row) => (
        <div
          key={row.id}
          className="w-3 h-3 rounded-full"
          style={{ background: dotColor(row.overall) }}
          title={`${new Date(row.generated_at).toLocaleDateString()} — ${row.overall}`}
        />
      ))}
    </div>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { apiCall } from '../../lib/firebase';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

/* ── Types ─────────────────────────────────────────────────── */

interface CostLatencyRow {
  agent_id: string;
  avg_tokens: number | string | null;
  p95_latency_ms: number | string | null;
  avg_latency_ms: number | string | null;
  avg_cost_usd: number | string | null;
  run_count: number | string;
}

/* ── Component ─────────────────────────────────────────────── */

export default function CostLatencyPanel() {
  const [data, setData] = useState<CostLatencyRow[] | null | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      const rows = await apiCall<CostLatencyRow[] | null>('/api/eval/cost-latency');
      setData(rows);
    } catch {
      setData(null);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 60_000);
    return () => clearInterval(interval);
  }, [refresh]);

  // Loading
  if (data === undefined) {
    return <div className="h-[200px] animate-pulse rounded-xl glass-surface" />;
  }

  // Not instrumented
  if (data === null) {
    return (
      <div className="rounded-xl border border-border glass-surface p-6">
        <h3 className="text-sm font-semibold text-txt-secondary uppercase tracking-widest mb-2">
          Cost &amp; Latency Tracking
        </h3>
        <p className="text-sm text-txt-muted leading-relaxed">
          No qualifying runs in the last 30 days: the API needs <code className="text-[#00E0FF]/70">input_tokens</code>{' '}
          (plus output/thinking), <code className="text-[#00E0FF]/70">duration_ms</code>, and{' '}
          <code className="text-[#00E0FF]/70">estimated_cost_usd</code> populated on{' '}
          <code className="text-[#00E0FF]/70">agent_runs</code>. If the Fleet API was misrouted, fix prod dashboard → scheduler routing for{' '}
          <code className="text-[#00E0FF]/70">/api/eval/*</code> first.
        </p>
      </div>
    );
  }

  function asFiniteNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  function asRunCount(value: number | string | null | undefined): number {
    const parsed = asFiniteNumber(value);
    return parsed === null ? 0 : Math.max(0, parsed);
  }

  const maxRunCount = Math.max(...data.map(r => asRunCount(r.run_count)), 1);

  function barColor(cost: number | null): string {
    if (cost === null) return '#64748B';
    if (cost > 1.0) return '#EF4444';
    if (cost > 0.5) return '#F59E0B';
    return '#00A3FF';
  }

  function barOpacity(runCount: number): number {
    return 0.4 + 0.6 * (runCount / maxRunCount);
  }

  return (
    <div className="rounded-xl border border-border glass-surface p-5">
      <h3 className="text-sm font-semibold text-txt-secondary uppercase tracking-widest mb-4">
        Cost &amp; Latency (30d)
      </h3>
      <ResponsiveContainer width="100%" height={Math.max(data.length * 32, 120)}>
        <BarChart data={data} layout="vertical" margin={{ left: 100, right: 20, top: 0, bottom: 0 }}>
          <XAxis type="number" tickFormatter={v => {
            const value = typeof v === 'number' && Number.isFinite(v) ? v : 0;
            return `$${value.toFixed(3)}`;
          }}
                 tick={{ fill: 'var(--color-txt-muted)', fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="agent_id" width={90}
                 tick={{ fill: 'var(--color-txt-secondary)', fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8 }}
            labelStyle={{ color: 'var(--color-txt-primary)' }}
            formatter={(rawValue: number, name: string) => {
              const value = asFiniteNumber(rawValue);
              if (name === 'avg_cost_usd') return [value === null ? '—' : `$${value.toFixed(4)}`, 'Avg Cost'];
              if (name === 'p95_latency_ms') return [value === null ? '—' : `${Math.round(value)}ms`, 'p95 Latency'];
              return [value, name];
            }}
          />
          <Bar dataKey="avg_cost_usd" radius={[0, 4, 4, 0]}>
            {data.map((entry, i) => (
              <Cell
                key={i}
                fill={barColor(asFiniteNumber(entry.avg_cost_usd))}
                fillOpacity={barOpacity(asRunCount(entry.run_count))}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Table with p95 latency */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-txt-faint border-b border-border">
              <th className="text-left py-1.5 font-medium">Agent</th>
              <th className="text-right py-1.5 font-medium">Avg Cost</th>
              <th className="text-right py-1.5 font-medium">p95 Latency</th>
              <th className="text-right py-1.5 font-medium">Avg Tokens</th>
              <th className="text-right py-1.5 font-medium">Runs</th>
            </tr>
          </thead>
          <tbody>
            {data.map(row => {
              const avgCost = asFiniteNumber(row.avg_cost_usd);
              const p95Latency = asFiniteNumber(row.p95_latency_ms);
              const avgTokens = asFiniteNumber(row.avg_tokens);
              const runCount = asRunCount(row.run_count);

              return (
                <tr key={row.agent_id} className="border-b border-border">
                  <td className="py-1.5 text-txt-secondary">{row.agent_id}</td>
                  <td className={`py-1.5 text-right ${
                    avgCost !== null && avgCost > 1
                      ? 'text-red-400'
                      : avgCost !== null && avgCost > 0.5
                        ? 'text-amber-400'
                        : 'text-txt-secondary'
                  }`}>
                    {avgCost === null ? '—' : `$${avgCost.toFixed(4)}`}
                  </td>
                  <td className="py-1.5 text-right text-txt-secondary">{p95Latency === null ? '—' : `${Math.round(p95Latency)}ms`}</td>
                  <td className="py-1.5 text-right text-txt-secondary">{avgTokens === null ? '—' : Math.round(avgTokens).toLocaleString()}</td>
                  <td className="py-1.5 text-right text-txt-muted">{runCount}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

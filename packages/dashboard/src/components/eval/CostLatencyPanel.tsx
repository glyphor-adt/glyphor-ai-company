import { useState, useEffect, useCallback } from 'react';
import { apiCall } from '../../lib/firebase';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

/* ── Types ─────────────────────────────────────────────────── */

interface CostLatencyRow {
  agent_id: string;
  avg_tokens: number;
  p95_latency_ms: number;
  avg_latency_ms: number;
  avg_cost_usd: number;
  run_count: number;
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
    return <div className="h-[200px] animate-pulse rounded-xl bg-[#131620]" />;
  }

  // Not instrumented
  if (data === null) {
    return (
      <div className="rounded-xl border border-white/5 bg-[#131620] p-6">
        <h3 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-2">
          Cost &amp; Latency Tracking
        </h3>
        <p className="text-sm text-white/40 leading-relaxed">
          Not yet instrumented. Add <code className="text-[#00E0FF]/70">total_tokens</code>,{' '}
          <code className="text-[#00E0FF]/70">duration_ms</code>, and{' '}
          <code className="text-[#00E0FF]/70">estimated_cost_usd</code> to{' '}
          <code className="text-[#00E0FF]/70">agent_runs</code> to enable this panel.
        </p>
      </div>
    );
  }

  const maxRunCount = Math.max(...data.map(r => r.run_count), 1);

  function barColor(cost: number): string {
    if (cost > 1.0) return '#EF4444';
    if (cost > 0.5) return '#F59E0B';
    return '#00A3FF';
  }

  function barOpacity(runCount: number): number {
    return 0.4 + 0.6 * (runCount / maxRunCount);
  }

  return (
    <div className="rounded-xl border border-white/5 bg-[#131620] p-5">
      <h3 className="text-sm font-semibold text-white/60 uppercase tracking-widest mb-4">
        Cost &amp; Latency (30d)
      </h3>
      <ResponsiveContainer width="100%" height={Math.max(data.length * 32, 120)}>
        <BarChart data={data} layout="vertical" margin={{ left: 100, right: 20, top: 0, bottom: 0 }}>
          <XAxis type="number" tickFormatter={v => `$${Number(v).toFixed(3)}`}
                 tick={{ fill: '#ffffff60', fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="agent_id" width={90}
                 tick={{ fill: '#ffffff80', fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ background: '#131620', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
            labelStyle={{ color: '#ffffffcc' }}
            formatter={(value: number, name: string) => {
              if (name === 'avg_cost_usd') return [`$${value.toFixed(4)}`, 'Avg Cost'];
              if (name === 'p95_latency_ms') return [`${Math.round(value)}ms`, 'p95 Latency'];
              return [value, name];
            }}
          />
          <Bar dataKey="avg_cost_usd" radius={[0, 4, 4, 0]}>
            {data.map((entry, i) => (
              <Cell
                key={i}
                fill={barColor(entry.avg_cost_usd)}
                fillOpacity={barOpacity(entry.run_count)}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Table with p95 latency */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-white/30 border-b border-white/5">
              <th className="text-left py-1.5 font-medium">Agent</th>
              <th className="text-right py-1.5 font-medium">Avg Cost</th>
              <th className="text-right py-1.5 font-medium">p95 Latency</th>
              <th className="text-right py-1.5 font-medium">Avg Tokens</th>
              <th className="text-right py-1.5 font-medium">Runs</th>
            </tr>
          </thead>
          <tbody>
            {data.map(row => (
              <tr key={row.agent_id} className="border-b border-white/5">
                <td className="py-1.5 text-white/70">{row.agent_id}</td>
                <td className={`py-1.5 text-right ${row.avg_cost_usd > 1 ? 'text-red-400' : row.avg_cost_usd > 0.5 ? 'text-amber-400' : 'text-white/60'}`}>
                  ${row.avg_cost_usd.toFixed(4)}
                </td>
                <td className="py-1.5 text-right text-white/60">{Math.round(row.p95_latency_ms)}ms</td>
                <td className="py-1.5 text-right text-white/60">{Math.round(row.avg_tokens).toLocaleString()}</td>
                <td className="py-1.5 text-right text-white/40">{row.run_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

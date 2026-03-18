import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

/* ── Types ─────────────────────────────────────────────────── */

interface ScoreRun {
  run_index: number;
  exec_quality: number | null;
  team_quality: number | null;
  cos_quality: number | null;
  constitutional_score: number | null;
  success_rate: number | null;
  composite: number | null;
  reflection_triggered?: boolean;
}

interface ScoreBreakdownPanelProps {
  runs: ScoreRun[];
}

/* ── Constants ─────────────────────────────────────────────── */

const COMPONENTS = [
  { key: 'exec_quality', label: 'Exec Quality', color: '#00E0FF' },
  { key: 'success_rate', label: 'Success Rate', color: '#00A3FF' },
  { key: 'constitutional_score', label: 'Constitutional', color: '#6E77DF' },
  { key: 'cos_quality', label: 'CoS Quality', color: '#1171ED' },
] as const;

/* ── Component ─────────────────────────────────────────────── */

export default function ScoreBreakdownPanel({ runs }: ScoreBreakdownPanelProps) {
  if (runs.length === 0) {
    return (
      <div className="rounded-lg border border-white/5 bg-white/5 p-4 text-xs text-white/40">
        No recent evaluation data available.
      </div>
    );
  }

  return (
    <div>
      <h4 className="text-xs font-semibold text-white/50 uppercase tracking-widest mb-3">
        Score Components (Last {runs.length} Runs)
      </h4>

      {/* Stacked bar chart */}
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={runs} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <XAxis dataKey="run_index" tick={{ fill: '#ffffff40', fontSize: 10 }}
                 axisLine={false} tickLine={false} />
          <YAxis domain={[0, 1]} tick={{ fill: '#ffffff40', fontSize: 10 }}
                 axisLine={false} tickLine={false} tickFormatter={v => `${Math.round(v * 100)}%`} />
          <Tooltip
            contentStyle={{ background: '#131620', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
            labelStyle={{ color: '#ffffffcc' }}
            formatter={(value: number, name: string) => [
              `${(value * 100).toFixed(1)}%`,
              COMPONENTS.find(c => c.key === name)?.label ?? name,
            ]}
          />
          <Legend
            iconType="circle" iconSize={8}
            formatter={(value: string) => (
              <span className="text-[10px] text-white/60">
                {COMPONENTS.find(c => c.key === value)?.label ?? value}
              </span>
            )}
          />
          {COMPONENTS.map(c => (
            <Bar key={c.key} dataKey={c.key} stackId="score" fill={c.color} radius={[0, 0, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>

      {/* Numeric table */}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-white/30 border-b border-white/5">
              <th className="text-left py-1 font-medium">Run</th>
              {COMPONENTS.map(c => (
                <th key={c.key} className="text-right py-1 font-medium" style={{ color: c.color + '99' }}>
                  {c.label}
                </th>
              ))}
              <th className="text-right py-1 font-medium text-white/50">Composite</th>
              <th className="text-center py-1 font-medium text-white/30">⟳</th>
            </tr>
          </thead>
          <tbody>
            {runs.map(run => (
              <tr key={run.run_index} className="border-b border-white/5">
                <td className="py-1 text-white/50">#{run.run_index}</td>
                {COMPONENTS.map(c => (
                  <td key={c.key} className="py-1 text-right text-white/60">
                    {run[c.key] !== null && run[c.key] !== undefined
                      ? `${(run[c.key]! * 100).toFixed(0)}%`
                      : '—'}
                  </td>
                ))}
                <td className="py-1 text-right text-white/80 font-medium">
                  {run.composite !== null ? `${(run.composite * 100).toFixed(0)}%` : '—'}
                </td>
                <td className="py-1 text-center">
                  {run.reflection_triggered && (
                    <span className="text-[#00E0FF]" title="Reflection mutation triggered">↑</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

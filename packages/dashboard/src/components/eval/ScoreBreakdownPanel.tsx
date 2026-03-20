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
      <div className="rounded-lg border border-border bg-raised/40 p-4 text-xs text-txt-muted">
        No recent evaluation data available.
      </div>
    );
  }

  return (
    <div>
      <h4 className="text-xs font-semibold text-txt-muted uppercase tracking-widest mb-3">
        Score Components (Last {runs.length} Runs)
      </h4>

      {/* Stacked bar chart */}
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={runs} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <XAxis dataKey="run_index" tick={{ fill: 'var(--color-txt-muted)', fontSize: 10 }}
                 axisLine={false} tickLine={false} />
          <YAxis domain={[0, 1]} tick={{ fill: 'var(--color-txt-muted)', fontSize: 10 }}
                 axisLine={false} tickLine={false} tickFormatter={v => `${Math.round(v * 100)}%`} />
          <Tooltip
            contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8 }}
            labelStyle={{ color: 'var(--color-txt-primary)' }}
            formatter={(value: number, name: string) => [
              `${(value * 100).toFixed(1)}%`,
              COMPONENTS.find(c => c.key === name)?.label ?? name,
            ]}
          />
          <Legend
            iconType="circle" iconSize={8}
            formatter={(value: string) => (
              <span className="text-[10px] text-txt-secondary">
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
            <tr className="text-txt-faint border-b border-border">
              <th className="text-left py-1 font-medium">Run</th>
              {COMPONENTS.map(c => (
                <th key={c.key} className="text-right py-1 font-medium" style={{ color: c.color + '99' }}>
                  {c.label}
                </th>
              ))}
              <th className="text-right py-1 font-medium text-txt-muted">Composite</th>
              <th className="text-center py-1 font-medium text-txt-faint">⟳</th>
            </tr>
          </thead>
          <tbody>
            {runs.map(run => (
              <tr key={run.run_index} className="border-b border-border">
                <td className="py-1 text-txt-muted">#{run.run_index}</td>
                {COMPONENTS.map(c => (
                  <td key={c.key} className="py-1 text-right text-txt-secondary">
                    {run[c.key] !== null && run[c.key] !== undefined
                      ? `${(run[c.key]! * 100).toFixed(0)}%`
                      : '—'}
                  </td>
                ))}
                <td className="py-1 text-right text-txt-primary font-medium">
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

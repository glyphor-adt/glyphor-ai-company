import { useState, useEffect, useCallback } from 'react';
import { apiCall } from '../../lib/firebase';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import ScoreBreakdownPanel from './ScoreBreakdownPanel';
import ToolAccuracySection from './ToolAccuracySection';

/* ── Types ─────────────────────────────────────────────────── */

interface TrendPoint {
  day: string;
  avg_quality: number | null;
  success_rate: number | null;
  run_count: number;
}

interface PromptVersion {
  version: number;
  deployed_at: string;
  source: string;
  change_summary: string | null;
  performance_score_at_deploy: number | null;
}

interface PerformanceTabProps {
  agentId: string;
}

/* ── Component ─────────────────────────────────────────────── */

export default function PerformanceTab({ agentId }: PerformanceTabProps) {
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiCall<{ trend: TrendPoint[]; promptVersions: PromptVersion[] }>(
        `/api/eval/agent/${encodeURIComponent(agentId)}/trend?days=30`,
      );
      setTrend(data.trend ?? []);
      setVersions(data.promptVersions ?? []);
    } catch {
      setTrend([]);
      setVersions([]);
    }
    setLoading(false);
  }, [agentId]);

  useEffect(() => { refresh(); }, [refresh]);

  if (loading) {
    return <div className="h-[200px] animate-pulse rounded-lg bg-white/5" />;
  }

  // Compute week-over-week delta
  const now = Date.now();
  const thisWeek = trend.filter(t => now - new Date(t.day).getTime() < 7 * 86400000);
  const lastWeek = trend.filter(t => {
    const age = now - new Date(t.day).getTime();
    return age >= 7 * 86400000 && age < 14 * 86400000;
  });
  const avgThis = thisWeek.length > 0
    ? thisWeek.reduce((s, t) => s + (t.avg_quality ?? 0), 0) / thisWeek.length
    : null;
  const avgLast = lastWeek.length > 0
    ? lastWeek.reduce((s, t) => s + (t.avg_quality ?? 0), 0) / lastWeek.length
    : null;
  const delta = avgThis !== null && avgLast !== null ? avgThis - avgLast : null;

  // Build score breakdown mock from trend (use last 10 entries as proxy)
  const breakdownRuns = trend.slice(-10).map((t, i) => ({
    run_index: i + 1,
    exec_quality: t.avg_quality,
    team_quality: null,
    cos_quality: null,
    constitutional_score: null,
    success_rate: t.success_rate,
    composite: t.avg_quality,
    reflection_triggered: false,
  }));

  return (
    <div className="space-y-6">
      {/* Week-over-week summary */}
      <div className="flex items-center gap-4">
        {avgThis !== null && (
          <div>
            <span className="text-[10px] text-white/30 uppercase">This week</span>
            <p className="text-lg font-semibold text-white">{(avgThis * 100).toFixed(0)}%</p>
          </div>
        )}
        {delta !== null && (
          <div>
            <span className="text-[10px] text-white/30 uppercase">vs last week</span>
            <p className={`text-lg font-semibold ${delta >= 0 ? 'text-[#00E0FF]' : 'text-red-400'}`}>
              {delta >= 0 ? '↑' : '↓'} {Math.abs(delta * 100).toFixed(1)}%
            </p>
          </div>
        )}
      </div>

      {/* Trend line chart */}
      {trend.length > 0 && (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={trend} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
            <XAxis dataKey="day" tick={{ fill: '#ffffff40', fontSize: 10 }}
                   tickFormatter={v => new Date(v).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
                   axisLine={false} tickLine={false} />
            <YAxis domain={[0, 1]} tick={{ fill: '#ffffff40', fontSize: 10 }}
                   tickFormatter={v => `${Math.round(v * 100)}%`} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ background: '#131620', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
              labelStyle={{ color: '#ffffffcc' }}
              labelFormatter={v => new Date(v).toLocaleDateString()}
              formatter={(value: number, name: string) => [
                `${(value * 100).toFixed(1)}%`,
                name === 'avg_quality' ? 'Quality' : 'Success Rate',
              ]}
            />
            <Line type="monotone" dataKey="avg_quality" stroke="#00E0FF" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="success_rate" stroke="#00A3FF" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />

            {/* Prompt version deployment markers */}
            {versions
              .filter(v => v.deployed_at)
              .map(v => (
                <ReferenceLine
                  key={v.version}
                  x={new Date(v.deployed_at).toISOString().split('T')[0] + 'T00:00:00.000Z'}
                  stroke="#6E77DF"
                  strokeDasharray="3 3"
                  strokeWidth={1}
                  label={{
                    value: `v${v.version}`,
                    position: 'top',
                    fill: '#6E77DF',
                    fontSize: 9,
                  }}
                />
              ))}
          </LineChart>
        </ResponsiveContainer>
      )}

      {/* Score breakdown */}
      <ScoreBreakdownPanel runs={breakdownRuns} />

      {/* Tool accuracy */}
      <ToolAccuracySection agentId={agentId} />
    </div>
  );
}

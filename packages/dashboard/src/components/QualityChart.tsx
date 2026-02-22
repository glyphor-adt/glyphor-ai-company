import { Sparkline } from './ui';

interface PerformanceDay {
  date: string;
  avg_quality_score: number | null;
  total_runs: number;
  successful_runs: number;
  failed_runs: number;
  total_cost: number;
}

export function QualityChart({ data }: { data: PerformanceDay[] }) {
  if (!data.length) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-txt-faint">
        No performance data yet
      </div>
    );
  }

  const scores = data
    .filter((d) => d.avg_quality_score != null)
    .map((d) => d.avg_quality_score!);

  if (!scores.length) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-txt-faint">
        No quality scores recorded yet
      </div>
    );
  }

  const current = scores[scores.length - 1];
  const first = scores[0];
  const delta = current - first;
  const best = Math.max(...scores);
  const worst = Math.min(...scores);
  const bestIdx = scores.indexOf(best);
  const worstIdx = scores.indexOf(worst);
  const bestDate = data.filter((d) => d.avg_quality_score != null)[bestIdx]?.date;
  const worstDate = data.filter((d) => d.avg_quality_score != null)[worstIdx]?.date;

  const trend = delta > 2 ? '↑ Improving' : delta < -2 ? '↓ Declining' : '→ Stable';
  const trendColor = delta > 2 ? 'text-tier-green' : delta < -2 ? 'text-tier-red' : 'text-txt-muted';

  return (
    <div className="space-y-4">
      {/* Chart */}
      <div className="flex items-end gap-4">
        <Sparkline data={scores} width={320} height={64} color="#00E0FF" />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Current</p>
          <p className="mt-0.5 text-lg font-bold text-txt-primary">
            {Math.round(current)}
            <span className="ml-1 text-sm font-normal text-txt-muted">
              ({delta >= 0 ? '+' : ''}{Math.round(delta)} from start)
            </span>
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Trend</p>
          <p className={`mt-0.5 text-lg font-bold ${trendColor}`}>{trend}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-txt-faint">Range</p>
          <p className="mt-0.5 text-sm text-txt-secondary">
            Best: {Math.round(best)} {bestDate && <span className="text-txt-faint">({formatShortDate(bestDate)})</span>}
            <br />
            Worst: {Math.round(worst)} {worstDate && <span className="text-txt-faint">({formatShortDate(worstDate)})</span>}
          </p>
        </div>
      </div>
    </div>
  );
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

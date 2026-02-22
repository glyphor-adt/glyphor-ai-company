interface GrowthArea {
  dimension: string;
  direction: string;
  current_value: number;
  previous_value: number;
  period: string;
  evidence: string | null;
}

const DIMENSION_LABELS: Record<string, string> = {
  quality_score: 'Quality Score',
  success_rate: 'Success Rate',
  cost_efficiency: 'Cost Efficiency',
  response_time: 'Response Time',
  incident_response_time: 'Incident Response',
  cost_awareness: 'Cost Awareness',
  deployment_success: 'Deploy Success Rate',
  build_time: 'Build Time',
};

const DIRECTION_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
  improving: { icon: '✓', color: 'text-tier-green', label: 'Improving' },
  stable: { icon: '→', color: 'text-txt-muted', label: 'Stable' },
  declining: { icon: '⚠', color: 'text-tier-yellow', label: 'Needs attention' },
};

export function GrowthAreas({ data }: { data: GrowthArea[] }) {
  if (!data.length) {
    return (
      <div className="flex h-24 items-center justify-center text-sm text-txt-faint">
        No growth data yet — check back after one week of activity
      </div>
    );
  }

  // Sort: improving first, then stable, then declining
  const sorted = [...data].sort((a, b) => {
    const order = { improving: 0, stable: 1, declining: 2 };
    return (order[a.direction as keyof typeof order] ?? 1) - (order[b.direction as keyof typeof order] ?? 1);
  });

  return (
    <ul className="space-y-3">
      {sorted.map((g) => {
        const config = DIRECTION_CONFIG[g.direction] ?? DIRECTION_CONFIG.stable;
        const label = DIMENSION_LABELS[g.dimension] ?? g.dimension.replace(/_/g, ' ');
        return (
          <li key={g.dimension} className="flex items-start gap-3">
            <span className={`mt-0.5 text-sm font-bold ${config.color}`}>{config.icon}</span>
            <div className="flex-1">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium text-txt-primary capitalize">{label}</span>
                <span className={`text-[11px] font-medium ${config.color}`}>{config.label}</span>
              </div>
              {g.evidence && (
                <p className="mt-0.5 font-mono text-[11px] text-txt-faint">{g.evidence}</p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

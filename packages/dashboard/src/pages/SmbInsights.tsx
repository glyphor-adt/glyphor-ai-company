import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { accountIsOlderThanThirtyDays, formatRelativeTime, useSmbSummary } from '../lib/smb';
import { Card, SectionHeader } from '../components/ui';

export default function SmbInsights() {
  const { data, loading } = useSmbSummary();
  const showChart = accountIsOlderThanThirtyDays(data.organization?.created_at);

  return (
    <div className="space-y-6">
      <SectionHeader title="Insights" subtitle="A simple readout of what has been delivered recently." />

      <div className="grid gap-4 md:grid-cols-3">
        {data.metrics.map((metric) => (
          <Card key={metric.label}>
            <p className="text-xs uppercase tracking-[0.18em] text-txt-faint">{metric.label}</p>
            <p className="mt-3 text-3xl font-semibold text-txt-primary">{loading ? '...' : metric.value}</p>
            <p className="mt-2 text-sm text-txt-secondary">{metric.detail}</p>
          </Card>
        ))}
      </div>

      <Card>
        <SectionHeader title="Work delivered this week" subtitle="The latest finished work from across the team." />
        <div className="space-y-3">
          {data.work_delivered_this_week.map((item) => (
            <div key={item.id} className="rounded-xl border border-border bg-base/50 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-txt-primary">{item.title}</p>
                <span className="text-xs text-txt-faint">{formatRelativeTime(item.delivered_at)}</span>
              </div>
              <p className="mt-2 text-sm text-txt-secondary">{item.preview}</p>
            </div>
          ))}
          {!loading && data.work_delivered_this_week.length === 0 && <p className="text-sm text-txt-muted">No work has been delivered yet this week.</p>}
        </div>
      </Card>

      {showChart && (
        <Card>
          <SectionHeader title="Past 8 weeks" subtitle="Completed work over time." />
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.weekly_work}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.18)" />
                <XAxis dataKey="week_label" stroke="currentColor" tick={{ fill: 'currentColor', fontSize: 12 }} />
                <YAxis allowDecimals={false} stroke="currentColor" tick={{ fill: 'currentColor', fontSize: 12 }} />
                <Tooltip
                  cursor={{ fill: 'rgba(34, 211, 238, 0.08)' }}
                  contentStyle={{ borderRadius: 16, border: '1px solid rgba(148, 163, 184, 0.2)', background: 'rgba(15, 23, 42, 0.95)' }}
                />
                <Bar dataKey="completed_count" fill="#22d3ee" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
    </div>
  );
}
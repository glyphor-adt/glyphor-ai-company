import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import {
  Card,
  SectionHeader,
  Skeleton,
} from '../components/ui';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

interface FinancialRow {
  id: string;
  date: string;
  product: string | null;
  metric: string;
  value: number;
  details: unknown;
}

function useFinancialsRaw(days = 30) {
  const [data, setData] = useState<FinancialRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const { data: rows } = await supabase
      .from('financials')
      .select('*')
      .gte('date', since)
      .order('date', { ascending: true });
    setData((rows as FinancialRow[]) ?? []);
    setLoading(false);
  }, [days]);

  useEffect(() => { refresh(); }, [refresh]);
  return { data, loading, refresh };
}

export default function Financials() {
  const { data: raw, loading } = useFinancialsRaw(30);

  // Pivot EAV rows into daily snapshots
  const mrrData = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const row of raw) {
      if (row.metric === 'mrr' && !row.product) {
        byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.value);
      }
    }
    return Array.from(byDate.entries())
      .map(([date, value]) => ({ date: formatDate(date), mrr: value }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [raw]);

  const costData = useMemo(() => {
    const byDate = new Map<string, { infra: number; api: number }>();
    for (const row of raw) {
      if (row.metric === 'infra_cost' || row.metric === 'api_cost') {
        const entry = byDate.get(row.date) ?? { infra: 0, api: 0 };
        if (row.metric === 'infra_cost') entry.infra += row.value;
        else entry.api += row.value;
        byDate.set(row.date, entry);
      }
    }
    return Array.from(byDate.entries())
      .map(([date, { infra, api }]) => ({ date: formatDate(date), infrastructure: infra, api }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [raw]);

  const marginData = useMemo(() => {
    const byDate = new Map<string, { revenue: number; cost: number }>();
    for (const row of raw) {
      if (row.metric === 'mrr' && !row.product) {
        const entry = byDate.get(row.date) ?? { revenue: 0, cost: 0 };
        entry.revenue += row.value;
        byDate.set(row.date, entry);
      }
      if (row.metric === 'infra_cost' || row.metric === 'api_cost') {
        const entry = byDate.get(row.date) ?? { revenue: 0, cost: 0 };
        entry.cost += row.value;
        byDate.set(row.date, entry);
      }
    }
    return Array.from(byDate.entries())
      .map(([date, { revenue, cost }]) => ({
        date: formatDate(date),
        margin: revenue > 0 ? ((revenue - cost) / revenue) * 100 : 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [raw]);

  // Cash flow data from Mercury
  const cashFlowData = useMemo(() => {
    const byDate = new Map<string, { inflow: number; outflow: number }>();
    for (const row of raw) {
      if (row.metric === 'cash_inflow' || row.metric === 'cash_outflow') {
        const entry = byDate.get(row.date) ?? { inflow: 0, outflow: 0 };
        if (row.metric === 'cash_inflow') entry.inflow += row.value;
        else entry.outflow += row.value;
        byDate.set(row.date, entry);
      }
    }
    return Array.from(byDate.entries())
      .map(([date, { inflow, outflow }]) => ({
        date: formatDate(date),
        inflow,
        outflow: -outflow,
        net: inflow - outflow,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [raw]);

  // Summary stats
  const latestMRR = mrrData.length > 0 ? mrrData[mrrData.length - 1].mrr : 0;
  const latestCost = costData.length > 0
    ? costData[costData.length - 1].infrastructure + costData[costData.length - 1].api
    : 0;
  const latestMargin = marginData.length > 0 ? marginData[marginData.length - 1].margin : 0;

  // Mercury stats
  const latestBalance = raw.filter((r) => r.metric === 'cash_balance').sort((a, b) => b.date.localeCompare(a.date))[0]?.value ?? 0;
  const latestBurnRate = raw.filter((r) => r.metric === 'burn_rate').sort((a, b) => b.date.localeCompare(a.date))[0]?.value ?? 0;
  const runwayMonths = latestBurnRate > 0 ? latestBalance / latestBurnRate : 0;

  // Per-product MRR
  const productMRR = useMemo(() => {
    const byProduct = new Map<string, number>();
    for (const row of raw) {
      if (row.metric === 'mrr' && row.product) {
        byProduct.set(row.product, (byProduct.get(row.product) ?? 0) + row.value);
      }
    }
    return Array.from(byProduct.entries()).map(([name, mrr]) => ({ name, mrr }));
  }, [raw]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-txt-primary">Financials</h1>
        <p className="mt-1 text-sm text-txt-muted">Revenue, costs, and margin trends</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <SummaryCard label="Monthly Revenue (Stripe)" value={`$${fmt(latestMRR)}`} loading={loading} sub={productMRR.map((p) => `${p.name}: $${fmt(p.mrr)}`).join(', ') || 'No product data'} />
        <SummaryCard label="Monthly Costs (GCP)" value={`$${fmt(latestCost)}`} loading={loading} />
        <SummaryCard label="Gross Margin" value={`${latestMargin.toFixed(1)}%`} loading={loading} />
      </div>

      {/* Banking Cards */}
      <div className="grid grid-cols-3 gap-4">
        <SummaryCard label="Cash Balance (Mercury)" value={`$${fmt(latestBalance)}`} loading={loading} />
        <SummaryCard label="Monthly Burn Rate" value={latestBurnRate > 0 ? `$${fmt(latestBurnRate)}` : '—'} loading={loading} />
        <SummaryCard label="Runway" value={runwayMonths > 0 ? `${runwayMonths.toFixed(1)} mo` : '—'} loading={loading} sub={runwayMonths > 0 ? `at current burn rate` : 'Awaiting burn data'} />
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* MRR Trend */}
        <Card>
          <SectionHeader title="MRR Trend" />
          {loading ? (
            <Skeleton className="h-64" />
          ) : mrrData.length === 0 ? (
            <EmptyChart message="No MRR data yet" />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={mrrData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} tickFormatter={(v) => `$${fmt(v)}`} />
                <Tooltip
                  contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: 'var(--color-txt-secondary)' }}
                  formatter={(value: number) => [`$${fmt(value)}`, 'MRR']}
                />
                <Line type="monotone" dataKey="mrr" stroke="#00E0FF" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Cost Breakdown */}
        <Card>
          <SectionHeader title="Cost Breakdown" />
          {loading ? (
            <Skeleton className="h-64" />
          ) : costData.length === 0 ? (
            <EmptyChart message="No cost data yet" />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={costData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} tickFormatter={(v) => `$${fmt(v)}`} />
                <Tooltip
                  contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: 'var(--color-txt-secondary)' }}
                  formatter={(value: number) => [`$${fmt(value)}`]}
                />
                <Bar dataKey="infrastructure" fill="#0097FF" stackId="costs" />
                <Bar dataKey="api" fill="#623CEA" stackId="costs" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Gross Margin */}
      <Card>
        <SectionHeader title="Gross Margin %" />
        {loading ? (
          <Skeleton className="h-64" />
        ) : marginData.length === 0 ? (
          <EmptyChart message="No margin data yet" />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={marginData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
              <Tooltip
                contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: 'var(--color-txt-secondary)' }}
                formatter={(value: number) => [`${value.toFixed(1)}%`, 'Margin']}
              />
              <Area type="monotone" dataKey="margin" stroke="#4B9FE1" fill="#4B9FE120" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Cash Flow (Mercury) */}
      <Card>
        <SectionHeader title="Cash Flow (Mercury)" />
        {loading ? (
          <Skeleton className="h-64" />
        ) : cashFlowData.length === 0 ? (
          <EmptyChart message="No cash flow data yet — Mercury sync pending" />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={cashFlowData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} tickFormatter={(v) => `$${fmt(Math.abs(v))}`} />
              <Tooltip
                contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: 'var(--color-txt-secondary)' }}
                formatter={(value: number) => [`$${fmt(Math.abs(value))}`]}
              />
              <Bar dataKey="inflow" fill="#00E0FF" name="Inflow" />
              <Bar dataKey="outflow" fill="#FF6B6B" name="Outflow" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>
    </div>
  );
}

function SummaryCard({ label, value, loading, sub }: { label: string; value: string; loading: boolean; sub?: string }) {
  if (loading) return <Skeleton className="h-24" />;
  return (
    <Card>
      <p className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">{label}</p>
      <p className="mt-1 font-mono text-2xl font-semibold text-txt-primary">{value}</p>
      {sub && <p className="mt-1 text-[11px] text-txt-faint">{sub}</p>}
    </Card>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-64 items-center justify-center">
      <p className="text-sm text-txt-faint">{message}</p>
    </div>
  );
}

function formatDate(d: string) {
  const parts = d.split('-');
  return `${parts[1]}/${parts[2]}`;
}

function fmt(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(0);
}

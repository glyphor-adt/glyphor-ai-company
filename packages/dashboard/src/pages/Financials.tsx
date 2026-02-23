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
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';

interface FinancialRow {
  id: string;
  date: string;
  product: string | null;
  metric: string;
  value: number;
  details: unknown;
}

interface GcpBillingRow {
  id: string;
  service: string;
  cost_usd: number;
  usage: { date?: string; currency?: string; raw_service?: string };
  recorded_at: string;
}

function useGcpBilling(days = 30) {
  const [data, setData] = useState<GcpBillingRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const { data: rows } = await supabase
        .from('gcp_billing')
        .select('*')
        .gte('recorded_at', since)
        .order('recorded_at', { ascending: true });
      setData((rows as GcpBillingRow[]) ?? []);
      setLoading(false);
    })();
  }, [days]);

  return { data, loading };
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
  const { data: gcpBilling, loading: gcpLoading } = useGcpBilling(30);

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

  // GCP cost by service (pie chart & table)
  const gcpByService = useMemo(() => {
    const byService = new Map<string, number>();
    for (const row of gcpBilling) {
      byService.set(row.service, (byService.get(row.service) ?? 0) + row.cost_usd);
    }
    return Array.from(byService.entries())
      .map(([service, cost]) => ({ service, cost: parseFloat(cost.toFixed(2)) }))
      .sort((a, b) => b.cost - a.cost);
  }, [gcpBilling]);

  // GCP daily cost trend (stacked by top services)
  const gcpDailyTrend = useMemo(() => {
    const topServices = gcpByService.slice(0, 6).map((s) => s.service);
    const byDate = new Map<string, Record<string, number>>();
    for (const row of gcpBilling) {
      const date = row.usage?.date ?? row.recorded_at.split('T')[0];
      const entry = byDate.get(date) ?? {};
      const key = topServices.includes(row.service) ? row.service : 'other';
      entry[key] = (entry[key] ?? 0) + row.cost_usd;
      byDate.set(date, entry);
    }
    return Array.from(byDate.entries())
      .map(([date, services]) => ({ date: formatDate(date), ...services }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [gcpBilling, gcpByService]);

  const gcpTopServices = useMemo(() => {
    const top = gcpByService.slice(0, 6).map((s) => s.service);
    if (gcpByService.length > 6) top.push('other');
    return top;
  }, [gcpByService]);

  const gcpTotalCost = gcpByService.reduce((sum, s) => sum + s.cost, 0);

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

  // Vendor subscriptions from Mercury — deduplicate by vendor name, keep latest sync date
  const subscriptions = useMemo(() => {
    const byVendor = new Map<string, { name: string; monthly: number; lastPayment: string; count: number; syncDate: string }>();
    for (const row of raw) {
      if (row.metric === 'vendor_subscription' && row.product) {
        const details = row.details as Record<string, unknown> | null;
        const existing = byVendor.get(row.product);
        if (!existing || row.date > existing.syncDate) {
          byVendor.set(row.product, {
            name: row.product,
            monthly: row.value,
            lastPayment: (details?.last_payment as string) ?? row.date,
            count: (details?.payment_count as number) ?? 0,
            syncDate: row.date,
          });
        }
      }
    }
    return Array.from(byVendor.values())
      .sort((a, b) => b.monthly - a.monthly)
      .map(({ syncDate: _s, ...rest }) => rest);
  }, [raw]);

  const totalSubscriptions = subscriptions.reduce((sum, s) => sum + s.monthly, 0);

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

      {/* Vendor Subscriptions */}
      <Card>
        <div className="flex items-center justify-between">
          <SectionHeader title="Vendor Subscriptions" />
          {!loading && subscriptions.length > 0 && (
            <span className="text-sm font-medium text-txt-secondary">
              Total: ${totalSubscriptions.toFixed(2)}/mo
            </span>
          )}
        </div>
        {loading ? (
          <Skeleton className="h-48" />
        ) : subscriptions.length === 0 ? (
          <div className="flex h-32 items-center justify-center">
            <p className="text-sm text-txt-faint">No subscription data yet — Mercury sync pending</p>
          </div>
        ) : (
          <div className="mt-2 overflow-hidden rounded-lg border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
                  <th className="px-4 py-2 text-left font-medium text-txt-muted">Vendor</th>
                  <th className="px-4 py-2 text-right font-medium text-txt-muted">Monthly Avg</th>
                  <th className="px-4 py-2 text-right font-medium text-txt-muted">Last Payment</th>
                  <th className="px-4 py-2 text-right font-medium text-txt-muted">Payments</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((sub) => (
                  <tr key={sub.name} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-4 py-2 font-medium text-txt-primary">{sub.name}</td>
                    <td className="px-4 py-2 text-right font-mono text-txt-secondary">${sub.monthly.toFixed(2)}</td>
                    <td className="px-4 py-2 text-right text-txt-muted">{formatDate(sub.lastPayment)}</td>
                    <td className="px-4 py-2 text-right text-txt-muted">{sub.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

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
                <Line type="monotone" dataKey="mrr" stroke="#0891B2" strokeWidth={2} dot={false} />
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
                <Bar dataKey="infrastructure" fill="#2563EB" stackId="costs" />
                <Bar dataKey="api" fill="#7C3AED" stackId="costs" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* GCP Billing Breakdown */}
      <div className="grid grid-cols-2 gap-6">
        {/* Per-Service Cost (Pie) */}
        <Card>
          <div className="flex items-center justify-between">
            <SectionHeader title="GCP Cost by Service" />
            {!gcpLoading && gcpTotalCost > 0 && (
              <span className="text-sm font-medium text-txt-secondary">
                Total: ${gcpTotalCost.toFixed(2)}
              </span>
            )}
          </div>
          {gcpLoading ? (
            <Skeleton className="h-64" />
          ) : gcpByService.length === 0 ? (
            <EmptyChart message="No GCP billing data yet" />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={gcpByService.slice(0, 8)}
                  dataKey="cost"
                  nameKey="service"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  innerRadius={50}
                  paddingAngle={2}
                  label={({ service, cost }: { service: string; cost: number }) =>
                    `${service} $${cost.toFixed(2)}`
                  }
                >
                  {gcpByService.slice(0, 8).map((_, i) => (
                    <Cell key={i} fill={GCP_COLORS[i % GCP_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }}
                  formatter={(value: number) => [`$${value.toFixed(4)}`]}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* GCP Daily Trend (Stacked Bar) */}
        <Card>
          <SectionHeader title="GCP Daily Cost Trend" />
          {gcpLoading ? (
            <Skeleton className="h-64" />
          ) : gcpDailyTrend.length === 0 ? (
            <EmptyChart message="No GCP billing data yet" />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={gcpDailyTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} tickFormatter={(v) => `$${v}`} />
                <Tooltip
                  contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: 'var(--color-txt-secondary)' }}
                  formatter={(value: number) => [`$${value.toFixed(4)}`]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {gcpTopServices.map((svc, i) => (
                  <Bar key={svc} dataKey={svc} stackId="gcp" fill={GCP_COLORS[i % GCP_COLORS.length]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* GCP Service Cost Table */}
      <Card>
        <SectionHeader title="GCP Service Cost Details (30 days)" />
        {gcpLoading ? (
          <Skeleton className="h-48" />
        ) : gcpByService.length === 0 ? (
          <div className="flex h-32 items-center justify-center">
            <p className="text-sm text-txt-faint">No GCP billing data yet — billing sync pending</p>
          </div>
        ) : (
          <div className="mt-2 overflow-hidden rounded-lg border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
                  <th className="px-4 py-2 text-left font-medium text-txt-muted">Service</th>
                  <th className="px-4 py-2 text-right font-medium text-txt-muted">Total Cost</th>
                  <th className="px-4 py-2 text-right font-medium text-txt-muted">% of Total</th>
                </tr>
              </thead>
              <tbody>
                {gcpByService.map((svc) => (
                  <tr key={svc.service} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="px-4 py-2 font-medium text-txt-primary">{svc.service}</td>
                    <td className="px-4 py-2 text-right font-mono text-txt-secondary">${svc.cost.toFixed(2)}</td>
                    <td className="px-4 py-2 text-right text-txt-muted">
                      {gcpTotalCost > 0 ? ((svc.cost / gcpTotalCost) * 100).toFixed(1) : '0.0'}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

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
              <Area type="monotone" dataKey="margin" stroke="#0369A1" fill="#0369A120" strokeWidth={2} />
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
              <Bar dataKey="inflow" fill="#0891B2" name="Inflow" />
              <Bar dataKey="outflow" fill="#FF6B6B" name="Outflow" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>
    </div>
  );
}

const GCP_COLORS = ['#4285F4', '#EA4335', '#FBBC04', '#34A853', '#FF6D01', '#46BDC6', '#7B61FF', '#9AA0A6'];

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

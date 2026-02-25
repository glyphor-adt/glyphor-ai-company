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
  project: string | null;
  product: string | null;
  cost_usd: number;
  usage: { date?: string; currency?: string; raw_service?: string; project?: string };
  recorded_at: string;
}

interface ApiBillingRow {
  id: string;
  provider: string;
  service: string;
  cost_usd: number;
  usage: Record<string, unknown>;
  product: string | null;
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

function useApiBilling(days = 30) {
  const [data, setData] = useState<ApiBillingRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const { data: rows } = await supabase
        .from('api_billing')
        .select('*')
        .gte('recorded_at', since)
        .order('recorded_at', { ascending: false });
      setData((rows as ApiBillingRow[]) ?? []);
      setLoading(false);
    })();
  }, [days]);

  return { data, loading };
}

export default function Financials() {
  const { data: raw, loading } = useFinancialsRaw(30);
  const { data: gcpBilling, loading: gcpLoading } = useGcpBilling(90);
  const { data: apiBilling, loading: apiLoading } = useApiBilling(90);

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

  // Current month prefix for filtering GCP data (e.g. "2026-02")
  const currentMonthPrefix = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }, []);

  const currentMonthLabel = useMemo(() => {
    const d = new Date();
    return d.toLocaleString('default', { month: 'long' });
  }, []);

  // Filter GCP billing to current month for totals
  const gcpBillingCurrentMonth = useMemo(() => {
    return gcpBilling.filter((row) => {
      const date = row.usage?.date ?? row.recorded_at.split('T')[0];
      return date.startsWith(currentMonthPrefix);
    });
  }, [gcpBilling, currentMonthPrefix]);

  // GCP cost by service — current month only (pie chart & table)
  const gcpByService = useMemo(() => {
    const byService = new Map<string, number>();
    for (const row of gcpBillingCurrentMonth) {
      byService.set(row.service, (byService.get(row.service) ?? 0) + row.cost_usd);
    }
    return Array.from(byService.entries())
      .map(([service, cost]) => ({ service, cost: parseFloat(cost.toFixed(2)) }))
      .sort((a, b) => b.cost - a.cost);
  }, [gcpBillingCurrentMonth]);

  // Filtered version for the pie chart — drop zero & near-zero cost items
  const gcpByServiceForPie = useMemo(() => {
    return gcpByService.filter((s) => s.cost >= 0.01).slice(0, 8);
  }, [gcpByService]);

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

  // GCP cost by product — current month only (pie chart)
  const gcpByProduct = useMemo(() => {
    const byProduct = new Map<string, number>();
    for (const row of gcpBillingCurrentMonth) {
      const label = row.product ?? 'unassigned';
      byProduct.set(label, (byProduct.get(label) ?? 0) + row.cost_usd);
    }
    return Array.from(byProduct.entries())
      .map(([product, cost]) => ({ product, cost: parseFloat(cost.toFixed(2)) }))
      .filter((p) => p.cost >= 0.01)
      .sort((a, b) => b.cost - a.cost);
  }, [gcpBillingCurrentMonth]);

  // GCP cost by project — current month (table + pie)
  const gcpByProject = useMemo(() => {
    const byProject = new Map<string, number>();
    for (const row of gcpBillingCurrentMonth) {
      const label = row.project ?? 'unknown';
      byProject.set(label, (byProject.get(label) ?? 0) + row.cost_usd);
    }
    return Array.from(byProject.entries())
      .map(([project, cost]) => ({ project, product: PROJECT_TO_PRODUCT_LABEL[project] ?? null, cost: parseFloat(cost.toFixed(2)) }))
      .filter((p) => p.cost >= 0.01)
      .sort((a, b) => b.cost - a.cost);
  }, [gcpBillingCurrentMonth]);

  // GCP daily trend by project (stacked bar)
  const gcpDailyByProject = useMemo(() => {
    const projects = gcpByProject.map((p) => p.project);
    const byDate = new Map<string, Record<string, number>>();
    for (const row of gcpBilling) {
      const date = row.usage?.date ?? row.recorded_at.split('T')[0];
      const proj = row.project ?? 'unknown';
      if (!projects.includes(proj)) continue;
      const entry = byDate.get(date) ?? {};
      entry[proj] = (entry[proj] ?? 0) + row.cost_usd;
      byDate.set(date, entry);
    }
    return Array.from(byDate.entries())
      .map(([date, projs]) => ({ date: formatDate(date), ...projs }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [gcpBilling, gcpByProject]);

  // Per-project service breakdown — current month
  const gcpProjectServiceBreakdown = useMemo(() => {
    const result = new Map<string, Map<string, number>>();
    for (const row of gcpBillingCurrentMonth) {
      const proj = row.project ?? 'unknown';
      if (!result.has(proj)) result.set(proj, new Map());
      const svcMap = result.get(proj)!;
      svcMap.set(row.service, (svcMap.get(row.service) ?? 0) + row.cost_usd);
    }
    return result;
  }, [gcpBillingCurrentMonth]);

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

  // ── Per-product financials ────────────────────────────────────────
  const productFinancials = useMemo(() => {
    const result: Record<string, { mrr: number; costs: number; apiCosts: number; users: number }> = {};
    for (const p of PRODUCTS) result[p] = { mrr: 0, costs: 0, apiCosts: 0, users: 0 };

    for (const row of raw) {
      if (!row.product || !result[row.product]) {
        if (row.product && !result[row.product]) result[row.product] = { mrr: 0, costs: 0, apiCosts: 0, users: 0 };
        else continue;
      }
      // Use only the latest date per metric per product
      if (row.metric === 'mrr') result[row.product].mrr = Math.max(result[row.product].mrr, row.value);
      if (row.metric === 'infra_cost') result[row.product].costs += row.value;
      if (row.metric === 'api_cost') result[row.product].apiCosts += row.value;
      if (row.metric === 'active_users') result[row.product].users = Math.max(result[row.product].users, row.value);
    }
    return result;
  }, [raw]);

  // Per-product MRR trend for comparison chart
  const productMRRTrend = useMemo(() => {
    const allDates = new Set<string>();
    const byDateProduct = new Map<string, Record<string, number>>();
    for (const row of raw) {
      if (row.metric === 'mrr' && row.product) {
        allDates.add(row.date);
        const entry = byDateProduct.get(row.date) ?? {};
        entry[row.product] = (entry[row.product] ?? 0) + row.value;
        byDateProduct.set(row.date, entry);
      }
    }
    return Array.from(allDates).sort().map((date) => ({
      date: formatDate(date),
      ...(byDateProduct.get(date) ?? {}),
    }));
  }, [raw]);

  // Per-product cost breakdown (infra + api)
  const productCostBreakdown = useMemo(() => {
    const products = new Set<string>();
    for (const row of raw) {
      if ((row.metric === 'infra_cost' || row.metric === 'api_cost') && row.product) {
        products.add(row.product);
      }
    }
    // Also include api_billing products
    for (const row of apiBilling) {
      if (row.product) products.add(row.product);
    }
    return Array.from(products).map((name) => {
      const f = productFinancials[name] ?? { mrr: 0, costs: 0, apiCosts: 0, users: 0 };
      const apiBillingCost = apiBilling.filter((r) => r.product === name).reduce((s, r) => s + r.cost_usd, 0);
      return {
        name: PRODUCT_LABELS[name] ?? name,
        infrastructure: f.costs,
        api: f.apiCosts + apiBillingCost,
      };
    }).filter((p) => p.infrastructure > 0 || p.api > 0);
  }, [raw, apiBilling, productFinancials]);

  // API billing by provider
  const apiBillingByProvider = useMemo(() => {
    const byProvider = new Map<string, { cost: number; rows: number }>();
    for (const row of apiBilling) {
      const entry = byProvider.get(row.provider) ?? { cost: 0, rows: 0 };
      entry.cost += row.cost_usd;
      entry.rows++;
      byProvider.set(row.provider, entry);
    }
    return Array.from(byProvider.entries()).map(([provider, data]) => ({ provider, ...data }));
  }, [apiBilling]);

  // Kling resource packs from api_billing
  const klingPacks = useMemo(() => {
    return apiBilling
      .filter((r) => r.provider === 'kling')
      .map((r) => ({
        name: r.service,
        total: (r.usage?.total_quantity as number) ?? 0,
        remaining: (r.usage?.remaining_quantity as number) ?? 0,
        consumed: (r.usage?.consumed_quantity as number) ?? 0,
        status: (r.usage?.status as string) ?? 'unknown',
        effective: r.usage?.effective_time ? formatDate(String(r.usage.effective_time).split('T')[0]) : '—',
        expires: r.usage?.invalid_time ? formatDate(String(r.usage.invalid_time).split('T')[0]) : '—',
      }));
  }, [apiBilling]);

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
        <SummaryCard label={`${currentMonthLabel} Costs (GCP)`} value={`$${fmt(gcpTotalCost)}`} loading={gcpLoading} />
        <SummaryCard label="Gross Margin" value={`${latestMargin.toFixed(1)}%`} loading={loading} />
      </div>

      {/* Banking Cards */}
      <div className="grid grid-cols-3 gap-4">
        <SummaryCard label="Cash Balance (Mercury)" value={`$${fmt(latestBalance)}`} loading={loading} />
        <SummaryCard label="Monthly Burn Rate" value={latestBurnRate > 0 ? `$${fmt(latestBurnRate)}` : '—'} loading={loading} />
        <SummaryCard label="Runway" value={runwayMonths > 0 ? `${runwayMonths.toFixed(1)} mo` : '—'} loading={loading} sub={runwayMonths > 0 ? `at current burn rate` : 'Awaiting burn data'} />
      </div>

      {/* ═══════════════════════════════════════════════════════════
           PRODUCT FINANCIALS — Fuse · Pulse · Reve
         ═══════════════════════════════════════════════════════════ */}
      <div>
        <h2 className="text-lg font-semibold text-txt-primary">Product Financials</h2>
        <p className="mt-0.5 text-xs text-txt-muted">Per-product revenue, costs, and API usage</p>
      </div>

      {/* Per-product summary cards */}
      <div className="grid grid-cols-3 gap-4">
        {PRODUCTS.map((p) => {
          const f = productFinancials[p] ?? { mrr: 0, costs: 0, apiCosts: 0, users: 0 };
          const totalCost = f.costs + f.apiCosts;
          const margin = f.mrr > 0 ? ((f.mrr - totalCost) / f.mrr * 100) : 0;
          return (
            <Card key={p}>
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PRODUCT_COLORS[p] }} />
                <p className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">{PRODUCT_LABELS[p]}</p>
              </div>
              <p className="mt-1 font-mono text-2xl font-semibold text-txt-primary">${fmt(f.mrr)}<span className="text-sm font-normal text-txt-muted">/mo</span></p>
              <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                <div>
                  <p className="text-txt-faint">Infra</p>
                  <p className="font-mono text-txt-secondary">${f.costs > 0 ? f.costs.toFixed(2) : '—'}</p>
                </div>
                <div>
                  <p className="text-txt-faint">API</p>
                  <p className="font-mono text-txt-secondary">${f.apiCosts > 0 ? f.apiCosts.toFixed(2) : '—'}</p>
                </div>
                <div>
                  <p className="text-txt-faint">Margin</p>
                  <p className="font-mono text-txt-secondary">{f.mrr > 0 ? `${margin.toFixed(0)}%` : '—'}</p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Product MRR Comparison */}
        <Card>
          <SectionHeader title="Revenue by Product" />
          {loading ? (
            <Skeleton className="h-64" />
          ) : productMRR.length === 0 ? (
            <EmptyChart message="No per-product MRR data yet" />
          ) : productMRRTrend.length > 1 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={productMRRTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} tickFormatter={(v) => `$${fmt(v)}`} />
                <Tooltip
                  contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: 'var(--color-txt-secondary)' }}
                  formatter={(value: number, name: string) => [`$${fmt(value)}`, PRODUCT_LABELS[name] ?? name]}
                />
                <Legend formatter={(value) => PRODUCT_LABELS[value] ?? value} wrapperStyle={{ fontSize: 11 }} />
                {PRODUCTS.map((p) => (
                  <Bar key={p} dataKey={p} fill={PRODUCT_COLORS[p]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={productMRR} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} tickFormatter={(v) => `$${fmt(v)}`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} width={60} tickFormatter={(v: string) => PRODUCT_LABELS[v] ?? v} />
                <Tooltip
                  contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }}
                  formatter={(value: number) => [`$${fmt(value)}`, 'MRR']}
                />
                <Bar dataKey="mrr" fill="#0891B2">
                  {productMRR.map((p) => (
                    <Cell key={p.name} fill={PRODUCT_COLORS[p.name] ?? '#0891B2'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Product Cost Breakdown */}
        <Card>
          <SectionHeader title="Costs by Product" />
          {loading ? (
            <Skeleton className="h-64" />
          ) : productCostBreakdown.length === 0 ? (
            <EmptyChart message="No per-product cost data yet" />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={productCostBreakdown}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} tickFormatter={(v) => `$${fmt(v)}`} />
                <Tooltip
                  contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: 'var(--color-txt-secondary)' }}
                  formatter={(value: number) => [`$${value.toFixed(2)}`]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="infrastructure" fill="#2563EB" stackId="costs" name="Infrastructure" />
                <Bar dataKey="api" fill="#7C3AED" stackId="costs" name="API / AI" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* API Billing by Provider + Kling Packs */}
      <div className="grid grid-cols-2 gap-6">
        <Card>
          <SectionHeader title="API Costs by Provider" />
          {apiLoading ? (
            <Skeleton className="h-48" />
          ) : apiBillingByProvider.length === 0 ? (
            <EmptyChart message="No API billing data yet — sync Kling, OpenAI, or Anthropic" />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={apiBillingByProvider}
                  dataKey="cost"
                  nameKey="provider"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  innerRadius={45}
                  paddingAngle={2}
                  label={({ provider, cost }: { provider: string; cost: number }) =>
                    `${provider} $${cost.toFixed(2)}`
                  }
                >
                  {apiBillingByProvider.map((_, i) => (
                    <Cell key={i} fill={API_COLORS[i % API_COLORS.length]} />
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

        <Card>
          <SectionHeader title="Kling AI Resource Packs (Pulse)" />
          {apiLoading ? (
            <Skeleton className="h-48" />
          ) : klingPacks.length === 0 ? (
            <div className="flex h-48 items-center justify-center">
              <p className="text-sm text-txt-faint">No Kling data yet — run /sync/kling-billing</p>
            </div>
          ) : (
            <div className="mt-2 space-y-3">
              {klingPacks.map((pack, i) => {
                const pct = pack.total > 0 ? (pack.consumed / pack.total) * 100 : 0;
                const statusColor = pack.status === 'online' ? '#34A853' : pack.status === 'expired' || pack.status === 'runOut' ? '#EA4335' : '#FBBC04';
                return (
                  <div key={i} className="rounded-lg border border-[var(--color-border)] p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-txt-primary">{pack.name}</span>
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ backgroundColor: statusColor + '20', color: statusColor }}>
                        {pack.status}
                      </span>
                    </div>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
                      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: pct > 80 ? '#EA4335' : pct > 50 ? '#FBBC04' : '#34A853' }} />
                    </div>
                    <div className="mt-1 flex justify-between text-[10px] text-txt-faint">
                      <span>{pack.consumed.toLocaleString()} / {pack.total.toLocaleString()} used ({pct.toFixed(0)}%)</span>
                      <span>{pack.remaining.toLocaleString()} remaining</span>
                    </div>
                    <div className="mt-1 flex justify-between text-[10px] text-txt-faint">
                      <span>Active: {pack.effective}</span>
                      <span>Expires: {pack.expires}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* ═══════════════════════════════════════════════════════════
           COMPANY-WIDE DETAILS
         ═══════════════════════════════════════════════════════════ */}
      <div>
        <h2 className="text-lg font-semibold text-txt-primary">Company-Wide Details</h2>
        <p className="mt-0.5 text-xs text-txt-muted">Aggregate infrastructure, banking, and vendor data</p>
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
        {/* Per-Product Cost (Pie) */}
        <Card>
          <SectionHeader title={`GCP Cost by Product (${currentMonthLabel})`} />
          {gcpLoading ? (
            <Skeleton className="h-64" />
          ) : gcpByProduct.length === 0 ? (
            <EmptyChart message="No per-product GCP data yet" />
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <PieChart>
                <Pie
                  data={gcpByProduct}
                  dataKey="cost"
                  nameKey="product"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  innerRadius={55}
                  paddingAngle={2}
                  label={({ product, cost, percent }: { product: string; cost: number; percent: number }) =>
                    percent > 0.05 ? `${PRODUCT_LABELS[product] ?? product} $${cost.toFixed(2)}` : ''
                  }
                  labelLine={{ stroke: 'var(--color-txt-faint)', strokeWidth: 1 }}
                >
                  {gcpByProduct.map((entry, i) => (
                    <Cell key={i} fill={PRODUCT_COLORS[entry.product] ?? GCP_COLORS[i % GCP_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }}
                  formatter={(value: number) => [`$${value.toFixed(2)}`]}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Per-Service Cost (Pie) */}
        <Card>
          <div className="flex items-center justify-between">
            <SectionHeader title={`GCP Cost by Service (${currentMonthLabel})`} />
            {!gcpLoading && gcpTotalCost > 0 && (
              <span className="text-sm font-medium text-txt-secondary">
                ${gcpTotalCost.toFixed(2)}
              </span>
            )}
          </div>
          {gcpLoading ? (
            <Skeleton className="h-64" />
          ) : gcpByService.length === 0 ? (
            <EmptyChart message="No GCP billing data yet" />
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <PieChart>
                <Pie
                  data={gcpByServiceForPie}
                  dataKey="cost"
                  nameKey="service"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  innerRadius={55}
                  paddingAngle={2}
                  label={({ service, cost, percent }: { service: string; cost: number; percent: number }) =>
                    percent > 0.04 ? `${service} $${cost.toFixed(2)}` : ''
                  }
                  labelLine={{ stroke: 'var(--color-txt-faint)', strokeWidth: 1 }}
                >
                  {gcpByServiceForPie.map((_, i) => (
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

      </div>

      {/* GCP Cost by Project — table with per-project service breakdown */}
      <Card>
        <SectionHeader title={`GCP Cost by Project (${currentMonthLabel})`} />
        {gcpLoading ? (
          <Skeleton className="h-48" />
        ) : gcpByProject.length === 0 ? (
          <EmptyChart message="No per-project GCP data yet" />
        ) : (
          <div className="mt-2 space-y-4">
            {gcpByProject.map((proj) => {
              const services = gcpProjectServiceBreakdown.get(proj.project);
              const serviceList = services
                ? Array.from(services.entries())
                    .map(([svc, cost]) => ({ service: svc, cost: parseFloat(cost.toFixed(4)) }))
                    .sort((a, b) => b.cost - a.cost)
                : [];
              const pct = gcpTotalCost > 0 ? (proj.cost / gcpTotalCost) * 100 : 0;
              return (
                <div key={proj.project} className="rounded-lg border border-[var(--color-border)] p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-medium text-txt-primary">{proj.project}</span>
                      {proj.product && (
                        <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 text-[10px] font-medium text-txt-muted">
                          {proj.product}
                        </span>
                      )}
                    </div>
                    <div className="text-right">
                      <span className="font-mono text-sm font-semibold text-txt-primary">${proj.cost.toFixed(2)}</span>
                      <span className="ml-2 text-[11px] text-txt-faint">{pct.toFixed(1)}%</span>
                    </div>
                  </div>
                  {/* Cost bar */}
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
                    <div className="h-full rounded-full bg-[#4285F4] transition-all" style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                  {/* Service breakdown */}
                  {serviceList.length > 0 && (
                    <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1">
                      {serviceList.map((svc) => (
                        <div key={svc.service} className="flex items-center justify-between text-[11px]">
                          <span className="text-txt-muted truncate mr-2">{svc.service}</span>
                          <span className="font-mono text-txt-secondary shrink-0">${svc.cost.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* GCP Daily Cost by Project — stacked bar */}
      <Card>
        <SectionHeader title="GCP Daily Cost by Project" />
        {gcpLoading ? (
          <Skeleton className="h-64" />
        ) : gcpDailyByProject.length === 0 ? (
          <EmptyChart message="No per-project GCP data yet" />
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={gcpDailyByProject} margin={{ top: 5, right: 20, left: 10, bottom: 25 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }}
                interval={Math.max(0, Math.floor(gcpDailyByProject.length / 12) - 1)}
                angle={gcpDailyByProject.length > 14 ? -40 : 0}
                textAnchor={gcpDailyByProject.length > 14 ? 'end' : 'middle'}
              />
              <YAxis tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} tickFormatter={(v) => `$${v}`} />
              <Tooltip
                contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: 'var(--color-txt-secondary)' }}
                formatter={(value: number, name: string) => [`$${value.toFixed(4)}`, PROJECT_TO_PRODUCT_LABEL[name] ?? name]}
              />
              <Legend formatter={(value) => PROJECT_TO_PRODUCT_LABEL[value] ?? value} wrapperStyle={{ fontSize: 11 }} />
              {gcpByProject.map((p, i) => (
                <Bar key={p.project} dataKey={p.project} stackId="proj" fill={GCP_COLORS[i % GCP_COLORS.length]} maxBarSize={36} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* GCP Daily Trend — full width */}
      <Card>
        <SectionHeader title="GCP Daily Cost Trend" />
        {gcpLoading ? (
          <Skeleton className="h-64" />
        ) : gcpDailyTrend.length === 0 ? (
          <EmptyChart message="No GCP billing data yet" />
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={gcpDailyTrend} margin={{ top: 5, right: 20, left: 10, bottom: 25 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }}
                interval={Math.max(0, Math.floor(gcpDailyTrend.length / 12) - 1)}
                angle={gcpDailyTrend.length > 14 ? -40 : 0}
                textAnchor={gcpDailyTrend.length > 14 ? 'end' : 'middle'}
              />
              <YAxis tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} tickFormatter={(v) => `$${v}`} />
              <Tooltip
                contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: 'var(--color-txt-secondary)' }}
                formatter={(value: number) => [`$${value.toFixed(4)}`]}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {gcpTopServices.map((svc, i) => (
                <Bar key={svc} dataKey={svc} stackId="gcp" fill={GCP_COLORS[i % GCP_COLORS.length]} maxBarSize={36} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* GCP Service Cost Table */}
      <Card>
        <SectionHeader title={`GCP Service Cost Details (${currentMonthLabel})`} />
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

const PRODUCTS = ['fuse', 'pulse', 'reve'] as const;
const PRODUCT_COLORS: Record<string, string> = { fuse: '#2563EB', pulse: '#7C3AED', reve: '#0891B2', glyphor: '#EA4335', unassigned: '#9AA0A6' };
const PRODUCT_LABELS: Record<string, string> = { fuse: 'Fuse', pulse: 'Pulse', reve: 'Reve', glyphor: 'Glyphor', unassigned: 'Unassigned' };
const PROJECT_TO_PRODUCT_LABEL: Record<string, string> = { 'ai-glyphor-company': 'Glyphor', 'glyphor-pulse': 'Pulse', 'gen-lang-client-0834143721': 'Fuse' };
const GCP_COLORS = ['#4285F4', '#EA4335', '#FBBC04', '#34A853', '#FF6D01', '#46BDC6', '#7B61FF', '#9AA0A6'];
const API_COLORS = ['#7C3AED', '#2563EB', '#0891B2', '#EA4335', '#FF6D01'];

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

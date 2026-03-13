import { useEffect, useState, useCallback, useMemo } from 'react';
import { apiCall } from '../lib/firebase';
import { GLYPHOR_PALETTE } from '../lib/types';
import {
  Card,
  SectionHeader,
  Skeleton,
} from '../components/ui';

// ─── Sync Status Types & Hook ─────────────────────────────────────
interface SyncStatus {
  id: string;
  status: string;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
}

const FINANCIAL_SYNCS = [
  { id: 'stripe', label: 'Stripe (Revenue)', endpoint: '/sync/stripe' },
  { id: 'mercury', label: 'Mercury (Banking)', endpoint: '/sync/mercury' },
  { id: 'gcp-billing', label: 'GCP Billing', endpoint: '/sync/gcp-billing' },
  { id: 'anthropic-billing', label: 'Anthropic', endpoint: '/sync/anthropic-billing' },
  { id: 'openai-billing', label: 'OpenAI', endpoint: '/sync/openai-billing' },
  { id: 'kling-billing', label: 'Kling', endpoint: '/sync/kling-billing' },
];

function useSyncStatus() {
  const [statuses, setStatuses] = useState<SyncStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const rows = await apiCall<SyncStatus[]>('/api/data-sync-status');
      setStatuses(rows ?? []);
    } catch { setStatuses([]); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  return { statuses, loading, refresh };
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  ScatterChart,
  Scatter,
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

interface AgentRunRow {
  id: string;
  agent_id?: string | null;
  routing_model?: string | null;
  routing_rule?: string | null;
  model_routing_reason?: string | null;
  subtask_complexity?: string | null;
  verification_tier?: string | null;
  [key: string]: unknown;
  reasoning_cost_usd?: number | null;
  cost?: number | null;
  started_at?: string | null;
}

interface AgentReflectionRow {
  id: string;
  run_id: string;
  agent_role: string;
  quality_score: number | null;
  created_at: string;
}

function useGcpBilling(days = 30) {
  const [data, setData] = useState<GcpBillingRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      try {
        const rows = await apiCall<GcpBillingRow[]>(`/api/gcp-billing?since=${since}`);
        setData(rows ?? []);
      } catch {
        setData([]);
      }
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
    try {
      const rows = await apiCall<FinancialRow[]>(`/api/financials?since=${since}&order=date.desc&limit=1000`);
      setData(rows ?? []);
    } catch {
      setData([]);
    }
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
      try {
        const rows = await apiCall<ApiBillingRow[]>(`/api/api-billing?since=${since}`);
        setData(rows ?? []);
      } catch {
        setData([]);
      }
      setLoading(false);
    })();
  }, [days]);

  return { data, loading };
}

function useAgentRunsForVerification(days = 30) {
  const [data, setData] = useState<AgentRunRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      try {
        const rows = await apiCall<AgentRunRow[]>(`/api/agent-runs?since=${since}&limit=1000`);
        setData(rows ?? []);
      } catch {
        setData([]);
      }
      setLoading(false);
    })();
  }, [days]);

  return { data, loading };
}

function useAgentReflections(days = 30) {
  const [data, setData] = useState<AgentReflectionRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      try {
        const rows = await apiCall<AgentReflectionRow[]>(`/api/agent-reflections?since=${since}&limit=1000`);
        setData(rows ?? []);
      } catch {
        setData([]);
      }
      setLoading(false);
    })();
  }, [days]);

  return { data, loading };
}

export default function Financials() {
  const { data: raw, loading, refresh: refreshFinancials } = useFinancialsRaw(30);
  const { data: gcpBilling, loading: gcpLoading } = useGcpBilling(90);
  const { data: apiBilling, loading: apiLoading } = useApiBilling(90);
  const { statuses: syncStatuses, loading: syncLoading, refresh: refreshSyncStatus } = useSyncStatus();
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());
  const [showSyncPanel, setShowSyncPanel] = useState(false);

  const triggerSync = useCallback(async (endpoint: string, id: string) => {
    setSyncingIds((prev) => new Set(prev).add(id));
    try {
      await apiCall(endpoint, { method: 'POST' });
    } catch { /* sync status will show the error */ }
    setSyncingIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    await Promise.all([refreshSyncStatus(), refreshFinancials()]);
  }, [refreshSyncStatus, refreshFinancials]);

  const triggerAllSyncs = useCallback(async () => {
    const ids = FINANCIAL_SYNCS.map((s) => s.id);
    setSyncingIds(new Set(ids));
    await Promise.allSettled(FINANCIAL_SYNCS.map((s) => apiCall(s.endpoint, { method: 'POST' })));
    setSyncingIds(new Set());
    await Promise.all([refreshSyncStatus(), refreshFinancials()]);
  }, [refreshSyncStatus, refreshFinancials]);

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
  // api_billing providers already tracked in financials.api_cost — only add providers NOT in financials
  const productCostBreakdown = useMemo(() => {
    const financialsApiProviders = new Set<string>();
    for (const row of raw) {
      if (row.metric === 'api_cost' && row.details) {
        const src = (row.details as Record<string, unknown>)?.source;
        if (typeof src === 'string') financialsApiProviders.add(src);
      }
    }
    const products = new Set<string>();
    for (const row of raw) {
      if ((row.metric === 'infra_cost' || row.metric === 'api_cost') && row.product) {
        products.add(row.product);
      }
    }
    // Only include api_billing rows from providers NOT already in financials.api_cost
    const extraApiBilling = apiBilling.filter((r) => !financialsApiProviders.has(r.provider));
    for (const row of extraApiBilling) {
      if (row.product) products.add(row.product);
    }
    return Array.from(products).map((name) => {
      const f = productFinancials[name] ?? { mrr: 0, costs: 0, apiCosts: 0, users: 0 };
      const apiBillingCost = extraApiBilling.filter((r) => r.product === name).reduce((s, r) => s + r.cost_usd, 0);
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

  // Kling resource packs from api_billing — deduplicate by service name, keep latest
  const klingPacks = useMemo(() => {
    const byService = new Map<string, ApiBillingRow>();
    for (const r of apiBilling.filter((r) => r.provider === 'kling')) {
      const existing = byService.get(r.service);
      if (!existing || r.recorded_at > existing.recorded_at) {
        byService.set(r.service, r);
      }
    }
    return Array.from(byService.values()).map((r) => ({
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

  const financialTrend = useMemo(() => {
    const byDate = new Map<string, { revenue: number; costs: number; margin: number }>();
    for (const row of mrrData) {
      const entry = byDate.get(row.date) ?? { revenue: 0, costs: 0, margin: 0 };
      entry.revenue = row.mrr;
      byDate.set(row.date, entry);
    }
    for (const row of costData) {
      const entry = byDate.get(row.date) ?? { revenue: 0, costs: 0, margin: 0 };
      entry.costs = row.infrastructure + row.api;
      byDate.set(row.date, entry);
    }
    for (const row of marginData) {
      const entry = byDate.get(row.date) ?? { revenue: 0, costs: 0, margin: 0 };
      entry.margin = row.margin;
      byDate.set(row.date, entry);
    }
    return Array.from(byDate.entries())
      .map(([date, metrics]) => ({ date, ...metrics }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [mrrData, costData, marginData]);

  const spendMix = useMemo(() => {
    const apiTotal = apiBillingByProvider.reduce((sum, provider) => sum + provider.cost, 0);
    return [
      { name: 'Infrastructure', value: gcpTotalCost },
      { name: 'AI / API', value: apiTotal },
      { name: 'Subscriptions', value: totalSubscriptions },
    ].filter((item) => item.value > 0);
  }, [apiBillingByProvider, gcpTotalCost, totalSubscriptions]);

  const productSnapshot = useMemo(() => {
    return PRODUCTS.map((product) => {
      const f = productFinancials[product] ?? { mrr: 0, costs: 0, apiCosts: 0, users: 0 };
      const totalCost = f.costs + f.apiCosts;
      const margin = f.mrr > 0 ? ((f.mrr - totalCost) / f.mrr) * 100 : 0;
      return {
        key: product,
        name: PRODUCT_LABELS[product] ?? product,
        mrr: f.mrr,
        totalCost,
        margin,
      };
    });
  }, [productFinancials]);

  const marginDelta = latestMRR > 0 ? (((latestMRR - latestCost) / latestMRR) * 100) - latestMargin : 0;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-gradient-to-r from-[#0f172a]/90 via-[#1e293b]/80 to-[#312e81]/65 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-cyan/80">Finance Command</p>
            <h1 className="mt-1 text-2xl font-bold text-txt-primary">Financials</h1>
            <p className="mt-1 text-sm text-txt-muted">A tighter readout focused on runway, margin, and spend concentration.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSyncPanel((v) => !v)}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-txt-secondary transition hover:bg-surface-hover"
            >
              {showSyncPanel ? 'Hide Sources' : 'Data Sources'}
            </button>
            <button
              onClick={triggerAllSyncs}
              disabled={syncingIds.size > 0}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:bg-accent/90 disabled:opacity-50"
            >
              {syncingIds.size > 0 ? 'Syncing…' : 'Refresh All'}
            </button>
          </div>
        </div>
      </div>

      {showSyncPanel && (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wider text-txt-muted">Data Source Status</p>
          </div>
          {syncLoading ? <Skeleton className="h-16" /> : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {FINANCIAL_SYNCS.map((sync) => {
                const s = syncStatuses.find((st) => st.id === sync.id);
                const isOk = s?.status === 'ok';
                const isFailing = s?.status === 'failing';
                const isSyncing = syncingIds.has(sync.id);
                return (
                  <div key={sync.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <div className={`h-2 w-2 flex-shrink-0 rounded-full ${isOk ? 'bg-green-500' : isFailing ? 'bg-red-500' : 'bg-yellow-500'}`} />
                        <p className="truncate text-xs font-medium text-txt-primary">{sync.label}</p>
                      </div>
                      <p className="mt-0.5 text-[10px] text-txt-faint">
                        {s?.last_success_at ? timeAgo(s.last_success_at) : 'never synced'}
                        {isFailing && s?.consecutive_failures ? ` · ${s.consecutive_failures} failures` : ''}
                      </p>
                    </div>
                    <button
                      onClick={() => triggerSync(sync.endpoint, sync.id)}
                      disabled={isSyncing}
                      className="ml-2 flex-shrink-0 rounded px-2 py-0.5 text-[10px] font-medium text-accent transition hover:bg-accent/10 disabled:opacity-50"
                    >
                      {isSyncing ? '…' : '↻'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Monthly Revenue" value={`$${fmt(latestMRR)}`} loading={loading} sub="Stripe MRR snapshot" />
        <SummaryCard label="Gross Margin" value={`${latestMargin.toFixed(1)}%`} loading={loading} sub={`${marginDelta >= 0 ? '+' : ''}${marginDelta.toFixed(1)} pts from trend baseline`} />
        <SummaryCard label="Burn Rate" value={latestBurnRate > 0 ? `$${fmt(latestBurnRate)}` : '—'} loading={loading} sub="Monthly cash outflow" />
        <SummaryCard label="Runway" value={runwayMonths > 0 ? `${runwayMonths.toFixed(1)} mo` : '—'} loading={loading} sub={runwayMonths > 0 ? 'Based on current burn' : 'Awaiting burn data'} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <SectionHeader title="Revenue vs Cost Trend" />
          {loading ? (
            <Skeleton className="h-72" />
          ) : financialTrend.length === 0 ? (
            <EmptyChart message="No revenue or cost trend data yet" />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={financialTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} tickFormatter={(v) => `$${fmt(Number(v))}`} />
                <Tooltip
                  contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: 'var(--color-txt-secondary)' }}
                  formatter={(value: number, name: string) => {
                    if (name === 'margin') return [`${value.toFixed(1)}%`, 'Margin'];
                    return [`$${fmt(value)}`, name === 'revenue' ? 'Revenue' : 'Costs'];
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="revenue" stroke="#22D3EE" strokeWidth={2.5} dot={false} name="Revenue" />
                <Line type="monotone" dataKey="costs" stroke="#FB7185" strokeWidth={2.5} dot={false} name="Costs" />
                <Line type="monotone" dataKey="margin" stroke="#A78BFA" strokeWidth={2} dot={false} yAxisId={1} name="Margin" />
                <YAxis yAxisId={1} orientation="right" tickFormatter={(v) => `${Number(v).toFixed(0)}%`} domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--color-txt-faint)' }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card>
          <SectionHeader title={`${currentMonthLabel} Spend Mix`} />
          {apiLoading || gcpLoading ? (
            <Skeleton className="h-72" />
          ) : spendMix.length === 0 ? (
            <EmptyChart message="No spend mix data yet" />
          ) : (
            <div className="space-y-3">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={spendMix} dataKey="value" nameKey="name" outerRadius={80} innerRadius={46} paddingAngle={2}>
                    {spendMix.map((slice, i) => (
                      <Cell key={slice.name} fill={API_COLORS[i % API_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }}
                    formatter={(value: number) => [`$${value.toFixed(2)}`]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5 text-xs">
                {spendMix.map((slice, i) => {
                  const total = spendMix.reduce((sum, s) => sum + s.value, 0);
                  const pct = total > 0 ? (slice.value / total) * 100 : 0;
                  return (
                    <div key={slice.name} className="flex items-center justify-between rounded-md border border-border px-2.5 py-1.5">
                      <span className="flex items-center gap-2 text-txt-secondary">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: API_COLORS[i % API_COLORS.length] }} />
                        {slice.name}
                      </span>
                      <span className="font-mono text-txt-primary">${slice.value.toFixed(2)} · {pct.toFixed(0)}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <SectionHeader title="Product Profitability Snapshot" />
          {loading ? (
            <Skeleton className="h-72" />
          ) : productSnapshot.every((p) => p.mrr === 0 && p.totalCost === 0) ? (
            <EmptyChart message="No product-level financial data yet" />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={productSnapshot}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} tickFormatter={(v) => `$${fmt(Number(v))}`} />
                <Tooltip
                  contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }}
                  formatter={(value: number, name: string) => {
                    if (name === 'margin') return [`${value.toFixed(1)}%`, 'Margin'];
                    return [`$${value.toFixed(2)}`, name === 'mrr' ? 'Revenue' : 'Cost'];
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="mrr" fill="#22D3EE" name="Revenue" radius={[6, 6, 0, 0]} />
                <Bar dataKey="totalCost" fill="#FB7185" name="Cost" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card>
          <SectionHeader title="Top Subscriptions" />
          {loading ? (
            <Skeleton className="h-72" />
          ) : subscriptions.length === 0 ? (
            <EmptyChart message="No subscription data yet" />
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-txt-faint">Total recurring vendor spend: <span className="font-mono text-txt-primary">${totalSubscriptions.toFixed(2)}/mo</span></p>
              {subscriptions.slice(0, 7).map((sub) => (
                <div key={sub.name} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-txt-primary">{sub.name}</p>
                    <p className="text-[11px] text-txt-faint">Last payment {formatDate(sub.lastPayment)} · {sub.count} payments</p>
                  </div>
                  <p className="font-mono text-sm text-txt-secondary">${sub.monthly.toFixed(2)}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card>
        <SectionHeader title="Cost Structure by Product" />
        {loading ? (
          <Skeleton className="h-60" />
        ) : productCostBreakdown.length === 0 ? (
          <EmptyChart message="No product cost data yet" />
        ) : (
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={productCostBreakdown}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--color-txt-muted)' }} tickFormatter={(v) => `$${fmt(Number(v))}`} />
              <Tooltip
                contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 12 }}
                formatter={(value: number, name: string) => [`$${value.toFixed(2)}`, name === 'infrastructure' ? 'Infrastructure' : 'API / AI']}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="infrastructure" fill="#60A5FA" stackId="costs" name="Infrastructure" />
              <Bar dataKey="api" fill="#C084FC" stackId="costs" name="API / AI" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>
    </div>
  );
}

const PRODUCTS = ['fuse', 'pulse', 'reve'] as const;
const PRODUCT_COLORS: Record<string, string> = { fuse: '#2563EB', pulse: '#7C3AED', reve: '#0891B2', glyphor: '#6366F1', unassigned: '#94A3B8' };
const PRODUCT_LABELS: Record<string, string> = { fuse: 'Fuse', pulse: 'Pulse', reve: 'Reve', glyphor: 'Glyphor', unassigned: 'Unassigned' };
const PROJECT_TO_PRODUCT_LABEL: Record<string, string> = { 'ai-glyphor-company': 'Glyphor', 'glyphor-pulse': 'Pulse', 'gen-lang-client-0834143721': 'Fuse' };
const GCP_COLORS = [...GLYPHOR_PALETTE];
const GCP_SERVICE_COLORS: Record<string, string> = {
  'gemini-api': '#2563EB', sql: '#6366F1', run: '#00A3C4',
  'memorystore-for-redis': '#7C3AED', 'artifact-registry': '#A855F7',
  compute: '#0891B2', storage: '#C084FC', networking: '#2563EB',
};
const API_COLORS = ['#7C3AED', '#2563EB', '#0891B2', '#6366F1', '#A855F7'];
const API_PROVIDER_COLORS: Record<string, string> = { openai: '#00A3C4', anthropic: '#6366F1', kling: '#7C3AED' };
const VERIF_COLORS: Record<string, string> = { none: '#2563EB', self_critique: '#00A3C4', cross_model: '#6366F1', conditional: '#7C3AED', unknown: '#94A3B8' };
const VERIF_LABELS: Record<string, string> = { none: 'None', self_critique: 'Self-critique', cross_model: 'Cross-model', conditional: 'Conditional', unknown: 'Unknown' };
const COMPLEXITY_COLORS: Record<string, string> = { trivial: '#00A3C4', standard: '#2563EB', complex: '#6366F1', frontier: '#7C3AED', unknown: '#94A3B8' };
const COMPLEXITY_LABELS: Record<string, string> = { trivial: 'Trivial', standard: 'Standard', complex: 'Complex', frontier: 'Frontier', unknown: 'Unknown' };

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
